import { decryptJson, encryptJson, createSignedToken, verifySignedToken } from "./security";
import { isoNow, parseStoredJson, textValue } from "./http";
import type { IntegrationRow, JsonObject } from "./types";

interface OpenAISecret {
  apiKey: string;
  model: string;
}

interface GoogleSecret {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

async function integrationRow(env: Env, type: "openai" | "google"): Promise<IntegrationRow | null> {
  return env.DB.prepare("SELECT * FROM integrations WHERE integration_type = ?").bind(type).first<IntegrationRow>();
}

async function readEncryptedIntegration<T>(env: Env, type: "openai" | "google"): Promise<{ row: IntegrationRow; secret: T } | null> {
  const row = await integrationRow(env, type);
  if (!row?.encrypted_payload || !row.iv || !env.DATA_ENCRYPTION_KEY) return null;
  const secret = await decryptJson<T>(row.encrypted_payload, row.iv, env.DATA_ENCRYPTION_KEY);
  return { row, secret };
}

async function storeEncryptedIntegration(
  env: Env,
  type: "openai" | "google",
  status: IntegrationRow["status"],
  secret: unknown,
  metadata: JsonObject,
): Promise<void> {
  if (!env.DATA_ENCRYPTION_KEY) throw new Error("Falta configurar la llave de cifrado del CRM.");
  const encrypted = await encryptJson(secret, env.DATA_ENCRYPTION_KEY);
  await env.DB.prepare(`
    INSERT INTO integrations (integration_type, status, encrypted_payload, iv, metadata_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(integration_type) DO UPDATE SET
      status = excluded.status,
      encrypted_payload = excluded.encrypted_payload,
      iv = excluded.iv,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).bind(type, status, encrypted.encrypted, encrypted.iv, JSON.stringify(metadata), isoNow()).run();
}

export async function getIntegrationStatuses(env: Env): Promise<JsonObject> {
  const result = await env.DB.prepare("SELECT integration_type, status, metadata_json, updated_at FROM integrations").all<Pick<IntegrationRow, "integration_type" | "status" | "metadata_json" | "updated_at">>();
  const statuses: JsonObject = {
    openai: { status: "disconnected" },
    google: { status: "disconnected" },
  };
  for (const row of result.results) {
    statuses[row.integration_type] = {
      status: row.status,
      metadata: parseStoredJson<JsonObject>(row.metadata_json, {}),
      updatedAt: row.updated_at,
    };
  }
  return statuses;
}

export async function configureOpenAI(env: Env, body: JsonObject): Promise<JsonObject> {
  const apiKey = textValue(body.apiKey, 300);
  const model = textValue(body.model, 100) || env.OPENAI_MODEL || "gpt-5.6-luna";
  if (!apiKey.startsWith("sk-") || apiKey.length < 30) throw new Error("La clave de OpenAI no tiene un formato válido.");

  const test = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!test.ok) throw new Error("OpenAI rechazó la clave. Revisa que esté activa y tenga crédito disponible.");

  await storeEncryptedIntegration(env, "openai", "connected", { apiKey, model } satisfies OpenAISecret, {
    model,
    label: "OpenAI conectado",
  });
  return { status: "connected", model };
}

export async function disconnectIntegration(env: Env, type: "openai" | "google"): Promise<void> {
  await env.DB.prepare("DELETE FROM integrations WHERE integration_type = ?").bind(type).run();
}

export async function configureGoogle(env: Env, body: JsonObject): Promise<JsonObject> {
  const clientId = textValue(body.clientId, 300);
  const clientSecret = textValue(body.clientSecret, 300);
  if (!clientId.endsWith(".apps.googleusercontent.com") || clientSecret.length < 10) {
    throw new Error("Las credenciales de Google no tienen un formato válido.");
  }
  await storeEncryptedIntegration(env, "google", "configured", { clientId, clientSecret } satisfies GoogleSecret, {
    label: "Credenciales listas",
  });
  return { status: "configured" };
}

export async function googleAuthorizationUrl(request: Request, env: Env): Promise<string> {
  const stored = await readEncryptedIntegration<GoogleSecret>(env, "google");
  if (!stored) throw new Error("Primero agrega las credenciales de Google Calendar.");
  const origin = new URL(request.url).origin;
  const state = await createSignedToken({ exp: Date.now() + 10 * 60_000, nonce: crypto.randomUUID(), scope: "google:connect" }, env.SESSION_SECRET);
  const params = new URLSearchParams({
    client_id: stored.secret.clientId,
    redirect_uri: `${origin}/api/integrations/google/callback`,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: "openid email https://www.googleapis.com/auth/calendar.events",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function finishGoogleOAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const origin = url.origin;
  const verified = await verifySignedToken(state, env.SESSION_SECRET);
  if (verified?.scope !== "google:connect" || !code) {
    return Response.redirect(`${origin}/ajustes?google=error`, 302);
  }
  const stored = await readEncryptedIntegration<GoogleSecret>(env, "google");
  if (!stored) return Response.redirect(`${origin}/ajustes?google=missing`, 302);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: stored.secret.clientId,
      client_secret: stored.secret.clientSecret,
      redirect_uri: `${origin}/api/integrations/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) return Response.redirect(`${origin}/ajustes?google=error`, 302);
  const tokens = await tokenResponse.json() as JsonObject;
  const accessToken = textValue(tokens.access_token, 4_000);
  const refreshToken = textValue(tokens.refresh_token, 4_000) || stored.secret.refreshToken;
  const expiresIn = Number(tokens.expires_in || 3600);
  if (!accessToken || !refreshToken) return Response.redirect(`${origin}/ajustes?google=no_refresh`, 302);

  let email = "Cuenta de Google";
  const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (profile.ok) {
    const profileData = await profile.json() as JsonObject;
    email = textValue(profileData.email, 300) || email;
  }

  const secret: GoogleSecret = {
    ...stored.secret,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: textValue(tokens.scope, 1_000),
  };
  await storeEncryptedIntegration(env, "google", "connected", secret, { label: email, email });
  return Response.redirect(`${origin}/ajustes?google=connected`, 302);
}

async function googleAccessToken(env: Env): Promise<string | null> {
  const stored = await readEncryptedIntegration<GoogleSecret>(env, "google");
  if (!stored || stored.row.status !== "connected" || !stored.secret.refreshToken) return null;
  if (stored.secret.accessToken && (stored.secret.expiresAt || 0) > Date.now() + 60_000) return stored.secret.accessToken;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: stored.secret.clientId,
      client_secret: stored.secret.clientSecret,
      refresh_token: stored.secret.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) return null;
  const tokens = await response.json() as JsonObject;
  const accessToken = textValue(tokens.access_token, 4_000);
  if (!accessToken) return null;
  const secret = { ...stored.secret, accessToken, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 };
  await storeEncryptedIntegration(env, "google", "connected", secret, parseStoredJson<JsonObject>(stored.row.metadata_json, {}));
  return accessToken;
}

export async function createGoogleCalendarEvent(env: Env, event: {
  title: string;
  startsAt: string;
  endsAt: string;
  location: string;
  notes: string;
  attendeeEmail?: string;
}): Promise<{ id: string; htmlLink: string } | null> {
  const accessToken = await googleAccessToken(env);
  if (!accessToken) return null;
  const body: JsonObject = {
    summary: event.title,
    description: event.notes,
    location: event.location,
    start: { dateTime: event.startsAt, timeZone: "America/Mexico_City" },
    end: { dateTime: event.endsAt, timeZone: "America/Mexico_City" },
  };
  if (event.attendeeEmail) body.attendees = [{ email: event.attendeeEmail }];
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  const data = await response.json() as JsonObject;
  return { id: textValue(data.id, 500), htmlLink: textValue(data.htmlLink, 1_000) };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function outputText(response: JsonObject): string {
  const direct = textValue(response.output_text, 100_000);
  if (direct) return direct;
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as JsonObject).content) ? (item as JsonObject).content as unknown[] : [];
    for (const part of content) {
      if (part && typeof part === "object") {
        const text = textValue((part as JsonObject).text, 100_000);
        if (text) return text;
      }
    }
  }
  return "";
}

async function openAIRequest(env: Env, payload: JsonObject): Promise<JsonObject> {
  const stored = await readEncryptedIntegration<OpenAISecret>(env, "openai");
  if (!stored || stored.row.status !== "connected") throw new Error("Conecta OpenAI desde Ajustes para activar MaggIA.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${stored.secret.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: stored.secret.model, store: false, ...payload }),
  });
  const data = await response.json() as JsonObject;
  if (!response.ok) {
    const error = data.error && typeof data.error === "object" ? textValue((data.error as JsonObject).message, 500) : "OpenAI no pudo completar la solicitud.";
    throw new Error(error || "OpenAI no pudo completar la solicitud.");
  }
  return data;
}

const policySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    insurer: { type: ["string", "null"] },
    product: { type: ["string", "null"] },
    policy_number: { type: ["string", "null"] },
    policy_type: { type: ["string", "null"] },
    policyholder_name: { type: ["string", "null"] },
    insured_name: { type: ["string", "null"] },
    issue_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    start_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    end_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    renewal_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    premium_amount: { type: ["number", "null"] },
    premium_frequency: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    sum_insured: { type: ["number", "null"] },
    beneficiaries: { type: "array", items: { type: "string" } },
    payment_method: { type: ["string", "null"] },
    extraction_confidence: { type: "number", minimum: 0, maximum: 1 },
    extraction_notes: { type: "string" },
  },
  required: ["insurer", "product", "policy_number", "policy_type", "policyholder_name", "insured_name", "issue_date", "start_date", "end_date", "renewal_date", "premium_amount", "premium_frequency", "currency", "sum_insured", "beneficiaries", "payment_method", "extraction_confidence", "extraction_notes"],
};

export async function extractPolicy(file: File, env: Env): Promise<JsonObject> {
  if (file.size <= 0 || file.size > 8 * 1024 * 1024) throw new Error("La póliza debe pesar entre 1 byte y 8 MB.");
  const allowed = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
  if (!allowed.includes(file.type)) throw new Error("Usa un archivo PDF, Word o texto.");
  const base64 = arrayBufferToBase64(await file.arrayBuffer());
  const fileInput: JsonObject = { type: "input_file", filename: file.name.slice(0, 180), file_data: `data:${file.type};base64,${base64}` };
  if (file.type === "application/pdf") fileInput.detail = "high";
  const result = await openAIRequest(env, {
    input: [{
      role: "user",
      content: [
        fileInput,
        { type: "input_text", text: "Extrae únicamente la información explícita de esta póliza de seguro. No inventes datos. Si un dato no aparece, usa null. La fecha de renovación debe ser la próxima fecha contractual identificable. Devuelve los importes como números sin símbolos." },
      ],
    }],
    reasoning: { effort: "low" },
    max_output_tokens: 1_200,
    text: { verbosity: "low", format: { type: "json_schema", name: "policy_extraction", strict: true, schema: policySchema } },
  });
  const text = outputText(result);
  if (!text) throw new Error("No fue posible leer información de la póliza.");
  return JSON.parse(text) as JsonObject;
}

export async function askMaggia(env: Env, question: string, context: JsonObject): Promise<string> {
  const prompt = `Eres MaggIA, asistente privada del CRM de Maggie Salmerón, asesora financiera en México. Solo trabajas con la información del CRM incluida abajo. Tu función es informar el estado del CRM, recordar las citas próximas, priorizar seguimientos, explicar el embudo, detectar renovaciones, resumir clientes y redactar mensajes breves y humanos. Para preguntas como "qué debo atender hoy", empieza por citas y seguimientos vencidos o próximos, con fecha, hora y cliente. No inventes hechos, no des asesoría fiscal o legal definitiva y nunca afirmes que ya enviaste mensajes, cambiaste datos o agendaste algo. Si se solicita una acción, redacta la propuesta y pide confirmación. Responde en español, con tono cálido, claro y ejecutivo.\n\nCONTEXTO DEL CRM:\n${JSON.stringify(context).slice(0, 20_000)}\n\nSOLICITUD:\n${question}`;
  const result = await openAIRequest(env, { input: prompt, reasoning: { effort: "low" }, text: { verbosity: "low" }, max_output_tokens: 500 });
  return outputText(result) || "No pude preparar una respuesta en este momento.";
}

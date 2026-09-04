import { askMaggia, configureGoogle, configureOpenAI, createGoogleCalendarEvent, disconnectIntegration, extractPolicy, finishGoogleOAuth, getIntegrationStatuses, googleAuthorizationUrl } from "./server/integrations";
import { addActivity, analyticsOverview, createLead, createOrMergePublicLead, dashboard, deleteLead, getLead, listAppointments, listLeads, listRenewals, maggiaContext, recordAnalyticsEvent, saveAppointment, savePolicy, updateLead } from "./server/data";
import { fail, isMutation, json, readJson, textValue } from "./server/http";
import { changeAdminPassword, clearLoginAttempts, clearSessionCookie, createSignedToken, isAuthenticated, loginRateLimited, recordFailedLogin, sessionCookie, verifyAdminPassword } from "./server/security";
import type { JsonObject } from "./server/types";

const PUBLIC_EVENTS = "/api/public/events";
const PUBLIC_LEADS = "/api/public/leads";

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("origin") || "";
  const allowed = [env.PUBLIC_LANDING_ORIGIN, "https://www.maggiesalmeron.com"];
  if (origin.startsWith("http://127.0.0.1:") || origin.startsWith("http://localhost:")) allowed.push(origin);
  return allowed.includes(origin) ? {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "Origin",
  } : {};
}

function publicOriginAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin") || "";
  return origin === env.PUBLIC_LANDING_ORIGIN || origin === "https://www.maggiesalmeron.com" || origin.startsWith("http://127.0.0.1:") || origin.startsWith("http://localhost:");
}

function protectedMutationOriginAllowed(request: Request): boolean {
  if (!isMutation(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const requestOrigin = new URL(request.url).origin;
  return origin === requestOrigin || (origin.startsWith("http://localhost:") && requestOrigin.startsWith("http://127.0.0.1:"));
}

async function handleAuth(request: Request, env: Env, pathname: string): Promise<Response | null> {
  if (pathname === "/api/auth/session" && request.method === "GET") {
    return json({ authenticated: await isAuthenticated(request, env) });
  }
  if (pathname === "/api/auth/login" && request.method === "POST") {
    if (!protectedMutationOriginAllowed(request)) return fail("Origen no permitido.", 403);
    if (await loginRateLimited(request, env)) return fail("Demasiados intentos. Espera 15 minutos antes de volver a intentar.", 429);
    const body = await readJson(request, 4_000);
    const password = textValue(body.password, 200);
    const valid = await verifyAdminPassword(password, env);
    if (!valid) {
      await recordFailedLogin(request, env);
      return fail("Contraseña incorrecta.", 401);
    }
    await clearLoginAttempts(request, env);
    const token = await createSignedToken({ exp: Date.now() + 12 * 60 * 60_000, scope: "crm:admin", nonce: crypto.randomUUID() }, env.SESSION_SECRET);
    return json({ authenticated: true }, 200, { "set-cookie": sessionCookie(token, request) });
  }
  if (pathname === "/api/auth/logout" && request.method === "POST") {
    return json({ authenticated: false }, 200, { "set-cookie": clearSessionCookie(request) });
  }
  return null;
}

async function handlePublic(request: Request, env: Env, pathname: string): Promise<Response | null> {
  if (pathname !== PUBLIC_EVENTS && pathname !== PUBLIC_LEADS) return null;
  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return fail("Método no permitido.", 405);
  if (!publicOriginAllowed(request, env)) return fail("Origen no permitido.", 403);
  try {
    const body = await readJson(request);
    if (pathname === PUBLIC_EVENTS) {
      await recordAnalyticsEvent(env, body);
      return json({ ok: true }, 201, cors);
    }
    const result = await createOrMergePublicLead(env, body);
    if (!result.ignored) {
      await recordAnalyticsEvent(env, {
        event_type: "lead_created",
        anonymous_session_id: body.anonymous_session_id ?? body.sessionId,
        calculator_type: body.calculator_type ?? body.interest_type,
        metadata: { leadId: result.id, merged: result.merged },
      });
    }
    return json({ ok: true, leadId: result.id || undefined, merged: result.merged }, 201, cors);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar la información.";
    return json({ error: message }, 400, cors);
  }
}

async function appointmentWithGoogle(env: Env, body: JsonObject): Promise<Response> {
  const leadId = textValue(body.lead_id ?? body.leadId, 100);
  let attendeeEmail = "";
  if (leadId) {
    const row = await env.DB.prepare("SELECT email FROM leads WHERE id = ?").bind(leadId).first<{ email: string }>();
    attendeeEmail = row?.email || "";
  }
  const syncGoogle = body.sync_google !== false && body.syncGoogle !== false;
  let google: { id: string; htmlLink: string } | null = null;
  if (syncGoogle) {
    google = await createGoogleCalendarEvent(env, {
      title: textValue(body.title, 300),
      startsAt: textValue(body.starts_at ?? body.startsAt, 40),
      endsAt: textValue(body.ends_at ?? body.endsAt, 40),
      location: textValue(body.location, 500),
      notes: textValue(body.notes, 3_000),
      attendeeEmail: attendeeEmail || undefined,
    });
    if (!google) {
      const compactDate = (value: unknown) => {
        const parsed = new Date(textValue(value, 40));
        return Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z") : "";
      };
      const parameters = new URLSearchParams({
        action: "TEMPLATE",
        text: textValue(body.title, 300),
        dates: `${compactDate(body.starts_at ?? body.startsAt)}/${compactDate(body.ends_at ?? body.endsAt)}`,
        details: textValue(body.notes, 3_000),
        location: textValue(body.location, 500),
      });
      if (attendeeEmail) parameters.set("add", attendeeEmail);
      google = { id: "", htmlLink: `https://calendar.google.com/calendar/render?${parameters.toString()}` };
    }
  }
  const saved = await saveAppointment(env, body, google);
  return json({ ok: true, ...saved });
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, "") || "/";

  const publicResponse = await handlePublic(request, env, pathname);
  if (publicResponse) return publicResponse;
  const authResponse = await handleAuth(request, env, pathname);
  if (authResponse) return authResponse;

  if (pathname === "/api/integrations/google/callback" && request.method === "GET") {
    if (!await isAuthenticated(request, env)) return Response.redirect(`${url.origin}/?sesion=expired`, 302);
    return finishGoogleOAuth(request, env);
  }

  if (!await isAuthenticated(request, env)) return fail("Tu sesión terminó. Vuelve a ingresar.", 401);
  if (!protectedMutationOriginAllowed(request)) return fail("Origen no permitido.", 403);

  if (pathname === "/api/dashboard" && request.method === "GET") return json(await dashboard(env));
  if (pathname === "/api/analytics" && request.method === "GET") return json(await analyticsOverview(env, Number(url.searchParams.get("days") || 30)));
  if (pathname === "/api/renewals" && request.method === "GET") return json(await listRenewals(env));
  if (pathname === "/api/appointments" && request.method === "GET") return json(await listAppointments(env, url));
  if (pathname === "/api/appointments" && request.method === "POST") return appointmentWithGoogle(env, await readJson(request));
  if (pathname === "/api/leads" && request.method === "GET") return json(await listLeads(env, url));
  if (pathname === "/api/leads" && request.method === "POST") return json(await createLead(env, await readJson(request)), 201);

  const leadMatch = pathname.match(/^\/api\/leads\/([a-zA-Z0-9-]+)$/);
  if (leadMatch && request.method === "GET") {
    const bundle = await getLead(env, leadMatch[1]);
    return bundle ? json(bundle) : fail("El prospecto no existe.", 404);
  }
  if (leadMatch && request.method === "PUT") {
    const bundle = await updateLead(env, leadMatch[1], await readJson(request));
    return bundle ? json(bundle) : fail("El prospecto no existe.", 404);
  }
  if (leadMatch && request.method === "DELETE") {
    const deleted = await deleteLead(env, leadMatch[1]);
    return deleted ? json({ ok: true, deletedId: leadMatch[1] }) : fail("El prospecto no existe.", 404);
  }

  const activityMatch = pathname.match(/^\/api\/leads\/([a-zA-Z0-9-]+)\/activities$/);
  if (activityMatch && request.method === "POST") return json(await addActivity(env, activityMatch[1], await readJson(request)), 201);

  const policyMatch = pathname.match(/^\/api\/leads\/([a-zA-Z0-9-]+)\/policies$/);
  if (policyMatch && request.method === "POST") return json(await savePolicy(env, policyMatch[1], await readJson(request, 96_000)), 201);

  const extractMatch = pathname.match(/^\/api\/leads\/([a-zA-Z0-9-]+)\/policies\/extract$/);
  if (extractMatch && request.method === "POST") {
    const lead = await env.DB.prepare("SELECT id FROM leads WHERE id = ?").bind(extractMatch[1]).first<{ id: string }>();
    if (!lead) return fail("El cliente no existe.", 404);
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 9 * 1024 * 1024) return fail("El archivo supera el límite de 8 MB.", 413);
    const form = await request.formData();
    const file = form.get("policy");
    if (!(file instanceof File)) return fail("Selecciona una póliza.");
    return json({ ok: true, policy: await extractPolicy(file, env), retained: false });
  }

  if (pathname === "/api/integrations" && request.method === "GET") return json(await getIntegrationStatuses(env));
  if (pathname === "/api/integrations/openai" && request.method === "POST") return json({ ok: true, ...(await configureOpenAI(env, await readJson(request, 8_000))) });
  if (pathname === "/api/integrations/google" && request.method === "POST") return json({ ok: true, ...(await configureGoogle(env, await readJson(request, 8_000))) });
  if (pathname === "/api/integrations/google/authorize" && request.method === "GET") return json({ url: await googleAuthorizationUrl(request, env) });
  const disconnectMatch = pathname.match(/^\/api\/integrations\/(openai|google)$/);
  if (disconnectMatch && request.method === "DELETE") {
    await disconnectIntegration(env, disconnectMatch[1] as "openai" | "google");
    return json({ ok: true });
  }

  if (pathname === "/api/maggia" && request.method === "POST") {
    const body = await readJson(request, 16_000);
    const question = textValue(body.question, 2_000);
    if (!question) return fail("Escribe una pregunta para MaggIA.");
    const leadId = textValue(body.leadId, 100) || undefined;
    const context = await maggiaContext(env, leadId);
    return json({ answer: await askMaggia(env, question, context) });
  }

  if (pathname === "/api/notifications" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT * FROM notifications WHERE read_at IS NULL ORDER BY due_at ASC, created_at DESC LIMIT 50").all();
    return json({ notifications: result.results });
  }
  if (pathname === "/api/settings/password" && request.method === "POST") {
    const body = await readJson(request, 4_000);
    await changeAdminPassword(textValue(body.currentPassword, 200), textValue(body.newPassword, 200), env);
    return json({ ok: true });
  }
  const notificationMatch = pathname.match(/^\/api\/notifications\/([a-zA-Z0-9-]+)\/read$/);
  if (notificationMatch && request.method === "POST") {
    await env.DB.prepare("UPDATE notifications SET read_at = ? WHERE id = ?").bind(new Date().toISOString(), notificationMatch[1]).run();
    return json({ ok: true });
  }

  return fail("Ruta no encontrada.", 404);
}

async function scheduled(env: Env): Promise<void> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const inThirty = new Date(now.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE window_started_at < ?").bind(new Date(now.getTime() - 24 * 60 * 60_000).toISOString()),
    env.DB.prepare("UPDATE policies SET policy_status = 'por_renovar', updated_at = ? WHERE renewal_date BETWEEN ? AND ? AND policy_status = 'vigente'").bind(now.toISOString(), today, inThirty),
    env.DB.prepare(`
      INSERT INTO notifications (id, notification_type, entity_id, title, body, due_at, created_at)
      SELECT lower(hex(randomblob(16))), 'renovacion', p.id, 'Renovación próxima', l.full_name || ' · ' || COALESCE(NULLIF(p.product,''), 'Póliza'), p.renewal_date, ?
      FROM policies p JOIN leads l ON l.id = p.lead_id
      WHERE p.renewal_date BETWEEN ? AND ? AND p.policy_status IN ('vigente','por_renovar')
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.notification_type = 'renovacion' AND n.entity_id = p.id AND n.due_at = p.renewal_date)
    `).bind(now.toISOString(), today, inThirty),
  ]);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await api(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ocurrió un error inesperado.";
      console.error(JSON.stringify({ level: "error", message, path: new URL(request.url).pathname }));
      return fail(message, 500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduled(env));
  },
} satisfies ExportedHandler<Env>;

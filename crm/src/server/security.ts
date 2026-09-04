import { isoNow } from "./http";

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function passwordDigest(password: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`maggia-password:${password}`));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function secureEqual(left: string, right: string): Promise<boolean> {
  const key = await hmacKey("maggia-constant-time-comparison");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(left));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(right));
}

export async function verifyAdminPassword(password: string, env: Env): Promise<boolean> {
  const saved = await env.DB.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'password_digest'").first<{ setting_value: string }>();
  if (saved?.setting_value) return secureEqual(await passwordDigest(password, env.SESSION_SECRET), saved.setting_value);
  return Boolean(env.CRM_PASSWORD) && secureEqual(password, env.CRM_PASSWORD);
}

export async function changeAdminPassword(currentPassword: string, newPassword: string, env: Env): Promise<void> {
  if (!await verifyAdminPassword(currentPassword, env)) throw new Error("La contraseña actual no es correcta.");
  if (newPassword.length < 8) throw new Error("La nueva contraseña debe tener al menos 8 caracteres.");
  const digest = await passwordDigest(newPassword, env.SESSION_SECRET);
  await env.DB.prepare("INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES ('password_digest', ?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at")
    .bind(digest, isoNow()).run();
}

export async function createSignedToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(encoded));
  return `${encoded}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifySignedToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), base64UrlToBuffer(signature), encoder.encode(payload));
    if (!valid) return null;
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBuffer(payload))) as Record<string, unknown>;
    const expiresAt = typeof parsed.exp === "number" ? parsed.exp : 0;
    return expiresAt > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}

export function getCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

export function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `maggia_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure}`;
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `maggia_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const token = getCookie(request, "maggia_session");
  if (!token || !env.SESSION_SECRET) return false;
  const payload = await verifySignedToken(token, env.SESSION_SECRET);
  return payload?.scope === "crm:admin";
}

export async function loginRateLimited(request: Request, env: Env): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(`${ip}:${env.SESSION_SECRET}`));
  const identity = bytesToBase64Url(new Uint8Array(hash));
  const row = await env.DB.prepare("SELECT window_started_at, attempt_count FROM login_attempts WHERE identity_hash = ?")
    .bind(identity).first<{ window_started_at: string; attempt_count: number }>();
  if (!row) return false;
  const windowAge = Date.now() - new Date(row.window_started_at).getTime();
  return windowAge < 15 * 60_000 && row.attempt_count >= 8;
}

export async function recordFailedLogin(request: Request, env: Env): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(`${ip}:${env.SESSION_SECRET}`));
  const identity = bytesToBase64Url(new Uint8Array(hash));
  const row = await env.DB.prepare("SELECT window_started_at, attempt_count FROM login_attempts WHERE identity_hash = ?")
    .bind(identity).first<{ window_started_at: string; attempt_count: number }>();
  const expired = !row || Date.now() - new Date(row.window_started_at).getTime() >= 15 * 60_000;
  if (expired) {
    await env.DB.prepare("INSERT INTO login_attempts (identity_hash, window_started_at, attempt_count) VALUES (?, ?, 1) ON CONFLICT(identity_hash) DO UPDATE SET window_started_at = excluded.window_started_at, attempt_count = 1")
      .bind(identity, isoNow()).run();
  } else {
    await env.DB.prepare("UPDATE login_attempts SET attempt_count = attempt_count + 1 WHERE identity_hash = ?").bind(identity).run();
  }
}

export async function clearLoginAttempts(request: Request, env: Env): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(`${ip}:${env.SESSION_SECRET}`));
  const identity = bytesToBase64Url(new Uint8Array(hash));
  await env.DB.prepare("DELETE FROM login_attempts WHERE identity_hash = ?").bind(identity).run();
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const bytes = base64UrlToBuffer(secret);
  if (bytes.byteLength !== 32) throw new Error("La llave de cifrado del servidor no está configurada correctamente.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptJson(value: unknown, secret: string): Promise<{ encrypted: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), plaintext);
  return { encrypted: bytesToBase64Url(new Uint8Array(encrypted)), iv: bytesToBase64Url(iv) };
}

export async function decryptJson<T>(encrypted: string, iv: string, secret: string): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBuffer(iv) },
    await encryptionKey(secret),
    base64UrlToBuffer(encrypted),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

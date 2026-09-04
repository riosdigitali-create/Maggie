import type { JsonObject } from "./types";

const DEFAULT_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...DEFAULT_HEADERS, ...headers },
  });
}

export function fail(message: string, status = 400, detail?: unknown): Response {
  return json({ ok: false, error: message, ...(detail === undefined ? {} : { detail }) }, status);
}

export async function readJson(request: Request, maxBytes = 64_000): Promise<JsonObject> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("La solicitud es demasiado grande.");
  const value: unknown = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Formato inválido.");
  return value as JsonObject;
}

export function textValue(value: unknown, maxLength = 500): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function numberValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function nullableText(value: unknown, maxLength = 500): string | null {
  const text = textValue(value, maxLength);
  return text || null;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function safeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value).slice(0, 25_000);
  } catch {
    return null;
  }
}

export function parseStoredJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function isMutation(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

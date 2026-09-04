import { isoNow, nullableText, numberValue, parseStoredJson, safeJson, textValue } from "./http";
import type { ActivityRow, AppointmentRow, InterestType, JsonObject, LeadRow, LeadStatus, PolicyRow } from "./types";

const LEAD_STATUSES: LeadStatus[] = ["nuevo", "contactado", "cita", "propuesta", "cerrado", "no_interesado"];
const INTEREST_TYPES: InterestType[] = ["retiro", "vida", "ambos", "otro"];
const ACTIVITY_TYPES = ["nota", "llamada", "whatsapp", "correo", "cita", "propuesta", "cambio_estado"];
const POLICY_STATUSES = ["vigente", "por_renovar", "vencida", "cancelada", "en_tramite"];

function statusValue(value: unknown): LeadStatus {
  const status = textValue(value, 30) as LeadStatus;
  return LEAD_STATUSES.includes(status) ? status : "nuevo";
}

function interestValue(value: unknown): InterestType {
  const interest = textValue(value, 30) as InterestType;
  return INTEREST_TYPES.includes(interest) ? interest : "otro";
}

function serializeLead(row: LeadRow): JsonObject {
  return {
    ...row,
    calculation: parseStoredJson<JsonObject | null>(row.calculation_json, null),
    calculation_json: undefined,
  };
}

function serializePolicy(row: PolicyRow): JsonObject {
  return {
    ...row,
    beneficiaries: parseStoredJson<string[]>(row.beneficiaries_json, []),
    beneficiaries_json: undefined,
  };
}

function validDateTime(value: unknown): string | null {
  const text = textValue(value, 40);
  return text && Number.isFinite(new Date(text).getTime()) ? text : null;
}

function validDate(value: unknown): string | null {
  const text = textValue(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export async function listLeads(env: Env, url: URL): Promise<JsonObject> {
  const search = (url.searchParams.get("search") || "").trim().slice(0, 100);
  const requestedStatus = url.searchParams.get("status") || "";
  const status = LEAD_STATUSES.includes(requestedStatus as LeadStatus) ? requestedStatus : "";
  const values: unknown[] = [];
  const clauses: string[] = [];
  if (status) {
    clauses.push("status = ?");
    values.push(status);
  }
  if (search) {
    clauses.push("(full_name LIKE ? OR email LIKE ? OR phone LIKE ?)");
    const term = `%${search.replace(/[%_]/g, "")}%`;
    values.push(term, term, term);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await env.DB.prepare(`SELECT * FROM leads ${where} ORDER BY updated_at DESC LIMIT 500`).bind(...values).all<LeadRow>();
  return { leads: result.results.map(serializeLead) };
}

export async function getLead(env: Env, id: string): Promise<JsonObject | null> {
  const lead = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first<LeadRow>();
  if (!lead) return null;
  const [activities, policies, appointments] = await Promise.all([
    env.DB.prepare("SELECT * FROM activities WHERE lead_id = ? ORDER BY occurred_at DESC, created_at DESC").bind(id).all<ActivityRow>(),
    env.DB.prepare("SELECT * FROM policies WHERE lead_id = ? ORDER BY renewal_date ASC, created_at DESC").bind(id).all<PolicyRow>(),
    env.DB.prepare("SELECT * FROM appointments WHERE lead_id = ? ORDER BY starts_at DESC").bind(id).all<AppointmentRow>(),
  ]);
  return {
    lead: serializeLead(lead),
    activities: activities.results,
    policies: policies.results.map(serializePolicy),
    appointments: appointments.results,
  };
}

export async function createLead(env: Env, body: JsonObject, source = "manual"): Promise<JsonObject> {
  const fullName = textValue(body.full_name ?? body.fullName, 200);
  const email = textValue(body.email, 300).toLowerCase();
  const phone = textValue(body.phone, 50);
  if (!fullName) throw new Error("El nombre es obligatorio.");
  if (!email && !phone) throw new Error("Agrega por lo menos correo o teléfono.");
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error("El correo no tiene un formato válido.");
  const now = isoNow();
  const id = crypto.randomUUID();
  const interest = interestValue(body.interest_type ?? body.interestType);
  const status = statusValue(body.status);
  const calculation = body.calculation && typeof body.calculation === "object" ? body.calculation : null;
  const calculatedAmount = numberValue(body.calculated_amount ?? body.calculatedAmount);
  const annualBudget = numberValue(body.annual_budget ?? body.annualBudget);
  const notes = textValue(body.notes, 5_000);
  const nextFollowUp = validDateTime(body.next_follow_up_at ?? body.nextFollowUpAt);

  await env.DB.prepare(`
    INSERT INTO leads (id, full_name, email, phone, source, status, interest_type, calculation_json, calculated_amount, annual_budget, notes, next_follow_up_at, last_activity_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, fullName, email, phone, source, status, interest, safeJson(calculation), calculatedAmount, annualBudget, notes, nextFollowUp, now, now, now).run();
  const bundle = await getLead(env, id);
  if (!bundle) throw new Error("No fue posible crear el prospecto.");
  return bundle;
}

export async function createOrMergePublicLead(env: Env, body: JsonObject): Promise<{ id: string; merged: boolean }> {
  const fullName = textValue(body.full_name ?? body.fullName, 200);
  const email = textValue(body.email, 300).toLowerCase();
  const phone = textValue(body.phone, 50);
  const honeypot = textValue(body.company, 200);
  if (honeypot) return { id: crypto.randomUUID(), merged: false };
  if (!fullName || !email || !phone) throw new Error("Completa nombre, correo y teléfono.");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("El correo no tiene un formato válido.");
  if (phone.replace(/\D/g, "").length < 10) throw new Error("El teléfono debe tener al menos 10 dígitos.");

  const existing = await env.DB.prepare(`
    SELECT id FROM leads
    WHERE (lower(email) = ? OR replace(replace(replace(phone, ' ', ''), '-', ''), '+', '') = ?)
      AND status != 'no_interesado'
    ORDER BY updated_at DESC LIMIT 1
  `).bind(email, phone.replace(/[\s+\-()]/g, "")).first<{ id: string }>();
  const now = isoNow();
  const interest = interestValue(body.interest_type ?? body.calculator_type);
  const calculation = body.calculation && typeof body.calculation === "object" ? body.calculation : null;
  const calculatedAmount = numberValue(body.calculated_amount);
  const annualBudget = numberValue(body.annual_budget);

  if (existing) {
    await env.DB.prepare(`
      UPDATE leads SET full_name = ?, email = ?, phone = ?, source = 'landing', interest_type = ?, calculation_json = ?, calculated_amount = ?, annual_budget = ?, updated_at = ?, last_activity_at = ?
      WHERE id = ?
    `).bind(fullName, email, phone, interest, safeJson(calculation), calculatedAmount, annualBudget, now, now, existing.id).run();
    await env.DB.prepare("INSERT INTO activities (id, lead_id, occurred_at, activity_type, note, created_at) VALUES (?, ?, ?, 'nota', ?, ?)")
      .bind(crypto.randomUUID(), existing.id, now, "Actualizó su cálculo desde la landing.", now).run();
    return { id: existing.id, merged: true };
  }

  const created = await createLead(env, {
    full_name: fullName,
    email,
    phone,
    source: "landing",
    status: "nuevo",
    interest_type: interest,
    calculation,
    calculated_amount: calculatedAmount,
    annual_budget: annualBudget,
  }, "landing");
  const lead = created.lead as JsonObject;
  return { id: String(lead.id), merged: false };
}

export async function updateLead(env: Env, id: string, body: JsonObject): Promise<JsonObject | null> {
  const existing = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first<LeadRow>();
  if (!existing) return null;
  const fullName = textValue(body.full_name ?? body.fullName, 200) || existing.full_name;
  const email = body.email === undefined ? existing.email : textValue(body.email, 300).toLowerCase();
  const phone = body.phone === undefined ? existing.phone : textValue(body.phone, 50);
  const status = body.status === undefined ? existing.status : statusValue(body.status);
  const interest = body.interest_type === undefined && body.interestType === undefined ? existing.interest_type : interestValue(body.interest_type ?? body.interestType);
  const notes = body.notes === undefined ? existing.notes : textValue(body.notes, 5_000);
  const nextFollowUp = body.next_follow_up_at === undefined && body.nextFollowUpAt === undefined ? existing.next_follow_up_at : validDateTime(body.next_follow_up_at ?? body.nextFollowUpAt);
  const now = isoNow();
  const statements = [
    env.DB.prepare("UPDATE leads SET full_name = ?, email = ?, phone = ?, status = ?, interest_type = ?, notes = ?, next_follow_up_at = ?, updated_at = ? WHERE id = ?")
      .bind(fullName, email, phone, status, interest, notes, nextFollowUp, now, id),
  ];
  if (status !== existing.status) {
    statements.push(env.DB.prepare("INSERT INTO activities (id, lead_id, occurred_at, activity_type, note, created_at) VALUES (?, ?, ?, 'cambio_estado', ?, ?)")
      .bind(crypto.randomUUID(), id, now, `Etapa actualizada de ${existing.status} a ${status}.`, now));
  }
  await env.DB.batch(statements);
  return getLead(env, id);
}

export async function addActivity(env: Env, leadId: string, body: JsonObject): Promise<JsonObject> {
  const note = textValue(body.note, 5_000);
  if (!note) throw new Error("Escribe una nota de seguimiento.");
  const requestedType = textValue(body.activity_type ?? body.activityType, 30);
  const type = ACTIVITY_TYPES.includes(requestedType) ? requestedType : "nota";
  const occurredAt = validDateTime(body.occurred_at ?? body.occurredAt) || isoNow();
  const nextAction = validDateTime(body.next_action_at ?? body.nextActionAt);
  const now = isoNow();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO activities (id, lead_id, occurred_at, activity_type, note, next_action_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), leadId, occurredAt, type, note, nextAction, now),
    env.DB.prepare("UPDATE leads SET next_follow_up_at = COALESCE(?, next_follow_up_at), last_activity_at = ?, updated_at = ? WHERE id = ?")
      .bind(nextAction, occurredAt, now, leadId),
  ]);
  const bundle = await getLead(env, leadId);
  if (!bundle) throw new Error("El prospecto no existe.");
  return bundle;
}

export async function savePolicy(env: Env, leadId: string, body: JsonObject): Promise<JsonObject> {
  const lead = await env.DB.prepare("SELECT id FROM leads WHERE id = ?").bind(leadId).first<{ id: string }>();
  if (!lead) throw new Error("El cliente no existe.");
  const now = isoNow();
  const id = crypto.randomUUID();
  const beneficiaries = Array.isArray(body.beneficiaries) ? body.beneficiaries.map(item => textValue(item, 200)).filter(Boolean).slice(0, 20) : [];
  const requestedStatus = textValue(body.policy_status ?? body.policyStatus, 30);
  const policyStatus = POLICY_STATUSES.includes(requestedStatus) ? requestedStatus : "vigente";
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO policies (id, lead_id, insurer, product, policy_number, policy_type, policyholder_name, insured_name, issue_date, start_date, end_date, renewal_date, premium_amount, premium_frequency, currency, sum_insured, beneficiaries_json, payment_method, policy_status, advisor, extraction_confidence, extraction_notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, leadId, textValue(body.insurer, 200), textValue(body.product, 200), textValue(body.policy_number, 200), textValue(body.policy_type, 100),
      textValue(body.policyholder_name, 200), textValue(body.insured_name, 200), validDate(body.issue_date), validDate(body.start_date), validDate(body.end_date), validDate(body.renewal_date),
      numberValue(body.premium_amount), textValue(body.premium_frequency, 100), textValue(body.currency, 10) || "MXN", numberValue(body.sum_insured), JSON.stringify(beneficiaries),
      textValue(body.payment_method, 100), policyStatus, textValue(body.advisor, 200) || "Maggie Salmerón", numberValue(body.extraction_confidence), textValue(body.extraction_notes, 2_000), now, now,
    ),
    env.DB.prepare("UPDATE leads SET status = 'cerrado', updated_at = ?, last_activity_at = ? WHERE id = ?").bind(now, now, leadId),
    env.DB.prepare("INSERT INTO activities (id, lead_id, occurred_at, activity_type, note, created_at) VALUES (?, ?, ?, 'cambio_estado', ?, ?)")
      .bind(crypto.randomUUID(), leadId, now, "Póliza registrada. El prospecto pasó a cliente.", now),
  ]);
  const bundle = await getLead(env, leadId);
  if (!bundle) throw new Error("No fue posible guardar la póliza.");
  return bundle;
}

export async function listAppointments(env: Env, url: URL): Promise<JsonObject> {
  const from = validDateTime(url.searchParams.get("from")) || new Date(Date.now() - 30 * 86400_000).toISOString();
  const to = validDateTime(url.searchParams.get("to")) || new Date(Date.now() + 180 * 86400_000).toISOString();
  const result = await env.DB.prepare(`
    SELECT a.*, l.full_name FROM appointments a LEFT JOIN leads l ON l.id = a.lead_id
    WHERE a.starts_at BETWEEN ? AND ? ORDER BY a.starts_at ASC
  `).bind(from, to).all<AppointmentRow>();
  return { appointments: result.results };
}

export async function saveAppointment(env: Env, body: JsonObject, google?: { id: string; htmlLink: string } | null): Promise<JsonObject> {
  const title = textValue(body.title, 300);
  const startsAt = validDateTime(body.starts_at ?? body.startsAt);
  const endsAt = validDateTime(body.ends_at ?? body.endsAt);
  if (!title || !startsAt || !endsAt) throw new Error("Completa título, inicio y fin de la cita.");
  if (new Date(endsAt) <= new Date(startsAt)) throw new Error("La hora final debe ser posterior al inicio.");
  const leadId = nullableText(body.lead_id ?? body.leadId, 100);
  if (leadId) {
    const lead = await env.DB.prepare("SELECT id FROM leads WHERE id = ?").bind(leadId).first<{ id: string }>();
    if (!lead) throw new Error("El prospecto seleccionado no existe.");
  }
  const id = crypto.randomUUID();
  const now = isoNow();
  await env.DB.prepare(`
    INSERT INTO appointments (id, lead_id, title, starts_at, ends_at, location, notes, appointment_status, google_event_id, google_event_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'programada', ?, ?, ?, ?)
  `).bind(id, leadId, title, startsAt, endsAt, textValue(body.location, 500), textValue(body.notes, 3_000), google?.id || null, google?.htmlLink || null, now, now).run();
  if (leadId) {
    await env.DB.batch([
      env.DB.prepare("UPDATE leads SET status = 'cita', next_follow_up_at = ?, updated_at = ?, last_activity_at = ? WHERE id = ?").bind(startsAt, now, now, leadId),
      env.DB.prepare("INSERT INTO activities (id, lead_id, occurred_at, activity_type, note, next_action_at, created_at) VALUES (?, ?, ?, 'cita', ?, ?, ?)")
        .bind(crypto.randomUUID(), leadId, now, `Cita agendada: ${title}.`, startsAt, now),
    ]);
  }
  const row = await env.DB.prepare("SELECT * FROM appointments WHERE id = ?").bind(id).first<AppointmentRow>();
  return { appointment: row, syncedToGoogle: Boolean(google?.id) };
}

export async function listRenewals(env: Env): Promise<JsonObject> {
  const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10);
  const result = await env.DB.prepare(`
    SELECT p.*, l.full_name, l.email, l.phone
    FROM policies p JOIN leads l ON l.id = p.lead_id
    WHERE p.renewal_date BETWEEN ? AND ? AND p.policy_status IN ('vigente','por_renovar')
    ORDER BY p.renewal_date ASC
  `).bind(from, to).all<PolicyRow & { full_name: string; email: string; phone: string }>();
  return { renewals: result.results.map(row => ({ ...serializePolicy(row), full_name: row.full_name, email: row.email, phone: row.phone })) };
}

export async function analyticsOverview(env: Env, days = 30): Promise<JsonObject> {
  const since = new Date(Date.now() - Math.min(Math.max(days, 7), 365) * 86400_000).toISOString();
  const [totals, daily] = await Promise.all([
    env.DB.prepare("SELECT event_type, COUNT(*) AS total, COUNT(DISTINCT anonymous_session_id) AS sessions FROM analytics_events WHERE occurred_at >= ? GROUP BY event_type")
      .bind(since).all<{ event_type: string; total: number; sessions: number }>(),
    env.DB.prepare("SELECT substr(occurred_at, 1, 10) AS day, event_type, COUNT(*) AS total FROM analytics_events WHERE occurred_at >= ? GROUP BY day, event_type ORDER BY day ASC")
      .bind(since).all<{ day: string; event_type: string; total: number }>(),
  ]);
  return { since, totals: totals.results, daily: daily.results };
}

export async function recordAnalyticsEvent(env: Env, body: JsonObject): Promise<void> {
  const allowed = ["page_view", "calculator_selected", "calculation_started", "calculation_completed", "lead_created", "whatsapp_clicked", "appointment_intent"];
  const eventType = textValue(body.event_type ?? body.eventType, 50);
  const sessionId = textValue(body.anonymous_session_id ?? body.sessionId, 100);
  if (!allowed.includes(eventType) || !sessionId) throw new Error("Evento inválido.");
  const calculatorType = textValue(body.calculator_type ?? body.calculatorType, 30) || null;
  await env.DB.prepare("INSERT INTO analytics_events (id, anonymous_session_id, event_type, calculator_type, metadata_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), sessionId, eventType, calculatorType, safeJson(body.metadata), isoNow()).run();
}

export async function dashboard(env: Env): Promise<JsonObject> {
  const today = new Date().toISOString();
  const monthStart = `${today.slice(0, 7)}-01T00:00:00.000Z`;
  const inSeven = new Date(Date.now() + 7 * 86400_000).toISOString();
  const inNinetyDate = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  const todayDate = today.slice(0, 10);
  const [pipeline, total, month, followUps, appointments, renewals, analytics] = await Promise.all([
    env.DB.prepare("SELECT status, COUNT(*) AS total FROM leads GROUP BY status").all<{ status: string; total: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM leads").first<{ total: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM leads WHERE created_at >= ?").bind(monthStart).first<{ total: number }>(),
    env.DB.prepare("SELECT id, full_name, phone, next_follow_up_at, status FROM leads WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at <= ? AND status NOT IN ('cerrado','no_interesado') ORDER BY next_follow_up_at ASC LIMIT 12")
      .bind(inSeven).all<{ id: string; full_name: string; phone: string; next_follow_up_at: string; status: string }>(),
    env.DB.prepare("SELECT a.*, l.full_name FROM appointments a LEFT JOIN leads l ON l.id = a.lead_id WHERE starts_at >= ? AND starts_at <= ? AND appointment_status = 'programada' ORDER BY starts_at ASC LIMIT 8")
      .bind(today, inSeven).all<AppointmentRow>(),
    env.DB.prepare("SELECT p.id, p.lead_id, p.product, p.insurer, p.renewal_date, l.full_name FROM policies p JOIN leads l ON l.id = p.lead_id WHERE p.renewal_date BETWEEN ? AND ? AND p.policy_status IN ('vigente','por_renovar') ORDER BY p.renewal_date ASC LIMIT 8")
      .bind(todayDate, inNinetyDate).all<{ id: string; lead_id: string; product: string; insurer: string; renewal_date: string; full_name: string }>(),
    analyticsOverview(env, 30),
  ]);
  return {
    totals: { all: total?.total || 0, thisMonth: month?.total || 0 },
    pipeline: pipeline.results,
    followUps: followUps.results,
    appointments: appointments.results,
    renewals: renewals.results,
    analytics,
  };
}

export async function maggiaContext(env: Env, leadId?: string): Promise<JsonObject> {
  if (leadId) {
    const bundle = await getLead(env, leadId);
    return bundle ? { selectedClient: bundle } : { selectedClient: null };
  }
  const summary = await dashboard(env);
  const renewals = await listRenewals(env);
  return { dashboard: summary, upcomingRenewals: (renewals.renewals as unknown[]).slice(0, 15) };
}

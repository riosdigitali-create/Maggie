import { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, ExternalLink, MapPin, Plus } from "lucide-react";
import { api } from "../api";
import type { Appointment, Lead } from "../types";
import { dateTime, EmptyState, Field, LoadingBlock, Modal } from "../ui";

function dateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function localDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function AppointmentModal({ leads, initialDay, onClose, onSaved }: { leads: Lead[]; initialDay: string; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const start = new Date(`${initialDay}T10:00:00`); const end = new Date(start.getTime() + 60 * 60_000);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    const openGoogle = form.get("sync_google") === "on";
    const googleTab = openGoogle ? window.open("", "_blank") : null;
    if (googleTab) googleTab.opener = null;
    try {
      const result = await api<{ appointment: Appointment }>("/api/appointments", { method: "POST", body: JSON.stringify({ lead_id: form.get("lead_id") || null, title: form.get("title"), starts_at: new Date(String(form.get("starts_at"))).toISOString(), ends_at: new Date(String(form.get("ends_at"))).toISOString(), location: form.get("location"), notes: form.get("notes"), sync_google: openGoogle }) });
      if (googleTab && result.appointment.google_event_url) googleTab.location.href = result.appointment.google_event_url;
      else googleTab?.close();
      onSaved();
    } catch (caught) { googleTab?.close(); setError(caught instanceof Error ? caught.message : "No fue posible guardar la cita."); }
    finally { setBusy(false); }
  }
  return <Modal title="Nueva cita" eyebrow="Agenda" onClose={onClose}><form className="form-stack" onSubmit={submit}>
    <Field label="Cliente o prospecto"><select name="lead_id"><option value="">Sin cliente asignado</option>{leads.map(lead => <option key={lead.id} value={lead.id}>{lead.full_name}</option>)}</select></Field>
    <Field label="Asunto"><input name="title" placeholder="Asesoría, revisión, renovación…" required autoFocus /></Field>
    <div className="form-grid form-grid--2"><Field label="Inicia"><input type="datetime-local" name="starts_at" defaultValue={localDateTime(start)} required /></Field><Field label="Termina"><input type="datetime-local" name="ends_at" defaultValue={localDateTime(end)} required /></Field></div>
    <Field label="Lugar o enlace"><input name="location" /></Field><Field label="Notas"><textarea name="notes" rows={3} /></Field>
    <label className="check-field"><input type="checkbox" name="sync_google" defaultChecked /><span><strong>Abrir en Google Calendar</strong><small>La cita aparecerá preparada; sólo confirma Guardar en Google.</small></span></label>
    {error && <div className="form-error">{error}</div>}<div className="form-actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button><button className="button button--primary" disabled={busy}>{busy ? "Agendando…" : "Guardar cita"}</button></div>
  </form></Modal>;
}

export default function Agenda({ refreshKey, onOpenLead, onChanged }: { refreshKey: number; onOpenLead: (id: string) => void; onChanged: () => void }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]); const [leads, setLeads] = useState<Lead[]>([]); const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => { const date = new Date(); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const [selected, setSelected] = useState(dateKey(new Date())); const [showAdd, setShowAdd] = useState(false); const [error, setError] = useState("");
  const load = () => { setLoading(true); Promise.all([api<{ appointments: Appointment[] }>("/api/appointments"), api<{ leads: Lead[] }>("/api/leads")]).then(([a, l]) => { setAppointments(a.appointments); setLeads(l.leads); }).catch(caught => setError(caught instanceof Error ? caught.message : "No fue posible cargar la agenda.")).finally(() => setLoading(false)); };
  useEffect(load, [refreshKey]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1); const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const mondayOffset = (first.getDay() + 6) % 7; const result: Array<{ date: Date; current: boolean }> = [];
    for (let index = -mondayOffset; index < last.getDate() + (7 - ((mondayOffset + last.getDate()) % 7 || 7)); index++) {
      const date = new Date(month.getFullYear(), month.getMonth(), index + 1); result.push({ date, current: date.getMonth() === month.getMonth() });
    }
    return result;
  }, [month]);
  const byDay = useMemo(() => new Map(cells.map(cell => { const key = dateKey(cell.date); return [key, appointments.filter(item => dateKey(item.starts_at) === key)]; })), [appointments, cells]);
  const selectedItems = appointments.filter(item => dateKey(item.starts_at) === selected);

  return <div className="page-stack">
    <section className="page-heading"><div><span className="eyebrow">Tiempo con intención</span><h1>Agenda y <em>citas</em></h1><p>Organiza cada encuentro y pásalo a Google Calendar con un clic.</p></div><button className="button button--primary" onClick={() => setShowAdd(true)}><Plus size={18} /> Nueva cita</button></section>
    {error && <div className="notice notice--error">{error}</div>}
    {loading ? <LoadingBlock /> : <div className="calendar-layout">
      <section className="calendar-panel panel">
        <header className="calendar-header"><div><span className="eyebrow">Calendario</span><h2>{new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(month)}</h2></div><div><button className="icon-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18} /></button><button className="button button--ghost button--small" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Hoy</button><button className="icon-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18} /></button></div></header>
        <div className="calendar-weekdays">{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(day => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">{cells.map(cell => { const key = dateKey(cell.date); const count = byDay.get(key)?.length || 0; return <button key={key} className={`${cell.current ? "" : "is-outside"} ${key === selected ? "is-selected" : ""} ${key === dateKey(new Date()) ? "is-today" : ""}`} onClick={() => setSelected(key)}><span>{cell.date.getDate()}</span>{count > 0 && <i>{count}</i>}</button>; })}</div>
      </section>
      <aside className="day-panel panel"><header><span className="eyebrow">Día seleccionado</span><h2>{new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${selected}T12:00:00`))}</h2></header><div className="day-panel__list">{selectedItems.length ? selectedItems.map(item => <article className="day-event" key={item.id}><span className="day-event__time">{new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit" }).format(new Date(item.starts_at))}</span><div><strong>{item.title}</strong>{item.full_name && <button onClick={() => item.lead_id && onOpenLead(item.lead_id)}>{item.full_name}</button>}<small>{item.location ? <><MapPin size={12} /> {item.location}</> : <><Clock3 size={12} /> {dateTime(item.ends_at)}</>}</small></div>{item.google_event_url && <a href={item.google_event_url} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>}</article>) : <EmptyState icon={<CalendarDays size={26} />} title="Día disponible" copy="No hay citas programadas para esta fecha." action={<button className="button button--soft" onClick={() => setShowAdd(true)}>Agendar aquí</button>} />}</div></aside>
    </div>}
    {showAdd && <AppointmentModal leads={leads} initialDay={selected} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); onChanged(); }} />}
  </div>;
}

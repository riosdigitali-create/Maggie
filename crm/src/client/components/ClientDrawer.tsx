import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CalendarPlus, Check, ExternalLink, FileSearch, FileText, Mail, MessageCircle, Phone, Plus, Save, ShieldCheck, Sparkles, UploadCloud, UserRound } from "lucide-react";
import { api } from "../api";
import type { Appointment, LeadBundle, LeadStatus, Policy } from "../types";
import { dateTime, Field, initials, interestLabels, LoadingBlock, Modal, money, shortDate, statusLabels } from "../ui";

type Tab = "resumen" | "seguimiento" | "polizas" | "citas";
type PolicyDraft = Partial<Policy> & { beneficiaries?: string[] };

function localDateTime(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

export default function ClientDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [bundle, setBundle] = useState<LeadBundle | null>(null);
  const [tab, setTab] = useState<Tab>("resumen");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const result = await api<LeadBundle>(`/api/leads/${id}`);
    setBundle(result);
  };
  useEffect(() => { reload().catch(caught => setError(caught instanceof Error ? caught.message : "No fue posible abrir la ficha.")); }, [id]);

  const calcEntries = useMemo(() => {
    if (!bundle?.lead.calculation) return [];
    return Object.entries(bundle.lead.calculation).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)).slice(0, 10);
  }, [bundle]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("profile"); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<LeadBundle>(`/api/leads/${id}`, { method: "PUT", body: JSON.stringify(Object.fromEntries(form)) });
      setBundle(result); onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible guardar."); }
    finally { setBusy(""); }
  }

  async function saveFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("followup"); setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const occurred = String(form.get("occurred_at") || "");
    const next = String(form.get("next_action_at") || "");
    try {
      const result = await api<LeadBundle>(`/api/leads/${id}/activities`, { method: "POST", body: JSON.stringify({
        activity_type: form.get("activity_type"), note: form.get("note"), occurred_at: occurred ? new Date(occurred).toISOString() : undefined, next_action_at: next ? new Date(next).toISOString() : undefined,
      }) });
      setBundle(result); formElement.reset(); onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible guardar el seguimiento."); }
    finally { setBusy(""); }
  }

  async function extractSelectedPolicy() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Selecciona una póliza para leerla."); return; }
    setBusy("extract"); setError(""); setFileName(file.name);
    const form = new FormData(); form.append("policy", file);
    try {
      const result = await api<{ policy: PolicyDraft; retained: boolean }>(`/api/leads/${id}/policies/extract`, { method: "POST", body: form });
      setPolicyDraft(result.policy);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible leer la póliza."); }
    finally { if (fileRef.current) fileRef.current.value = ""; setBusy(""); }
  }

  async function savePolicyData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("policy"); setError("");
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form);
    const beneficiaries = String(values.beneficiaries || "").split(/\n|,/).map(value => value.trim()).filter(Boolean);
    try {
      const result = await api<LeadBundle>(`/api/leads/${id}/policies`, { method: "POST", body: JSON.stringify({ ...values, beneficiaries, extraction_confidence: policyDraft?.extraction_confidence }) });
      setBundle(result); setPolicyDraft(null); setFileName(""); onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible guardar la póliza."); }
    finally { setBusy(""); }
  }

  async function saveClientAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("appointment"); setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const openGoogle = form.get("sync_google") === "on";
    const googleTab = openGoogle ? window.open("", "_blank") : null;
    if (googleTab) googleTab.opener = null;
    try {
      const result = await api<{ appointment: Appointment }>("/api/appointments", { method: "POST", body: JSON.stringify({
        lead_id: id, title: form.get("title"), starts_at: new Date(String(form.get("starts_at"))).toISOString(), ends_at: new Date(String(form.get("ends_at"))).toISOString(), location: form.get("location"), notes: form.get("notes"), sync_google: openGoogle,
      }) });
      if (googleTab && result.appointment.google_event_url) googleTab.location.href = result.appointment.google_event_url;
      else googleTab?.close();
      await reload(); formElement.reset(); onChanged();
    } catch (caught) { googleTab?.close(); setError(caught instanceof Error ? caught.message : "No fue posible agendar la cita."); }
    finally { setBusy(""); }
  }

  if (!bundle) return <Modal title="Ficha del cliente" onClose={onClose} wide>{error ? <div className="notice notice--error">{error}</div> : <LoadingBlock />}</Modal>;
  const { lead } = bundle;
  const phoneDigits = lead.phone.replace(/\D/g, "");
  const policyValues = policyDraft || {};
  const now = new Date();
  const appointmentStart = new Date(now.getTime() + 60 * 60_000);
  appointmentStart.setMinutes(Math.ceil(appointmentStart.getMinutes() / 30) * 30, 0, 0);
  const appointmentEnd = new Date(appointmentStart.getTime() + 60 * 60_000);

  return (
    <Modal title={lead.full_name} eyebrow={interestLabels[lead.interest_type]} onClose={onClose} wide>
      <div className="client-hero">
        <span className="client-avatar">{initials(lead.full_name)}</span>
        <div className="client-hero__identity"><span className={`status-pill status-pill--${lead.status}`}>{statusLabels[lead.status]}</span><p>{lead.email || "Sin correo"} · {lead.phone || "Sin teléfono"}</p></div>
        <div className="client-hero__actions">
          {phoneDigits && <a className="icon-action" href={`tel:${phoneDigits}`} title="Llamar"><Phone size={17} /></a>}
          {phoneDigits && <a className="icon-action" href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(`Hola ${lead.full_name.split(" ")[0]}, soy Maggie.`)}`} target="_blank" rel="noreferrer" title="WhatsApp"><MessageCircle size={17} /></a>}
          {lead.email && <a className="icon-action" href={`mailto:${lead.email}`} title="Correo"><Mail size={17} /></a>}
          <button className="button button--soft" onClick={() => window.dispatchEvent(new CustomEvent("maggia:open", { detail: { leadId: lead.id, leadName: lead.full_name } }))}><Bot size={17} /> Consultar a MaggIA</button>
        </div>
      </div>
      <div className="client-tabs" role="tablist">
        {(["resumen", "seguimiento", "polizas", "citas"] as Tab[]).map(item => <button role="tab" aria-selected={tab === item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)} key={item}>{item === "polizas" ? "Pólizas" : titleCase(item)}{item === "seguimiento" && bundle.activities.length > 0 ? <i>{bundle.activities.length}</i> : null}</button>)}
      </div>
      {error && <div className="notice notice--error">{error}</div>}

      {tab === "resumen" && (
        <div className="detail-layout">
          <form className="panel form-stack" onSubmit={saveProfile}>
            <header className="panel__header"><div><span className="eyebrow">Datos de contacto</span><h3>Información principal</h3></div></header>
            <Field label="Nombre completo"><input name="full_name" defaultValue={lead.full_name} required /></Field>
            <div className="form-grid form-grid--2"><Field label="Correo"><input name="email" type="email" defaultValue={lead.email} /></Field><Field label="Teléfono"><input name="phone" defaultValue={lead.phone} /></Field></div>
            <div className="form-grid form-grid--2"><Field label="Etapa"><select name="status" defaultValue={lead.status}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label="Interés"><select name="interest_type" defaultValue={lead.interest_type}>{Object.entries(interestLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field></div>
            <Field label="Notas generales"><textarea name="notes" rows={4} defaultValue={lead.notes} /></Field>
            <div className="form-actions"><button className="button button--primary" disabled={busy === "profile"}><Save size={17} /> {busy === "profile" ? "Guardando…" : "Guardar cambios"}</button></div>
          </form>
          <div className="detail-side">
            <article className="result-card">
              <span className="eyebrow"><Sparkles size={13} /> Resultado de la landing</span>
              <h3>{lead.interest_type === "vida" ? "Protección estimada" : "Retiro estimado"}</h3>
              <strong>{money(lead.calculated_amount)}</strong>
              {lead.annual_budget !== null && <p>Presupuesto/aportación anual: <b>{money(lead.annual_budget)}</b></p>}
              <small>{lead.source === "landing" ? "Capturado automáticamente desde la calculadora." : "Prospecto agregado manualmente."}</small>
            </article>
            {calcEntries.length > 0 && <article className="panel calculation-data"><span className="eyebrow">Datos del cálculo</span>{calcEntries.map(([key, value]) => <div key={key}><span>{titleCase(key)}</span><strong>{typeof value === "number" && value > 999 ? money(value) : String(value)}</strong></div>)}</article>}
            <article className="panel quick-summary"><span className="eyebrow">Siguiente paso</span><h3>{lead.next_follow_up_at ? dateTime(lead.next_follow_up_at) : "Sin seguimiento programado"}</h3><p>Creado el {shortDate(lead.created_at)} · Origen: {lead.source}</p><button className="text-button" onClick={() => setTab("seguimiento")}>Agregar seguimiento <ExternalLink size={14} /></button></article>
          </div>
        </div>
      )}

      {tab === "seguimiento" && (
        <div className="detail-layout">
          <form className="panel form-stack sticky-form" onSubmit={saveFollowUp}>
            <header className="panel__header"><div><span className="eyebrow">Nueva actividad</span><h3>Registrar seguimiento</h3></div></header>
            <div className="form-grid form-grid--2"><Field label="Tipo"><select name="activity_type"><option value="whatsapp">WhatsApp</option><option value="llamada">Llamada</option><option value="correo">Correo</option><option value="cita">Cita</option><option value="propuesta">Propuesta</option><option value="nota">Nota</option></select></Field><Field label="Fecha"><input type="datetime-local" name="occurred_at" defaultValue={localDateTime(new Date())} /></Field></div>
            <Field label="¿Qué pasó?"><textarea name="note" rows={5} required placeholder="Ej. Le expliqué la propuesta y quedamos en revisarla el viernes…" /></Field>
            <Field label="Próxima acción"><input type="datetime-local" name="next_action_at" /></Field>
            <button className="button button--primary" disabled={busy === "followup"}><Plus size={17} /> {busy === "followup" ? "Guardando…" : "Guardar seguimiento"}</button>
          </form>
          <section className="timeline-wrap"><header><span className="eyebrow">Historial completo</span><h3>Lo que han construido</h3></header><div className="timeline">{bundle.activities.length ? bundle.activities.map(activity => <article className="timeline-item" key={activity.id}><span className="timeline-item__dot" /><div><span className="timeline-item__meta">{titleCase(activity.activity_type)} · {dateTime(activity.occurred_at)}</span><p>{activity.note}</p>{activity.next_action_at && <small>Próxima acción: {dateTime(activity.next_action_at)}</small>}</div></article>) : <div className="mini-empty"><MessageCircle size={22} /><p>Aún no hay seguimientos. Registra la primera conversación.</p></div>}</div></section>
        </div>
      )}

      {tab === "polizas" && (
        <div className="policy-layout">
          <section className="policy-uploader">
            <div className="policy-uploader__icon"><FileSearch size={27} /></div><span className="eyebrow">Lectura inteligente</span><h3>Subir póliza</h3><p>MaggIA desglosa los datos para que tú los revises. El archivo no se guarda en el CRM.</p>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" aria-label="Seleccionar póliza" onChange={event => setFileName(event.target.files?.[0]?.name || "")} />
            <button className="button button--primary" onClick={extractSelectedPolicy} disabled={!fileName || busy === "extract"}><UploadCloud size={17} /> {busy === "extract" ? "Leyendo póliza…" : fileName ? "Leer y desglosar" : "Selecciona un archivo"}</button>
            {fileName && <small className="selected-file"><FileText size={14} /> {fileName}</small>}
            <div className="privacy-note"><ShieldCheck size={17} /><span><strong>Sin archivo guardado.</strong> Sólo se conserva la información que confirmes en el formulario.</span></div>
          </section>
          <section className="policy-content">
            {(policyDraft || bundle.policies.length === 0) && (
              <form className="panel form-stack policy-form" onSubmit={savePolicyData}>
                <header className="panel__header"><div><span className="eyebrow">{policyDraft ? "Revisa la extracción" : "Captura manual"}</span><h3>Datos de la póliza</h3></div>{policyDraft && <span className="confidence"><Check size={14} /> {Math.round(Number(policyDraft.extraction_confidence || 0) * 100)}% de lectura</span>}</header>
                <div className="form-grid form-grid--3"><Field label="Aseguradora"><input name="insurer" defaultValue={policyValues.insurer || ""} /></Field><Field label="Producto"><input name="product" defaultValue={policyValues.product || ""} /></Field><Field label="No. de póliza"><input name="policy_number" defaultValue={policyValues.policy_number || ""} /></Field></div>
                <div className="form-grid form-grid--3"><Field label="Tipo"><input name="policy_type" defaultValue={policyValues.policy_type || ""} /></Field><Field label="Contratante"><input name="policyholder_name" defaultValue={policyValues.policyholder_name || lead.full_name} /></Field><Field label="Asegurado"><input name="insured_name" defaultValue={policyValues.insured_name || lead.full_name} /></Field></div>
                <div className="form-grid form-grid--4"><Field label="Emisión"><input type="date" name="issue_date" defaultValue={policyValues.issue_date || ""} /></Field><Field label="Inicio"><input type="date" name="start_date" defaultValue={policyValues.start_date || ""} /></Field><Field label="Vencimiento"><input type="date" name="end_date" defaultValue={policyValues.end_date || ""} /></Field><Field label="Próxima renovación"><input type="date" name="renewal_date" defaultValue={policyValues.renewal_date || ""} required /></Field></div>
                <div className="form-grid form-grid--4"><Field label="Prima"><input type="number" name="premium_amount" min="0" step="0.01" defaultValue={policyValues.premium_amount ?? ""} /></Field><Field label="Frecuencia"><select name="premium_frequency" defaultValue={policyValues.premium_frequency || "anual"}><option value="mensual">Mensual</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option><option value="unica">Única</option></select></Field><Field label="Moneda"><select name="currency" defaultValue={policyValues.currency || "MXN"}><option value="MXN">MXN</option><option value="USD">USD</option><option value="UDI">UDI</option></select></Field><Field label="Suma asegurada"><input type="number" name="sum_insured" min="0" step="0.01" defaultValue={policyValues.sum_insured ?? ""} /></Field></div>
                <div className="form-grid form-grid--3"><Field label="Método de pago"><input name="payment_method" defaultValue={policyValues.payment_method || ""} /></Field><Field label="Estado"><select name="policy_status" defaultValue={policyValues.policy_status || "vigente"}><option value="vigente">Vigente</option><option value="por_renovar">Por renovar</option><option value="vencida">Vencida</option><option value="cancelada">Cancelada</option><option value="en_tramite">En trámite</option></select></Field><Field label="Asesora"><input name="advisor" defaultValue={policyValues.advisor || "Maggie Salmerón"} /></Field></div>
                <Field label="Beneficiarios" hint="Uno por línea; no es necesario incluir porcentajes si no aparecen."><textarea name="beneficiaries" rows={3} defaultValue={(policyValues.beneficiaries || []).join("\n")} /></Field>
                <Field label="Notas de lectura"><textarea name="extraction_notes" rows={2} defaultValue={policyValues.extraction_notes || ""} /></Field>
                <div className="form-actions">{policyDraft && <button type="button" className="button button--ghost" onClick={() => setPolicyDraft(null)}>Descartar lectura</button>}<button className="button button--primary" disabled={busy === "policy"}><Save size={17} /> {busy === "policy" ? "Guardando…" : "Confirmar y guardar datos"}</button></div>
              </form>
            )}
            {bundle.policies.length > 0 && <div className="saved-policies"><header><span className="eyebrow">Pólizas registradas</span><h3>{bundle.policies.length} {bundle.policies.length === 1 ? "póliza" : "pólizas"}</h3></header>{bundle.policies.map(policy => <article className="saved-policy" key={policy.id}><span className="round-icon"><ShieldCheck size={19} /></span><div><strong>{policy.product || policy.policy_type || "Póliza"}</strong><small>{policy.insurer || "Sin aseguradora"} · {policy.policy_number || "Sin número"}</small></div><div><span>Suma asegurada</span><strong>{money(policy.sum_insured, policy.currency)}</strong></div><div><span>Renovación</span><strong>{shortDate(policy.renewal_date)}</strong></div><span className={`status-pill status-pill--${policy.policy_status === "vigente" ? "cerrado" : "propuesta"}`}>{titleCase(policy.policy_status)}</span></article>)}</div>}
          </section>
        </div>
      )}

      {tab === "citas" && (
        <div className="detail-layout">
          <form className="panel form-stack sticky-form" onSubmit={saveClientAppointment}>
            <header className="panel__header"><div><span className="eyebrow">Nueva cita</span><h3>Agendar con {lead.full_name.split(" ")[0]}</h3></div></header>
            <Field label="Asunto"><input name="title" defaultValue={`Asesoría con ${lead.full_name}`} required /></Field>
            <div className="form-grid form-grid--2"><Field label="Inicia"><input type="datetime-local" name="starts_at" defaultValue={localDateTime(appointmentStart)} required /></Field><Field label="Termina"><input type="datetime-local" name="ends_at" defaultValue={localDateTime(appointmentEnd)} required /></Field></div>
            <Field label="Lugar o enlace"><input name="location" placeholder="Videollamada, oficina…" /></Field><Field label="Notas"><textarea name="notes" rows={4} /></Field>
            <label className="check-field"><input type="checkbox" name="sync_google" defaultChecked /><span><strong>Abrir en Google Calendar</strong><small>La cita y el correo del cliente quedarán preparados; sólo confirma Guardar.</small></span></label>
            <button className="button button--primary" disabled={busy === "appointment"}><CalendarPlus size={17} /> {busy === "appointment" ? "Agendando…" : "Guardar cita"}</button>
          </form>
          <section className="appointment-history"><header><span className="eyebrow">Citas del cliente</span><h3>Agenda e historial</h3></header>{bundle.appointments.length ? bundle.appointments.map((appointment: Appointment) => <article className="appointment-card" key={appointment.id}><span className="date-chip date-chip--purple"><strong>{new Date(appointment.starts_at).getDate()}</strong><small>{new Intl.DateTimeFormat("es-MX", { month: "short" }).format(new Date(appointment.starts_at))}</small></span><div><strong>{appointment.title}</strong><small>{dateTime(appointment.starts_at)}{appointment.location ? ` · ${appointment.location}` : ""}</small></div>{appointment.google_event_url && <a href={appointment.google_event_url} target="_blank" rel="noreferrer">Google <ExternalLink size={14} /></a>}</article>) : <div className="mini-empty"><CalendarPlus size={23} /><p>No hay citas registradas para este cliente.</p></div>}</section>
        </div>
      )}
    </Modal>
  );
}

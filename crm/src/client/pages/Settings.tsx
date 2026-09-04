import { FormEvent, useEffect, useState } from "react";
import { Bot, CalendarCheck, CheckCircle2, ExternalLink, LockKeyhole, ShieldCheck } from "lucide-react";
import { api } from "../api";
import type { IntegrationStatus } from "../types";
import { Field, LoadingBlock } from "../ui";

interface Statuses { openai: IntegrationStatus; google: IntegrationStatus }

export default function Settings({ refreshKey }: { refreshKey: number; onChanged: () => void }) {
  const [statuses, setStatuses] = useState<Statuses | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<Statuses>("/api/integrations").then(setStatuses).catch(caught => setError(caught instanceof Error ? caught.message : "No fue posible cargar el estado del CRM."));
  }, [refreshKey]);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("password"); setError(""); setMessage("");
    const form = new FormData(event.currentTarget); const next = String(form.get("new_password") || "");
    if (next !== String(form.get("confirm_password") || "")) { setError("Las contraseñas nuevas no coinciden."); setBusy(""); return; }
    try {
      await api("/api/settings/password", { method: "POST", body: JSON.stringify({ currentPassword: form.get("current_password"), newPassword: next }) });
      event.currentTarget.reset(); setMessage("Contraseña actualizada. Úsala la próxima vez que ingreses.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible cambiar la contraseña."); }
    finally { setBusy(""); }
  }

  if (!statuses) return <LoadingBlock />;
  const openaiConnected = statuses.openai.status === "connected";
  return <div className="page-stack">
    <section className="page-heading"><div><span className="eyebrow">Todo listo para trabajar</span><h1>Conexiones y <em>seguridad</em></h1><p>Las partes técnicas se administran de forma privada; Maggie no necesita copiar claves ni configurar APIs.</p></div><div className="security-seal"><ShieldCheck size={20} /><span><strong>Datos protegidos</strong><small>Acceso privado</small></span></div></section>
    {message && <div className="notice notice--success"><CheckCircle2 size={18} /> {message}</div>}{error && <div className="notice notice--error">{error}</div>}
    <section className="settings-grid">
      <article className="integration-card">
        <header><span className="integration-icon integration-icon--ai"><Bot size={23} /></span><div><span className="eyebrow">Asistente del CRM</span><h2>MaggIA</h2></div><span className={`connection-state ${openaiConnected ? "is-connected" : ""}`}>{openaiConnected ? "Activa" : "En preparación"}</span></header>
        <p>Consulta el estado del CRM, recuerda citas, detecta prioridades, prepara seguimientos y desglosa pólizas.</p>
        <div className="connected-box"><ShieldCheck size={19} /><div><strong>Conexión administrada de forma privada</strong><small>{openaiConnected ? "MaggIA está lista para ayudarte." : "Se activará desde el servidor, sin pasos para Maggie."}</small></div></div>
      </article>
      <article className="integration-card">
        <header><span className="integration-icon"><CalendarCheck size={23} /></span><div><span className="eyebrow">Agenda sencilla</span><h2>Google Calendar</h2></div><span className="connection-state is-connected">Listo</span></header>
        <p>No hay APIs que copiar. Al guardar una cita, Google Calendar se abre con el horario, las notas y el cliente ya preparados.</p>
        <a className="button button--primary" href="https://calendar.google.com/calendar/" target="_blank" rel="noreferrer">Abrir mi Google Calendar <ExternalLink size={16} /></a>
      </article>
      <article className="integration-card integration-card--wide">
        <header><span className="integration-icon"><LockKeyhole size={23} /></span><div><span className="eyebrow">Acceso al CRM</span><h2>Cambiar contraseña</h2></div><span className="connection-state is-connected">Protegido</span></header>
        <p>La nueva contraseña sustituye a la inicial y debe tener por lo menos 8 caracteres.</p>
        <form className="password-change" onSubmit={changePassword}><Field label="Contraseña actual"><input type="password" name="current_password" required /></Field><Field label="Nueva contraseña"><input type="password" name="new_password" minLength={8} required /></Field><Field label="Confirmar nueva"><input type="password" name="confirm_password" minLength={8} required /></Field><button className="button button--primary" disabled={busy === "password"}>{busy === "password" ? "Actualizando…" : "Actualizar contraseña"}</button></form>
      </article>
    </section>
    <section className="data-policy"><ShieldCheck size={22} /><div><strong>Cómo se manejan las pólizas</strong><p>El CRM envía temporalmente el documento a OpenAI para extraer los datos, devuelve un formulario editable y descarta el archivo. Sólo se guardan los campos que tú revisas y confirmas.</p></div></section>
  </div>;
}

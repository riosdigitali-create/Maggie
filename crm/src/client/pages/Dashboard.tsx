import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, CircleDollarSign, Clock3, Plus, Sparkles, UserRoundPlus, Users } from "lucide-react";
import { api } from "../api";
import type { DashboardData, Section } from "../types";
import { dateTime, LoadingBlock, shortDate, statusLabels } from "../ui";

export default function Dashboard({ refreshKey, onAddLead, onOpenLead, onNavigate }: {
  refreshKey: number;
  onAddLead: () => void;
  onOpenLead: (id: string) => void;
  onNavigate: (section: Section) => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    api<DashboardData>("/api/dashboard").then(setData).catch(caught => setError(caught instanceof Error ? caught.message : "No fue posible cargar el tablero."));
  }, [refreshKey]);

  const pipeline = useMemo(() => {
    const map = new Map(data?.pipeline.map(item => [item.status, item.total]) || []);
    return (["nuevo", "contactado", "cita", "propuesta", "cerrado"] as const).map(status => ({ status, total: map.get(status) || 0 }));
  }, [data]);
  const analytics = new Map(data?.analytics.totals.map(item => [item.event_type, item.total]) || []);
  const pageViews = analytics.get("page_view") || 0;
  const leads = analytics.get("lead_created") || 0;
  const conversion = pageViews ? Math.round((leads / pageViews) * 1000) / 10 : 0;

  if (!data && !error) return <LoadingBlock />;
  if (error) return <div className="notice notice--error">{error}</div>;
  if (!data) return null;

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <span className="eyebrow">Tu cartera hoy</span>
          <h1>Hola, Maggie. <em>¿Qué sigue?</em></h1>
          <p>Prioriza lo importante y deja que cada prospecto avance con intención.</p>
        </div>
        <button className="button button--primary" onClick={onAddLead}><Plus size={18} /> Nuevo prospecto</button>
      </section>

      <section className="metric-grid">
        <article className="metric-card metric-card--accent">
          <span>Prospectos y clientes</span><strong>{data.totals.all}</strong><small><Users size={14} /> {data.totals.thisMonth} nuevos este mes</small>
        </article>
        <article className="metric-card"><span>Seguimientos próximos</span><strong>{data.followUps.length}</strong><small><Clock3 size={14} /> En los siguientes 7 días</small></article>
        <article className="metric-card"><span>Citas esta semana</span><strong>{data.appointments.length}</strong><small><CalendarDays size={14} /> Confirmadas en el CRM</small></article>
        <article className="metric-card"><span>Conversión de la landing</span><strong>{conversion}%</strong><small><CircleDollarSign size={14} /> {leads} datos recibidos</small></article>
      </section>

      <section className="dashboard-grid">
        <article className="panel panel--span-2">
          <header className="panel__header"><div><span className="eyebrow">Embudo comercial</span><h2>De interés a protección</h2></div><button className="text-button" onClick={() => onNavigate("clientes")}>Ver todos <ArrowRight size={15} /></button></header>
          <div className="pipeline-summary">
            {pipeline.map((item, index) => (
              <div className="pipeline-step" key={item.status}>
                <div className="pipeline-step__bar"><span style={{ width: `${Math.max(10, data.totals.all ? (item.total / data.totals.all) * 100 : 0)}%` }} /></div>
                <strong>{item.total}</strong><span>{statusLabels[item.status]}</span>{index < pipeline.length - 1 && <ArrowRight className="pipeline-step__arrow" size={16} />}
              </div>
            ))}
          </div>
        </article>

        <article className="panel agent-card">
          <div className="agent-orb agent-orb--small"><span /><Sparkles size={18} /></div>
          <span className="eyebrow">MaggIA observa</span>
          <h2>{data.followUps.length ? `${data.followUps.length} conversaciones merecen atención.` : "Tu seguimiento está al día."}</h2>
          <p>{data.appointments.length ? `Tu próxima cita es ${dateTime(data.appointments[0].starts_at)}${data.appointments[0].full_name ? ` con ${data.appointments[0].full_name}` : ""}.` : data.renewals.length ? `También tienes ${data.renewals.length} renovaciones en los próximos 90 días.` : "Cuando registres citas y pólizas, aquí te recordaré lo importante."}</p>
          <button className="button button--soft" onClick={() => window.dispatchEvent(new CustomEvent("maggia:open"))}>Preguntarle a MaggIA</button>
        </article>

        <article className="panel">
          <header className="panel__header"><div><span className="eyebrow">Seguimiento</span><h2>Lo próximo</h2></div></header>
          <div className="compact-list">
            {data.followUps.length ? data.followUps.slice(0, 6).map(item => (
              <button className="compact-item" key={item.id} onClick={() => onOpenLead(item.id)}>
                <span className="date-chip"><strong>{new Date(item.next_follow_up_at).getDate()}</strong><small>{new Intl.DateTimeFormat("es-MX", { month: "short" }).format(new Date(item.next_follow_up_at))}</small></span>
                <span><strong>{item.full_name}</strong><small>{dateTime(item.next_follow_up_at)} · {statusLabels[item.status]}</small></span><ArrowRight size={16} />
              </button>
            )) : <div className="mini-empty"><Clock3 size={22} /><p>No hay seguimientos próximos.</p></div>}
          </div>
        </article>

        <article className="panel">
          <header className="panel__header"><div><span className="eyebrow">Agenda</span><h2>Próximas citas</h2></div><button className="text-button" onClick={() => onNavigate("agenda")}>Abrir agenda</button></header>
          <div className="compact-list">
            {data.appointments.length ? data.appointments.slice(0, 5).map(item => (
              <div className="compact-item compact-item--static" key={item.id}>
                <span className="date-chip date-chip--purple"><strong>{new Date(item.starts_at).getDate()}</strong><small>{new Intl.DateTimeFormat("es-MX", { month: "short" }).format(new Date(item.starts_at))}</small></span>
                <span><strong>{item.title}</strong><small>{dateTime(item.starts_at)}{item.full_name ? ` · ${item.full_name}` : ""}</small></span>
              </div>
            )) : <div className="mini-empty"><CalendarDays size={22} /><p>Aún no hay citas programadas.</p></div>}
          </div>
        </article>

        <article className="panel">
          <header className="panel__header"><div><span className="eyebrow">Renovaciones</span><h2>Próximos 90 días</h2></div><button className="text-button" onClick={() => onNavigate("renovaciones")}>Ver calendario</button></header>
          <div className="compact-list">
            {data.renewals.length ? data.renewals.slice(0, 5).map(item => (
              <button className="compact-item" key={item.id} onClick={() => onOpenLead(item.lead_id)}>
                <span className="date-chip date-chip--gold"><strong>{new Date(`${item.renewal_date}T12:00:00`).getDate()}</strong><small>{new Intl.DateTimeFormat("es-MX", { month: "short" }).format(new Date(`${item.renewal_date}T12:00:00`))}</small></span>
                <span><strong>{item.full_name}</strong><small>{item.product || item.insurer || "Póliza"} · {shortDate(item.renewal_date)}</small></span><ArrowRight size={16} />
              </button>
            )) : <div className="mini-empty"><CircleDollarSign size={22} /><p>Registra una póliza para activar recordatorios.</p></div>}
          </div>
        </article>
      </section>

      {data.totals.all === 0 && (
        <section className="getting-started">
          <span className="getting-started__number">01</span>
          <div><span className="eyebrow">Primer paso</span><h2>Agrega tu primer prospecto</h2><p>También aparecerán aquí automáticamente quienes dejen sus datos en la landing.</p></div>
          <button className="button button--outline" onClick={onAddLead}><UserRoundPlus size={18} /> Agregar prospecto</button>
        </section>
      )}
    </div>
  );
}

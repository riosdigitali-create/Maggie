import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarClock, MessageCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../api";
import type { Policy } from "../types";
import { EmptyState, LoadingBlock, money, shortDate } from "../ui";

function daysUntil(value: string | null): number {
  if (!value) return 9999;
  const target = new Date(`${value}T12:00:00`).getTime();
  const today = new Date(); today.setHours(12, 0, 0, 0);
  return Math.ceil((target - today.getTime()) / 86400_000);
}

export default function Renewals({ refreshKey, onOpenLead }: { refreshKey: number; onOpenLead: (id: string) => void }) {
  const [renewals, setRenewals] = useState<Policy[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [range, setRange] = useState<30 | 60 | 90 | 365>(90);
  useEffect(() => { setLoading(true); api<{ renewals: Policy[] }>("/api/renewals").then(result => setRenewals(result.renewals)).catch(caught => setError(caught instanceof Error ? caught.message : "No fue posible cargar renovaciones.")).finally(() => setLoading(false)); }, [refreshKey]);
  const visible = useMemo(() => renewals.filter(item => daysUntil(item.renewal_date) <= range), [renewals, range]);
  const urgent = renewals.filter(item => daysUntil(item.renewal_date) <= 30).length;
  return <div className="page-stack">
    <section className="page-heading"><div><span className="eyebrow">Protección que continúa</span><h1>Renovaciones <em>a tiempo</em></h1><p>Anticipa cada conversación antes de que una cobertura llegue a su fecha.</p></div><div className="heading-stat"><span>Próximos 30 días</span><strong>{urgent}</strong></div></section>
    <section className="renewal-summary"><article><CalendarClock size={20} /><div><strong>{renewals.length}</strong><span>renovaciones en el año</span></div></article><article><RefreshCw size={20} /><div><strong>{urgent}</strong><span>requieren atención pronto</span></div></article><article><ShieldCheck size={20} /><div><strong>{renewals.filter(item => item.policy_status === "vigente").length}</strong><span>pólizas vigentes</span></div></article></section>
    <section className="toolbar"><span className="toolbar__label">Mostrar</span><div className="segmented">{([30, 60, 90, 365] as const).map(value => <button className={range === value ? "is-active" : ""} onClick={() => setRange(value)} key={value}>{value === 365 ? "12 meses" : `${value} días`}</button>)}</div></section>
    {error && <div className="notice notice--error">{error}</div>}
    {loading ? <LoadingBlock /> : visible.length ? <section className="renewal-list">{visible.map(policy => { const days = daysUntil(policy.renewal_date); const urgency = days < 0 ? "overdue" : days <= 14 ? "urgent" : days <= 30 ? "soon" : "calm"; const phone = (policy.phone || "").replace(/\D/g, ""); return <article className="renewal-row" key={policy.id}><div className={`renewal-countdown renewal-countdown--${urgency}`}><strong>{days < 0 ? Math.abs(days) : days}</strong><span>{days < 0 ? "días vencida" : days === 0 ? "vence hoy" : "días"}</span></div><div className="renewal-person"><strong>{policy.full_name}</strong><small>{policy.email || policy.phone || "Sin contacto"}</small></div><div><span className="table-label">Póliza</span><strong>{policy.product || policy.policy_type || "Sin nombre"}</strong><small>{policy.insurer} · {policy.policy_number}</small></div><div><span className="table-label">Prima</span><strong>{money(policy.premium_amount, policy.currency)}</strong><small>{policy.premium_frequency || "Frecuencia pendiente"}</small></div><div><span className="table-label">Renovación</span><strong>{shortDate(policy.renewal_date)}</strong></div><div className="row-actions">{phone && <a className="icon-action" href={`https://wa.me/${phone}?text=${encodeURIComponent(`Hola ${String(policy.full_name).split(" ")[0]}, soy Maggie. Quiero revisar contigo la próxima renovación de tu póliza.`)}`} target="_blank" rel="noreferrer"><MessageCircle size={17} /></a>}<button className="icon-action" onClick={() => onOpenLead(policy.lead_id)}><ArrowRight size={17} /></button></div></article>; })}</section> : <EmptyState icon={<RefreshCw size={28} />} title="Sin renovaciones en este periodo" copy="Al registrar una póliza con su próxima fecha, aparecerá automáticamente aquí." />}
  </div>;
}

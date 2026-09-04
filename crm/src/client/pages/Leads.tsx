import { useEffect, useMemo, useState } from "react";
import { ArrowRight, LayoutGrid, List, Plus, Search, UserRoundSearch, Users } from "lucide-react";
import { api } from "../api";
import type { Lead, LeadStatus } from "../types";
import { dateTime, EmptyState, initials, interestLabels, LoadingBlock, statusLabels } from "../ui";

const stages: LeadStatus[] = ["nuevo", "contactado", "cita", "propuesta", "cerrado"];

export default function Leads({ refreshKey, onAdd, onOpen, onChanged }: { refreshKey: number; onAdd: () => void; onOpen: (id: string) => void; onChanged: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LeadStatus | "todos">("todos");
  const [view, setView] = useState<"lista" | "embudo">("lista");
  const [moving, setMoving] = useState("");

  useEffect(() => {
    setLoading(true);
    api<{ leads: Lead[] }>("/api/leads").then(result => setLeads(result.leads)).catch(caught => setError(caught instanceof Error ? caught.message : "No fue posible cargar clientes.")).finally(() => setLoading(false));
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return leads.filter(lead => (filter === "todos" || lead.status === filter) && (!term || `${lead.full_name} ${lead.email} ${lead.phone}`.toLocaleLowerCase("es").includes(term)));
  }, [leads, search, filter]);

  async function changeStatus(id: string, status: LeadStatus) {
    const previous = leads;
    setMoving(id);
    setLeads(items => items.map(item => item.id === id ? { ...item, status } : item));
    try {
      await api(`/api/leads/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
      onChanged();
    } catch (caught) {
      setLeads(previous);
      setError(caught instanceof Error ? caught.message : "No se pudo cambiar la etapa.");
    } finally {
      setMoving("");
    }
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">Relaciones que crecen</span><h1>Prospectos y <em>clientes</em></h1><p>Cada conversación, cálculo y próxima acción en una sola ficha.</p></div>
        <button className="button button--primary" onClick={onAdd}><Plus size={18} /> Nuevo prospecto</button>
      </section>
      <section className="toolbar">
        <label className="search-field"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nombre, correo o teléfono" /></label>
        <select value={filter} onChange={event => setFilter(event.target.value as LeadStatus | "todos")} aria-label="Filtrar por etapa">
          <option value="todos">Todas las etapas</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <div className="segmented"><button className={view === "lista" ? "is-active" : ""} onClick={() => setView("lista")}><List size={17} /> Lista</button><button className={view === "embudo" ? "is-active" : ""} onClick={() => setView("embudo")}><LayoutGrid size={17} /> Embudo</button></div>
      </section>
      {error && <div className="notice notice--error">{error}</div>}
      {loading ? <LoadingBlock /> : filtered.length === 0 ? (
        <EmptyState icon={<UserRoundSearch size={28} />} title={leads.length ? "No encontré coincidencias" : "Tu cartera comienza aquí"} copy={leads.length ? "Prueba otra búsqueda o etapa." : "Agrega un prospecto o conecta la landing para recibirlos automáticamente."} action={!leads.length ? <button className="button button--primary" onClick={onAdd}><Plus size={17} /> Agregar prospecto</button> : undefined} />
      ) : view === "lista" ? (
        <section className="table-card">
          <div className="data-table data-table--leads">
            <div className="data-table__head"><span>Persona</span><span>Interés</span><span>Etapa</span><span>Próxima acción</span><span>Origen</span><span /></div>
            {filtered.map(lead => (
              <button className="data-table__row" key={lead.id} onClick={() => onOpen(lead.id)}>
                <span className="person-cell"><i>{initials(lead.full_name)}</i><span><strong>{lead.full_name}</strong><small>{lead.email || lead.phone || "Sin contacto"}</small></span></span>
                <span><span className={`interest-pill interest-pill--${lead.interest_type}`}>{interestLabels[lead.interest_type]}</span></span>
                <span><span className={`status-pill status-pill--${lead.status}`}>{statusLabels[lead.status]}</span></span>
                <span>{lead.next_follow_up_at ? dateTime(lead.next_follow_up_at) : <small className="muted">Sin programar</small>}</span>
                <span className="source-label">{lead.source === "landing" ? "Landing" : "Manual"}</span>
                <span><ArrowRight size={17} /></span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="kanban" aria-label="Embudo comercial">
          {stages.map(stage => {
            const stageLeads = filtered.filter(lead => lead.status === stage);
            return (
              <div className={`kanban-column kanban-column--${stage}`} key={stage} onDragOver={event => event.preventDefault()} onDrop={event => { const id = event.dataTransfer.getData("text/plain"); if (id) void changeStatus(id, stage); }}>
                <header><span>{statusLabels[stage]}</span><strong>{stageLeads.length}</strong></header>
                <div className="kanban-column__body">
                  {stageLeads.map(lead => (
                    <button draggable onDragStart={event => event.dataTransfer.setData("text/plain", lead.id)} className={`lead-card ${moving === lead.id ? "is-moving" : ""}`} key={lead.id} onClick={() => onOpen(lead.id)}>
                      <span className="lead-card__top"><i>{initials(lead.full_name)}</i><span className={`interest-dot interest-dot--${lead.interest_type}`} /></span>
                      <strong>{lead.full_name}</strong><small>{interestLabels[lead.interest_type]} · {lead.source === "landing" ? "Landing" : "Manual"}</small>
                      <span className="lead-card__follow">{lead.next_follow_up_at ? `Siguiente: ${dateTime(lead.next_follow_up_at)}` : "Sin seguimiento programado"}</span>
                    </button>
                  ))}
                  {!stageLeads.length && <div className="kanban-empty"><Users size={18} /><span>Arrastra aquí</span></div>}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

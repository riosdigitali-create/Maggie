import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Sparkles, X } from "lucide-react";
import { api } from "../api";

interface ChatMessage { role: "user" | "assistant"; text: string }

export default function MaggiaAgent() {
  const [open, setOpen] = useState(false); const [question, setQuestion] = useState(""); const [messages, setMessages] = useState<ChatMessage[]>([]); const [busy, setBusy] = useState(false); const [lead, setLead] = useState<{ id: string; name: string } | null>(null); const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const listener = (event: Event) => { const detail = (event as CustomEvent<{ leadId?: string; leadName?: string }>).detail; if (detail?.leadId) setLead({ id: detail.leadId, name: detail.leadName || "este cliente" }); setOpen(true); }; window.addEventListener("maggia:open", listener); return () => window.removeEventListener("maggia:open", listener); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);
  async function ask(text: string) { const clean = text.trim(); if (!clean || busy) return; setMessages(items => [...items, { role: "user", text: clean }]); setQuestion(""); setBusy(true); try { const result = await api<{ answer: string }>("/api/maggia", { method: "POST", body: JSON.stringify({ question: clean, leadId: lead?.id }) }); setMessages(items => [...items, { role: "assistant", text: result.answer }]); } catch (caught) { setMessages(items => [...items, { role: "assistant", text: caught instanceof Error ? caught.message : "No pude responder en este momento." }]); } finally { setBusy(false); } }
  function submit(event: FormEvent) { event.preventDefault(); void ask(question); }
  const prompts = lead ? [`Resume la situación de ${lead.name}`, "¿Cuál debería ser mi siguiente paso?", "Redacta un WhatsApp de seguimiento"] : ["¿Qué citas tengo hoy y mañana?", "¿Cómo va mi CRM?", "¿Qué debo atender primero?"];
  return <>
    <button className={`agent-launcher ${open ? "is-hidden" : ""}`} onClick={() => setOpen(true)} aria-label="Abrir MaggIA"><span className="agent-orb"><i /><Sparkles size={20} /></span><span><strong>MaggIA</strong><small>Tu agente del CRM</small></span></button>
    <aside className={`agent-panel ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <header><div className="agent-orb agent-orb--small"><i /><Sparkles size={18} /></div><div><strong>MaggIA</strong><small>{lead ? `Enfocada en ${lead.name}` : "Agente privado del CRM"}</small></div>{lead && <button className="text-button" onClick={() => setLead(null)}>Ver todo</button>}<button className="icon-button" onClick={() => setOpen(false)} aria-label="Cerrar MaggIA"><X size={18} /></button></header>
      <div className="agent-messages">
        {!messages.length && <div className="agent-welcome"><Bot size={25} /><h3>¿Qué necesitas hoy?</h3><p>Puedo revisar el estado del CRM, recordarte citas, priorizar tareas y redactar seguimientos. No realizo cambios sin tu confirmación.</p><div className="agent-prompts">{prompts.map(prompt => <button onClick={() => void ask(prompt)} key={prompt}>{prompt}</button>)}</div></div>}
        {messages.map((message, index) => <div className={`agent-message agent-message--${message.role}`} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? "MaggIA" : "Tú"}</span><p>{message.text}</p></div>)}
        {busy && <div className="agent-thinking"><i /><i /><i /><span>Analizando tu CRM…</span></div>}<div ref={endRef} />
      </div>
      <form className="agent-input" onSubmit={submit}><textarea rows={2} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Pregunta sobre clientes, citas o renovaciones…" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(question); } }} /><button disabled={busy || !question.trim()} aria-label="Enviar"><ArrowUp size={18} /></button></form>
    </aside>
  </>;
}

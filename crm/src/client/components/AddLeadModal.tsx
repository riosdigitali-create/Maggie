import { FormEvent, useState } from "react";
import { UserRoundPlus } from "lucide-react";
import { api } from "../api";
import type { InterestType, LeadBundle } from "../types";
import { Field, Modal } from "../ui";

export default function AddLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (lead: LeadBundle) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<LeadBundle>("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          full_name: form.get("full_name"),
          email: form.get("email"),
          phone: form.get("phone"),
          interest_type: form.get("interest_type") as InterestType,
          notes: form.get("notes"),
        }),
      });
      onCreated(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible guardar el prospecto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Nuevo prospecto" eyebrow="Captura manual" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <div className="form-intro"><span className="round-icon"><UserRoundPlus size={20} /></span><p>Comienza con lo que ya sabes. La ficha crecerá con cada seguimiento.</p></div>
        <Field label="Nombre completo"><input name="full_name" autoFocus required /></Field>
        <div className="form-grid form-grid--2">
          <Field label="Correo electrónico"><input type="email" name="email" autoComplete="email" /></Field>
          <Field label="Teléfono / WhatsApp"><input name="phone" inputMode="tel" autoComplete="tel" /></Field>
        </div>
        <Field label="Interés principal">
          <select name="interest_type" defaultValue="retiro">
            <option value="retiro">Retiro</option><option value="vida">Vida</option><option value="ambos">Retiro y vida</option><option value="otro">Otro</option>
          </select>
        </Field>
        <Field label="Nota inicial"><textarea name="notes" rows={3} placeholder="¿Cómo llegó, qué necesita o qué acordaron?" /></Field>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button><button className="button button--primary" disabled={loading}>{loading ? "Guardando…" : "Guardar prospecto"}</button></div>
      </form>
    </Modal>
  );
}

import { FormEvent, useState } from "react";
import { Eye, EyeOff, LockKeyhole, Sparkles } from "lucide-react";
import Brand from "./Brand";
import { api } from "../api";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      onSuccess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-page__glow" aria-hidden="true" />
      <section className="login-story">
        <Brand />
        <div className="login-story__copy">
          <span className="eyebrow"><Sparkles size={14} /> Tu cartera, con claridad</span>
          <h1>Todo lo que construyes,<br /><em>bien acompañado.</em></h1>
          <p>Prospectos, clientes, seguimientos, citas y renovaciones en un solo lugar privado.</p>
        </div>
        <p className="login-story__quote">“Un buen seguimiento convierte una intención en protección real.”</p>
      </section>
      <section className="login-card-wrap">
        <form className="login-card" onSubmit={submit}>
          <div className="login-card__icon"><LockKeyhole size={22} /></div>
          <span className="eyebrow">Acceso privado</span>
          <h2>Bienvenida a <em>MaggIA</em></h2>
          <p>Ingresa tu contraseña para abrir el CRM.</p>
          <label htmlFor="crm-password">Contraseña</label>
          <div className="password-field">
            <input
              id="crm-password"
              type={visible ? "text" : "password"}
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
            <button type="button" onClick={() => setVisible(value => !value)} aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}>
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button--primary button--wide" disabled={loading}>
            {loading ? "Abriendo…" : "Entrar al CRM"}
          </button>
          <small className="login-card__security">Sesión privada y datos protegidos.</small>
        </form>
      </section>
    </main>
  );
}

import { ReactNode, useState } from "react";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Gauge, LogOut, Menu, RefreshCw, Settings, Users, X } from "lucide-react";
import type { Section } from "../types";
import Brand from "./Brand";

const items: Array<{ id: Section; label: string; icon: typeof Gauge }> = [
  { id: "inicio", label: "Inicio", icon: Gauge },
  { id: "clientes", label: "Prospectos y clientes", icon: Users },
  { id: "agenda", label: "Agenda", icon: CalendarDays },
  { id: "renovaciones", label: "Renovaciones", icon: RefreshCw },
  { id: "metricas", label: "Métricas de la landing", icon: BarChart3 },
  { id: "ajustes", label: "Conexiones", icon: Settings },
];

export default function Shell({ section, onNavigate, onLogout, children, topAction }: {
  section: Section;
  onNavigate: (section: Section) => void;
  onLogout: () => void;
  children: ReactNode;
  topAction?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = items.find(item => item.id === section);
  const navigate = (next: Section) => {
    onNavigate(next);
    setMobileOpen(false);
  };
  return (
    <div className={`app-shell ${collapsed ? "app-shell--collapsed" : ""}`}>
      <aside className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`}>
        <div className="sidebar__top">
          <Brand compact={collapsed} />
          <button className="icon-button sidebar__mobile-close" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"><X size={19} /></button>
        </div>
        <div className="sidebar__product">
          <span className="agent-mini"><span /></span>
          {!collapsed && <div><strong>MaggIA CRM</strong><small>Espacio privado</small></div>}
        </div>
        <nav className="sidebar__nav" aria-label="Navegación principal">
          {items.map(item => (
            <button key={item.id} className={section === item.id ? "is-active" : ""} onClick={() => navigate(item.id)} title={collapsed ? item.label : undefined}>
              <item.icon size={19} strokeWidth={1.8} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar__footer">
          <button onClick={onLogout}><LogOut size={18} />{!collapsed && <span>Cerrar sesión</span>}</button>
          <button className="sidebar__collapse" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? "Ampliar menú" : "Reducir menú"}>
            {collapsed ? <ChevronRight size={18} /> : <><ChevronLeft size={18} /><span>Reducir menú</span></>}
          </button>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú" />}
      <div className="app-main">
        <header className="topbar">
          <button className="icon-button topbar__menu" onClick={() => setMobileOpen(true)} aria-label="Abrir menú"><Menu size={20} /></button>
          <div>
            <span className="topbar__overline">MaggIA CRM</span>
            <strong>{current?.label || "Inicio"}</strong>
          </div>
          <div className="topbar__actions">{topAction}</div>
        </header>
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}

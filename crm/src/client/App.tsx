import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "./api";
import type { LeadBundle, Section } from "./types";
import Login from "./components/Login";
import Shell from "./components/Shell";
import AddLeadModal from "./components/AddLeadModal";
import ClientDrawer from "./components/ClientDrawer";
import MaggiaAgent from "./components/MaggiaAgent";
import { LoadingBlock } from "./ui";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Leads = lazy(() => import("./pages/Leads"));
const Agenda = lazy(() => import("./pages/Agenda"));
const Renewals = lazy(() => import("./pages/Renewals"));
const Metrics = lazy(() => import("./pages/Metrics"));
const Settings = lazy(() => import("./pages/Settings"));

const sectionPaths: Record<Section, string> = { inicio: "/", clientes: "/clientes", agenda: "/agenda", renovaciones: "/renovaciones", metricas: "/metricas", ajustes: "/ajustes" };
function sectionFromPath(path: string): Section { const found = (Object.entries(sectionPaths) as Array<[Section, string]>).find(([, value]) => value === path.replace(/\/$/, "") || (value === "/" && path === "/")); return found?.[0] || "inicio"; }

export default function App() {
  const [auth, setAuth] = useState<"checking" | "in" | "out">("checking"); const [section, setSection] = useState<Section>(() => sectionFromPath(window.location.pathname)); const [refreshKey, setRefreshKey] = useState(0); const [addLead, setAddLead] = useState(false); const [selectedLead, setSelectedLead] = useState<string | null>(null);
  useEffect(() => { api<{ authenticated: boolean }>("/api/auth/session").then(result => setAuth(result.authenticated ? "in" : "out")).catch(() => setAuth("out")); }, []);
  useEffect(() => { const listener = () => setAuth("out"); window.addEventListener("maggia:unauthorized", listener); return () => window.removeEventListener("maggia:unauthorized", listener); }, []);
  useEffect(() => { const listener = () => setSection(sectionFromPath(window.location.pathname)); window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); }, []);
  function navigate(next: Section) { setSection(next); const path = sectionPaths[next]; if (window.location.pathname !== path) window.history.pushState({}, "", path); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function changed() { setRefreshKey(value => value + 1); }
  async function logout() { try { await api("/api/auth/logout", { method: "POST" }); } finally { setAuth("out"); setSelectedLead(null); navigate("inicio"); } }
  function created(bundle: LeadBundle) { setAddLead(false); changed(); setSelectedLead(bundle.lead.id); }
  if (auth === "checking") return <div className="boot-screen"><span className="agent-orb"><i /></span><strong>MaggIA</strong><small>Preparando tu CRM…</small></div>;
  if (auth === "out") return <Login onSuccess={() => setAuth("in")} />;
  let content;
  if (section === "clientes") content = <Leads refreshKey={refreshKey} onAdd={() => setAddLead(true)} onOpen={setSelectedLead} onChanged={changed} />;
  else if (section === "agenda") content = <Agenda refreshKey={refreshKey} onOpenLead={setSelectedLead} onChanged={changed} />;
  else if (section === "renovaciones") content = <Renewals refreshKey={refreshKey} onOpenLead={setSelectedLead} />;
  else if (section === "metricas") content = <Metrics refreshKey={refreshKey} />;
  else if (section === "ajustes") content = <Settings refreshKey={refreshKey} onChanged={changed} />;
  else content = <Dashboard refreshKey={refreshKey} onAddLead={() => setAddLead(true)} onOpenLead={setSelectedLead} onNavigate={navigate} />;
  return <>
    <Shell section={section} onNavigate={navigate} onLogout={() => void logout()}><Suspense fallback={<LoadingBlock />}>{content}</Suspense></Shell>
    {addLead && <AddLeadModal onClose={() => setAddLead(false)} onCreated={created} />}
    {selectedLead && <ClientDrawer id={selectedLead} onClose={() => setSelectedLead(null)} onChanged={changed} />}
    <MaggiaAgent />
  </>;
}

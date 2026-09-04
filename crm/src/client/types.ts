export type Section = "inicio" | "clientes" | "agenda" | "renovaciones" | "metricas" | "ajustes";
export type LeadStatus = "nuevo" | "contactado" | "cita" | "propuesta" | "cerrado" | "no_interesado";
export type InterestType = "retiro" | "vida" | "ambos" | "otro";

export interface Lead {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  source: string;
  status: LeadStatus;
  interest_type: InterestType;
  calculation: Record<string, unknown> | null;
  calculated_amount: number | null;
  annual_budget: number | null;
  notes: string;
  next_follow_up_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  lead_id: string;
  occurred_at: string;
  activity_type: string;
  note: string;
  next_action_at: string | null;
  created_at: string;
}

export interface Policy {
  id: string;
  lead_id: string;
  insurer: string;
  product: string;
  policy_number: string;
  policy_type: string;
  policyholder_name: string;
  insured_name: string;
  issue_date: string | null;
  start_date: string | null;
  end_date: string | null;
  renewal_date: string | null;
  premium_amount: number | null;
  premium_frequency: string;
  currency: string;
  sum_insured: number | null;
  beneficiaries: string[];
  payment_method: string;
  policy_status: string;
  advisor: string;
  extraction_confidence: number | null;
  extraction_notes: string;
  created_at: string;
  updated_at: string;
  full_name?: string;
  email?: string;
  phone?: string;
}

export interface Appointment {
  id: string;
  lead_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string;
  notes: string;
  appointment_status: string;
  google_event_id: string | null;
  google_event_url: string | null;
  full_name?: string;
}

export interface LeadBundle {
  lead: Lead;
  activities: Activity[];
  policies: Policy[];
  appointments: Appointment[];
}

export interface DashboardData {
  totals: { all: number; thisMonth: number };
  pipeline: Array<{ status: LeadStatus; total: number }>;
  followUps: Array<{ id: string; full_name: string; phone: string; next_follow_up_at: string; status: LeadStatus }>;
  appointments: Appointment[];
  renewals: Array<{ id: string; lead_id: string; product: string; insurer: string; renewal_date: string; full_name: string }>;
  analytics: AnalyticsData;
}

export interface AnalyticsData {
  since: string;
  totals: Array<{ event_type: string; total: number; sessions: number }>;
  daily: Array<{ day: string; event_type: string; total: number }>;
}

export interface IntegrationStatus {
  status: "disconnected" | "configured" | "connected" | "error";
  metadata?: { label?: string; email?: string; model?: string };
  updatedAt?: string;
}

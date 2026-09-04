export type LeadStatus = "nuevo" | "contactado" | "cita" | "propuesta" | "cerrado" | "no_interesado";
export type InterestType = "retiro" | "vida" | "ambos" | "otro";

export interface LeadRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  source: string;
  status: LeadStatus;
  interest_type: InterestType;
  calculation_json: string | null;
  calculated_amount: number | null;
  annual_budget: number | null;
  notes: string;
  next_follow_up_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityRow {
  id: string;
  lead_id: string;
  occurred_at: string;
  activity_type: string;
  note: string;
  next_action_at: string | null;
  created_at: string;
}

export interface PolicyRow {
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
  beneficiaries_json: string | null;
  payment_method: string;
  policy_status: string;
  advisor: string;
  extraction_confidence: number | null;
  extraction_notes: string;
  created_at: string;
  updated_at: string;
}

export interface AppointmentRow {
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
  created_at: string;
  updated_at: string;
  full_name?: string;
}

export interface IntegrationRow {
  integration_type: "openai" | "google";
  status: "disconnected" | "configured" | "connected" | "error";
  encrypted_payload: string | null;
  iv: string | null;
  metadata_json: string | null;
  updated_at: string;
}

export type JsonObject = Record<string, unknown>;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'nuevo' CHECK (status IN ('nuevo','contactado','cita','propuesta','cerrado','no_interesado')),
  interest_type TEXT NOT NULL DEFAULT 'otro' CHECK (interest_type IN ('retiro','vida','ambos','otro')),
  calculation_json TEXT,
  calculated_amount INTEGER,
  annual_budget INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  next_follow_up_at TEXT,
  last_activity_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  activity_type TEXT NOT NULL DEFAULT 'nota' CHECK (activity_type IN ('nota','llamada','whatsapp','correo','cita','propuesta','cambio_estado')),
  note TEXT NOT NULL,
  next_action_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  insurer TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '',
  policy_number TEXT NOT NULL DEFAULT '',
  policy_type TEXT NOT NULL DEFAULT '',
  policyholder_name TEXT NOT NULL DEFAULT '',
  insured_name TEXT NOT NULL DEFAULT '',
  issue_date TEXT,
  start_date TEXT,
  end_date TEXT,
  renewal_date TEXT,
  premium_amount REAL,
  premium_frequency TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'MXN',
  sum_insured REAL,
  beneficiaries_json TEXT,
  payment_method TEXT NOT NULL DEFAULT '',
  policy_status TEXT NOT NULL DEFAULT 'vigente' CHECK (policy_status IN ('vigente','por_renovar','vencida','cancelada','en_tramite')),
  advisor TEXT NOT NULL DEFAULT 'Maggie Salmerón',
  extraction_confidence REAL,
  extraction_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  lead_id TEXT,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  appointment_status TEXT NOT NULL DEFAULT 'programada' CHECK (appointment_status IN ('programada','realizada','cancelada')),
  google_event_id TEXT,
  google_event_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  anonymous_session_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('page_view','calculator_selected','calculation_started','calculation_completed','lead_created','whatsapp_clicked','appointment_intent')),
  calculator_type TEXT,
  metadata_json TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  integration_type TEXT PRIMARY KEY CHECK (integration_type IN ('openai','google')),
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','configured','connected','error')),
  encrypted_payload TEXT,
  iv TEXT,
  metadata_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  identity_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  notification_type TEXT NOT NULL,
  entity_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  due_at TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_status_updated ON leads(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_follow_up ON leads(next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_lead_date ON activities(lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_policies_lead ON policies(lead_id);
CREATE INDEX IF NOT EXISTS idx_policies_renewal ON policies(renewal_date) WHERE policy_status IN ('vigente','por_renovar');
CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(starts_at);
CREATE INDEX IF NOT EXISTS idx_analytics_type_date ON analytics_events(event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_notifications_due ON notifications(due_at, read_at);

PRAGMA optimize;

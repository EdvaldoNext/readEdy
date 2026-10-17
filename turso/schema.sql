-- ReadEdy no Turso (libSQL). Preparado para a migração; o app ainda usa o Supabase.
-- Segredos ficam em variáveis de ambiente. As tabelas *_settings guardam só o nome da variável.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE COLLATE NOCASE,
  email_confirmed_at TEXT,
  encrypted_password TEXT,
  app_metadata TEXT NOT NULL DEFAULT '{}',
  user_metadata TEXT NOT NULL DEFAULT '{}',
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_sign_in_at TEXT
);

CREATE TABLE auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('email', 'google')),
  provider_user_id TEXT NOT NULL,
  identity_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ip TEXT,
  user_agent TEXT,
  revoked_at TEXT
);

CREATE TABLE auth_one_time_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  email TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('magic_link', 'recovery', 'signup', 'email_change')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE auth_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_brl REAL NOT NULL DEFAULT 0,
  billing_interval TEXT NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month', 'year')),
  mp_plan_id TEXT,
  tts_minutes_month INTEGER,
  storage_mb INTEGER,
  max_pdfs INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  bytes INTEGER,
  num_pages INTEGER,
  last_page INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  theme TEXT DEFAULT 'light',
  tts_rate REAL DEFAULT 1,
  continuous_read INTEGER DEFAULT 1 CHECK (continuous_read IN (0, 1)),
  voice_key TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE checkout_sessions (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL REFERENCES plans (id),
  payer_email TEXT,
  mp_preapproval_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'linked')),
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  subscription_id TEXT,
  expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans (id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'trialing', 'active', 'past_due', 'canceled', 'expired')),
  mp_preapproval_id TEXT,
  mp_payer_id TEXT,
  current_period_end TEXT,
  trial_ends_at TEXT,
  canceled_at TEXT,
  checkout_session_id TEXT REFERENCES checkout_sessions (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE billing_events (
  id TEXT PRIMARY KEY,
  mp_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  subscription_id TEXT REFERENCES subscriptions (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE billing_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE usage_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE site_visits (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  path TEXT NOT NULL DEFAULT '/',
  country TEXT,
  city TEXT,
  referrer TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id, created_at DESC);
CREATE INDEX auth_tokens_email_purpose_idx ON auth_one_time_tokens (email, purpose, created_at DESC);
CREATE INDEX documents_user_updated_idx ON documents (user_id, updated_at DESC);
CREATE INDEX documents_user_active_updated_idx ON documents (user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX documents_user_deleted_idx ON documents (user_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX subscriptions_user_idx ON subscriptions (user_id, created_at DESC);
CREATE INDEX subscriptions_status_period_idx ON subscriptions (status, current_period_end);
CREATE UNIQUE INDEX subscriptions_one_active_per_user_idx ON subscriptions (user_id)
  WHERE user_id IS NOT NULL AND status IN ('pending', 'trialing', 'active', 'past_due');
CREATE INDEX billing_events_created_idx ON billing_events (created_at DESC);
CREATE INDEX checkout_sessions_mp_idx ON checkout_sessions (mp_preapproval_id);
CREATE INDEX usage_logs_user_created_idx ON usage_logs (user_id, created_at DESC);
CREATE INDEX usage_logs_event_created_idx ON usage_logs (event_type, created_at DESC);
CREATE INDEX site_visits_created_idx ON site_visits (created_at DESC);
CREATE INDEX site_visits_visitor_idx ON site_visits (visitor_id, created_at DESC);
CREATE INDEX site_visits_country_idx ON site_visits (country, created_at DESC);

CREATE TRIGGER profiles_set_updated_at
AFTER UPDATE ON profiles
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE profiles
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER documents_set_updated_at
AFTER UPDATE ON documents
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE documents
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER user_preferences_set_updated_at
AFTER UPDATE ON user_preferences
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE user_preferences
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE user_id = NEW.user_id;
END;

CREATE TRIGGER subscriptions_set_updated_at
AFTER UPDATE ON subscriptions
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE subscriptions
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER checkout_sessions_set_updated_at
AFTER UPDATE ON checkout_sessions
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE checkout_sessions
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER users_set_updated_at
AFTER UPDATE ON users
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE users
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE VIEW admin_dashboard_daily AS
SELECT
  date(created_at) AS day,
  SUM(CASE WHEN event_type = 'session_start' THEN 1 ELSE 0 END) AS sessions,
  SUM(CASE WHEN event_type = 'tts_request' THEN 1 ELSE 0 END) AS tts_requests,
  COUNT(DISTINCT CASE WHEN event_type = 'session_start' THEN user_id END) AS dau
FROM usage_logs
GROUP BY date(created_at);

CREATE VIEW admin_subscriptions_summary AS
SELECT
  s.status,
  p.slug AS plan_slug,
  p.name AS plan_name,
  p.price_brl,
  p.billing_interval,
  COUNT(*) AS total
FROM subscriptions s
JOIN plans p ON p.id = s.plan_id
GROUP BY s.status, p.slug, p.name, p.price_brl, p.billing_interval;

CREATE VIEW admin_visits_daily AS
SELECT
  date(created_at) AS day,
  COUNT(*) AS visits,
  COUNT(DISTINCT visitor_id) AS unique_visitors,
  COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) AS logged_in_visits
FROM site_visits
GROUP BY date(created_at);

CREATE VIEW admin_visits_geo AS
SELECT
  COALESCE(country, 'unknown') AS country,
  COALESCE(city, 'unknown') AS city,
  COUNT(*) AS visits,
  COUNT(DISTINCT visitor_id) AS unique_visitors
FROM site_visits
WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
GROUP BY 1, 2;

CREATE VIEW admin_clients_summary AS
SELECT
  (SELECT COUNT(*) FROM profiles) AS total_clients,
  (SELECT COUNT(DISTINCT s.user_id)
   FROM subscriptions s
   WHERE s.user_id IS NOT NULL
     AND s.status = 'active'
     AND COALESCE(s.current_period_end, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ) AS active_paying,
  (SELECT COUNT(*)
   FROM profiles p
   WHERE NOT EXISTS (
     SELECT 1 FROM subscriptions s
     WHERE s.user_id = p.id
       AND s.status = 'active'
       AND COALESCE(s.current_period_end, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   )
  ) AS inactive_or_unpaid,
  (SELECT COUNT(*)
   FROM profiles
   WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
  ) AS new_clients_7d,
  (SELECT COUNT(*)
   FROM subscriptions s
   WHERE s.user_id IS NOT NULL
     AND s.status IN ('active', 'past_due')
     AND COALESCE(s.current_period_end, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ) AS paid_subscribers,
  (SELECT COUNT(DISTINCT p.id)
   FROM profiles p
   LEFT JOIN subscriptions s ON s.user_id = p.id
     AND s.status IN ('active', 'past_due')
     AND COALESCE(s.current_period_end, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE s.id IS NULL
  ) AS unpaid_clients;

CREATE VIEW admin_user_storage AS
SELECT
  p.id AS user_id,
  p.email,
  p.display_name,
  COALESCE(pl.name, 'Sem plano') AS plan_name,
  COALESCE(pl.slug, '') AS plan_slug,
  COALESCE(sub.status, 'none') AS subscription_status,
  COALESCE(pl.storage_mb, 0) AS storage_mb_limit,
  COALESCE(pl.max_pdfs, 0) AS max_pdfs_limit,
  COALESCE(doc_stats.pdf_count, 0) AS pdf_count,
  COALESCE(doc_stats.bytes_used, 0) AS bytes_used,
  p.created_at AS joined_at
FROM profiles p
LEFT JOIN subscriptions sub ON sub.id = (
  SELECT s.id FROM subscriptions s
  WHERE s.user_id = p.id
  ORDER BY s.created_at DESC
  LIMIT 1
)
LEFT JOIN plans pl ON pl.id = sub.plan_id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS pdf_count, COALESCE(SUM(bytes), 0) AS bytes_used
  FROM documents
  GROUP BY user_id
) doc_stats ON doc_stats.user_id = p.id;

CREATE VIEW admin_project_storage AS
SELECT
  COALESCE(SUM(bytes), 0) AS used_bytes,
  1073741824 AS limit_bytes,
  MAX(0, 1073741824 - COALESCE(SUM(bytes), 0)) AS remaining_bytes,
  COUNT(id) AS total_documents
FROM documents;

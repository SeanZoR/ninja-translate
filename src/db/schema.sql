-- Allowlisted groups Sean has approved.
CREATE TABLE IF NOT EXISTS groups (
  jid                          TEXT PRIMARY KEY,
  label                        TEXT NOT NULL,
  target_languages             TEXT NOT NULL,        -- JSON array of ISO-639-1 codes
  enabled                      INTEGER NOT NULL DEFAULT 1,
  voice_translate              INTEGER NOT NULL DEFAULT 1,
  text_translate_on_mention    INTEGER NOT NULL DEFAULT 1,
  polish_level                 INTEGER NOT NULL DEFAULT 1,  -- 0=verbatim, 1=light, 2=medium, 3=high (voice only)
  show_source_label            INTEGER NOT NULL DEFAULT 1,
  show_processing_reaction     INTEGER NOT NULL DEFAULT 0,
  max_audio_seconds            INTEGER NOT NULL DEFAULT 600,
  monthly_budget_cents         INTEGER NOT NULL DEFAULT 500,
  created_by_ninja             INTEGER NOT NULL DEFAULT 0,
  auto_approved                INTEGER NOT NULL DEFAULT 0,  -- true if landed via open-mode
  invite_link                  TEXT,
  notes                        TEXT,
  last_translated_at           TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Global key/value settings. Currently used by the open-mode feature flag.
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,           -- JSON-encoded
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Groups the bot has been added to but Sean has not yet approved.
CREATE TABLE IF NOT EXISTS pending_groups (
  jid                TEXT PRIMARY KEY,
  subject            TEXT,
  participants       TEXT,                    -- JSON array of JIDs
  inviter_jid        TEXT,
  inviter_name       TEXT,
  sample_messages    TEXT,                    -- JSON array of recent message snippets
  first_seen_at      TEXT NOT NULL DEFAULT (datetime('now')),
  status             TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'rejected'
);

-- Groups Sean has rejected; bot left them. Used to flag re-adds.
CREATE TABLE IF NOT EXISTS rejected_groups (
  jid             TEXT PRIMARY KEY,
  inviter_jid     TEXT,
  rejected_at     TEXT NOT NULL DEFAULT (datetime('now')),
  reason          TEXT
);

-- Translated messages.
CREATE TABLE IF NOT EXISTS messages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  group_jid           TEXT NOT NULL,
  wa_message_id       TEXT NOT NULL,
  sender_jid          TEXT,
  sender_name         TEXT,
  kind                TEXT NOT NULL,           -- 'voice' | 'text'
  source_lang         TEXT,
  source_text         TEXT,
  translations        TEXT,                    -- JSON object: { lang: text }
  audio_seconds       INTEGER,
  gemini_tokens_in    INTEGER,
  gemini_tokens_out   INTEGER,
  cost_cents          REAL NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_jid, wa_message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_group_created
  ON messages(group_jid, created_at DESC);

-- Daily rollup for cost dashboards.
CREATE TABLE IF NOT EXISTS usage_daily (
  group_jid             TEXT NOT NULL,
  date                  TEXT NOT NULL,         -- YYYY-MM-DD
  messages_count        INTEGER NOT NULL DEFAULT 0,
  audio_seconds_total   INTEGER NOT NULL DEFAULT 0,
  cost_cents_total      REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (group_jid, date)
);

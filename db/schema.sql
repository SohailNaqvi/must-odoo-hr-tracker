-- ══════════════════════════════════════════════════════════
-- MUST Odoo HR Implementation Tracker — Database Schema
-- SQLite3
-- ══════════════════════════════════════════════════════════

-- Users & Authentication
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK(role IN ('admin','directorHR','registrar','vpOps')),
  email         TEXT,
  active        INTEGER DEFAULT 1,
  created_at    TEXT    DEFAULT (datetime('now')),
  last_login    TEXT
);

-- Implementation Phases
CREATE TABLE IF NOT EXISTS phases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_number  INTEGER UNIQUE NOT NULL,
  title         TEXT    NOT NULL,
  subtitle      TEXT    DEFAULT '',
  timeline      TEXT    DEFAULT '',
  note          TEXT    DEFAULT '',
  sort_order    INTEGER DEFAULT 0,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT    DEFAULT (datetime('now')),
  updated_at    TEXT    DEFAULT (datetime('now'))
);

-- Tasks within phases
CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id      INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  label         TEXT    NOT NULL,
  category      TEXT    NOT NULL CHECK(category IN ('policy','document','odoo','action')),
  status        TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','blocked')),
  sort_order    INTEGER DEFAULT 0,
  completed_date TEXT,
  completed_by  TEXT,
  note          TEXT    DEFAULT '',
  deliverable   TEXT    DEFAULT '',
  created_at    TEXT    DEFAULT (datetime('now')),
  updated_at    TEXT    DEFAULT (datetime('now'))
);

-- Odoo configuration steps per phase
CREATE TABLE IF NOT EXISTS odoo_steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id      INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  label         TEXT    NOT NULL,
  sort_order    INTEGER DEFAULT 0
);

-- Prerequisites per phase
CREATE TABLE IF NOT EXISTS prerequisites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id      INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  label         TEXT    NOT NULL,
  sort_order    INTEGER DEFAULT 0
);

-- Approval authorities per phase
CREATE TABLE IF NOT EXISTS authorities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id      INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  label         TEXT    NOT NULL,
  sort_order    INTEGER DEFAULT 0
);

-- Progress reports submitted by Director HR
CREATE TABLE IF NOT EXISTS progress_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL,
  summary       TEXT    NOT NULL,
  submitted_by  INTEGER NOT NULL REFERENCES users(id),
  submitted_at  TEXT    DEFAULT (datetime('now')),
  phase_number  INTEGER,
  tasks_snapshot TEXT   DEFAULT '[]'   -- JSON array of task IDs marked completed at time of report
);

-- Key findings within a progress report
CREATE TABLE IF NOT EXISTS report_findings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id     INTEGER NOT NULL REFERENCES progress_reports(id) ON DELETE CASCADE,
  finding       TEXT    NOT NULL,
  sort_order    INTEGER DEFAULT 0
);

-- Audit log for all changes
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  action        TEXT    NOT NULL,
  entity_type   TEXT,    -- 'task', 'phase', 'report', 'user'
  entity_id     INTEGER,
  old_value     TEXT,
  new_value     TEXT,
  created_at    TEXT    DEFAULT (datetime('now'))
);

-- 002_add_job_scheduler_state.sql

CREATE TABLE IF NOT EXISTS job_scheduler_state (
  job_name TEXT PRIMARY KEY,
  last_started_at TEXT,
  last_finished_at TEXT,
  last_succeeded_at TEXT,
  last_failed_at TEXT,
  last_error TEXT,
  lock_owner TEXT,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);
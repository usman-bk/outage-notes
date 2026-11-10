CREATE TABLE IF NOT EXISTS components (
  id         serial PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operators (
  id            serial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS incidents (
  id            serial PRIMARY KEY,
  title         text NOT NULL,
  impact        text NOT NULL CHECK (impact IN ('degraded', 'partial', 'major')),
  status        text NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  version       integer NOT NULL DEFAULT 1,
  submission_id uuid NOT NULL UNIQUE,
  CONSTRAINT resolved_means_resolved_at CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  CONSTRAINT ends_after_it_starts CHECK (resolved_at IS NULL OR resolved_at >= started_at)
);

CREATE INDEX IF NOT EXISTS incidents_started_at ON incidents (started_at DESC);
CREATE INDEX IF NOT EXISTS incidents_open ON incidents (started_at) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS incident_components (
  incident_id  integer NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  component_id integer NOT NULL REFERENCES components (id) ON DELETE CASCADE,
  PRIMARY KEY (incident_id, component_id)
);

CREATE TABLE IF NOT EXISTS incident_updates (
  id            bigserial PRIMARY KEY,
  incident_id   integer NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  body          text NOT NULL,
  author        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  submission_id uuid NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS incident_updates_timeline ON incident_updates (incident_id, id DESC);

CREATE TABLE IF NOT EXISTS login_failures (
  email text NOT NULL,
  at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_failures_recent ON login_failures (email, at DESC);

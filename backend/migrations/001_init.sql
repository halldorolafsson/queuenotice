-- Grunnskjema for overvåking, trafikkdata og varsling.

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE watch_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  active      boolean NOT NULL DEFAULT true,
  -- Ukedager 1=mandag ... 7=søndag. Tom liste betyr hele døgnet alle dager.
  schedule    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX watch_lists_user_idx ON watch_lists(user_id);

CREATE TABLE segments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id          uuid NOT NULL REFERENCES watch_lists(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  road_number      text NOT NULL,
  start_name       text NOT NULL,
  start_lat        double precision NOT NULL,
  start_lon        double precision NOT NULL,
  end_name         text NOT NULL,
  end_lat          double precision NOT NULL,
  end_lon          double precision NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('forward', 'both')),
  buffer_m         integer NOT NULL DEFAULT 300 CHECK (buffer_m BETWEEN 50 AND 2000),
  -- Linje som [[lon, lat], ...] fra NVDB eller rett linje som reserve.
  geometry         jsonb NOT NULL,
  geometry_source  text NOT NULL CHECK (geometry_source IN ('nvdb', 'straight')),
  geometry_note    text,
  active           boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX segments_list_idx ON segments(list_id);

CREATE TABLE notification_settings (
  user_id                    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_enabled               boolean NOT NULL DEFAULT false,
  email_enabled              boolean NOT NULL DEFAULT false,
  email                      text,
  event_types                jsonb NOT NULL DEFAULT '["closure","queue","accident","obstruction","restriction"]'::jsonb,
  delay_threshold_min        integer NOT NULL DEFAULT 10 CHECK (delay_threshold_min BETWEEN 1 AND 180),
  notify_on_resolved         boolean NOT NULL DEFAULT true,
  include_unknown_direction  boolean NOT NULL DEFAULT true,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count   integer NOT NULL DEFAULT 0
);

-- Normaliserte hendelser fra alle kilder. id = "<kilde>:<kildens id>".
CREATE TABLE traffic_events (
  id                  text PRIMARY KEY,
  source              text NOT NULL,
  source_id           text NOT NULL,
  version             text NOT NULL,
  category            text NOT NULL,
  situation_type      text,
  secondary_types     jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity            integer NOT NULL DEFAULT 0,
  title               text NOT NULL,
  description         text NOT NULL DEFAULT '',
  road_numbers        jsonb NOT NULL DEFAULT '[]'::jsonb,
  geometry            jsonb NOT NULL,
  direction           text NOT NULL DEFAULT 'unknown',
  direction_checked   text,
  reported_delay_min  integer,
  start_time          timestamptz,
  end_time            timestamptz,
  active_periods      jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_updated_at   timestamptz,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  status              text NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'gone')),
  gone_at             timestamptz,
  is_demo             boolean NOT NULL DEFAULT false
);
CREATE INDEX traffic_events_status_idx ON traffic_events(status, source);

CREATE TABLE travel_times (
  id              text PRIMARY KEY,
  source          text NOT NULL,
  name            text NOT NULL,
  geometry        jsonb NOT NULL,
  actual_sec      integer,
  expected_sec    integer,
  delay_sec       integer,
  status_value    text,
  measured_at     timestamptz,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'gone')),
  is_demo         boolean NOT NULL DEFAULT false
);

CREATE TABLE source_status (
  source                text PRIMARY KEY,
  last_attempt_at       timestamptz,
  last_success_at       timestamptz,
  last_error            text,
  last_error_at         timestamptz,
  consecutive_failures  integer NOT NULL DEFAULT 0,
  last_item_count       integer,
  last_duration_ms      integer,
  is_demo               boolean NOT NULL DEFAULT false
);

-- Husker hva brukeren har fått beskjed om, per strekning og hendelse.
CREATE TABLE alert_state (
  segment_id         uuid NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  item_key           text NOT NULL,
  source             text NOT NULL,
  notified           boolean NOT NULL DEFAULT false,
  first_matched_at   timestamptz NOT NULL DEFAULT now(),
  last_matched_at    timestamptz NOT NULL DEFAULT now(),
  last_notified_at   timestamptz,
  last_category      text,
  last_severity      integer,
  last_delay_min     integer,
  last_fingerprint   text,
  PRIMARY KEY (segment_id, item_key)
);

CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  segment_id   uuid REFERENCES segments(id) ON DELETE SET NULL,
  item_key     text,
  kind         text NOT NULL CHECK (kind IN ('new', 'update', 'resolved', 'test')),
  channel      text NOT NULL CHECK (channel IN ('push', 'email', 'none')),
  status       text NOT NULL CHECK (status IN ('dry_run', 'sent', 'failed', 'skipped')),
  title        text NOT NULL,
  body         text NOT NULL,
  error        text,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE poll_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  trigger       text NOT NULL,
  summary       jsonb,
  error         text
);

-- Hindrer at to innhentinger kjører samtidig (f.eks. planlagt jobb og "Oppdater nå").
CREATE TABLE poll_lock (
  id            integer PRIMARY KEY CHECK (id = 1),
  locked_until  timestamptz NOT NULL
);
INSERT INTO poll_lock (id, locked_until) VALUES (1, '1970-01-01T00:00:00Z');

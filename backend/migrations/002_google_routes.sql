-- Reisetider som gjelder én bestemt strekning (Google Routes), og telling av betalte API-kall.

ALTER TABLE travel_times ADD COLUMN kind text NOT NULL DEFAULT 'measured' CHECK (kind IN ('measured', 'estimated'));
ALTER TABLE travel_times ADD COLUMN segment_id uuid REFERENCES segments(id) ON DELETE CASCADE;
ALTER TABLE travel_times ADD COLUMN segment_direction text CHECK (segment_direction IN ('same', 'opposite'));

-- Antall kall per kilde per dag (norsk dato), for kostnadskontroll.
CREATE TABLE api_usage (
  day     text NOT NULL,
  source  text NOT NULL,
  calls   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source)
);

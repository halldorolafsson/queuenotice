-- Brukeren kan slå av enkeltkilder. Lagrer hva som er slått av, slik at nye kilder er på som standard.
ALTER TABLE notification_settings ADD COLUMN disabled_sources jsonb NOT NULL DEFAULT '[]'::jsonb;

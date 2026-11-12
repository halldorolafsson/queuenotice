-- Strekninger velges i kart og kan følge flere veger. Alle vegnumre ruten bruker, lagres for treff mot meldinger.
ALTER TABLE segments ADD COLUMN road_numbers jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE segments SET road_numbers = jsonb_build_array(road_number) WHERE road_number <> '';

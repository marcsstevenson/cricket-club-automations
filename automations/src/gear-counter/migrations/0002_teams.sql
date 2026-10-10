-- Teams and pools move from shared/src/gear-data.json into D1 so the admin page can add and hide them.
CREATE TABLE teams (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('team', 'pool')),
  mascot TEXT NOT NULL DEFAULT '',
  grade TEXT,
  spec TEXT,
  dot TEXT,
  sort INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at TEXT NOT NULL,
  CHECK ((kind = 'team') = (spec IS NOT NULL))
);
CREATE UNIQUE INDEX teams_name ON teams (name COLLATE NOCASE);

-- The 27 game-day teams (grades and dots from the gear workbook's Oct Gear check tab) and the Club pool.
INSERT INTO teams (slug, name, kind, mascot, grade, spec, dot, sort, hidden, created_at) VALUES
  ('bears', 'Parklands Bears', 'team', 'bears', 'Year 4', 'Year 4', 'dark blue', 10, 0, '2026-10-09T00:00:00.000Z'),
  ('cheetahs', 'Parklands Cheetahs', 'team', 'cheetahs', 'Year 5', 'Year 5', 'orange', 20, 0, '2026-10-09T00:00:00.000Z'),
  ('dolphins', 'Parklands Dolphins', 'team', 'dolphins', 'Kiwi Year 2', 'Kiwi Y2', 'light blue', 30, 0, '2026-10-09T00:00:00.000Z'),
  ('dragons', 'Parklands Dragons', 'team', 'dragons', 'Year 4', 'Year 4', 'orange', 40, 0, '2026-10-09T00:00:00.000Z'),
  ('gorillas', 'Parklands Gorillas', 'team', 'gorillas', 'Year 3', 'Year 3', 'green', 50, 0, '2026-10-09T00:00:00.000Z'),
  ('jackals', 'Parklands Jackals', 'team', 'jackals', 'Year 6', 'Year 6', 'yellow', 60, 0, '2026-10-09T00:00:00.000Z'),
  ('korimako', 'ECSCC/Parklands Korimako', 'team', 'foxes', 'Division 5', 'Div 5', NULL, 70, 0, '2026-10-09T00:00:00.000Z'),
  ('lemurs', 'Parklands Lemurs', 'team', 'lemurs', 'Year 4', 'Year 4', 'yellow', 80, 0, '2026-10-09T00:00:00.000Z'),
  ('leopards', 'Parklands Leopards', 'team', 'leopards', 'Year 6', 'Year 6', 'light blue', 90, 0, '2026-10-09T00:00:00.000Z'),
  ('lions', 'Parklands Lions', 'team', 'lions', 'Kiwi Year 1/2', 'Kiwi Y1', 'yellow', 100, 0, '2026-10-09T00:00:00.000Z'),
  ('meerkats', 'Parklands Meerkats', 'team', 'meerkats', 'Division 4', 'Div 4', 'green', 110, 0, '2026-10-09T00:00:00.000Z'),
  ('monkeys', 'Parklands Monkeys', 'team', 'monkeys', 'Kiwi Year 1', 'Kiwi Y1', 'light blue', 120, 0, '2026-10-09T00:00:00.000Z'),
  ('narwhals', 'Parklands Narwhals', 'team', 'narwhals', 'Kiwi Year 1/2', 'Kiwi Y1', 'yellow', 130, 0, '2026-10-09T00:00:00.000Z'),
  ('orcas', 'Parklands Orcas', 'team', 'orcas', 'Kiwi Year 1/2', 'Kiwi Y1', NULL, 140, 0, '2026-10-09T00:00:00.000Z'),
  ('pandas', 'Parklands/NBCC Pandas', 'team', 'pandas', 'Division 3 Hardball', 'Div 3 Hardball', 'orange', 150, 0, '2026-10-09T00:00:00.000Z'),
  ('panthers', 'Parklands Panthers', 'team', 'panthers', 'Year 3', 'Year 3', 'green', 160, 0, '2026-10-09T00:00:00.000Z'),
  ('pelicans', 'Parklands Pelicans', 'team', 'pelicans', 'Year 5', 'Year 5', 'dark blue', 170, 0, '2026-10-09T00:00:00.000Z'),
  ('penguins', 'Parklands Penguins', 'team', 'penguins', 'Kiwi Year 1', 'Kiwi Y1', 'yellow', 180, 0, '2026-10-09T00:00:00.000Z'),
  ('pumas', 'Parklands Pumas', 'team', 'pumas', 'Year 7', 'Year 7', 'green', 190, 0, '2026-10-09T00:00:00.000Z'),
  ('pythons', 'Parklands Pythons', 'team', 'pythons', 'Year 6', 'Year 6', 'dark blue', 200, 0, '2026-10-09T00:00:00.000Z'),
  ('rhinos', 'Parklands Rhinos', 'team', 'rhinos', 'Year 5', 'Year 5', 'light blue', 210, 0, '2026-10-09T00:00:00.000Z'),
  ('sharks', 'Parklands Sharks', 'team', 'sharks', 'Year 3', 'Year 3', 'dark blue', 220, 0, '2026-10-09T00:00:00.000Z'),
  ('swans', 'Parklands Swans', 'team', 'swans', 'Division 5', 'Div 5', NULL, 230, 0, '2026-10-09T00:00:00.000Z'),
  ('tigers', 'Parklands Tigers', 'team', 'tigers', 'Year 3', 'Year 3', 'orange', 240, 0, '2026-10-09T00:00:00.000Z'),
  ('unicorns', 'Parklands Unicorns', 'team', 'unicorns', 'Division 5', 'Div 5', 'light blue', 250, 0, '2026-10-09T00:00:00.000Z'),
  ('wolves', 'Parklands Wolves', 'team', 'wolves', 'Year 5', 'Year 5', 'green', 260, 0, '2026-10-09T00:00:00.000Z'),
  ('wombats', 'Parklands Wombats', 'team', 'wombats', 'Year 3', 'Year 3', 'orange', 270, 0, '2026-10-09T00:00:00.000Z'),
  ('pool', 'Club pool', 'pool', '', NULL, NULL, NULL, 10, 0, '2026-10-09T00:00:00.000Z');

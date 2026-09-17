-- One row per installation in each versioned puzzle cohort. Each metric is
-- minimized independently; combined need not equal the sum of stored minima.
CREATE TABLE score_bests (
  puzzle_id TEXT NOT NULL,
  puzzle_revision TEXT NOT NULL CHECK (length(puzzle_revision) = 64),
  scoring_version INTEGER NOT NULL CHECK (scoring_version > 0),
  installation_id TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0 AND price <= 9007199254740991),
  cycles REAL NOT NULL CHECK (cycles >= 0 AND cycles <= 9007199254740991),
  footprint INTEGER NOT NULL CHECK (footprint >= 0 AND footprint <= 9007199254740991),
  combined REAL NOT NULL CHECK (combined >= 0 AND combined <= 9007199254740991),
  PRIMARY KEY (puzzle_id, puzzle_revision, scoring_version, installation_id)
) WITHOUT ROWID;

-- Content-addressed JSON is immutable. Re-publishing identical content does not
-- change its original attribution or create another row.
CREATE TABLE shared_puzzles (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 64),
  installation_id TEXT NOT NULL,
  puzzle_json TEXT NOT NULL CHECK (length(CAST(puzzle_json AS BLOB)) <= 1048576)
) WITHOUT ROWID;

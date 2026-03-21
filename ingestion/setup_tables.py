"""
setup_tables.py

Restructures Supabase tables for the rosters/lineups schema change:
  - Drops old `lineups` table
  - Renames old `rosters` → `owners`
  - Creates new `rosters` table
  - Disables RLS on new tables

Run once before the next full reload.
"""

import os
import psycopg2
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_HOST     = os.environ["DB_HOST"]
DB_PORT     = os.environ.get("DB_PORT", "5432")
DB_PASSWORD = os.environ["DB_PASSWORD"]

conn = psycopg2.connect(
    host=DB_HOST,
    port=DB_PORT,
    dbname="postgres",
    user="postgres",
    password=DB_PASSWORD,
    sslmode="require",
)
conn.autocommit = True
cur = conn.cursor()

steps = [
    ("Drop lineups table",
     "DROP TABLE IF EXISTS lineups CASCADE;"),

    ("Rename rosters to owners",
     "ALTER TABLE IF EXISTS rosters RENAME TO owners;"),

    ("Drop owners unique constraint (will recreate)",
     "ALTER TABLE IF EXISTS owners DROP CONSTRAINT IF EXISTS rosters_year_roster_id_key;"),

    ("Add owners unique constraint",
     """
     DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'owners_year_roster_id_key'
       ) THEN
         ALTER TABLE owners ADD CONSTRAINT owners_year_roster_id_key UNIQUE (year, roster_id);
       END IF;
     END $$;
     """),

    ("Create rosters table",
     """
     CREATE TABLE IF NOT EXISTS rosters (
         id              BIGSERIAL PRIMARY KEY,
         year            INTEGER      NOT NULL,
         week            INTEGER      NOT NULL,
         roster_id       INTEGER      NOT NULL,
         player_id       VARCHAR(20)  NOT NULL,
         player_name     VARCHAR(100) NOT NULL,
         player_position VARCHAR(20)  NOT NULL,
         mapped_position VARCHAR(20)  NOT NULL,
         lineup_slot     VARCHAR(20)  NOT NULL,
         is_starter      BOOLEAN      NOT NULL DEFAULT FALSE,
         points          DOUBLE PRECISION NOT NULL DEFAULT 0,
         UNIQUE (year, week, roster_id, player_id)
     );
     """),

    ("Disable RLS on owners",
     "ALTER TABLE owners DISABLE ROW LEVEL SECURITY;"),

    ("Disable RLS on rosters",
     "ALTER TABLE rosters DISABLE ROW LEVEL SECURITY;"),
]

print("=" * 60)
print("MLD Table Setup")
print("=" * 60)

for label, sql in steps:
    try:
        cur.execute(sql)
        print(f"  [OK]    {label}")
    except Exception as e:
        print(f"  [FAIL]  {label}: {e}")

cur.close()
conn.close()
print("\nDone.")

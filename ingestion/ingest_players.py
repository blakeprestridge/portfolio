"""
ingest_players.py

Full replace of the players reference table from Sleeper's /players/nfl endpoint.
Run manually or on a weekly schedule — player data changes slowly.

Usage:
    python ingest_players.py
"""

import os
import psycopg2
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

from db_utils import full_replace, clean_row
from api.models import Player
from mld_utilities.get_players import get_all_players

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def create_table_if_missing():
    """Create the players table in Supabase if it doesn't exist yet."""
    conn = psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=os.environ.get("DB_PORT", "5432"),
        dbname="postgres",
        user=os.environ.get("DB_USER", "postgres"),
        password=os.environ["DB_PASSWORD"],
        sslmode="require",
    )
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS players (
            id             BIGSERIAL    PRIMARY KEY,
            player_id      VARCHAR(20)  NOT NULL UNIQUE,
            full_name      VARCHAR(100) NOT NULL,
            first_name     VARCHAR(50),
            last_name      VARCHAR(50),
            position       VARCHAR(20),
            team           VARCHAR(10),
            age            INTEGER,
            years_exp      INTEGER,
            status         VARCHAR(50),
            injury_status  VARCHAR(50),
            search_rank    INTEGER
        );
    """)
    cur.execute("ALTER TABLE players DISABLE ROW LEVEL SECURITY;")
    cur.execute("GRANT SELECT ON players TO anon;")

    cur.close()
    conn.close()


def main():
    print("=" * 60)
    print(f"MLD PLAYER INGESTION -- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    print("\nEnsuring players table exists...")
    create_table_if_missing()
    print("  [OK]")

    print("\nFetching players from Sleeper API...")
    rows = get_all_players()
    print(f"  {len(rows):,} fantasy-relevant players fetched")

    print("\nWriting to database (full replace)...")
    instances = [Player(**clean_row(r)) for r in rows]
    n = full_replace(Player, instances)
    print(f"  {n:,} rows written")

    print(f"\n{'=' * 60}")
    print(f"Done -- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    main()

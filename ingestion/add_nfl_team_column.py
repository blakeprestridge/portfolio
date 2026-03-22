"""
add_nfl_team_column.py

Adds the nfl_team column to the transaction_players table.
Run once before the next ingestion.
"""

import os
import psycopg2
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_HOST     = os.environ["DB_HOST"]
DB_PORT     = os.environ.get("DB_PORT", "5432")
DB_USER     = os.environ.get("DB_USER", "postgres")
DB_PASSWORD = os.environ["DB_PASSWORD"]

conn = psycopg2.connect(
    host=DB_HOST,
    port=DB_PORT,
    dbname="postgres",
    user=DB_USER,
    password=DB_PASSWORD,
    sslmode="require",
)
conn.autocommit = True
cur = conn.cursor()

sql = """
ALTER TABLE transaction_players
ADD COLUMN IF NOT EXISTS nfl_team VARCHAR(10) NULL;
"""

try:
    cur.execute(sql)
    print("[OK] Added nfl_team column to transaction_players")
except Exception as e:
    print(f"[FAIL] {e}")

cur.close()
conn.close()

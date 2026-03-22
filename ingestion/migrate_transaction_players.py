"""
migrate_transaction_players.py

Alters the transaction_players table in Supabase to support draft pick IDs,
which are longer than the original VARCHAR(20) player_id column.
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

steps = [
    ("Widen transaction_players.player_id to VARCHAR(100)",
     "ALTER TABLE transaction_players ALTER COLUMN player_id TYPE VARCHAR(100);"),
]

print("=" * 60)
print("MLD Migration: transaction_players")
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

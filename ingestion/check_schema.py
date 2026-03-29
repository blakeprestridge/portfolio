"""
check_schema.py

Compares current Supabase table columns against Django model fields.
"""

import os
import sys
import psycopg2
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

conn = psycopg2.connect(
    host=os.environ["DB_HOST"],
    port=os.environ.get("DB_PORT", "5432"),
    dbname="postgres",
    user=os.environ.get("DB_USER", "postgres"),
    password=os.environ["DB_PASSWORD"],
    sslmode="require",
)
cur = conn.cursor()

TABLES = [
    "owners", "standings", "matchups", "rosters", "player_stats",
    "transactions", "transaction_players", "traded_picks",
    "draft_metadata", "draft_picks",
]

print("=" * 60)
print("Supabase column check")
print("=" * 60)

for table in TABLES:
    cur.execute("""
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position;
    """, (table,))
    rows = cur.fetchall()
    print(f"\n{table}")
    for col, dtype, nullable in rows:
        print(f"  {col:<30} {dtype:<25} {'NULL' if nullable == 'YES' else 'NOT NULL'}")

cur.close()
conn.close()

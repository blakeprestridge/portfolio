"""
reload_league_files.py

Full reload of all MLD data across all seasons, writing directly to Supabase.
Run this to rebuild the database from scratch.
"""

import json
import os
from datetime import datetime
from pathlib import Path

from db_utils import (
    INGESTION_DIR,
    clean_row, full_replace, season_replace, nan_to_none,
)

from api.models import (
    Owner, Roster, Standing, Matchup, PlayerStat,
    Transaction, TransactionPlayer, TradedPick, DraftMetadata, DraftPick,
)

from mld_utilities.get_rosters      import get_season_owners, get_season_rosters
from mld_utilities.get_matchups     import get_season_matchups
from mld_utilities.get_standings    import get_season_standings
from mld_utilities.get_player_stats import get_week_stats_for_season
from mld_utilities.get_transactions import get_season_transactions
from mld_utilities.get_traded_picks import get_season_traded_picks
from mld_utilities.get_drafts       import get_season_drafts
from sleeper_wrapper import Players

MLD_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DL", "LB", "DB"}


def load_seasons():
    with open(INGESTION_DIR / "mld_league_season_ids.json") as f:
        seasons = json.load(f)
    seasons.sort(key=lambda s: s["year"])
    return seasons


def extract_league_id(url):
    return url.split("/")[5]


# ---------------------------------------------------------------------------
# Row builders  —  dict → model instance
# ---------------------------------------------------------------------------

def build_owners(rows):
    return [Owner(**clean_row(r)) for r in rows]

def build_rosters(rows):
    return [Roster(**clean_row(r)) for r in rows]

def build_standings(rows):
    return [Standing(**clean_row(r)) for r in rows]

def build_matchups(rows):
    return [Matchup(**clean_row(r)) for r in rows]

def build_player_stats(rows):
    instances = []
    for r in rows:
        d = clean_row(r)
        # "int" is a reserved word in Python; Django model field is "interceptions"
        d["interceptions"] = d.pop("int", 0)
        instances.append(PlayerStat(**d))
    return instances

def build_transactions(rows):
    return [Transaction(**clean_row(r)) for r in rows]

def build_transaction_players(rows):
    return [TransactionPlayer(**clean_row(r)) for r in rows]

def build_traded_picks(rows):
    return [TradedPick(**clean_row(r)) for r in rows]

def build_draft_metadata(rows):
    return [DraftMetadata(**clean_row(r)) for r in rows]

def build_draft_picks(rows):
    instances = []
    for r in rows:
        d = clean_row(r)
        # Coerce is_keeper to bool in case it comes through as a string
        d["is_keeper"] = str(d.get("is_keeper", "False")).lower() in ("true", "1")
        instances.append(DraftPick(**d))
    return instances


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    os.chdir(INGESTION_DIR)
    seasons = load_seasons()

    print("=" * 70)
    print("MLD FULL RELOAD — ALL SEASONS")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Seasons: {[s['year'] for s in seasons]}")
    print("=" * 70)

    print("\nFetching all players (used by rosters, stats, transactions, drafts)...")
    all_players = Players().get_all_players()
    print(f"  {len(all_players):,} players loaded")

    # Collect all rows across all seasons before touching the DB
    all_owners, all_rosters, all_standings, all_matchups = [], [], [], []
    all_stats                                             = []
    all_txns, all_txn_players, all_traded_picks          = [], [], []
    all_draft_meta, all_draft_picks                      = [], []
    owner_map                                             = {}

    for season in seasons:
        year      = season["year"]
        league_id = extract_league_id(season["url"])
        print(f"\n--- {year} (league {league_id}) ---")

        try:
            season_owners = get_season_owners(year, league_id)
            all_owners += season_owners
            for o in season_owners:
                owner_map[(str(o['year']), int(o['roster_id']))] = o['display_name']
            print(f"  owners         OK")
        except Exception as e:
            print(f"  owners         FAILED: {e}")

        try:
            all_rosters += get_season_rosters(year, league_id, all_players)
            print(f"  rosters        OK")
        except Exception as e:
            print(f"  rosters        FAILED: {e}")

        try:
            all_standings += get_season_standings(year, league_id)
            print(f"  standings      OK")
        except Exception as e:
            print(f"  standings      FAILED: {e}")

        try:
            all_matchups += get_season_matchups(year, league_id)
            print(f"  matchups       OK")
        except Exception as e:
            print(f"  matchups       FAILED: {e}")

        try:
            all_stats += get_week_stats_for_season(year, all_players, MLD_POSITIONS)
            print(f"  player_stats   OK")
        except Exception as e:
            print(f"  player_stats   FAILED: {e}")

        try:
            txn_rows, player_rows = get_season_transactions(year, league_id, all_players, owner_map=owner_map)
            all_txns        += txn_rows
            all_txn_players += player_rows
            print(f"  transactions   OK")
        except Exception as e:
            print(f"  transactions   FAILED: {e}")

        try:
            all_traded_picks += get_season_traded_picks(year, league_id)
            print(f"  traded_picks   OK")
        except Exception as e:
            print(f"  traded_picks   FAILED: {e}")

        try:
            meta_rows, pick_rows = get_season_drafts(year, league_id, all_players)
            all_draft_meta  += meta_rows
            all_draft_picks += pick_rows
            print(f"  drafts         OK")
        except Exception as e:
            print(f"  drafts         FAILED: {e}")

    # Write to DB — full replace for every table
    print(f"\n{'=' * 70}")
    print("Writing to Supabase...")
    print("=" * 70)

    results = {}

    def write(label, model, rows, builder):
        try:
            n = full_replace(model, builder(rows))
            results[label] = n
            print(f"  [OK]    {label:<22}  {n:>8,} rows")
        except Exception as e:
            import traceback
            traceback.print_exc()
            results[label] = f"FAILED: {e}"
            print(f"  [FAIL]  {label:<22}  {e}")

    write("owners",              Owner,             all_owners,       build_owners)
    write("rosters",             Roster,            all_rosters,      build_rosters)
    write("standings",           Standing,          all_standings,    build_standings)
    write("matchups",            Matchup,           all_matchups,     build_matchups)
    write("player_stats",        PlayerStat,        all_stats,        build_player_stats)
    write("transactions",        Transaction,       all_txns,         build_transactions)
    write("transaction_players", TransactionPlayer, all_txn_players,  build_transaction_players)
    write("traded_picks",        TradedPick,        all_traded_picks, build_traded_picks)
    write("draft_metadata",      DraftMetadata,     all_draft_meta,   build_draft_metadata)
    write("draft_picks",         DraftPick,         all_draft_picks,  build_draft_picks)

    print(f"\n{'=' * 70}")
    print(f"Completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)


if __name__ == "__main__":
    main()

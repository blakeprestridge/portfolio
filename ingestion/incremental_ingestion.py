"""
incremental_ingestion.py

Reloads data for the most recent season only, writing directly to Supabase.
Intended to run daily via Railway cron job.
"""

import argparse
import json
import os
from datetime import datetime

from db_utils import (
    INGESTION_DIR,
    clean_row, season_replace, nan_to_none,
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


def load_current_season():
    with open(INGESTION_DIR / "mld_league_season_ids.json") as f:
        seasons = json.load(f)
    return max(seasons, key=lambda s: s["year"])


def extract_league_id(url):
    return url.split("/")[5]


# ---------------------------------------------------------------------------
# Row builders — identical to reload_league_files.py
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
        d["is_keeper"] = str(d.get("is_keeper", "False")).lower() in ("true", "1")
        instances.append(DraftPick(**d))
    return instances


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

GROUPS = {
    "hourly": [
        "rosters", "matchups", "transactions", "traded_picks",
    ],
    "weekly": [
        "player_stats", "standings",
    ],
    "manual": [
        "owners", "draft_metadata", "draft_picks",
    ],
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--group",
        choices=GROUPS.keys(),
        default=None,
        help="Table group to reload. Omit to run all tables.",
    )
    args = parser.parse_args()

    tables = GROUPS[args.group] if args.group else [t for g in GROUPS.values() for t in g]

    os.chdir(INGESTION_DIR)
    current   = load_current_season()
    year      = current["year"]
    league_id = extract_league_id(current["url"])

    group_label = args.group.upper() if args.group else "ALL"
    print("=" * 70)
    print(f"MLD INCREMENTAL INGESTION [{group_label}] -- {year}")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    # Only fetch all_players when a group that needs it is running
    needs_players = {"rosters", "player_stats", "transactions"} & set(tables)
    all_players = {}
    if needs_players:
        print("\nFetching all players...")
        all_players = Players().get_all_players()
        print(f"  {len(all_players):,} players loaded\n")

    results = {}

    def run(label, model, builder, fetch_fn, *fetch_args, year_field="year"):
        if label not in tables:
            return
        try:
            rows = fetch_fn(*fetch_args)
            n = season_replace(model, builder(rows), year_field=year_field, year=year)
            results[label] = n
        except Exception as e:
            import traceback
            traceback.print_exc()
            results[label] = f"FAILED: {e}"

    run("owners",       Owner,      build_owners,       get_season_owners,             year, league_id)
    run("rosters",      Roster,     build_rosters,      get_season_rosters,            year, league_id, all_players)
    run("standings",    Standing,   build_standings,    get_season_standings,          year, league_id)
    run("matchups",     Matchup,    build_matchups,     get_season_matchups,           year, league_id)
    run("player_stats", PlayerStat, build_player_stats, get_week_stats_for_season,     year, all_players, MLD_POSITIONS)
    run("traded_picks", TradedPick, build_traded_picks, get_season_traded_picks,       year, league_id, year_field="league_year")

    # Transactions return two lists — handle separately
    if "transactions" in tables:
        try:
            txn_rows, player_rows = get_season_transactions(year, league_id, all_players)
            results["transactions"]        = season_replace(Transaction,       build_transactions(txn_rows),          year=year)
            results["transaction_players"] = season_replace(TransactionPlayer, build_transaction_players(player_rows), year=year)
        except Exception as e:
            import traceback
            traceback.print_exc()
            results["transactions"] = f"FAILED: {e}"

    # Drafts return two lists — handle separately
    if "draft_metadata" in tables or "draft_picks" in tables:
        try:
            meta_rows, pick_rows = get_season_drafts(year, league_id, all_players)
            results["draft_metadata"] = season_replace(DraftMetadata, build_draft_metadata(meta_rows), year=year)
            results["draft_picks"]    = season_replace(DraftPick,     build_draft_picks(pick_rows),    year=year)
        except Exception as e:
            import traceback
            traceback.print_exc()
            results["draft_metadata"] = f"FAILED: {e}"

    print(f"\n{'=' * 70}")
    print(f"SUMMARY  --  completed {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)
    for name, result in results.items():
        if isinstance(result, int):
            print(f"  [OK]    {name:<24}  {result:>6,} rows")
        else:
            print(f"  [FAIL]  {name:<24}  {result}")


if __name__ == "__main__":
    main()

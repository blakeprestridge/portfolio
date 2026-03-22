"""
get_transactions.py

Fetches all transactions (trades, waivers, free agent moves) for all seasons
of the Major League Dynasty league.

Creates two output tables:
  - transactions.csv     one row per transaction (metadata + summary)
  - transaction_players.csv  one row per player add/drop per transaction
"""

import json
import os
import pandas as pd
from datetime import datetime, timezone
from sleeper_wrapper import League, Players


def _epoch_ms_to_dt(epoch_ms):
    """Convert Sleeper epoch milliseconds to a UTC datetime, or None."""
    if epoch_ms is None:
        return None
    try:
        return datetime.fromtimestamp(int(epoch_ms) / 1000, tz=timezone.utc)
    except Exception:
        return None


def extract_league_id(url):
    return url.split('/')[5]


def load_pick_map():
    """
    Load draft_pick_order.json from the ingestion directory or project root.
    Builds a lookup dict keyed by (season_str, round, original_roster_id)
    -> {pick_in_round, overall}.
    Returns an empty dict if the file doesn't exist.
    """
    script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidates = [
        os.path.join(script_dir, 'draft_pick_order.json'),
        os.path.join(os.getcwd(), 'draft_pick_order.json'),
        os.path.join(os.getcwd(), 'fantasy_football', 'draft_pick_order.json'),
    ]
    path = next((p for p in candidates if os.path.exists(p)), None)
    if not path:
        return {}
    with open(path, 'r') as f:
        raw = json.load(f)
    pick_map = {}
    for season_str, picks in raw.items():
        num_teams = len(picks)  # one entry per team per season
        for p in picks:
            key = (season_str, int(p['original_roster_id']))
            pick_map[key] = (int(p['pick_in_round']), num_teams)
    return pick_map


def load_owner_map(base_dir):
    """
    Load owners.csv and build a lookup dict keyed by
    (year_str, roster_id) -> display_name.
    Returns an empty dict if the file doesn't exist.
    """
    path = os.path.join(base_dir, 'owners.csv')
    if not os.path.exists(path):
        return {}
    df = pd.read_csv(path, dtype={'roster_id': int, 'year': int})
    owner_map = {}
    for _, row in df.iterrows():
        key = (str(row['year']), int(row['roster_id']))
        owner_map[key] = row['display_name']
    return owner_map


def get_season_transactions(year, league_id, player_map, pick_map=None, owner_map=None):
    """
    Fetch all transactions for a season across all weeks.

    Parameters:
    - year: Season year
    - league_id: Sleeper league ID
    - player_map: Dict of player_id -> player info (from Players.get_all_players())

    Returns:
    - (transaction_rows, player_rows): lists of dicts
    """
    pick_map  = pick_map  or {}
    owner_map = owner_map or {}
    league = League(league_id)

    transaction_rows = []
    player_rows = []
    seen_transaction_ids = set()

    # Week 0 catches off-season/pre-season moves; weeks 1-18 cover the season
    for week in range(0, 19):
        try:
            transactions = league.get_transactions(week)
            if not transactions:
                continue

            for txn in transactions:
                txn_id = txn.get('transaction_id')

                # Sleeper occasionally returns the same transaction in multiple weeks
                if txn_id in seen_transaction_ids:
                    continue
                seen_transaction_ids.add(txn_id)

                txn_type = txn.get('type')       # trade, waiver, free_agent
                txn_status = txn.get('status')   # complete, failed
                created = _epoch_ms_to_dt(txn.get('created'))
                status_updated = _epoch_ms_to_dt(txn.get('status_updated'))

                roster_ids = txn.get('roster_ids') or []

                # FAAB budget transfers (present on waiver transactions)
                waiver_budget = txn.get('waiver_budget') or []
                faab_bid = sum(w.get('amount', 0) for w in waiver_budget) if waiver_budget else None

                # Draft picks involved (present on trade transactions)
                draft_picks = txn.get('draft_picks') or []
                num_picks_traded = len(draft_picks)

                adds = txn.get('adds') or {}
                drops = txn.get('drops') or {}

                transaction_rows.append({
                    'year': year,
                    'week': week,
                    'transaction_id': txn_id,
                    'type': txn_type,
                    'status': txn_status,
                    'created': created,
                    'status_updated': status_updated,
                    'roster_ids': ','.join(str(r) for r in roster_ids),
                    'num_adds': len(adds),
                    'num_drops': len(drops),
                    'num_picks_traded': num_picks_traded,
                    'faab_bid': faab_bid,
                })

                # Player-level rows: adds
                for player_id, roster_id in adds.items():
                    info = player_map.get(str(player_id), {})
                    player_rows.append({
                        'year': year,
                        'week': week,
                        'transaction_id': txn_id,
                        'type': txn_type,
                        'action': 'add',
                        'player_id': player_id,
                        'player_name': info.get('full_name', 'Unknown'),
                        'player_position': info.get('position', 'UNKNOWN'),
                        'roster_id': roster_id,
                        'faab_bid': faab_bid if txn_type == 'waiver' else None,
                    })

                # Player-level rows: drops
                for player_id, roster_id in drops.items():
                    info = player_map.get(str(player_id), {})
                    player_rows.append({
                        'year': year,
                        'week': week,
                        'transaction_id': txn_id,
                        'type': txn_type,
                        'action': 'drop',
                        'player_id': player_id,
                        'player_name': info.get('full_name', 'Unknown'),
                        'player_position': info.get('position', 'UNKNOWN'),
                        'roster_id': roster_id,
                        'faab_bid': None,
                    })

                # Draft pick rows: one add (receiver) + one drop (sender) per pick
                for pick in draft_picks:
                    pick_season    = str(pick.get('season', year))
                    pick_round     = pick.get('round', '?')
                    orig_roster_id = pick.get('roster_id')
                    receiver_id    = pick.get('owner_id')
                    sender_id      = pick.get('previous_owner_id')

                    map_key  = (pick_season, int(orig_roster_id)) if orig_roster_id else None
                    map_info = pick_map.get(map_key) if map_key else None

                    if map_info:
                        pick_in_round, num_teams = map_info
                        overall    = (int(pick_round) - 1) * num_teams + pick_in_round
                        round_str  = f"{pick_round}.{str(pick_in_round).zfill(2)}"
                        pick_id    = f"pick_{pick_season}_r{pick_round}_p{overall}"
                        pick_name  = f"{pick_season} Pick {round_str}"
                    else:
                        owner_key    = (pick_season, int(orig_roster_id)) if orig_roster_id else None
                        display_name = owner_map.get(owner_key, f"Roster{orig_roster_id}") if owner_key else f"Roster{orig_roster_id}"
                        safe_name    = display_name.replace(' ', '_')
                        pick_id   = f"pick_{pick_season}_r{pick_round}_{safe_name}"
                        pick_name = f"{pick_season} {display_name} Round {pick_round}"

                    if receiver_id:
                        player_rows.append({
                            'year': year,
                            'week': week,
                            'transaction_id': txn_id,
                            'type': txn_type,
                            'action': 'add',
                            'player_id': pick_id,
                            'player_name': pick_name,
                            'player_position': 'PICK',
                            'roster_id': receiver_id,
                            'faab_bid': None,
                        })
                    if sender_id:
                        player_rows.append({
                            'year': year,
                            'week': week,
                            'transaction_id': txn_id,
                            'type': txn_type,
                            'action': 'drop',
                            'player_id': pick_id,
                            'player_name': pick_name,
                            'player_position': 'PICK',
                            'roster_id': sender_id,
                            'faab_bid': None,
                        })

        except Exception:
            # Some weeks simply don't exist for a given league/season
            pass

    return transaction_rows, player_rows


def main():
    if os.path.exists('fantasy_football/mld_league_season_ids.json'):
        league_file = 'fantasy_football/mld_league_season_ids.json'
        base_dir = 'fantasy_football/mld_base_tables'
    else:
        league_file = 'mld_league_season_ids.json'
        base_dir = 'mld_base_tables'

    with open(league_file, 'r') as f:
        league_data = json.load(f)

    print("Fetching all players data...")
    print("=" * 60)
    players_client = Players()
    all_players = players_client.get_all_players()
    print(f"[OK] Retrieved {len(all_players)} players")

    print(f"\nFetching transactions for {len(league_data)} seasons...")
    print("=" * 60)

    pick_map  = load_pick_map()
    owner_map = load_owner_map(base_dir)
    print(f"[OK] Loaded {len(pick_map)} pick mappings from draft_pick_order.json" if pick_map else "[--] No draft_pick_order.json found — picks will use fallback IDs")
    print(f"[OK] Loaded {len(owner_map)} owner display names")

    all_transactions = []
    all_player_moves = []

    for season in league_data:
        year = season['year']
        league_id = extract_league_id(season['url'])

        print(f"\n{year} (League ID: {league_id})")

        try:
            txn_rows, player_rows = get_season_transactions(year, league_id, all_players, pick_map, owner_map)
            all_transactions.extend(txn_rows)
            all_player_moves.extend(player_rows)

            trades   = sum(1 for t in txn_rows if t['type'] == 'trade')
            waivers  = sum(1 for t in txn_rows if t['type'] == 'waiver')
            fa_moves = sum(1 for t in txn_rows if t['type'] == 'free_agent')
            print(f"  [OK] {len(txn_rows)} transactions: {trades} trades, {waivers} waivers, {fa_moves} FA pickups")

        except Exception as e:
            print(f"  [ERROR] {e}")

    df_txn = pd.DataFrame(all_transactions)
    df_players = pd.DataFrame(all_player_moves)

    print("\n" + "=" * 60)
    print(f"Total transactions:    {len(df_txn)}")
    print(f"Total player moves:    {len(df_players)}")

    if not df_txn.empty:
        print(f"\nTransaction type breakdown:")
        print(df_txn.groupby(['year', 'type']).size().unstack(fill_value=0))

    txn_file    = f'{base_dir}/transactions.csv'
    player_file = f'{base_dir}/transaction_players.csv'

    df_txn.to_csv(txn_file, index=False)
    df_players.to_csv(player_file, index=False)

    print(f"\n[OK] Saved to {txn_file}")
    print(f"[OK] Saved to {player_file}")

    return df_txn


if __name__ == "__main__":
    df = main()

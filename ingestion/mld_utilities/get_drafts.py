"""
get_drafts.py

Fetches draft history for all seasons of the Major League Dynasty league.

Creates two output tables:
  - draft_metadata.csv  one row per draft (settings, type, status, draft order)
  - draft_picks.csv     one row per pick (player, round, slot, team, keeper flag)
"""

import json
import os
import pandas as pd
from sleeper_wrapper import League, Drafts, Players


def extract_league_id(url):
    return url.split('/')[5]


def get_season_drafts(year, league_id, player_map):
    """
    Fetch draft metadata and all picks for a season.

    Parameters:
    - year: Season year
    - league_id: Sleeper league ID
    - player_map: Dict of player_id -> player info

    Returns:
    - (metadata_rows, pick_rows): lists of dicts
    """
    league = League(league_id)
    all_drafts = league.get_all_drafts()

    if not all_drafts:
        return [], []

    metadata_rows = []
    pick_rows = []

    for draft_info in all_drafts:
        draft_id = draft_info.get('draft_id')
        if not draft_id:
            continue

        drafts_client = Drafts(draft_id)

        # --- Draft metadata ---
        detail = drafts_client.get_specific_draft()

        settings = detail.get('settings', {})
        draft_order = detail.get('draft_order') or {}       # user_id -> draft_slot
        slot_to_roster = detail.get('slot_to_roster_id') or {}  # slot -> roster_id

        metadata_rows.append({
            'year': year,
            'draft_id': draft_id,
            'league_id': league_id,
            'type': detail.get('type'),           # snake, auction, linear
            'status': detail.get('status'),       # complete, drafting, pre_draft
            'sport': detail.get('sport'),
            'season': detail.get('season'),
            'season_type': detail.get('season_type'),
            'rounds': settings.get('rounds'),
            'teams': settings.get('teams'),
            'pick_timer': settings.get('pick_timer'),
            'reversal_round': settings.get('reversal_round'),  # when snake reverses
            'num_draft_order_entries': len(draft_order),
        })

        # --- Draft picks ---
        picks = drafts_client.get_all_picks()

        if not picks:
            continue

        for pick in picks:
            player_id = str(pick.get('player_id', ''))
            info = player_map.get(player_id, {})

            # Metadata field on the pick sometimes has name/position
            pick_metadata = pick.get('metadata') or {}

            player_name = (
                info.get('full_name')
                or pick_metadata.get('first_name', '') + ' ' + pick_metadata.get('last_name', '')
            ).strip() or 'Unknown'

            position = (
                info.get('position')
                or pick_metadata.get('position', 'UNKNOWN')
            )

            pick_rows.append({
                'year': year,
                'draft_id': draft_id,
                'overall_pick': pick.get('pick_no'),
                'round': pick.get('round'),
                'draft_slot': pick.get('draft_slot'),
                'roster_id': pick.get('roster_id'),
                'picked_by': pick.get('picked_by'),   # user_id of drafter
                'player_id': player_id,
                'player_name': player_name,
                'position': position,
                'nfl_team': info.get('team', pick_metadata.get('team', '')),
                'is_keeper': pick.get('is_keeper', False),
            })

    return metadata_rows, pick_rows


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

    print(f"\nFetching draft data for {len(league_data)} seasons...")
    print("=" * 60)

    all_metadata = []
    all_picks = []

    for season in league_data:
        year = season['year']
        league_id = extract_league_id(season['url'])

        print(f"\n{year} (League ID: {league_id})")

        try:
            metadata_rows, pick_rows = get_season_drafts(year, league_id, all_players)
            all_metadata.extend(metadata_rows)
            all_picks.extend(pick_rows)

            for m in metadata_rows:
                print(f"  [OK] Draft {m['draft_id']} | type={m['type']} | status={m['status']} | {len([p for p in pick_rows if p['draft_id'] == m['draft_id']])} picks")

        except Exception as e:
            print(f"  [ERROR] {e}")
            import traceback
            traceback.print_exc()

    df_meta = pd.DataFrame(all_metadata)
    df_picks = pd.DataFrame(all_picks)

    print("\n" + "=" * 60)
    print(f"Total drafts:      {len(df_meta)}")
    print(f"Total draft picks: {len(df_picks)}")

    if not df_picks.empty:
        print("\nPicks by year:")
        print(df_picks.groupby('year').agg(picks=('player_id', 'count'), keepers=('is_keeper', 'sum')))

        print("\nTop 10 drafted players (by frequency across all seasons):")
        top = df_picks[df_picks['player_name'] != 'Unknown'].groupby(
            ['player_name', 'position']
        ).size().reset_index(name='times_drafted').sort_values('times_drafted', ascending=False).head(10)
        print(top.to_string(index=False))

    meta_file  = f'{base_dir}/draft_metadata.csv'
    picks_file = f'{base_dir}/draft_picks.csv'

    df_meta.to_csv(meta_file, index=False)
    df_picks.to_csv(picks_file, index=False)

    print(f"\n[OK] Saved to {meta_file}")
    print(f"[OK] Saved to {picks_file}")

    return df_picks


if __name__ == "__main__":
    df = main()

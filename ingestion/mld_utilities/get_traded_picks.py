"""
get_traded_picks.py

Fetches the current state of all traded draft picks for all seasons of the
Major League Dynasty league. This shows which team currently owns picks that
originated with a different team — essential for dynasty league context.

Output:
  - traded_picks.csv   one row per traded pick (current ownership state)
"""

import json
import os
import pandas as pd
from sleeper_wrapper import League


def extract_league_id(url):
    return url.split('/')[5]


def get_season_traded_picks(year, league_id):
    """
    Fetch the current traded-pick ownership for a season.

    Parameters:
    - year: Season year
    - league_id: Sleeper league ID

    Returns:
    - List of dicts with traded pick records
    """
    league = League(league_id)
    raw_picks = league.get_traded_picks()

    if not raw_picks:
        return []

    rows = []
    for pick in raw_picks:
        rows.append({
            'league_year': year,                          # MLD season this league_id belongs to
            'pick_season': pick.get('season'),            # Year the pick will be used (draft year)
            'round': pick.get('round'),
            'roster_id': pick.get('roster_id'),           # Current owner of the pick
            'previous_owner_id': pick.get('previous_owner_id'),
            'original_owner_id': pick.get('owner_id'),   # Team that originally owned the pick
        })

    return rows


def main():
    if os.path.exists('fantasy_football/mld_league_season_ids.json'):
        league_file = 'fantasy_football/mld_league_season_ids.json'
        base_dir = 'fantasy_football/mld_base_tables'
    else:
        league_file = 'mld_league_season_ids.json'
        base_dir = 'mld_base_tables'

    with open(league_file, 'r') as f:
        league_data = json.load(f)

    print(f"Fetching traded picks for {len(league_data)} seasons...")
    print("=" * 60)

    all_picks = []

    for season in league_data:
        year = season['year']
        league_id = extract_league_id(season['url'])

        print(f"\n{year} (League ID: {league_id})")

        try:
            picks = get_season_traded_picks(year, league_id)
            all_picks.extend(picks)
            print(f"  [OK] {len(picks)} traded picks on record")

        except Exception as e:
            print(f"  [ERROR] {e}")

    df = pd.DataFrame(all_picks)

    print("\n" + "=" * 60)
    print(f"Total traded pick records: {len(df)}")

    if not df.empty:
        print(f"\nColumns: {df.columns.tolist()}")
        print("\nSample data:")
        print(df.head(10).to_string(index=False))

    output_file = f'{base_dir}/traded_picks.csv'
    df.to_csv(output_file, index=False)
    print(f"\n[OK] Saved to {output_file}")

    return df


if __name__ == "__main__":
    df = main()

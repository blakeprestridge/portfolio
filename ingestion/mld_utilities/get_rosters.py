"""
get_rosters.py

Fetches roster and owner data for all seasons of the Major League Dynasty league.
Returns a dataset with roster_id, owner info, team names, and division assignments.
"""

import json
import pandas as pd
from sleeper_wrapper import League


def extract_league_id(url):
    """Extract league ID from Sleeper API URL"""
    return url.split('/')[5]


def get_season_rosters(year, league_id):
    """
    Fetch roster data for a given season

    Parameters:
    - year: Season year
    - league_id: Sleeper league ID

    Returns:
    - List of dictionaries with roster information
    """
    league = League(league_id)

    # Get rosters and users
    rosters = league.get_rosters()
    users = league.get_users()
    league_info = league.get_league()

    # Create a mapping of owner_id to user info
    user_map = {user['user_id']: user for user in users}

    # Get division names from league metadata
    division_names = {}
    if league_info.get('metadata'):
        if 'division_1' in league_info['metadata']:
            division_names[1] = league_info['metadata']['division_1']
        if 'division_2' in league_info['metadata']:
            division_names[2] = league_info['metadata']['division_2']

    # Extract roster data
    roster_data = []
    for roster in rosters:
        owner_id = roster['owner_id']
        user_info = user_map.get(owner_id, {})

        display_name = user_info.get('display_name', 'Unknown')
        team_name = user_info.get('metadata', {}).get('team_name', None) if user_info.get('metadata') else None

        # Default team_name to "Team {display_name}" if blank or None
        if not team_name or team_name.strip() == '':
            team_name = f"Team {display_name}"

        # Get division number from roster settings and map to division name
        division_num = roster.get('settings', {}).get('division', None)
        division_name = division_names.get(division_num, None) if division_num else None

        roster_entry = {
            'year': year,
            'roster_id': roster['roster_id'],
            'user_id': owner_id,
            'display_name': display_name,
            'team_name': team_name,
            'avatar': user_info.get('avatar', None),
            'division': division_name
        }
        roster_data.append(roster_entry)

    return roster_data


def main():
    """Main function to fetch all roster data"""

    # Load league IDs from JSON file
    import os

    # Support running from either project root or fantasy_football directory
    if os.path.exists('fantasy_football/mld_league_season_ids.json'):
        league_file = 'fantasy_football/mld_league_season_ids.json'
    else:
        league_file = 'mld_league_season_ids.json'

    with open(league_file, 'r') as f:
        league_data = json.load(f)

    print(f"Fetching roster data for {len(league_data)} seasons...")
    print("=" * 60)

    all_rosters = []

    for season in league_data:
        year = season['year']
        league_id = extract_league_id(season['url'])

        print(f"\n{year} (League ID: {league_id})")

        try:
            season_rosters = get_season_rosters(year, league_id)
            all_rosters.extend(season_rosters)

            print(f"  [OK] Retrieved {len(season_rosters)} rosters")

        except Exception as e:
            print(f"  [ERROR] {e}")

    # Create DataFrame
    df = pd.DataFrame(all_rosters)

    print("\n" + "=" * 60)
    print(f"Total roster records collected: {len(df)}")
    print(f"\nDataset shape: {df.shape}")
    print(f"\nColumns: {df.columns.tolist()}")

    # Display sample data
    print("\nSample data (2025 season):")
    if len(df[df['year'] == 2025]) > 0:
        print(df[df['year'] == 2025][['year', 'roster_id', 'display_name', 'team_name', 'division']].head(10))
    else:
        print(df.head(10))

    # Show summary statistics
    print("\n" + "=" * 60)
    print("ROSTERS BY SEASON:")
    print("=" * 60)
    print(df.groupby('year').size())

    print("\n" + "=" * 60)
    print(f"Unique managers across all seasons: {df['display_name'].nunique()}")

    # Save to CSV
    # Support running from either project root or fantasy_football directory
    if os.path.exists('fantasy_football/mld_base_tables'):
        output_file = 'fantasy_football/mld_base_tables/rosters.csv'
    else:
        output_file = 'mld_base_tables/rosters.csv'

    df.to_csv(output_file, index=False)
    print(f"\n[OK] Data saved to {output_file}")

    return df


if __name__ == "__main__":
    df = main()

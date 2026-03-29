"""
get_lineups.py

Fetches starting lineup data for all completed weeks across all seasons of the Major League Dynasty league.
Returns a dataset with player_id, roster_id, week, year, position, and lineup_slot for each starter.
"""

import json
import pandas as pd
from sleeper_wrapper import League, Players


def extract_league_id(url):
    """Extract league ID from Sleeper API URL"""
    return url.split('/')[5]


def map_position_to_roster_slot(position):
    """
    Map actual player position to roster slot position

    Defensive positions mapping:
    - DT, DE → DL (Defensive Line)
    - CB, S → DB (Defensive Back)
    - LB → LB (Linebacker)

    Offensive positions stay the same: QB, RB, WR, TE, K
    """
    position_mapping = {
        # Defensive Line
        'DT': 'DL',
        'DE': 'DL',
        'DL': 'DL',

        # Defensive Back
        'CB': 'DB',
        'S': 'DB',
        'DB': 'DB',

        # Linebacker
        'LB': 'LB',

        # Offensive positions (no mapping needed)
        'QB': 'QB',
        'RB': 'RB',
        'WR': 'WR',
        'TE': 'TE',
        'K': 'K',

        # Flex/special positions
        'FLEX': 'FLEX',
        'SUPER_FLEX': 'SUPER_FLEX',
        'IDP_FLEX': 'IDP_FLEX',
        'DEF': 'DEF'
    }

    return position_mapping.get(position, position)


def get_season_lineups(year, league_id, all_players):
    """
    Fetch lineup data for a given season (only completed weeks)

    Parameters:
    - year: Season year
    - league_id: Sleeper league ID
    - all_players: Dictionary of all player data

    Returns:
    - List of dictionaries with lineup information
    """
    league = League(league_id)

    # Get league info and roster positions
    league_info = league.get_league()
    roster_positions = league_info.get('roster_positions', [])

    # Determine max weeks to fetch
    max_weeks = 17  # MLD season ends at week 17

    lineup_data = []

    for week in range(1, max_weeks + 1):
        try:
            matchups = league.get_matchups(week)

            if not matchups:
                # No more matchups available
                print(f"    Week {week}: No data available")
                break

            # Check if week has been played (matchups have points)
            week_played = any(m.get('points', 0) > 0 for m in matchups)

            if not week_played:
                print(f"    Week {week}: Not played yet, stopping")
                break

            # Process each matchup to get starters
            for matchup in matchups:
                roster_id = matchup.get('roster_id')
                starters = matchup.get('starters', [])
                starters_points = matchup.get('starters_points', [])

                # Process each starter with their lineup slot position
                for slot_index, starter_player_id in enumerate(starters):
                    # Skip empty roster slots (represented as "0" or 0)
                    if starter_player_id and starter_player_id != "0" and starter_player_id != 0:
                        # Get player info from all_players dict
                        player_info = all_players.get(starter_player_id, {})
                        player_position = player_info.get('position', 'UNKNOWN')
                        player_name = player_info.get('full_name', 'Unknown Player')

                        # Get the lineup slot position (what position they filled in lineup)
                        lineup_slot = roster_positions[slot_index] if slot_index < len(roster_positions) else 'UNKNOWN'

                        # Map player's actual position to roster slot format
                        mapped_position = map_position_to_roster_slot(player_position)

                        # Get points for this player this week
                        points = starters_points[slot_index] if slot_index < len(starters_points) else 0

                        lineup_entry = {
                            'year': year,
                            'week': week,
                            'roster_id': roster_id,
                            'player_id': starter_player_id,
                            'player_name': player_name,
                            'player_position': player_position,  # Actual position (DE, CB, etc.)
                            'mapped_position': mapped_position,   # Mapped to roster slot (DL, DB, etc.)
                            'lineup_slot': lineup_slot,           # Which lineup slot they filled
                            'points': points
                        }
                        lineup_data.append(lineup_entry)

            print(f"    Week {week}: [OK] Retrieved lineups")

        except Exception as e:
            # Week doesn't exist or other error
            print(f"    Week {week}: Error or end of season ({e})")
            break

    return lineup_data


def main():
    """Main function to fetch all lineup data"""

    # Load league IDs from JSON file
    import os

    # Support running from either project root or fantasy_football directory
    if os.path.exists('fantasy_football/mld_league_season_ids.json'):
        league_file = 'fantasy_football/mld_league_season_ids.json'
    else:
        league_file = 'mld_league_season_ids.json'

    with open(league_file, 'r') as f:
        league_data = json.load(f)

    print("Fetching all players data...")
    print("=" * 60)

    # Get all players data once (this is a large payload, so we cache it)
    players = Players()
    all_players = players.get_all_players()
    print(f"[OK] Retrieved {len(all_players)} players")

    print(f"\nFetching lineup data for {len(league_data)} seasons...")
    print("=" * 60)

    all_lineups = []

    for season in league_data:
        year = season['year']
        league_id = extract_league_id(season['url'])

        print(f"\n{year} (League ID: {league_id})")

        try:
            season_lineups = get_season_lineups(year, league_id, all_players)
            all_lineups.extend(season_lineups)

            # Calculate some stats
            weeks_played = len(set(l['week'] for l in season_lineups))
            total_starter_slots = len(season_lineups)
            unique_players = len(set(l['player_id'] for l in season_lineups))

            print(f"  [OK] Retrieved {weeks_played} weeks, {total_starter_slots} starter slots, {unique_players} unique players")

        except Exception as e:
            print(f"  [ERROR] {e}")
            import traceback
            traceback.print_exc()

    # Create DataFrame
    df = pd.DataFrame(all_lineups)

    print("\n" + "=" * 60)
    print(f"Total lineup records collected: {len(df)}")
    print(f"\nDataset shape: {df.shape}")
    print(f"\nColumns: {df.columns.tolist()}")

    # Display sample data
    print("\nSample data:")
    print(df.head(20)[['year', 'week', 'roster_id', 'player_name', 'player_position', 'mapped_position', 'lineup_slot', 'points']])

    # Show summary by year
    print("\n" + "=" * 60)
    print("LINEUP DATA BY YEAR:")
    print("=" * 60)
    summary = df.groupby('year').agg({
        'week': 'nunique',
        'roster_id': 'nunique',
        'player_id': 'count'
    }).rename(columns={
        'week': 'weeks_played',
        'roster_id': 'num_teams',
        'player_id': 'total_starter_slots'
    })
    print(summary)

    # Show position distribution
    print("\n" + "=" * 60)
    print("POSITION DISTRIBUTION:")
    print("=" * 60)
    print("\nActual Player Positions:")
    print(df['player_position'].value_counts().head(15))
    print("\nMapped Positions (for roster slots):")
    print(df['mapped_position'].value_counts())
    print("\nLineup Slots Used:")
    print(df['lineup_slot'].value_counts())

    # Show most commonly started players (across all seasons)
    print("\n" + "=" * 60)
    print("MOST COMMONLY STARTED PLAYERS (Top 10):")
    print("=" * 60)
    top_players_df = df.groupby(['player_name', 'player_position']).size().reset_index(name='starts')
    top_players_df = top_players_df.sort_values('starts', ascending=False).head(10)
    for _, row in top_players_df.iterrows():
        print(f"  {row['player_name']} ({row['player_position']}): {row['starts']} starts")

    # Save to CSV
    # Support running from either project root or fantasy_football directory
    if os.path.exists('fantasy_football/mld_base_tables'):
        output_file = 'fantasy_football/mld_base_tables/lineups.csv'
    else:
        output_file = 'mld_base_tables/lineups.csv'

    df.to_csv(output_file, index=False)
    print(f"\n[OK] Data saved to {output_file}")

    return df


if __name__ == "__main__":
    df = main()

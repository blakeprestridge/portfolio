"""
get_matchups.py

Fetches matchup data for all seasons of the Major League Dynasty league.
Returns a dataset with weekly matchup results including scores and outcomes.
"""

import json
import pandas as pd
from sleeper_wrapper import League


def extract_league_id(url):
    """Extract league ID from Sleeper API URL"""
    return url.split('/')[5]


def get_season_matchups(year, league_id):
    """
    Fetch matchup data for a given season

    Parameters:
    - year: Season year
    - league_id: Sleeper league ID

    Returns:
    - List of dictionaries with matchup information
    """
    league = League(league_id)

    # Get league info to determine playoff settings
    league_info = league.get_league()

    # Get playoff start week from league settings
    playoff_week_start = league_info.get('settings', {}).get('playoff_week_start', 15)

    # Get playoff bracket to identify consolation games
    try:
        winners_bracket = league.get_playoff_winners_bracket()
        losers_bracket = league.get_playoff_losers_bracket()

        # Create sets of roster_ids in each bracket for quick lookup
        playoff_rosters = set()
        consolation_rosters = set()

        if winners_bracket:
            for matchup in winners_bracket:
                if matchup.get('t1'):
                    playoff_rosters.add(matchup['t1'])
                if matchup.get('t2'):
                    playoff_rosters.add(matchup['t2'])

        if losers_bracket:
            for matchup in losers_bracket:
                if matchup.get('t1'):
                    consolation_rosters.add(matchup['t1'])
                if matchup.get('t2'):
                    consolation_rosters.add(matchup['t2'])
    except:
        # If brackets not available, we'll rely on playoff_week_start only
        playoff_rosters = set()
        consolation_rosters = set()

    # Regular season weeks (typically weeks 1-14 or 1-15)
    # We'll try to get all weeks and handle errors for weeks that don't exist
    max_weeks = 18  # NFL regular season

    matchup_data = []

    for week in range(1, max_weeks + 1):
        try:
            matchups = league.get_matchups(week)

            if not matchups:
                # No more matchups available
                break

            # Group matchups by matchup_id
            matchup_groups = {}
            for matchup in matchups:
                matchup_id = matchup.get('matchup_id')
                if matchup_id:
                    if matchup_id not in matchup_groups:
                        matchup_groups[matchup_id] = []
                    matchup_groups[matchup_id].append(matchup)

            # Process each matchup pair
            for matchup_id, teams in matchup_groups.items():
                if len(teams) == 2:
                    # Head-to-head matchup
                    team1, team2 = teams

                    points1 = team1.get('points', 0)
                    points2 = team2.get('points', 0)

                    # Determine result for team1
                    if points1 > points2:
                        result1, result2 = 'W', 'L'
                    elif points1 < points2:
                        result1, result2 = 'L', 'W'
                    else:
                        result1, result2 = 'T', 'T'

                    # Determine game type
                    roster1_id = team1.get('roster_id')
                    roster2_id = team2.get('roster_id')

                    if week < playoff_week_start:
                        game_type = 'regular'
                    elif roster1_id in playoff_rosters or roster2_id in playoff_rosters:
                        game_type = 'playoff'
                    elif roster1_id in consolation_rosters or roster2_id in consolation_rosters:
                        game_type = 'consolation'
                    else:
                        # Default to playoff if week >= playoff_week_start and no bracket info
                        game_type = 'playoff'

                    # Add entry for team1
                    matchup_data.append({
                        'year': year,
                        'week': week,
                        'matchup_id': matchup_id,
                        'roster_id': roster1_id,
                        'opponent_roster_id': roster2_id,
                        'points': points1,
                        'opponent_points': points2,
                        'result': result1,
                        'game_type': game_type
                    })

                    # Add entry for team2
                    matchup_data.append({
                        'year': year,
                        'week': week,
                        'matchup_id': matchup_id,
                        'roster_id': roster2_id,
                        'opponent_roster_id': roster1_id,
                        'points': points2,
                        'opponent_points': points1,
                        'result': result2,
                        'game_type': game_type
                    })
                elif len(teams) == 1:
                    # Bye week
                    team = teams[0]
                    roster_id = team.get('roster_id')

                    # Determine game type for bye week
                    if week < playoff_week_start:
                        game_type = 'regular'
                    elif roster_id in playoff_rosters:
                        game_type = 'playoff'
                    elif roster_id in consolation_rosters:
                        game_type = 'consolation'
                    else:
                        game_type = 'regular'  # Byes typically in regular season

                    matchup_data.append({
                        'year': year,
                        'week': week,
                        'matchup_id': matchup_id,
                        'roster_id': roster_id,
                        'opponent_roster_id': None,
                        'points': team.get('points', 0),
                        'opponent_points': None,
                        'result': 'BYE',
                        'game_type': game_type
                    })

        except Exception as e:
            # Week doesn't exist or other error
            print(f"  Week {week}: No data (likely end of season)")
            break

    return matchup_data


def main():
    """Main function to fetch all matchup data"""

    # Load league IDs from JSON file
    import os

    # Support running from either project root or fantasy_football directory
    if os.path.exists('fantasy_football/mld_league_season_ids.json'):
        league_file = 'fantasy_football/mld_league_season_ids.json'
    else:
        league_file = 'mld_league_season_ids.json'

    with open(league_file, 'r') as f:
        league_data = json.load(f)

    print(f"Fetching matchup data for {len(league_data)} seasons...")
    print("=" * 60)

    all_matchups = []

    for season in league_data:
        year = season['year']
        league_id = extract_league_id(season['url'])

        print(f"\n{year} (League ID: {league_id})")

        try:
            season_matchups = get_season_matchups(year, league_id)
            all_matchups.extend(season_matchups)

            # Calculate some stats
            weeks_played = len(set(m['week'] for m in season_matchups))
            total_games = len([m for m in season_matchups if m['result'] != 'BYE'])

            print(f"  [OK] Retrieved {weeks_played} weeks, {total_games} matchup records")

        except Exception as e:
            print(f"  [ERROR] {e}")

    # Create DataFrame
    df = pd.DataFrame(all_matchups)

    print("\n" + "=" * 60)
    print(f"Total matchup records collected: {len(df)}")
    print(f"\nDataset shape: {df.shape}")
    print(f"\nColumns: {df.columns.tolist()}")

    # Display sample data
    print("\nSample data:")
    print(df.head(10))

    # Save to CSV
    # Support running from either project root or fantasy_football directory
    if os.path.exists('fantasy_football/mld_base_tables'):
        output_file = 'fantasy_football/mld_base_tables/matchups.csv'
    else:
        output_file = 'mld_base_tables/matchups.csv'

    df.to_csv(output_file, index=False)
    print(f"\n[OK] Data saved to {output_file}")

    return df


if __name__ == "__main__":
    df = main()

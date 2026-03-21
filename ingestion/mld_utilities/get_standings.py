"""
get_standings.py

Fetches season standings data for all seasons of the Major League Dynasty league.
Returns a dataset with season-long records, rankings, and playoff results.
"""

import json
import pandas as pd
from sleeper_wrapper import League


def extract_league_id(url):
    """Extract league ID from Sleeper API URL"""
    return url.split('/')[5]


def get_season_standings(year, league_id):
    """
    Fetch standings data for a given season

    Parameters:
    - year: Season year
    - league_id: Sleeper league ID

    Returns:
    - List of dictionaries with standings information
    """
    league = League(league_id)

    # Get rosters, users, and league info
    rosters = league.get_rosters()
    users = league.get_users()
    league_info = league.get_league()

    # Create user mapping
    user_map = {user['user_id']: user for user in users}

    # Get division names
    division_names = {}
    if league_info.get('metadata'):
        if 'division_1' in league_info['metadata']:
            division_names[1] = league_info['metadata']['division_1']
        if 'division_2' in league_info['metadata']:
            division_names[2] = league_info['metadata']['division_2']

    # Get playoff settings
    playoff_week_start = league_info.get('settings', {}).get('playoff_week_start', 15)
    playoff_teams = league_info.get('settings', {}).get('playoff_teams', 6)

    # Get playoff brackets to identify champion and runner-up
    # Only identify champions if season is complete (championship game has a winner)
    try:
        winners_bracket = league.get_playoff_winners_bracket()
        champion_roster_id = None
        runner_up_roster_id = None
        season_complete = False

        if winners_bracket:
            # Find the championship game (highest round)
            max_round = max([m.get('r', 0) for m in winners_bracket])
            championship_game = [m for m in winners_bracket if m.get('r') == max_round]

            if championship_game:
                champ_game = championship_game[0]
                winner = champ_game.get('w')  # Winner roster_id
                loser = champ_game.get('l')   # Loser roster_id

                # Only set champions if the championship game has been played (has a winner)
                if winner is not None:
                    champion_roster_id = winner
                    runner_up_roster_id = loser
                    season_complete = True

    except Exception as e:
        print(f"  Warning: Could not fetch playoff bracket: {e}")
        champion_roster_id = None
        runner_up_roster_id = None
        season_complete = False

    standings_data = []

    for roster in rosters:
        roster_id = roster['roster_id']
        owner_id = roster['owner_id']
        user_info = user_map.get(owner_id, {})

        # Get roster settings (contains W/L/T, points, etc.)
        settings = roster.get('settings', {})

        # Get division
        division_num = settings.get('division', None)
        division_name = division_names.get(division_num, None) if division_num else None

        # Calculate regular season record (from settings)
        wins = settings.get('wins', 0)
        losses = settings.get('losses', 0)
        ties = settings.get('ties', 0)

        # Points for/against
        points_for = settings.get('fpts', 0)
        points_for += settings.get('fpts_decimal', 0) / 100 if settings.get('fpts_decimal') else 0

        points_against = settings.get('fpts_against', 0)
        points_against += settings.get('fpts_against_decimal', 0) / 100 if settings.get('fpts_against_decimal') else 0

        # Calculate win percentage
        total_games = wins + losses + ties
        win_pct = wins / total_games if total_games > 0 else 0

        # Determine if made playoffs (top N teams)
        # This is approximate - ideally we'd check the bracket
        made_playoffs = False
        try:
            winners_bracket = league.get_playoff_winners_bracket()
            if winners_bracket:
                playoff_roster_ids = set()
                for matchup in winners_bracket:
                    if matchup.get('t1'):
                        playoff_roster_ids.add(matchup['t1'])
                    if matchup.get('t2'):
                        playoff_roster_ids.add(matchup['t2'])
                made_playoffs = roster_id in playoff_roster_ids
        except:
            pass

        standings_entry = {
            'year': year,
            'roster_id': roster_id,
            'user_id': owner_id,
            'display_name': user_info.get('display_name', 'Unknown'),
            'division': division_name,
            'wins': wins,
            'losses': losses,
            'ties': ties,
            'win_pct': round(win_pct, 3),
            'points_for': round(points_for, 2),
            'points_against': round(points_against, 2),
            'points_diff': round(points_for - points_against, 2),
            'made_playoffs': made_playoffs,
            'champion': roster_id == champion_roster_id if season_complete else False,
            'runner_up': roster_id == runner_up_roster_id if season_complete else False
        }

        standings_data.append(standings_entry)

    # Sort by record (wins desc, then points_for desc)
    standings_data.sort(key=lambda x: (-x['wins'], -x['points_for']))

    # Add overall rank
    for rank, standing in enumerate(standings_data, start=1):
        standing['overall_rank'] = rank

    # Add division rank
    divisions = {}
    for standing in standings_data:
        div = standing['division']
        if div:
            if div not in divisions:
                divisions[div] = []
            divisions[div].append(standing)

    for div, teams in divisions.items():
        teams.sort(key=lambda x: (-x['wins'], -x['points_for']))
        for div_rank, team in enumerate(teams, start=1):
            team['division_rank'] = div_rank
            # Mark division champion (rank 1 in their division) - only if season is complete
            team['div_champ'] = (div_rank == 1 and season_complete)

    # Set division_rank and div_champ to None/False for teams without division
    for standing in standings_data:
        if 'division_rank' not in standing:
            standing['division_rank'] = None
            standing['div_champ'] = False

    return standings_data


def main():
    """Main function to fetch all standings data"""

    # Load league IDs from JSON file
    import os

    # Support running from either project root or fantasy_football directory
    if os.path.exists('fantasy_football/mld_league_season_ids.json'):
        league_file = 'fantasy_football/mld_league_season_ids.json'
    else:
        league_file = 'mld_league_season_ids.json'

    with open(league_file, 'r') as f:
        league_data = json.load(f)

    print(f"Fetching standings data for {len(league_data)} seasons...")
    print("=" * 60)

    all_standings = []

    for season in league_data:
        year = season['year']
        league_id = extract_league_id(season['url'])

        print(f"\n{year} (League ID: {league_id})")

        try:
            season_standings = get_season_standings(year, league_id)
            all_standings.extend(season_standings)

            # Display summary
            num_teams = len(season_standings)
            champion = next((s for s in season_standings if s['champion']), None)

            print(f"  [OK] Retrieved {num_teams} teams")
            if champion:
                print(f"  [CHAMPION] {champion['display_name']}")
            else:
                print(f"  [IN PROGRESS] Season in progress (no champion yet)")

        except Exception as e:
            print(f"  [ERROR] {e}")
            import traceback
            traceback.print_exc()

    # Create DataFrame
    df = pd.DataFrame(all_standings)

    print("\n" + "=" * 60)
    print(f"Total standings records collected: {len(df)}")
    print(f"\nDataset shape: {df.shape}")
    print(f"\nColumns: {df.columns.tolist()}")

    # Display sample data
    print("\nSample data (2025 season):")
    if len(df[df['year'] == 2025]) > 0:
        print(df[df['year'] == 2025].head(10)[['year', 'display_name', 'division', 'wins', 'losses',
                                                  'points_for', 'division_rank', 'div_champ']])
    else:
        print(df.head(10))

    # Show champions by year
    print("\n" + "=" * 60)
    print("LEAGUE CHAMPIONS BY YEAR:")
    print("=" * 60)
    champions = df[df['champion'] == True].sort_values('year', ascending=False)
    if len(champions) > 0:
        for _, champ in champions.iterrows():
            print(f"  {champ['year']}: {champ['display_name']} ({champ['wins']}-{champ['losses']}, {champ['points_for']:.2f} pts)")
    else:
        print("  No champions found in data")

    # Show division champions by year
    print("\n" + "=" * 60)
    print("DIVISION CHAMPIONS BY YEAR:")
    print("=" * 60)
    div_champs = df[df['div_champ'] == True].sort_values(['year', 'division'], ascending=[False, True])
    if len(div_champs) > 0:
        for _, champ in div_champs.iterrows():
            print(f"  {champ['year']} - {champ['division']}: {champ['display_name']} ({champ['wins']}-{champ['losses']}, {champ['points_for']:.2f} pts)")
    else:
        print("  No division champions found in data")

    # Save to CSV
    # Support running from either project root or fantasy_football directory
    if os.path.exists('fantasy_football/mld_base_tables'):
        output_file = 'fantasy_football/mld_base_tables/standings.csv'
    else:
        output_file = 'mld_base_tables/standings.csv'

    df.to_csv(output_file, index=False)
    print(f"\n[OK] Data saved to {output_file}")

    return df


if __name__ == "__main__":
    df = main()

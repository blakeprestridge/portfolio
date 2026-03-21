"""
get_player_stats.py

Fetches player stats by week for all seasons (2020-2025) of the Major League Dynasty league.
Returns a dataset with player stats and fantasy points for all positions used in MLD:
- Offensive: QB, RB, WR, TE, K
- Defensive: DL (DE/DT), LB, DB (CB/S)
"""

import json
import pandas as pd
from sleeper_wrapper import Stats, Players
import time


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
    }

    return position_mapping.get(position, position)


def get_week_stats_for_season(year, all_players, mld_positions):
    """
    Fetch weekly stats for all players in MLD positions for a given season

    Parameters:
    - year: Season year
    - all_players: Dictionary of all player data
    - mld_positions: Set of positions used in MLD

    Returns:
    - List of dictionaries with player stats by week
    """
    stats_client = Stats()

    # For regular season stats
    season_type = "regular"
    max_weeks = 18  # NFL regular season length

    stats_data = []

    for week in range(1, max_weeks + 1):
        print(f"    Week {week}...", end=" ")

        try:
            # Get stats for this week
            week_stats = stats_client.get_week_stats(season_type, year, week)

            if not week_stats:
                print("No data available, stopping")
                break

            # Process each player's stats
            player_count = 0
            for player_id, player_stats in week_stats.items():
                # Get player info
                player_info = all_players.get(player_id, {})
                player_position = player_info.get('position', 'UNKNOWN')

                # Map position to MLD format
                mapped_position = map_position_to_roster_slot(player_position)

                # Only include players in MLD positions
                if mapped_position not in mld_positions:
                    continue

                player_name = player_info.get('full_name', 'Unknown Player')
                team = player_info.get('team', None)

                # Calculate fantasy points
                fantasy_points = player_stats.get('pts_ppr', 0) or player_stats.get('pts_half_ppr', 0) or player_stats.get('pts_std', 0) or 0

                # Create stats entry with comprehensive stats
                # Include universal stats that can apply to any player
                stats_entry = {
                    'year': year,
                    'week': week,
                    'player_id': player_id,
                    'player_name': player_name,
                    'player_position': player_position,
                    'mapped_position': mapped_position,
                    'team': team,
                    'fantasy_points': fantasy_points,
                    # Universal defensive/special teams stats (for all players)
                    'tackles_solo': player_stats.get('tkl_solo', 0),
                    'tackles_ast': player_stats.get('tkl_ast', 0),
                    'tackles_total': player_stats.get('tkl', 0),
                    'sacks': player_stats.get('sack', 0),
                    'sack_yards': player_stats.get('sack_yd', 0),
                    'forced_fumbles': player_stats.get('ff', 0),
                    'fumbles_recovered': player_stats.get('fum_rec', 0),
                    'fumble_recovery_yards': player_stats.get('fum_rec_yd', 0),
                    'fumble_recovery_td': player_stats.get('fum_rec_td', 0),
                    # Return stats (can apply to any player)
                    'kick_return_yards': player_stats.get('kr_yd', 0),
                    'kick_return_td': player_stats.get('kr_td', 0),
                    'punt_return_yards': player_stats.get('pr_yd', 0),
                    'punt_return_td': player_stats.get('pr_td', 0),
                }

                # Add position-specific stats
                if mapped_position == 'QB':
                    stats_entry.update({
                        'pass_yards': player_stats.get('pass_yd', 0),
                        'pass_tds': player_stats.get('pass_td', 0),
                        'pass_int': player_stats.get('pass_int', 0),
                        'pass_completions': player_stats.get('pass_cmp', 0),
                        'pass_attempts': player_stats.get('pass_att', 0),
                        'rush_yards': player_stats.get('rush_yd', 0),
                        'rush_tds': player_stats.get('rush_td', 0),
                        'rush_attempts': player_stats.get('rush_att', 0),
                        'fumbles_lost': player_stats.get('fum_lost', 0),
                    })

                elif mapped_position == 'RB':
                    stats_entry.update({
                        'rush_yards': player_stats.get('rush_yd', 0),
                        'rush_tds': player_stats.get('rush_td', 0),
                        'rush_attempts': player_stats.get('rush_att', 0),
                        'receptions': player_stats.get('rec', 0),
                        'rec_yards': player_stats.get('rec_yd', 0),
                        'rec_tds': player_stats.get('rec_td', 0),
                        'targets': player_stats.get('rec_tgt', 0),
                        'fumbles_lost': player_stats.get('fum_lost', 0),
                    })

                elif mapped_position == 'WR':
                    stats_entry.update({
                        'receptions': player_stats.get('rec', 0),
                        'rec_yards': player_stats.get('rec_yd', 0),
                        'rec_tds': player_stats.get('rec_td', 0),
                        'targets': player_stats.get('rec_tgt', 0),
                        'rush_yards': player_stats.get('rush_yd', 0),
                        'rush_tds': player_stats.get('rush_td', 0),
                        'rush_attempts': player_stats.get('rush_att', 0),
                        'fumbles_lost': player_stats.get('fum_lost', 0),
                    })

                elif mapped_position == 'TE':
                    stats_entry.update({
                        'receptions': player_stats.get('rec', 0),
                        'rec_yards': player_stats.get('rec_yd', 0),
                        'rec_tds': player_stats.get('rec_td', 0),
                        'targets': player_stats.get('rec_tgt', 0),
                        'fumbles_lost': player_stats.get('fum_lost', 0),
                    })

                elif mapped_position == 'K':
                    stats_entry.update({
                        'fg_made': player_stats.get('fgm', 0),
                        'fg_att': player_stats.get('fga', 0),
                        'fg_made_0_19': player_stats.get('fgm_0_19', 0),
                        'fg_made_20_29': player_stats.get('fgm_20_29', 0),
                        'fg_made_30_39': player_stats.get('fgm_30_39', 0),
                        'fg_made_40_49': player_stats.get('fgm_40_49', 0),
                        'fg_made_50_plus': player_stats.get('fgm_50p', 0),
                        'xp_made': player_stats.get('xpm', 0),
                        'xp_att': player_stats.get('xpa', 0),
                    })

                elif mapped_position in ['DL', 'LB', 'DB']:
                    # IDP-specific stats (universal stats already added above)
                    stats_entry.update({
                        'int': player_stats.get('def_int', 0) or player_stats.get('int', 0),
                        'int_yards': player_stats.get('int_ret_yd', 0),
                        'int_td': player_stats.get('int_ret_td', 0),
                        'def_tds': player_stats.get('def_td', 0),
                        'passes_defended': player_stats.get('def_pass_def', 0) or player_stats.get('pass_def', 0),
                        'tackles_for_loss': player_stats.get('tkl_loss', 0),
                        'qb_hits': player_stats.get('qb_hit', 0),
                        'safeties': player_stats.get('safe', 0),
                        'blocked_kicks': player_stats.get('blk_kick', 0),
                    })

                stats_data.append(stats_entry)
                player_count += 1

            print(f"{player_count} players")

            # Add small delay to respect API rate limits
            time.sleep(0.1)

        except Exception as e:
            print(f"Error: {e}")
            break

    return stats_data


def main():
    """Main function to fetch all player stats data"""

    # Load league IDs from JSON file (we need years)
    import os

    # Support running from either project root or fantasy_football directory
    if os.path.exists('fantasy_football/mld_league_season_ids.json'):
        league_file = 'fantasy_football/mld_league_season_ids.json'
    else:
        league_file = 'mld_league_season_ids.json'

    with open(league_file, 'r') as f:
        league_data = json.load(f)

    # MLD positions (mapped positions)
    mld_positions = {'QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB'}

    print("Fetching all players data...")
    print("=" * 60)

    # Get all players data once (this is a large payload, so we cache it)
    players = Players()
    all_players = players.get_all_players()
    print(f"Retrieved {len(all_players)} players")

    print(f"\nFetching player stats for {len(league_data)} seasons...")
    print("=" * 60)

    all_stats = []

    for season in league_data:
        year = season['year']

        print(f"\n{year}")

        try:
            season_stats = get_week_stats_for_season(year, all_players, mld_positions)
            all_stats.extend(season_stats)

            # Calculate some summary stats
            weeks_with_data = len(set(s['week'] for s in season_stats))
            total_player_weeks = len(season_stats)
            unique_players = len(set(s['player_id'] for s in season_stats))

            print(f"  Retrieved {weeks_with_data} weeks, {total_player_weeks} player-week records, {unique_players} unique players")

        except Exception as e:
            print(f"  Error: {e}")
            import traceback
            traceback.print_exc()

    # Create DataFrame
    df = pd.DataFrame(all_stats)

    print("\n" + "=" * 60)
    print(f"Total player-week records collected: {len(df)}")
    print(f"\nDataset shape: {df.shape}")
    print(f"\nColumns: {df.columns.tolist()}")

    # Display sample data by position
    print("\n" + "=" * 60)
    print("SAMPLE DATA BY POSITION:")
    print("=" * 60)

    for pos in ['QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB']:
        pos_df = df[df['mapped_position'] == pos]
        if not pos_df.empty:
            print(f"\n{pos} (showing top 3 by fantasy points):")
            sample = pos_df.nlargest(3, 'fantasy_points')[['year', 'week', 'player_name', 'team', 'fantasy_points']].head(3)
            print(sample.to_string(index=False))

    # Show summary by year and position
    print("\n" + "=" * 60)
    print("PLAYER-WEEK RECORDS BY YEAR AND POSITION:")
    print("=" * 60)
    summary = df.groupby(['year', 'mapped_position']).size().unstack(fill_value=0)
    print(summary)

    # Show top fantasy scorers overall
    print("\n" + "=" * 60)
    print("TOP FANTASY PERFORMANCES (Single Week):")
    print("=" * 60)
    top_performances = df.nlargest(20, 'fantasy_points')[['year', 'week', 'player_name', 'mapped_position', 'team', 'fantasy_points']]
    print(top_performances.to_string(index=False))

    # Show players with most weeks played
    print("\n" + "=" * 60)
    print("PLAYERS WITH MOST WEEKS PLAYED (Top 10):")
    print("=" * 60)
    player_weeks = df.groupby(['player_name', 'mapped_position']).size().reset_index(name='weeks_played')
    player_weeks = player_weeks.sort_values('weeks_played', ascending=False).head(10)
    print(player_weeks.to_string(index=False))

    # Save to CSV
    # Support running from either project root or fantasy_football directory
    if os.path.exists('fantasy_football/mld_base_tables'):
        output_file = 'fantasy_football/mld_base_tables/player_stats.csv'
    else:
        output_file = 'mld_base_tables/player_stats.csv'

    df.to_csv(output_file, index=False)
    print(f"\nData saved to {output_file}")

    return df


if __name__ == "__main__":
    df = main()

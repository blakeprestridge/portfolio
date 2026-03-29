"""
get_rosters.py

Fetches owner/team info and full weekly roster data for all MLD seasons.

get_season_owners() — one row per team per year (display_name, team_name, etc.)
get_season_rosters() — one row per player per team per week, including bench players,
                       with points sourced from players_points (not just starters_points)
"""

from sleeper_wrapper import League


POSITION_MAP = {
    # Defensive Line
    'DT': 'DL', 'DE': 'DL', 'DL': 'DL',
    # Defensive Back
    'CB': 'DB', 'S': 'DB', 'DB': 'DB',
    # Linebacker
    'LB': 'LB',
    # Offensive
    'QB': 'QB', 'RB': 'RB', 'WR': 'WR', 'TE': 'TE', 'K': 'K',
    # Flex / special
    'FLEX': 'FLEX', 'SUPER_FLEX': 'SUPER_FLEX',
    'IDP_FLEX': 'IDP_FLEX', 'DEF': 'DEF',
}


def map_position(position):
    return POSITION_MAP.get(position, position)


# ---------------------------------------------------------------------------
# Owner data (replaces old get_season_rosters)
# ---------------------------------------------------------------------------

def get_season_owners(year, league_id):
    """
    Returns one row per team per season with owner/team metadata.
    Fields: year, roster_id, user_id, display_name, team_name, avatar, division
    """
    league      = League(league_id)
    rosters     = league.get_rosters()
    users       = league.get_users()
    league_info = league.get_league()

    user_map = {u['user_id']: u for u in users}

    division_names = {}
    metadata = league_info.get('metadata') or {}
    if 'division_1' in metadata:
        division_names[1] = metadata['division_1']
    if 'division_2' in metadata:
        division_names[2] = metadata['division_2']

    rows = []
    for roster in rosters:
        owner_id  = roster['owner_id']
        user_info = user_map.get(owner_id, {})

        display_name = user_info.get('display_name', 'Unknown')
        team_name    = (user_info.get('metadata') or {}).get('team_name') or None
        if not team_name or not team_name.strip():
            team_name = f"Team {display_name}"

        division_num  = (roster.get('settings') or {}).get('division')
        division_name = division_names.get(division_num) if division_num else None

        rows.append({
            'year':         year,
            'roster_id':    roster['roster_id'],
            'user_id':      owner_id,
            'display_name': display_name,
            'team_name':    team_name,
            'avatar':       user_info.get('avatar'),
            'division':     division_name,
        })

    return rows


# ---------------------------------------------------------------------------
# Full weekly roster data (replaces old get_season_lineups)
# ---------------------------------------------------------------------------

def get_season_rosters(year, league_id, all_players):
    """
    Returns one row per player per team per week, covering every rostered player
    (starters + bench).  Points come from players_points so bench players have
    their actual fantasy-point totals.

    Fields: year, week, roster_id, player_id, player_name, player_position,
            mapped_position, lineup_slot, is_starter, points
    """
    league           = League(league_id)
    league_info      = league.get_league()
    roster_positions = league_info.get('roster_positions', [])

    # Build taxi / IR maps from current roster state (best available — no week-by-week history)
    taxi_players = set()
    ir_players   = set()
    current_rosters = league.get_rosters()
    for r in current_rosters:
        for pid in (r.get('taxi') or []):
            taxi_players.add(str(pid))
        for pid in (r.get('reserve') or []):
            ir_players.add(str(pid))

    rows = []
    scored_weeks = 0

    for week in range(1, 19):
        matchups = league.get_matchups(week)

        if not matchups:
            break

        # Stop once we hit a week with no scored points
        if not any((m.get('points') or 0) > 0 for m in matchups):
            break

        scored_weeks += 1

        for matchup in matchups:
            roster_id      = matchup.get('roster_id')
            starters       = matchup.get('starters') or []
            players        = matchup.get('players') or []
            players_points = matchup.get('players_points') or {}

            # Map each starter player_id → the lineup slot it fills
            starter_slots = {}
            for slot_idx, pid in enumerate(starters):
                if pid and pid != "0":
                    slot = roster_positions[slot_idx] if slot_idx < len(roster_positions) else 'UNKNOWN'
                    starter_slots[pid] = slot

            starters_set = set(starter_slots.keys())

            for player_id in players:
                if not player_id or player_id == "0":
                    continue

                player_info     = all_players.get(str(player_id)) or {}
                player_position = player_info.get('position', 'UNKNOWN')
                player_name     = player_info.get('full_name', 'Unknown Player')
                mapped_position = map_position(player_position)

                is_starter = player_id in starters_set
                if is_starter:
                    lineup_slot = starter_slots[player_id]
                elif player_id in taxi_players:
                    lineup_slot = 'TAXI'
                elif player_id in ir_players:
                    lineup_slot = 'IR'
                else:
                    lineup_slot = 'BN'

                points = players_points.get(str(player_id)) or 0

                rows.append({
                    'year':            year,
                    'week':            week,
                    'roster_id':       roster_id,
                    'player_id':       str(player_id),
                    'player_name':     player_name,
                    'player_position': player_position,
                    'mapped_position': mapped_position,
                    'lineup_slot':     lineup_slot,
                    'is_starter':      is_starter,
                    'points':          points,
                })

    # Pre-season fallback: no weeks have been played yet, so emit current
    # roster state as week 0 so the team page always has something to show.
    if scored_weeks == 0:
        for roster in current_rosters:
            roster_id  = roster.get('roster_id')
            player_ids = roster.get('players') or []
            for player_id in player_ids:
                if not player_id or player_id == "0":
                    continue
                player_info     = all_players.get(str(player_id)) or {}
                player_position = player_info.get('position', 'UNKNOWN')
                player_name     = player_info.get('full_name', 'Unknown Player')
                mapped_position = map_position(player_position)

                pid_str = str(player_id)
                if pid_str in taxi_players:
                    lineup_slot = 'TAXI'
                elif pid_str in ir_players:
                    lineup_slot = 'IR'
                else:
                    lineup_slot = 'BN'

                rows.append({
                    'year':            year,
                    'week':            0,
                    'roster_id':       roster_id,
                    'player_id':       pid_str,
                    'player_name':     player_name,
                    'player_position': player_position,
                    'mapped_position': mapped_position,
                    'lineup_slot':     lineup_slot,
                    'is_starter':      False,
                    'points':          0,
                })

    return rows

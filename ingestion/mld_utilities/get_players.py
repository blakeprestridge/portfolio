"""
get_players.py

Fetches all NFL players from Sleeper's /players/nfl endpoint and returns
rows for the players reference table.

Only includes fantasy-relevant positions (skill players + IDP).
Run via ingest_players.py — this table is a full replace, not year-scoped.
"""

from sleeper_wrapper import Players

FANTASY_POSITIONS = {
    "QB", "RB", "WR", "TE", "K",
    "DL", "DE", "DT", "LB", "DB", "CB", "S",
}


def get_all_players():
    """
    Returns one row per fantasy-relevant NFL player.
    Fields: player_id, full_name, first_name, last_name, position,
            team, age, years_exp, status, injury_status, search_rank
    """
    raw = Players().get_all_players()
    rows = []

    for player_id, info in raw.items():
        position = info.get("position") or ""
        if position not in FANTASY_POSITIONS:
            continue

        first = info.get("first_name") or ""
        last  = info.get("last_name")  or ""
        full  = info.get("full_name")  or f"{first} {last}".strip() or "Unknown"

        rows.append({
            "player_id":     player_id,
            "full_name":     full,
            "first_name":    first or None,
            "last_name":     last  or None,
            "position":      position or None,
            "team":          info.get("team"),
            "age":           info.get("age"),
            "years_exp":     info.get("years_exp"),
            "status":        info.get("status"),
            "injury_status": info.get("injury_status"),
            "search_rank":   info.get("search_rank"),
        })

    return rows

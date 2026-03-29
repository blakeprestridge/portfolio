"""
get_player_season_stats.py

Aggregates weekly player_stats rows into per-player season totals,
then assigns position rank (by total fantasy points within mapped_position).

Returns one row per player per year.
"""

from django.db import connection


def get_player_season_stats(year):
    """
    Reads directly from the player_stats table via raw SQL for speed,
    aggregates totals, and computes position rank.

    Fields: year, player_id, player_name, player_position, mapped_position,
            total_pts, weeks_played, avg_pts, pos_rank
    """
    sql = """
        SELECT
            player_id,
            MAX(player_name)     AS player_name,
            MAX(player_position) AS player_position,
            MAX(mapped_position) AS mapped_position,
            SUM(fantasy_points)  AS total_pts,
            COUNT(CASE WHEN fantasy_points > 0 THEN 1 END) AS weeks_played
        FROM player_stats
        WHERE year = %s
        GROUP BY player_id
        HAVING SUM(fantasy_points) > 0
    """

    with connection.cursor() as cur:
        cur.execute(sql, [year])
        cols = [c.name for c in cur.description]
        raw = [dict(zip(cols, row)) for row in cur.fetchall()]

    # Compute avg and position rank
    by_pos = {}
    for p in raw:
        pos = p['mapped_position']
        if pos not in by_pos:
            by_pos[pos] = []
        by_pos[pos].append(p)

    for players in by_pos.values():
        players.sort(key=lambda p: p['total_pts'], reverse=True)
        for rank, p in enumerate(players, start=1):
            p['pos_rank'] = rank

    rows = []
    for p in raw:
        weeks = p['weeks_played'] or 0
        rows.append({
            'year':            year,
            'player_id':       p['player_id'],
            'player_name':     p['player_name'],
            'player_position': p['player_position'],
            'mapped_position': p['mapped_position'],
            'total_pts':       round(float(p['total_pts']), 2),
            'weeks_played':    weeks,
            'avg_pts':         round(float(p['total_pts']) / weeks, 2) if weeks > 0 else 0.0,
            'pos_rank':        p['pos_rank'],
        })

    return rows

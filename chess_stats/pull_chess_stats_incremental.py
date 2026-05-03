"""
Chess.com Game Statistics Fetcher - Incremental Supabase Version
Only pulls games after the last game already in the database
"""

import os
import requests
from datetime import datetime, timezone
import chess.engine

from pull_chess_stats import (
    get_conn, upsert_games, extract_eco, extract_final_clocks, format_clock, clock_to_seconds,
    normalize_termination, eco_to_opening, analyze_game_moves, build_move_classifications,
    CHESS_USERNAME, ANALYSIS_DEPTH, STOCKFISH_PATH,
)

ANALYZE_MOVES = os.environ.get("ANALYZE_MOVES", "true").lower() == "true"

HEADERS = {"User-Agent": "Chess Stats Fetcher/1.0 (Contact: aymoosay on Chess.com)"}


def get_last_game_info(username):
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Last game overall for timestamp/index/rolling_elo
            cur.execute("""
                SELECT game_index, game_date, game_url, rolling_elo
                FROM chess_stats.games
                WHERE username = %s
                ORDER BY game_date DESC
                LIMIT 1
            """, (username,))
            row = cur.fetchone()

            if not row:
                return None

            game_index, game_date, game_url, rolling_elo = row

            # Last rated elo per format
            cur.execute("""
                SELECT DISTINCT ON (format) format, my_elo
                FROM chess_stats.games
                WHERE username = %s AND rated = TRUE
                ORDER BY format, game_date DESC
            """, (username,))
            previous_rating = {fmt: elo for fmt, elo in cur.fetchall()}

    last_timestamp = int(game_date.replace(tzinfo=timezone.utc).timestamp()
                         if game_date.tzinfo is None else game_date.timestamp())

    return {
        "game_index": game_index,
        "rolling_elo": rolling_elo,
        "previous_rating": previous_rating,
        "last_game_url": game_url,
        "last_timestamp": last_timestamp,
    }


def pull_chess_com_games_incremental(username=None, analyze_moves=None,
                                      depth=None, stockfish_path=None):
    username = username or CHESS_USERNAME
    analyze_moves = analyze_moves if analyze_moves is not None else ANALYZE_MOVES
    depth = depth or ANALYSIS_DEPTH
    stockfish_path = stockfish_path or STOCKFISH_PATH

    last_game_info = get_last_game_info(username)

    if not last_game_info:
        print("No existing data found in Supabase. Run pull_chess_stats.py first for the initial load.")
        return

    print(f"Found {last_game_info['game_index']} existing games")
    print(f"Last game: {datetime.fromtimestamp(last_game_info['last_timestamp'])}")

    game_index = last_game_info["game_index"]
    rolling_elo = last_game_info["rolling_elo"]
    previous_rating = last_game_info["previous_rating"]
    last_timestamp = last_game_info["last_timestamp"]
    last_url = last_game_info["last_game_url"]

    engine = None
    if analyze_moves:
        try:
            engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)
            print(f"Stockfish initialized (depth={depth})")
        except Exception as e:
            print(f"Warning: Could not initialize Stockfish: {e}")
            analyze_moves = False

    archives_url = f"https://api.chess.com/pub/player/{username}/games/archives"
    response = requests.get(archives_url, headers=HEADERS)
    response.raise_for_status()
    archives = sorted(response.json()["archives"])

    rows = []

    for month_url in archives:
        response = requests.get(month_url, headers=HEADERS)
        response.raise_for_status()
        games = response.json()["games"]

        for game in games:
            if "white" not in game or "black" not in game:
                continue

            game_timestamp = game.get("end_time", 0)
            game_url = game.get("url", "")

            if game_timestamp <= last_timestamp or game_url == last_url:
                continue

            print(f"  New game: {game_url}")

            is_white = game["white"]["username"].lower() == username.lower()
            me = game["white"] if is_white else game["black"]
            opp = game["black"] if is_white else game["white"]

            draw_results = ["repetition", "insufficient", "stalemate", "agreed",
                            "timevsinsufficient", "50move"]
            if me["result"] == "win":
                my_result = "W"
            elif me["result"] in draw_results:
                my_result = "D"
            else:
                my_result = "L"

            is_rated = game.get("rated", False)
            fmt = game.get("time_class", "")
            current_rating = me.get("rating", 0)
            if is_rated:
                elo_delta = current_rating - previous_rating[fmt] if fmt in previous_rating else 0
                rolling_elo += elo_delta
                previous_rating[fmt] = current_rating
            else:
                elo_delta = 0
            game_index += 1

            pgn = game.get("pgn", "")
            termination = normalize_termination(pgn)
            clocks = extract_final_clocks(pgn)
            eco = extract_eco(pgn)
            opening = eco_to_opening(eco)
            my_clock = format_clock(clocks["white"] if is_white else clocks["black"])
            opp_clock = format_clock(clocks["black"] if is_white else clocks["white"])
            time_trouble = clock_to_seconds(my_clock) < 30 or clock_to_seconds(opp_clock) < 30

            move_classifications = None
            if analyze_moves and engine:
                print(f"    Analyzing game {game_index}...")
                move_classifications = analyze_game_moves(pgn, engine, depth)

            mc = build_move_classifications(move_classifications, is_white)

            rows.append({
                "game_index": game_index,
                "game_date": datetime.fromtimestamp(game["end_time"], tz=timezone.utc).isoformat(),
                "format": game.get("time_class", ""),
                "game_url": game_url,
                "my_elo": me.get("rating", 0),
                "opp_elo": opp.get("rating", 0),
                "elo_change": elo_delta,
                "my_color": "White" if is_white else "Black",
                "result": my_result,
                "my_time_remaining": my_clock,
                "opp_time_remaining": opp_clock,
                "termination": termination,
                "opening": opening,
                "eco": eco,
                "time_trouble": time_trouble,
                "rated": game.get("rated", False),
                "rolling_elo": rolling_elo,
                "username": username,
                **mc,
            })

    if engine:
        engine.quit()

    if not rows:
        print("No new games found. Already up to date.")
        return

    print(f"Inserting {len(rows)} new games...")
    upsert_games(rows)
    print(f"Done — {len(rows)} games added to Supabase.")


if __name__ == "__main__":
    pull_chess_com_games_incremental()

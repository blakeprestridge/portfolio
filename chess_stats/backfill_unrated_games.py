"""
One-time backfill script for unrated games.
Run after pull_chess_stats.py has already loaded all rated games.
"""

from pull_chess_stats import (
    get_conn, upsert_games, extract_eco, extract_final_clocks, format_clock, clock_to_seconds,
    normalize_termination, eco_to_opening, analyze_game_moves, build_move_classifications,
    CHESS_USERNAME, ANALYSIS_DEPTH, STOCKFISH_PATH,
)

import requests
from datetime import datetime, timezone
import chess.engine

HEADERS = {"User-Agent": "Chess Stats Fetcher/1.0 (Contact: aymoosay on Chess.com)"}


def get_max_game_index():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COALESCE(MAX(game_index), 0) FROM chess_stats.games")
            return cur.fetchone()[0]


def backfill_unrated(username=CHESS_USERNAME, depth=ANALYSIS_DEPTH, stockfish_path=STOCKFISH_PATH):
    print("Deleting existing unrated games...")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM chess_stats.games WHERE username = %s AND rated = FALSE",
                (username,)
            )
        print(f"  Deleted {conn.cursor().rowcount} rows")

    game_index = get_max_game_index()

    engine = None
    try:
        engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)
        print(f"Stockfish initialized (depth={depth})")
    except Exception as e:
        print(f"Warning: Could not initialize Stockfish: {e}")

    archives_url = f"https://api.chess.com/pub/player/{username}/games/archives"
    response = requests.get(archives_url, headers=HEADERS)
    response.raise_for_status()
    archives = sorted(response.json()["archives"])

    rows = []

    for month_url in archives:
        print(f"  Scanning {month_url.split('/')[-2]}/{month_url.split('/')[-1]}...")
        response = requests.get(month_url, headers=HEADERS)
        response.raise_for_status()
        games = response.json()["games"]

        for game in games:
            if game.get("rated", False):
                continue
            if "white" not in game or "black" not in game:
                continue

            game_url = game.get("url", "")

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

            pgn = game.get("pgn", "")
            termination = normalize_termination(pgn)
            clocks = extract_final_clocks(pgn)
            eco = extract_eco(pgn)
            opening = eco_to_opening(eco)
            my_clock = format_clock(clocks["white"] if is_white else clocks["black"])
            opp_clock = format_clock(clocks["black"] if is_white else clocks["white"])
            time_trouble = clock_to_seconds(my_clock) < 30 or clock_to_seconds(opp_clock) < 30

            game_index += 1
            print(f"    Analyzing game {game_index}...")
            move_classifications = analyze_game_moves(pgn, engine, depth) if engine else None
            mc = build_move_classifications(move_classifications, is_white)

            rows.append({
                "game_index": game_index,
                "game_date": datetime.fromtimestamp(game["end_time"], tz=timezone.utc).isoformat(),
                "format": game.get("time_class", ""),
                "game_url": game_url,
                "my_elo": me.get("rating", 0),
                "opp_elo": opp.get("rating", 0),
                "elo_change": 0,
                "my_color": "White" if is_white else "Black",
                "result": my_result,
                "my_time_remaining": my_clock,
                "opp_time_remaining": opp_clock,
                "termination": termination,
                "opening": opening,
                "eco": eco,
                "time_trouble": time_trouble,
                "rated": False,
                "rolling_elo": me.get("rating", 0),
                "username": username,
                **mc,
            })

    if engine:
        engine.quit()

    if not rows:
        print("No unrated games found to backfill.")
        return

    print(f"Inserting {len(rows)} unrated games...")
    upsert_games(rows)
    print(f"Done — {len(rows)} unrated games added.")


if __name__ == "__main__":
    backfill_unrated()

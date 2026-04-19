"""
Chess.com Game Statistics Fetcher - Supabase Version
Pulls all rated games for a target year and upserts to Supabase chess_stats schema
"""

import os
import requests
import re
from datetime import datetime, timezone
import chess
import chess.pgn
import chess.engine
from io import StringIO
import psycopg2
import psycopg2.extras

CHESS_USERNAME = os.environ.get("CHESS_USERNAME", "aymoosay")
TARGET_YEAR = os.environ.get("TARGET_YEAR", str(datetime.now().year))
ANALYZE_MOVES = os.environ.get("ANALYZE_MOVES", "false").lower() == "true"
ANALYSIS_DEPTH = int(os.environ.get("ANALYSIS_DEPTH", "20"))
STOCKFISH_PATH = os.environ.get("STOCKFISH_PATH", "stockfish")


def get_conn():
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=os.environ.get("DB_PORT", 5432),
        dbname=os.environ.get("DB_NAME", "postgres"),
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
    )


def upsert_games(rows):
    cols = list(rows[0].keys())
    placeholders = ",".join([f"%({c})s" for c in cols])
    updates = ",".join([f"{c}=EXCLUDED.{c}" for c in cols if c != "game_url"])
    sql = f"""
        INSERT INTO chess_stats.games ({",".join(cols)})
        VALUES ({placeholders})
        ON CONFLICT (game_url) DO UPDATE SET {updates}
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, sql, rows)


def pull_chess_com_games(username=None, target_year=None, analyze_moves=None,
                         depth=None, stockfish_path=None):
    username = username or CHESS_USERNAME
    target_year = target_year or TARGET_YEAR
    analyze_moves = analyze_moves if analyze_moves is not None else ANALYZE_MOVES
    depth = depth or ANALYSIS_DEPTH
    stockfish_path = stockfish_path or STOCKFISH_PATH

    headers = {"User-Agent": "Chess Stats Fetcher/1.0 (Contact: aymoosay on Chess.com)"}

    engine = None
    if analyze_moves:
        try:
            engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)
            print(f"Stockfish initialized (depth={depth})")
        except Exception as e:
            print(f"Warning: Could not initialize Stockfish: {e}")
            analyze_moves = False

    archives_url = f"https://api.chess.com/pub/player/{username}/games/archives"
    response = requests.get(archives_url, headers=headers)
    response.raise_for_status()
    archives = response.json()["archives"]

    year_archives = sorted([url for url in archives if f"/{target_year}/" in url])

    rows = []
    game_index = 1
    rolling_elo = 0
    previous_rating = None

    print(f"Fetching games for {username} in {target_year}...")

    for month_url in year_archives:
        print(f"  Fetching {month_url.split('/')[-2]}/{month_url.split('/')[-1]}...")
        response = requests.get(month_url, headers=headers)
        response.raise_for_status()
        games = response.json()["games"]

        for game in games:
            if not game.get("rated", False):
                continue
            if "white" not in game or "black" not in game:
                continue

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

            current_rating = me.get("rating", 0)
            if previous_rating is not None:
                elo_delta = current_rating - previous_rating
                rolling_elo += elo_delta
            else:
                elo_delta = 0
                rolling_elo = current_rating
            previous_rating = current_rating

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
                "game_url": game.get("url", ""),
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
                "rolling_elo": rolling_elo,
                "username": username,
                **mc,
            })

            game_index += 1

    if engine:
        engine.quit()

    print(f"Found {len(rows)} rated games")

    if rows:
        upsert_games(rows)
        print(f"Successfully upserted {len(rows)} games to Supabase")


def build_move_classifications(move_classifications, is_white):
    if move_classifications:
        my_color = "white" if is_white else "black"
        opp_color = "black" if is_white else "white"
        my = move_classifications[my_color]
        opp = move_classifications[opp_color]
        counted = ["brilliant", "critical", "best", "excellent", "okay",
                   "inaccuracy", "mistake", "blunder"]
        my_non_theory = sum(my[k] for k in counted)
        opp_non_theory = sum(opp[k] for k in counted)
        return {
            "my_brilliant": my["brilliant"],
            "my_critical": my["critical"],
            "my_best": my["best"],
            "my_excellent": my["excellent"],
            "my_okay": my["okay"],
            "my_inaccuracies": my["inaccuracy"],
            "my_mistakes": my["mistake"],
            "my_blunders": my["blunder"],
            "my_theory": my["theory"],
            "my_total_cp_loss": my["total_cp_loss"],
            "my_avg_cp_loss": round(my["total_cp_loss"] / my_non_theory, 1) if my_non_theory else 0,
            "opp_brilliant": opp["brilliant"],
            "opp_critical": opp["critical"],
            "opp_best": opp["best"],
            "opp_excellent": opp["excellent"],
            "opp_okay": opp["okay"],
            "opp_inaccuracies": opp["inaccuracy"],
            "opp_mistakes": opp["mistake"],
            "opp_blunders": opp["blunder"],
            "opp_theory": opp["theory"],
            "opp_total_cp_loss": opp["total_cp_loss"],
            "opp_avg_cp_loss": round(opp["total_cp_loss"] / opp_non_theory, 1) if opp_non_theory else 0,
        }
    else:
        return {k: 0 for k in [
            "my_brilliant", "my_critical", "my_best", "my_excellent", "my_okay",
            "my_inaccuracies", "my_mistakes", "my_blunders", "my_theory",
            "my_total_cp_loss", "my_avg_cp_loss",
            "opp_brilliant", "opp_critical", "opp_best", "opp_excellent", "opp_okay",
            "opp_inaccuracies", "opp_mistakes", "opp_blunders", "opp_theory",
            "opp_total_cp_loss", "opp_avg_cp_loss",
        ]}


def extract_eco(pgn):
    match = re.search(r'\[ECO "([^"]+)"\]', pgn)
    return match.group(1) if match else ""


def extract_final_clocks(pgn):
    matches = re.findall(r'%clk\s([\d:]+)', pgn)
    if len(matches) < 2:
        return {"white": "", "black": ""}
    if len(matches) % 2 == 0:
        return {"white": matches[-2], "black": matches[-1]}
    else:
        return {"white": matches[-1], "black": matches[-2]}


def format_clock(clock):
    if not clock:
        return ""
    parts = [int(p) for p in clock.split(":")]
    seconds = parts[1] * 60 + parts[2] if len(parts) == 3 else parts[0] * 60 + parts[1]
    return f"{seconds // 60}:{seconds % 60:02d}"


def clock_to_seconds(clock):
    if not clock:
        return float("inf")
    parts = clock.split(":")
    return int(parts[0]) * 60 + int(parts[1])


def normalize_termination(pgn):
    match = re.search(r'\[Termination "([^"]+)"\]', pgn)
    if not match:
        return ""
    t = match.group(1).lower()
    if "checkmate" in t:
        return "Checkmate"
    elif "time" in t:
        return "Time"
    elif "resign" in t:
        return "Resignation"
    elif "abandon" in t:
        return "Abandoned"
    elif "insufficient" in t:
        return "Insufficient Material"
    elif "stalemate" in t:
        return "Stalemate"
    elif "agreement" in t:
        return "Agreement"
    return match.group(1)


def analyze_game_moves(pgn_string, engine, depth=20):
    try:
        game = chess.pgn.read_game(StringIO(pgn_string))
        if game is None:
            return None

        classifications = {
            color: {"brilliant": 0, "critical": 0, "best": 0, "excellent": 0, "okay": 0,
                    "inaccuracy": 0, "mistake": 0, "blunder": 0, "theory": 0, "total_cp_loss": 0}
            for color in ("white", "black")
        }

        board = game.board()
        theory_ended = {"white": False, "black": False}

        for node in game.mainline():
            prev_board = board.copy()
            player = "white" if prev_board.turn == chess.WHITE else "black"

            is_theory = False
            if not theory_ended[player]:
                try:
                    multi_info = engine.analyse(prev_board, chess.engine.Limit(depth=depth), multipv=3)
                    if len(multi_info) >= 2:
                        scores = [i["score"].white().score(mate_score=10000) for i in multi_info
                                  if i["score"].white().score(mate_score=10000) is not None]
                        if len(scores) >= 2:
                            if prev_board.turn == chess.BLACK:
                                scores = [-s for s in scores]
                            if max(scores) - min(scores) <= 50:
                                is_theory = True
                            else:
                                theory_ended[player] = True
                        else:
                            theory_ended[player] = True
                    else:
                        theory_ended[player] = True
                except Exception:
                    theory_ended[player] = True

            if is_theory:
                classifications[player]["theory"] += 1
                board.push(node.move)
                continue

            try:
                best_info = engine.analyse(prev_board, chess.engine.Limit(depth=depth))
                best_score = best_info["score"].white().score(mate_score=10000)
                best_move = best_info.get("pv", [None])[0]
            except Exception:
                board.push(node.move)
                continue

            actual_move = node.move
            board.push(actual_move)

            try:
                actual_score = engine.analyse(board, chess.engine.Limit(depth=depth))["score"].white().score(mate_score=10000)
            except Exception:
                continue

            if prev_board.turn == chess.WHITE:
                cp_loss = (best_score - actual_score) if best_score and actual_score else 0
            else:
                cp_loss = (actual_score - best_score) if best_score and actual_score else 0

            classifications[player]["total_cp_loss"] += max(0, cp_loss)

            is_critical = abs(best_score or 0) < 100 and prev_board.fullmove_number > 15
            piece_count = len(prev_board.piece_map())
            is_brilliant = (cp_loss <= 5 and piece_count >= 20 and
                            actual_move == best_move and abs(best_score or 0) < 50)

            if is_brilliant:
                classifications[player]["brilliant"] += 1
            elif is_critical and cp_loss <= 25:
                classifications[player]["critical"] += 1
            elif cp_loss <= 10:
                classifications[player]["best"] += 1
            elif cp_loss <= 25:
                classifications[player]["excellent"] += 1
            elif cp_loss <= 75:
                classifications[player]["okay"] += 1
            elif cp_loss <= 150:
                classifications[player]["inaccuracy"] += 1
            elif cp_loss <= 300:
                classifications[player]["mistake"] += 1
            else:
                classifications[player]["blunder"] += 1

        return classifications

    except Exception as e:
        print(f"  Error analyzing game: {e}")
        return None


def eco_to_opening(eco):
    if not eco:
        return ""
    letter = eco[0]
    try:
        num = int(eco[1:])
    except ValueError:
        return ""

    eco_map = {
        "A": [(0, 0, "Polish Opening"), (1, 3, "Nimzowitsch-Larsen Attack"),
              (4, 9, "Reti Opening"), (10, 39, "English Opening"),
              (40, 44, "Queen's Pawn Game"), (45, 45, "Trompowsky Attack"),
              (46, 49, "Queen's Pawn Game"), (50, 55, "Old Indian Defense"),
              (56, 79, "Benoni Defense"), (80, 99, "Dutch Defense")],
        "B": [(0, 1, "Nimzowitsch Defense"), (1, 1, "Scandinavian Defense"),
              (2, 5, "Alekhine's Defense"), (6, 6, "Modern Defense"),
              (7, 9, "Pirc Defense"), (10, 19, "Caro-Kann Defense"),
              (20, 99, "Sicilian Defense")],
        "C": [(0, 19, "French Defense"), (20, 29, "King's Pawn Game"),
              (30, 39, "King's Gambit"), (40, 49, "King's Knight Opening"),
              (50, 59, "Italian Game"), (60, 99, "Ruy Lopez")],
        "D": [(0, 5, "Queen's Pawn Game"), (6, 9, "Queen's Gambit"),
              (10, 19, "Slav Defense"), (20, 29, "Queen's Gambit Accepted"),
              (30, 69, "Queen's Gambit Declined"), (70, 99, "Grunfeld Defense")],
        "E": [(0, 9, "Catalan Opening"), (10, 19, "Blumenfeld Gambit"),
              (20, 59, "Nimzo-Indian Defense"), (60, 99, "King's Indian Defense")],
    }

    for min_val, max_val, name in eco_map.get(letter, []):
        if min_val <= num <= max_val:
            return name
    return ""


if __name__ == "__main__":
    pull_chess_com_games()

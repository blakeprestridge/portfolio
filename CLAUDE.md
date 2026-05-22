# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Django-based portfolio application that combines two main functionalities:
1. **Fantasy Football League Management (MLD - Major League Dynasty)**: A web application for tracking fantasy football statistics, standings, and player data via the Sleeper API
2. **Chess Statistics Tracking**: Chess.com game analysis and statistics collection using Stockfish engine

The project uses Supabase as the database and is deployed on Railway with scheduled cron jobs for data ingestion.

## Development Commands

### Django Management
- `python manage.py runserver` - Start Django development server
- `python manage.py makemigrations` - Create database migrations
- `python manage.py migrate` - Apply database migrations
- `python manage.py shell` - Open Django shell
- `python manage.py collectstatic` - Collect static files

### Database Operations
- `python ingestion/setup_tables.py` - Initialize database tables
- `python ingestion/incremental_ingestion.py` - Run incremental data ingestion for current season
- `python ingestion/reload_league_files.py` - Full data reload for all seasons

### Chess Statistics
- `python chess_stats/pull_chess_stats.py` - Pull chess game data for target year
- `python chess_stats/pull_chess_stats_incremental.py` - Incremental chess data update
- `python chess_stats/backfill_unrated_games.py` - Backfill unrated chess games

## Architecture

### Django Apps
- **api/**: Core Django app containing database models for fantasy football data (Owner, Standing, Matchup, PlayerStat, etc.)
- **config/**: Django project configuration with settings, URLs, and deployment config

### Data Ingestion System
- **ingestion/**: Contains utilities for fetching and processing Sleeper API data
  - `mld_utilities/`: Modular functions for different data types (rosters, matchups, standings, transactions, etc.)
  - `db_utils.py`: Database connection and utility functions
  - `incremental_ingestion.py`: Daily scheduled job for current season updates
  - JSON configuration files for league/season IDs

### Chess Analytics
- **chess_stats/**: Chess.com API integration and game analysis
  - Uses `python-chess` library for PGN parsing
  - Stockfish integration for move analysis
  - Stores game data, moves, and engine evaluations in Supabase

### Frontend
- **mld/**: Static HTML/CSS/JS frontend for fantasy football league interface
  - Tailwind CSS for styling with dark mode support
  - Vanilla JavaScript for interactivity
  - Standalone HTML pages (index, standings, teams)

## Environment Configuration

Required environment variables (stored in `.env`):
- `SECRET_KEY`: Django secret key
- `DEBUG`: Django debug mode (True/False)
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`: Supabase database connection
- `CHESS_USERNAME`: Chess.com username for data fetching
- `TARGET_YEAR`: Year for chess data collection
- `STOCKFISH_PATH`: Path to Stockfish engine binary

## Database Schema

The application uses Supabase (PostgreSQL) with two main schemas:

### Fantasy Football Schema (public)

#### Core Tables

**owners** - Fantasy league team managers by year
- `year` (int) - League season year
- `roster_id` (int) - Team identifier within league
- `user_id` (bigint) - Sleeper user ID
- `display_name` (varchar) - Manager's display name
- `team_name` (varchar) - Custom team name
- `avatar` (varchar) - Sleeper avatar ID
- `division` (varchar) - League division assignment
- *Unique: (year, roster_id)*

**standings** - Season records and playoff results
- `year` (int) - League season year
- `roster_id` (int) - Team identifier
- `user_id` (bigint) - Sleeper user ID
- `display_name` (varchar) - Manager name
- `division` (varchar) - League division
- `wins/losses/ties` (int) - Regular season record
- `win_pct` (float) - Winning percentage
- `points_for/against/diff` (float) - Season scoring totals
- `made_playoffs/champion/runner_up/div_champ` (boolean) - Playoff results
- `overall_rank/division_rank` (int) - Final standings
- *Unique: (year, roster_id)*

**matchups** - Weekly head-to-head results
- `year/week` (int) - Season and week identifiers
- `matchup_id` (int) - Grouping for H2H matchups
- `roster_id` (int) - Team identifier
- `opponent_roster_id` (int) - Opponent team ID
- `points/opponent_points` (float) - Scoring totals
- `result` (varchar) - 'W', 'L', 'T', or 'BYE'
- `game_type` (varchar) - 'regular', 'playoff', 'consolation'
- *Unique: (year, week, roster_id)*

#### Player & Roster Data

**rosters** - Weekly lineup composition
- `year/week` (int) - Season and week identifiers
- `roster_id` (int) - Team identifier
- `player_id` (varchar) - Sleeper player ID
- `player_name` (varchar) - Player full name
- `player_position` (varchar) - NFL position
- `mapped_position` (varchar) - Fantasy position grouping
- `lineup_slot` (varchar) - Starting position or bench
- `is_starter` (boolean) - Active in starting lineup
- `points` (float) - Fantasy points scored
- *Unique: (year, week, roster_id, player_id)*

**player_stats** - Detailed weekly performance statistics
- `year/week` (int) - Season and week identifiers
- `player_id/name/position` (varchar) - Player identification
- `mapped_position` (varchar) - Fantasy position grouping
- `team` (varchar) - NFL team abbreviation
- `fantasy_points` (float) - Total fantasy points
- **Passing**: `pass_yards/tds/int/completions/attempts`
- **Rushing**: `rush_yards/tds/attempts`, `fumbles_lost`
- **Receiving**: `receptions/rec_yards/rec_tds/targets`
- **Kicking**: `fg_made/att`, `fg_made_[distance_ranges]`, `xp_made/att`
- **Defense**: `tackles_[solo/ast/total]`, `sacks/sack_yards`, `interceptions/int_yards/int_td`, `forced_fumbles/fumbles_recovered`, `def_tds`, `passes_defended`, `tackles_for_loss`, `qb_hits`, `safeties`, `blocked_kicks`
- **Returns**: `kick_return_yards/td`, `punt_return_yards/td`
- *Unique: (year, week, player_id)*

**players** - Master player directory
- `player_id` (varchar) - Sleeper player ID (unique)
- `full_name/first_name/last_name` (varchar) - Name components
- `position` (varchar) - NFL position
- `team` (varchar) - Current NFL team
- `age/years_exp` (int) - Player demographics
- `status/injury_status` (varchar) - Availability status
- `search_rank` (int) - Search priority ranking

**player_season_stats** - Aggregated seasonal performance
- `year` (int) - Season year
- `player_id/name/position` (varchar) - Player identification
- `mapped_position` (varchar) - Fantasy position grouping
- `total_pts` (float) - Season fantasy points total
- `weeks_played` (int) - Games with stats recorded
- `avg_pts` (float) - Average points per game
- `pos_rank` (int) - Position ranking by total points
- *Unique: (year, player_id)*

#### Transactions & Draft

**transactions** - League roster moves
- `year/week` (int) - When transaction occurred
- `transaction_id` (bigint) - Sleeper transaction ID (unique)
- `type` (varchar) - 'trade', 'waiver', 'free_agent'
- `status` (varchar) - 'complete', 'failed'
- `created/status_updated` (timestamp) - Transaction timeline
- `roster_ids` (varchar) - Comma-separated involved teams
- `num_adds/drops/picks_traded` (int) - Transaction component counts
- `faab_bid` (float) - Waiver claim bid amount

**transaction_players** - Individual player movements
- `year/week` (int) - Transaction timing
- `transaction_id` (bigint) - Parent transaction
- `type/action` (varchar) - Transaction type and 'add'/'drop'
- `player_id/name/position` (varchar) - Player identification
- `nfl_team` (varchar) - Player's NFL team
- `roster_id` (int) - Team acquiring/releasing player
- `faab_bid` (float) - Bid amount for player
- *Unique: (year, transaction_id, player_id, action)*

**traded_picks** - Draft pick ownership tracking
- `league_year` (int) - Year trade occurred
- `pick_season` (int) - Draft year of the pick
- `round` (int) - Draft round (1-5 typically)
- `roster_id` (int) - Current pick owner
- `previous_owner_id/original_owner_id` (int) - Trading history
- *Unique: (league_year, pick_season, round, roster_id, original_owner_id)*

**draft_metadata** - Draft configuration
- `year` (int) - Draft season
- `draft_id` (bigint) - Sleeper draft ID (unique)
- `league_id` (bigint) - League identifier
- `type/status` (varchar) - Draft type and completion status
- `sport` (varchar) - 'nfl' (default)
- `season/season_type` (int/varchar) - NFL season details
- `rounds/teams` (int) - Draft structure
- `pick_timer` (int) - Seconds per pick
- `reversal_round` (int) - Snake draft reversal point
- `num_draft_order_entries` (int) - Draft order complexity

**draft_picks** - Individual draft selections
- `year` (int) - Draft season
- `draft_id` (bigint) - Parent draft
- `overall_pick/round/draft_slot` (int) - Pick positioning
- `roster_id` (int) - Team making selection
- `picked_by` (bigint) - Original pick owner (for trades)
- `player_id/name` (varchar) - Selected player
- `position` (varchar) - Player position
- `nfl_team` (varchar) - Player's NFL team
- `is_keeper` (boolean) - Keeper league designation
- *Unique: (year, draft_id, overall_pick)*

### Chess Statistics Schema (chess_stats)

**games** - Individual chess game records
- `username` (varchar) - Chess.com username
- `game_index` (int) - Sequential game number
- `game_date` (timestamp) - Game completion time
- `format` (varchar) - Time control ('blitz', 'rapid', 'bullet')
- `game_url` (varchar) - Chess.com game URL (unique)
- `my_elo/opp_elo` (int) - Player ratings before game
- `elo_change` (int) - Rating change from game result
- `rolling_elo` (int) - Running rating after game
- `result` (varchar) - 'win', 'loss', 'draw'
- `termination` (varchar) - Game ending reason
- `moves_played` (int) - Total half-moves in game
- **Performance Metrics**:
  - `avg_centipawn_loss` (float) - Average move inaccuracy
  - `accuracy_percentage` (float) - Move accuracy score
  - `brilliant/great/good/inaccurate/mistake/blunder_moves` (int) - Move quality counts
  - `total_time_seconds` (int) - Time used in game

### Key Relationships

- **owners.roster_id** links to all other tables for team identification
- **draft_picks.picked_by** references **owners.roster_id** for traded picks
- **transaction_players.roster_id** references **owners.roster_id**
- **traded_picks** tracks draft pick ownership changes over time
- **player_stats** aggregates into **player_season_stats** by year
- **chess_stats.games** is independent schema for chess analytics

### Data Dictionary Notes

- **roster_id**: Team identifier within a league season (1-14 typically)
- **user_id**: Persistent Sleeper platform user identifier
- **player_id**: Sleeper's unique player identifier (e.g., "4046")
- **Timestamps**: Stored in UTC, usually as ISO strings or Unix timestamps
- **FAAB**: Free Agent Auction Budget - waiver claim bidding system
- **Keeper**: Players retained from previous season without using draft pick
- **Snake Draft**: Alternating pick order by round (1-2-3...3-2-1 pattern)

## Deployment

- Deployed on Railway platform for cron job execution
- Uses Procfile for worker process definition
- Railway cron jobs handle scheduled data ingestion
- Supabase database with IPv4 resolution for Railway compatibility

## Key Dependencies

- Django 6.0.3
- psycopg2-binary for PostgreSQL
- sleeper-api-wrapper for fantasy football data
- python-chess and Stockfish for chess analysis
- pandas for data processing
- python-dotenv for environment management
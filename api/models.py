from django.db import models


class Owner(models.Model):
    year         = models.IntegerField()
    roster_id    = models.IntegerField()
    user_id      = models.BigIntegerField()
    display_name = models.CharField(max_length=100)
    team_name    = models.CharField(max_length=200, blank=True, null=True)
    avatar       = models.CharField(max_length=100, blank=True, null=True)
    division     = models.CharField(max_length=100, blank=True, null=True)

    class Meta:
        db_table        = "owners"
        unique_together = [("year", "roster_id")]
        ordering        = ["year", "roster_id"]

    def __str__(self):
        return f"{self.year} — {self.display_name} (roster {self.roster_id})"


class Standing(models.Model):
    year           = models.IntegerField()
    roster_id      = models.IntegerField()
    user_id        = models.BigIntegerField()
    display_name   = models.CharField(max_length=100)
    division       = models.CharField(max_length=100, blank=True, null=True)
    wins           = models.IntegerField(default=0)
    losses         = models.IntegerField(default=0)
    ties           = models.IntegerField(default=0)
    win_pct        = models.FloatField(default=0)
    points_for     = models.FloatField(default=0)
    points_against = models.FloatField(default=0)
    points_diff    = models.FloatField(default=0)
    made_playoffs  = models.BooleanField(default=False)
    champion       = models.BooleanField(default=False)
    runner_up      = models.BooleanField(default=False)
    overall_rank   = models.IntegerField(blank=True, null=True)
    division_rank  = models.IntegerField(blank=True, null=True)
    div_champ      = models.BooleanField(default=False)

    class Meta:
        db_table        = "standings"
        unique_together = [("year", "roster_id")]
        ordering        = ["year", "overall_rank"]

    def __str__(self):
        return f"{self.year} — {self.display_name} ({self.wins}-{self.losses})"


class Matchup(models.Model):
    year               = models.IntegerField()
    week               = models.IntegerField()
    matchup_id         = models.IntegerField()
    roster_id          = models.IntegerField()
    opponent_roster_id = models.IntegerField(blank=True, null=True)
    points             = models.FloatField(default=0)
    opponent_points    = models.FloatField(blank=True, null=True)
    result             = models.CharField(max_length=10)   # W / L / T / BYE
    game_type          = models.CharField(max_length=20)   # regular / playoff / consolation

    class Meta:
        db_table        = "matchups"
        unique_together = [("year", "week", "matchup_id", "roster_id")]
        ordering        = ["year", "week", "matchup_id"]

    def __str__(self):
        return f"{self.year} W{self.week} — roster {self.roster_id} vs {self.opponent_roster_id}"


class Roster(models.Model):
    year            = models.IntegerField()
    week            = models.IntegerField()
    roster_id       = models.IntegerField()
    player_id       = models.CharField(max_length=20)
    player_name     = models.CharField(max_length=100)
    player_position = models.CharField(max_length=20)
    mapped_position = models.CharField(max_length=20)
    lineup_slot     = models.CharField(max_length=20)
    is_starter      = models.BooleanField(default=False)
    points          = models.FloatField(default=0)

    class Meta:
        db_table        = "rosters"
        unique_together = [("year", "week", "roster_id", "player_id")]
        ordering        = ["year", "week", "roster_id"]

    def __str__(self):
        return f"{self.year} W{self.week} — {self.player_name} ({'starter' if self.is_starter else 'bench'})"


class PlayerStat(models.Model):
    year            = models.IntegerField()
    week            = models.IntegerField()
    player_id       = models.CharField(max_length=20)
    player_name     = models.CharField(max_length=100)
    player_position = models.CharField(max_length=20)
    mapped_position = models.CharField(max_length=20)
    team            = models.CharField(max_length=10, blank=True, null=True)
    fantasy_points  = models.FloatField(default=0)

    # Universal
    tackles_solo          = models.FloatField(default=0)
    tackles_ast           = models.FloatField(default=0)
    tackles_total         = models.FloatField(default=0)
    sacks                 = models.FloatField(default=0)
    sack_yards            = models.FloatField(default=0)
    forced_fumbles        = models.FloatField(default=0)
    fumbles_recovered     = models.FloatField(default=0)
    fumble_recovery_yards = models.FloatField(default=0)
    fumble_recovery_td    = models.FloatField(default=0)
    kick_return_yards     = models.FloatField(default=0)
    kick_return_td        = models.FloatField(default=0)
    punt_return_yards     = models.FloatField(default=0)
    punt_return_td        = models.FloatField(default=0)

    # Kicker
    fg_made         = models.FloatField(default=0)
    fg_att          = models.FloatField(default=0)
    fg_made_0_19    = models.FloatField(default=0)
    fg_made_20_29   = models.FloatField(default=0)
    fg_made_30_39   = models.FloatField(default=0)
    fg_made_40_49   = models.FloatField(default=0)
    fg_made_50_plus = models.FloatField(default=0)
    xp_made         = models.FloatField(default=0)
    xp_att          = models.FloatField(default=0)

    # IDP — "int" is a reserved word; map to db column "int"
    interceptions    = models.FloatField(default=0, db_column="int")
    int_yards        = models.FloatField(default=0)
    int_td           = models.FloatField(default=0)
    def_tds          = models.FloatField(default=0)
    passes_defended  = models.FloatField(default=0)
    tackles_for_loss = models.FloatField(default=0)
    qb_hits          = models.FloatField(default=0)
    safeties         = models.FloatField(default=0)
    blocked_kicks    = models.FloatField(default=0)

    # Receiving
    receptions = models.FloatField(default=0)
    rec_yards  = models.FloatField(default=0)
    rec_tds    = models.FloatField(default=0)
    targets    = models.FloatField(default=0)

    # Rushing
    rush_yards    = models.FloatField(default=0)
    rush_tds      = models.FloatField(default=0)
    rush_attempts = models.FloatField(default=0)
    fumbles_lost  = models.FloatField(default=0)

    # Passing
    pass_yards       = models.FloatField(default=0)
    pass_tds         = models.FloatField(default=0)
    pass_int         = models.FloatField(default=0)
    pass_completions = models.FloatField(default=0)
    pass_attempts    = models.FloatField(default=0)

    class Meta:
        db_table        = "player_stats"
        unique_together = [("year", "week", "player_id")]
        ordering        = ["year", "week", "player_id"]

    def __str__(self):
        return f"{self.year} W{self.week} — {self.player_name} ({self.fantasy_points} pts)"


class Transaction(models.Model):
    year             = models.IntegerField()
    week             = models.IntegerField()
    transaction_id   = models.BigIntegerField(unique=True)
    type             = models.CharField(max_length=20)   # trade / waiver / free_agent
    status           = models.CharField(max_length=20)   # complete / failed
    created          = models.DateTimeField(blank=True, null=True)
    status_updated   = models.DateTimeField(blank=True, null=True)
    roster_ids       = models.CharField(max_length=200, blank=True, null=True)
    num_adds         = models.IntegerField(default=0)
    num_drops        = models.IntegerField(default=0)
    num_picks_traded = models.IntegerField(default=0)
    faab_bid         = models.FloatField(blank=True, null=True)

    class Meta:
        db_table = "transactions"
        ordering = ["year", "week", "transaction_id"]

    def __str__(self):
        return f"{self.year} W{self.week} — {self.type} ({self.transaction_id})"


class TransactionPlayer(models.Model):
    year            = models.IntegerField()
    week            = models.IntegerField()
    transaction_id  = models.BigIntegerField()
    type            = models.CharField(max_length=20)
    action          = models.CharField(max_length=10)   # add / drop
    player_id       = models.CharField(max_length=100)
    player_name     = models.CharField(max_length=100)
    player_position = models.CharField(max_length=20)
    roster_id       = models.IntegerField()
    faab_bid        = models.FloatField(blank=True, null=True)

    class Meta:
        db_table        = "transaction_players"
        unique_together = [("year", "transaction_id", "player_id", "action")]
        ordering        = ["year", "week", "transaction_id"]

    def __str__(self):
        return f"{self.year} W{self.week} — {self.action} {self.player_name}"


class TradedPick(models.Model):
    league_year       = models.IntegerField()
    pick_season       = models.IntegerField()
    round             = models.IntegerField()
    roster_id         = models.IntegerField()
    previous_owner_id = models.IntegerField(blank=True, null=True)
    original_owner_id = models.IntegerField(blank=True, null=True)

    class Meta:
        db_table        = "traded_picks"
        unique_together = [("league_year", "pick_season", "round", "roster_id", "original_owner_id")]
        ordering        = ["league_year", "pick_season", "round"]

    def __str__(self):
        return f"{self.pick_season} R{self.round} — roster {self.original_owner_id} → {self.roster_id}"


class DraftMetadata(models.Model):
    year                    = models.IntegerField()
    draft_id                = models.BigIntegerField(unique=True)
    league_id               = models.BigIntegerField()
    type                    = models.CharField(max_length=20)
    status                  = models.CharField(max_length=20)
    sport                   = models.CharField(max_length=10, default="nfl")
    season                  = models.IntegerField()
    season_type             = models.CharField(max_length=20, blank=True, null=True)
    rounds                  = models.IntegerField(blank=True, null=True)
    teams                   = models.IntegerField(blank=True, null=True)
    pick_timer              = models.IntegerField(blank=True, null=True)
    reversal_round          = models.IntegerField(blank=True, null=True)
    num_draft_order_entries = models.IntegerField(blank=True, null=True)

    class Meta:
        db_table = "draft_metadata"
        ordering = ["year", "draft_id"]

    def __str__(self):
        return f"{self.year} draft — {self.type} ({self.status})"


class DraftPick(models.Model):
    year         = models.IntegerField()
    draft_id     = models.BigIntegerField()
    overall_pick = models.IntegerField()
    round        = models.IntegerField()
    draft_slot   = models.IntegerField()
    roster_id    = models.IntegerField()
    picked_by    = models.BigIntegerField(blank=True, null=True)
    player_id    = models.CharField(max_length=20)
    player_name  = models.CharField(max_length=100)
    position     = models.CharField(max_length=20, blank=True, null=True)
    nfl_team     = models.CharField(max_length=10, blank=True, null=True)
    is_keeper    = models.BooleanField(default=False)

    class Meta:
        db_table        = "draft_picks"
        unique_together = [("year", "draft_id", "overall_pick")]
        ordering        = ["year", "draft_id", "overall_pick"]

    def __str__(self):
        return f"{self.year} pick {self.overall_pick} — {self.player_name} ({self.position})"

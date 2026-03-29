// ---------------------------------------------------------------------------
// team.js  —  individual team page
// URL param: ?roster_id=<int>
// ---------------------------------------------------------------------------

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB'];
const SLOT_TIER      = { BN: 1, TAXI: 2, IR: 3 };

// ---------------------------------------------------------------------------
// Page-level state
// ---------------------------------------------------------------------------
let _rosterId      = null;
let _selectedYear  = CURRENT_YEAR;
let _allOwners     = [];
let _allStandings  = [];
let _playerDetails  = {};   // player_id → { team, age }
let _statsByYear    = {};   // statsYear → { player_id → { total_pts, avg_pts, pos_rank } }
let _yearCache      = {};   // year → { roster, latestWeek, matchups, opponentMap, statsYear }
let _rosterExpanded    = true;
let _expandedPositions = new Set(POSITION_ORDER);  // all positions expanded by default

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  renderNav('teams');

  _rosterId = parseInt(getQueryParam('roster_id'));
  if (!_rosterId) {
    document.getElementById('team-hero').innerHTML =
      `<p class="text-red-400">No roster_id specified.</p>`;
    return;
  }

  renderSkeletons();

  try {
    const [
      { data: owners,    error: e1 },
      { data: standings, error: e2 },
    ] = await Promise.all([
      window.db.from('owners')
        .select('year,roster_id,display_name,team_name,avatar,division')
        .eq('roster_id', _rosterId).order('year'),
      window.db.from('standings')
        .select('year,roster_id,wins,losses,ties,points_for,points_against,made_playoffs,champion,runner_up,div_champ,overall_rank,division_rank,division')
        .eq('roster_id', _rosterId).order('year'),
    ]);
    if (e1 || e2) throw e1 || e2;

    _allOwners    = owners    || [];
    _allStandings = standings || [];

    const currentOwner = _allOwners.find(o => o.year === CURRENT_YEAR)
      || _allOwners[_allOwners.length - 1]
      || { display_name: 'Unknown', team_name: 'Unknown', avatar: null, division: null };

    document.title = `${currentOwner.team_name || currentOwner.display_name} — MLD`;

    renderHero(currentOwner);
    renderStatBar();
    renderHistory();
    renderSeasonSelector();

    await loadYear(CURRENT_YEAR);

  } catch (err) {
    console.error(err);
    document.getElementById('team-hero').innerHTML =
      `<p class="text-red-400 text-sm">Failed to load team data.</p>`;
  }
});

// ---------------------------------------------------------------------------
// Season selector
// ---------------------------------------------------------------------------

function renderSeasonSelector() {
  const years = SEASONS.filter(y => _allStandings.some(s => s.year === y));
  const el = document.getElementById('season-selector');
  el.innerHTML = years.map(y => `
    <button class="year-pill${y === _selectedYear ? ' year-pill--active' : ''}"
            data-year="${y}">${y}</button>
  `).join('');

  el.addEventListener('click', async e => {
    const btn = e.target.closest('[data-year]');
    if (!btn) return;
    const year = parseInt(btn.dataset.year);
    if (year === _selectedYear) return;
    _selectedYear = year;
    el.querySelectorAll('.year-pill').forEach(b =>
      b.classList.toggle('year-pill--active', parseInt(b.dataset.year) === year));
    await loadYear(year);
  });
}

// ---------------------------------------------------------------------------
// Roster toggle handlers (called via inline onclick — avoids listener stacking)
// ---------------------------------------------------------------------------

function _toggleRosterExpand() {
  _rosterExpanded = !_rosterExpanded;
  renderYearSections(_selectedYear, _yearCache[_selectedYear]);
}

function _togglePos(pos) {
  if (_expandedPositions.has(pos)) _expandedPositions.delete(pos);
  else _expandedPositions.add(pos);
  renderYearSections(_selectedYear, _yearCache[_selectedYear]);
}

// ---------------------------------------------------------------------------
// Per-year data loader (cached)
// ---------------------------------------------------------------------------

async function loadYear(year) {
  _selectedYear = year;

  // Show skeletons for the two dynamic sections
  document.getElementById('schedule-container').innerHTML =
    `<div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(10, 4)}</tbody></table></div>`;
  document.getElementById('roster-container').innerHTML =
    `<div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(14, 4)}</tbody></table></div>`;

  // Serve from cache if available
  if (_yearCache[year]) {
    renderYearSections(year, _yearCache[year]);
    return;
  }

  try {
    const [
      { data: rosterRows, error: er },
      { data: matchups,   error: em },
      { data: yearOwners, error: eo },
    ] = await Promise.all([
      window.db.from('rosters')
        .select('week,player_id,player_name,player_position,mapped_position,lineup_slot,is_starter,points')
        .eq('year', year).eq('roster_id', _rosterId)
        .order('week', { ascending: false }),
      window.db.from('matchups')
        .select('week,points,opponent_points,result,opponent_roster_id,game_type')
        .eq('year', year).eq('roster_id', _rosterId).order('week'),
      window.db.from('owners')
        .select('roster_id,display_name,team_name,avatar')
        .eq('year', year),
    ]);
    if (er || em || eo) throw er || em || eo;

    const latestWeek = rosterRows?.[0]?.week ?? null;
    const roster = latestWeek !== null
      ? rosterRows.filter(r => r.week === latestWeek)
      : [];

    const opponentMap = {};
    for (const o of (yearOwners || [])) opponentMap[o.roster_id] = o;

    // Pre-season: show prev year stats; otherwise show stats for the displayed year
    const statsYear = (year === CURRENT_YEAR && latestWeek === 0) ? CURRENT_YEAR - 1 : year;

    _yearCache[year] = { roster, latestWeek, matchups: matchups || [], opponentMap, statsYear };

    await loadPlayerEnrichment(roster.map(r => r.player_id), statsYear);

    renderYearSections(year, _yearCache[year]);

  } catch (err) {
    console.error(err);
    document.getElementById('schedule-container').innerHTML =
      `<p class="text-red-400 text-sm">Failed to load ${year} data.</p>`;
  }
}

// ---------------------------------------------------------------------------
// Player enrichment (NFL team, age, prev-season stats) — loaded once
// ---------------------------------------------------------------------------

async function loadPlayerEnrichment(playerIds, statsYear) {
  if (!playerIds.length) return;
  try {
    const newIds     = playerIds.filter(id => !_playerDetails[id]);
    const needsStats = !_statsByYear[statsYear];
    if (!newIds.length && !needsStats) return;

    const fetches = await Promise.all([
      newIds.length
        ? window.db.from('players').select('player_id,team,age').in('player_id', newIds)
        : Promise.resolve({ data: [], error: null }),
      needsStats
        ? window.db.from('player_season_stats')
            .select('player_id,total_pts,weeks_played,avg_pts,pos_rank')
            .eq('year', statsYear).in('player_id', playerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const [{ data: playerRows, error: ep }, { data: seasonRows, error: es }] = fetches;
    if (ep) console.warn('players fetch error:', ep);
    if (es) console.warn('player_season_stats fetch error:', es);

    for (const p of (playerRows || [])) _playerDetails[p.player_id] = p;
    if (needsStats) {
      _statsByYear[statsYear] = {};
      for (const s of (seasonRows || [])) _statsByYear[statsYear][s.player_id] = s;
    }
  } catch (e) {
    console.warn('Player enrichment failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Render schedule + roster for a given year's cached data
// ---------------------------------------------------------------------------

function renderYearSections(year, { roster, latestWeek, matchups, opponentMap, statsYear }) {
  const isCurrentYear = year === CURRENT_YEAR;

  // Schedule
  document.getElementById('schedule-label').textContent = `${year} Schedule`;
  if (!matchups.length && isCurrentYear) {
    document.getElementById('schedule-container').innerHTML =
      `<p class="text-slate-500 text-sm">Season hasn't started yet.</p>`;
  } else {
    renderSchedule(matchups, opponentMap, year);
  }

  // Roster — always pass details, stats, and display year for age calc
  renderRoster(roster, latestWeek, year, _playerDetails, _statsByYear[statsYear] || {}, statsYear);
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function renderSkeletons() {
  document.getElementById('team-hero').innerHTML = `
    <div class="card p-6" style="display:flex;align-items:center;gap:1.5rem;">
      <div class="skeleton" style="width:80px;height:80px;border-radius:50%;flex-shrink:0;"></div>
      <div style="flex:1;display:flex;flex-direction:column;gap:10px;">
        <div class="skeleton" style="height:28px;width:55%;border-radius:6px;"></div>
        <div class="skeleton" style="height:16px;width:35%;border-radius:6px;"></div>
      </div>
    </div>`;
  document.getElementById('stat-bar').innerHTML = `
    <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
      ${Array.from({length: 5}, () =>
        `<div class="skeleton" style="height:64px;width:110px;border-radius:12px;"></div>`
      ).join('')}
    </div>`;
  document.getElementById('season-selector').innerHTML =
    Array.from({length: 7}, () =>
      `<div class="skeleton" style="height:34px;width:60px;border-radius:99px;"></div>`
    ).join('');
  document.getElementById('schedule-container').innerHTML =
    `<div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(10, 4)}</tbody></table></div>`;
  document.getElementById('roster-container').innerHTML =
    `<div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(14, 4)}</tbody></table></div>`;
  document.getElementById('history-container').innerHTML =
    `<div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(7, 6)}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function renderHero(owner) {
  const currentStanding = _allStandings.find(s => s.year === CURRENT_YEAR);
  const divisionName = owner.division || currentStanding?.division || null;
  const divBadge = divisionName ? `
    <span class="badge" style="background:rgba(1,28,69,0.08);color:#011C45;border:1px solid rgba(1,28,69,0.2);font-size:0.65rem;">
      ${esc(divisionName)}
    </span>` : '';

  document.getElementById('team-hero').innerHTML = `
    <div class="card p-6" style="display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;">
      ${avatarImg(owner.avatar, owner.display_name, 80)}
      <div style="min-width:0;">
        <div style="font-family:'Roboto Condensed',sans-serif;font-weight:900;font-size:1.75rem;letter-spacing:0.05em;color:#0D0F11;line-height:1.1;margin-bottom:0.35rem;">
          ${esc(owner.team_name || owner.display_name)}
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
          <span style="font-size:0.875rem;color:#6b7280;font-weight:500;">${esc(owner.display_name)}</span>
          ${divBadge}
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Stat bar
// ---------------------------------------------------------------------------

function renderStatBar() {
  const cur = _allStandings.find(s => s.year === CURRENT_YEAR);
  const championships = _allStandings.filter(s => s.champion).length;
  const playoffApps   = _allStandings.filter(s => s.made_playoffs).length;
  const totalGames    = _allStandings.reduce((sum, s) => sum + s.wins + s.losses + (s.ties || 0), 0);
  const totalWins     = _allStandings.reduce((sum, s) => sum + s.wins, 0);
  const allTimePct    = totalGames > 0
    ? ((totalWins / totalGames) * 100).toFixed(1) + '%' : '—';

  const stats = [
    {
      label: `${CURRENT_YEAR} Record`,
      value: cur ? formatRecord(cur.wins, cur.losses, cur.ties) : '—',
      sub:   cur ? `#${cur.overall_rank ?? '?'} overall` : 'No data',
    },
    {
      label: `${CURRENT_YEAR} PF`,
      value: cur ? formatPts(cur.points_for) : '—',
      sub:   cur ? `PA: ${formatPts(cur.points_against)}` : '',
    },
    {
      label: 'Championships',
      value: championships || '0',
      sub:   championships
        ? _allStandings.filter(s => s.champion).map(s => s.year).join(', ')
        : 'None yet',
    },
    {
      label: 'Playoff Apps',
      value: playoffApps,
      sub:   `of ${_allStandings.length} seasons`,
    },
    {
      label: 'All-Time Win%',
      value: allTimePct,
      sub:   `${totalWins}W — ${_allStandings.reduce((s, r) => s + r.losses, 0)}L`,
    },
  ];

  document.getElementById('stat-bar').innerHTML = `
    <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
      ${stats.map(s => `
        <div class="card" style="padding:0.75rem 1rem;min-width:110px;flex:1;">
          <div style="font-size:0.6rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#6b7280;margin-bottom:2px;">${s.label}</div>
          <div style="font-family:'Roboto Condensed',sans-serif;font-weight:900;font-size:1.5rem;letter-spacing:0.04em;color:#0D0F11;line-height:1.1;">${s.value}</div>
          <div style="font-size:0.7rem;color:#94a3b8;margin-top:2px;">${s.sub}</div>
        </div>`).join('')}
    </div>`;
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

function renderSchedule(matchups, opponentMap, year) {
  const el = document.getElementById('schedule-container');
  if (!matchups?.length) {
    el.innerHTML = `<p class="text-slate-500 text-sm">No matchups found for ${year}.</p>`;
    return;
  }

  const roundBadge = (gameType, isBye) => {
    const map = {
      wildcard:     { label: 'Wildcard',      color: '#a855f7' },
      divisional:   { label: 'Divisional',    color: '#a855f7' },
      championship: { label: 'Championship',  color: '#eab308' },
      third_place:  { label: '3rd Place',     color: '#f97316' },
      fifth_place:  { label: '5th Place',     color: '#f97316' },
      consolation:  { label: 'Consolation',   color: '#94a3b8' },
      playoff:      { label: 'Playoff',       color: '#a855f7' },
    };
    if (isBye && gameType === 'wildcard') {
      return `<span style="font-size:0.6rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#a855f7;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.2);border-radius:99px;padding:1px 6px;">1st Rd Bye</span>`;
    }
    const entry = map[gameType];
    if (!entry) return '';
    const { label, color } = entry;
    return `<span style="font-size:0.6rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${color};background:${color}1a;border:1px solid ${color}40;border-radius:99px;padding:1px 6px;margin-left:4px;">${label}</span>`;
  };

  const buildRow = m => {
    const opp   = opponentMap[m.opponent_roster_id] || { display_name: 'BYE', avatar: null };
    const isBye = m.result === 'BYE';
    const resultColor = m.result === 'W' ? '#10b981' : m.result === 'L' ? '#ef4444' : '#94a3b8';
    const resultLabel = isBye
      ? '<span style="color:#94a3b8;font-size:0.75rem;">BYE</span>'
      : `<span style="font-weight:800;font-size:0.85rem;color:${resultColor};">${m.result}</span>`;
    const scoreHtml = isBye ? '—'
      : `<span style="font-weight:700;">${formatPts(m.points)}</span>
         <span style="color:#94a3b8;margin:0 3px;">-</span>
         <span style="color:#94a3b8;">${formatPts(m.opponent_points)}</span>`;
    return `
      <tr>
        <td class="font-mono text-sm text-slate-500">Wk ${m.week}</td>
        <td>${resultLabel}</td>
        <td class="font-mono text-sm">${scoreHtml}</td>
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            ${isBye ? '' : avatarImg(opp.avatar, opp.display_name, 22)}
            ${isBye ? '' : `<span style="font-size:0.8rem;color:#374151;">${esc(opp.display_name)}</span>`}
            ${roundBadge(m.game_type, isBye)}
          </div>
        </td>
      </tr>`;
  };

  const thead = `<thead><tr><th>Wk</th><th>W/L</th><th>Score</th><th>Opponent</th></tr></thead>`;
  const playoffGames    = matchups.filter(m => m.game_type !== 'regular');
  const madePlayoffs    = playoffGames.length > 0;
  const playoffStart    = madePlayoffs
    ? Math.min(...playoffGames.map(m => m.week))
    : (year === 2020 ? 14 : 15);   // fallback for non-playoff teams
  const regularSeasonEnd = playoffStart - 1;

  const hardCap     = year === 2020 ? 16 : 17;
  const fifthPlace  = matchups.find(m => m.game_type === 'fifth_place');
  const maxWeek     = !madePlayoffs  ? regularSeasonEnd
    : fifthPlace                     ? fifthPlace.week
    :                                  hardCap;

  const visible = matchups.filter(m => m.week <= maxWeek);
  const left  = visible.filter(m => m.week <= 9).map(buildRow).join('');
  const right  = visible.filter(m => m.week >= 10).map(buildRow).join('');

  el.innerHTML = `
    <div class="card overflow-hidden">
      <div style="display:grid;grid-template-columns:1fr 1fr;">
        <div style="overflow-x:auto;">
          <table class="data-table">${thead}<tbody>${left}</tbody></table>
        </div>
        <div style="border-left:1px solid #e5e7eb;overflow-x:auto;">
          <table class="data-table">${thead}<tbody>${right}</tbody></table>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

function renderRoster(players, week, displayYear, playerDetails, stats, statsYear) {
  const el          = document.getElementById('roster-container');
  const isPreSeason = week === 0;
  const ageOffset   = CURRENT_YEAR - displayYear;

  if (!players?.length) {
    el.innerHTML = `<p class="text-slate-500 text-sm">No roster data available.</p>`;
    return;
  }

  // Group by mapped_position
  const groups = {};
  for (const p of players) {
    const pos = POSITION_ORDER.includes(p.mapped_position) ? p.mapped_position : 'Other';
    if (!groups[pos]) groups[pos] = [];
    groups[pos].push(p);
  }

  // Sort: starters first → BN → TAXI → IR, then by stats rank
  for (const pos of Object.keys(groups)) {
    groups[pos].sort((a, b) => {
      const tierA = a.is_starter ? 0 : (SLOT_TIER[a.lineup_slot] ?? 1);
      const tierB = b.is_starter ? 0 : (SLOT_TIER[b.lineup_slot] ?? 1);
      if (tierA !== tierB) return tierA - tierB;
      const rankA = stats?.[a.player_id]?.pos_rank ?? 9999;
      const rankB = stats?.[b.player_id]?.pos_rank ?? 9999;
      return rankA - rankB;
    });
  }

  const COLLAPSED_LIMITS = { QB: 2, RB: 3, WR: 4, TE: 2, K: 1, DL: 3, LB: 3, DB: 3 };
  const colCount  = _rosterExpanded ? 6 : 5;
  const theadCols = _rosterExpanded
    ? `<th>Player</th><th>Team</th><th>Age</th><th></th><th title="${statsYear} Total Pts">Pts</th><th title="${statsYear} Avg / Rank">Avg&nbsp;&bull;&nbsp;Rank</th>`
    : `<th>Player</th><th>Team</th><th>Age</th><th></th><th title="${statsYear} Rank">Rank</th>`;

  const slotPill = slot => {
    if (slot !== 'TAXI' && slot !== 'IR') return '';
    const color = slot === 'IR' ? '#ef4444' : '#f97316';
    return `<span style="font-size:0.65rem;font-weight:700;color:${color};background:${color}1a;border:1px solid ${color}40;border-radius:4px;padding:1px 5px;display:inline-block;">${slot}</span>`;
  };

  const buildPositionRows = positions => positions.filter(pos => groups[pos]).flatMap(pos => {
    const posExpanded = _expandedPositions.has(pos);
    const colLimit    = COLLAPSED_LIMITS[pos] ?? Infinity;
    const hasMore     = groups[pos].length > colLimit;
    const visible     = posExpanded ? groups[pos] : groups[pos].slice(0, colLimit);
    const hiddenCount = groups[pos].length - visible.length;

    const chevronIcon = posExpanded
      ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 9 12 15 6 9"/></svg>`
      : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

    const chevron = hasMore ? `
      <button onclick="_togglePos('${pos}')" title="${posExpanded ? 'Collapse' : `Show ${hiddenCount} more`}"
        style="display:flex;align-items:center;color:#6366f1;background:none;border:none;cursor:pointer;padding:2px 4px;border-radius:4px;line-height:0;">
        ${chevronIcon}
      </button>` : '';

    const posHeader = `
      <tr style="background:#f9fafb;">
        <td colspan="${colCount}" style="padding:0.35rem 1rem;border-bottom:1px solid #e5e7eb;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:0.65rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#6b7280;">${pos}</span>
            ${chevron}
          </div>
        </td>
      </tr>`;

    const playerRows = visible.map(p => {
      const detail = playerDetails?.[p.player_id] || {};
      const pStats = stats?.[p.player_id] || null;
      const dimmed = !p.is_starter;

      const teamCell = detail.team
        ? `<div style="display:flex;align-items:center;gap:4px;">${nflTeamLogo(detail.team, 18)}<span style="font-size:0.75rem;color:#6b7280;">${esc(detail.team)}</span></div>`
        : `<span style="color:#d1d5db;">—</span>`;

      const displayAge = detail.age != null ? detail.age - ageOffset : null;
      const ageCell = displayAge != null
        ? `<span style="font-size:0.8rem;color:#374151;">${displayAge}</span>`
        : `<span style="color:#d1d5db;">—</span>`;

      const statCell = _rosterExpanded ? `
        <td style="font-family:monospace;font-size:0.8rem;color:${pStats ? '#0D0F11' : '#94a3b8'};padding:0.5rem 0.5rem;">
          ${pStats ? formatPts(pStats.total_pts) : '—'}
        </td>
        <td style="padding:0.5rem 0.5rem;">
          <span style="font-family:monospace;font-size:0.8rem;color:${pStats ? '#374151' : '#94a3b8'};">
            ${pStats ? formatPts(pStats.avg_pts) : '—'}
          </span>
          ${pStats?.pos_rank ? `<span style="font-size:0.65rem;font-weight:700;color:#6366f1;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:4px;padding:1px 5px;margin-left:4px;">${p.mapped_position}${pStats.pos_rank}</span>` : ''}
        </td>` : `
        <td style="padding:0.5rem 0.5rem;">
          ${pStats?.pos_rank ? `<span style="font-size:0.65rem;font-weight:700;color:#6366f1;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:4px;padding:2px 7px;">${p.mapped_position}${pStats.pos_rank}</span>` : `<span style="color:#d1d5db;">—</span>`}
        </td>`;

      return `
        <tr style="${dimmed ? 'opacity:0.55;' : ''}">
          <td style="padding:0.5rem 1rem;">
            <span style="font-size:0.85rem;font-weight:${dimmed ? '400' : '600'};color:#0D0F11;">${esc(p.player_name)}</span>
          </td>
          <td style="padding:0.5rem 0.5rem;">${teamCell}</td>
          <td style="padding:0.5rem 0.5rem;">${ageCell}</td>
          <td style="padding:0.5rem 0.5rem;">${slotPill(p.lineup_slot)}</td>
          ${statCell}
        </tr>`;
    }).join('');

    return posHeader + playerRows;
  }).join('');

  const leftRows  = buildPositionRows(['QB', 'RB', 'WR', 'TE']);
  const rightRows = buildPositionRows(['K', 'DL', 'LB', 'DB']);

  const rosterLabel = isPreSeason ? 'Pre-season roster' : `Week ${week} roster`;
  const statsLabel  = `<span style="margin-left:0.5rem;font-weight:400;color:#d1d5db;">— ${statsYear} stats</span>`;

  el.innerHTML = `
    <div class="card overflow-hidden">
      <div style="padding:0.6rem 1rem;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:0.7rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">${rosterLabel}${statsLabel}</span>
        <button onclick="_toggleRosterExpand()" style="font-size:0.7rem;font-weight:600;color:#6366f1;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:6px;padding:2px 10px;cursor:pointer;">
          ${_rosterExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;">
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr>${theadCols}</tr></thead>
            <tbody>${leftRows}</tbody>
          </table>
        </div>
        <div style="border-left:1px solid #e5e7eb;overflow-x:auto;">
          <table class="data-table">
            <thead><tr>${theadCols}</tr></thead>
            <tbody>${rightRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Season history
// ---------------------------------------------------------------------------

function renderHistory() {
  const el = document.getElementById('history-container');
  if (!_allStandings?.length) {
    el.innerHTML = `<p class="text-slate-500 text-sm">No history available.</p>`;
    return;
  }

  const teamNameByYear = {};
  for (const o of _allOwners) teamNameByYear[o.year] = o.team_name || o.display_name;

  const rows = [..._allStandings].reverse().map(s => {
    const diff = (s.points_for || 0) - (s.points_against || 0);
    const seasonComplete = s.year < CURRENT_YEAR;
    const badges = [];
    if (seasonComplete) {
      if (s.champion)  badges.push(`<span class="badge badge-champion">&#127942; Champ</span>`);
      if (s.runner_up) badges.push(`<span class="badge badge-runnerup">&#129352; Runner-up</span>`);
      if (s.div_champ) badges.push(divChampBadge(s.division));
      if (s.made_playoffs && !s.champion && !s.runner_up)
                       badges.push(`<span class="badge badge-playoffs">Playoffs</span>`);
    }
    const resultCell = !seasonComplete
      ? '<span style="font-size:0.75rem;color:#d1d5db;">In progress</span>'
      : badges.join('') || '<span style="font-size:0.75rem;color:#94a3b8;">Missed</span>';
    return `
      <tr>
        <td class="font-mono text-sm font-semibold" style="color:#0D0F11;">${s.year}</td>
        <td><div class="truncate-name" style="font-size:0.8rem;color:#374151;">${esc(teamNameByYear[s.year] || '—')}</div></td>
        <td class="font-semibold">${formatRecord(s.wins, s.losses, s.ties)}</td>
        <td class="font-mono text-sm hidden md:table-cell">${formatPts(s.points_for)}</td>
        <td class="font-mono text-sm hidden md:table-cell text-slate-400">${formatPts(s.points_against)}</td>
        <td class="font-mono text-sm hidden md:table-cell ${diffClass(diff)}">${diffLabel(diff)}</td>
        <td><div style="display:flex;gap:4px;flex-wrap:wrap;">${resultCell}</div></td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="card overflow-x-auto">
      <table class="data-table">
        <thead><tr>
          <th>Year</th><th>Team</th><th>W-L</th>
          <th class="hidden md:table-cell">PF</th>
          <th class="hidden md:table-cell">PA</th>
          <th class="hidden md:table-cell">+/-</th>
          <th>Result</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

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
let _allMatchups       = [];   // all matchups for this team, every year
let _allOpponents      = {};   // roster_id → latest owner info (for opponent names)
let _leagueMatchups    = [];   // all non-BYE matchups for all teams (for ranking)
let _allTeamStandings  = {};   // year → roster_id → { wins, losses, ties }
let _opponentOwnedYears = {}; // roster_id → Set<year> owned by that team's current user
let _draftPicks         = []; // historical draft picks for this team
let _tradedPicks        = []; // current traded-pick state involving this team
let _draftRounds        = 5;  // number of rounds (from latest draft metadata)

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
      { data: owners,            error: e1 },
      { data: standings,         error: e2 },
      { data: allMatchups,       error: e3 },
      { data: allOwnersAll,      error: e4 },
      { data: leagueRegMatchups,  error: e5 },
      { data: allTeamStandings,  error: e6 },
      { data: draftPicks,        error: e7 },
      { data: tradedPicks,       error: e8 },
      { data: draftMeta,         error: e9 },
    ] = await Promise.all([
      window.db.from('owners')
        .select('year,roster_id,user_id,display_name,team_name,avatar,division')
        .eq('roster_id', _rosterId).order('year'),
      window.db.from('standings')
        .select('year,roster_id,wins,losses,ties,points_for,points_against,made_playoffs,champion,runner_up,div_champ,overall_rank,division_rank,division')
        .eq('roster_id', _rosterId).order('year'),
      window.db.from('matchups')
        .select('year,week,points,opponent_points,result,opponent_roster_id,game_type')
        .eq('roster_id', _rosterId),
      window.db.from('owners')
        .select('roster_id,user_id,display_name,team_name,avatar,year'),
      window.db.from('matchups')
        .select('roster_id,result,game_type,points')
        .neq('result', 'BYE')
        .gt('points', 0),
      window.db.from('standings')
        .select('year,roster_id,wins,losses,ties,overall_rank'),
      window.db.from('draft_picks')
        .select('year,round,overall_pick,player_id,player_name,position,nfl_team,is_keeper')
        .eq('roster_id', _rosterId)
        .order('year').order('round').order('overall_pick'),
      window.db.from('traded_picks')
        .select('pick_season,round,roster_id,original_owner_id')
        .eq('league_year', CURRENT_YEAR),
      window.db.from('draft_metadata')
        .select('year,rounds')
        .order('year', { ascending: false })
        .limit(1),
    ]);
    if (e1||e2||e3||e4||e5||e6||e7||e8||e9) throw e1||e2||e3||e4||e5||e6||e7||e8||e9;

    // owners is ordered by year asc — last entry is the most recent owner of this roster slot
    const rawOwners = owners || [];
    const currentDisplayName = rawOwners[rawOwners.length - 1]?.display_name ?? null;

    // Collect all display_names that belong to this person (handles account merges)
    const mergedNames = new Set([currentDisplayName]);
    for (const [oldName, newName] of Object.entries(OWNER_ACCOUNT_MERGES)) {
      if (oldName === currentDisplayName || newName === currentDisplayName) {
        mergedNames.add(oldName);
        mergedNames.add(newName);
      }
    }

    // Resolve to all user_ids across every account belonging to this person
    const ownedUserIds = new Set(
      rawOwners.filter(o => mergedNames.has(o.display_name)).map(o => o.user_id)
    );

    // Only keep years where any of this person's user_ids owned the team
    const ownedYears = new Set(
      rawOwners.filter(o => ownedUserIds.has(o.user_id)).map(o => o.year)
    );
    for (const y of (OWNER_YEAR_EXCLUSIONS[currentDisplayName] || []))
      ownedYears.delete(y);

    _allOwners         = rawOwners.filter(o => ownedYears.has(o.year));
    _allStandings      = (standings          || []).filter(s => ownedYears.has(s.year));
    _allMatchups      = (allMatchups       || []).filter(m => ownedYears.has(m.year));
    _leagueMatchups   = leagueRegMatchups  || [];

    const tsMap = {};
    for (const s of (allTeamStandings || [])) {
      if (!tsMap[s.year]) tsMap[s.year] = {};
      tsMap[s.year][s.roster_id] = s;
    }
    _allTeamStandings = tsMap;

    // Build opponent owned-years map using the same ownership logic as the main team
    const ownersByRid = {};
    for (const o of (allOwnersAll || [])) {
      if (!ownersByRid[o.roster_id]) ownersByRid[o.roster_id] = [];
      ownersByRid[o.roster_id].push(o);
    }
    const oppOwnedYears = {};
    for (const [ridStr, rows] of Object.entries(ownersByRid)) {
      rows.sort((a, b) => a.year - b.year);
      const latest = rows[rows.length - 1];
      const latestDisplayName = latest?.display_name ?? null;

      const mergedNames = new Set([latestDisplayName]);
      for (const [oldName, newName] of Object.entries(OWNER_ACCOUNT_MERGES)) {
        if (oldName === latestDisplayName || newName === latestDisplayName) {
          mergedNames.add(oldName); mergedNames.add(newName);
        }
      }
      const userIds = new Set(rows.filter(o => mergedNames.has(o.display_name)).map(o => o.user_id));
      const ys = new Set(rows.filter(o => userIds.has(o.user_id)).map(o => o.year));
      for (const y of (OWNER_YEAR_EXCLUSIONS[latestDisplayName] || [])) ys.delete(y);
      oppOwnedYears[parseInt(ridStr)] = ys;
    }
    _opponentOwnedYears = oppOwnedYears;

    _draftPicks  = (draftPicks || []).filter(p => ownedYears.has(p.year));
    _tradedPicks = tradedPicks || [];
    _draftRounds = draftMeta?.[0]?.rounds || 7;

    // Build latest-owner lookup: for each roster_id keep the highest-year entry
    for (const o of (allOwnersAll || [])) {
      if (!_allOpponents[o.roster_id] || o.year > _allOpponents[o.roster_id].year) {
        _allOpponents[o.roster_id] = o;
      }
    }

    const currentOwner = _allOwners.find(o => o.year === CURRENT_YEAR)
      || _allOwners[_allOwners.length - 1]
      || { display_name: 'Unknown', team_name: 'Unknown', avatar: null, division: null };

    document.title = `${currentOwner.team_name || currentOwner.display_name} — MLD`;

    // Default to CURRENT_YEAR if this owner has data for it, otherwise their most recent year
    const latestOwnedYear = _allStandings.length
      ? _allStandings[_allStandings.length - 1].year
      : CURRENT_YEAR;
    if (_selectedYear > latestOwnedYear) _selectedYear = latestOwnedYear;

    renderHero(currentOwner);
    renderStatBar();
    renderHistory();
    renderH2H();
    renderDraftPicks();
    renderSeasonSelector();

    await loadYear(_selectedYear);

  } catch (err) {
    console.error(err);
    document.getElementById('team-hero').innerHTML =
      `<p class="text-red-400 text-sm">Failed to load team data.</p>`;
  }
});

// ---------------------------------------------------------------------------
// Section nav
// ---------------------------------------------------------------------------

const SECTION_NAV_ITEMS = [
  { id: 'section-schedule', label: 'Schedule' },
  { id: 'section-roster',   label: 'Roster'   },
  { id: 'section-draft',    label: 'Draft'    },
  { id: 'section-history',  label: 'History'  },
  { id: 'section-h2h',      label: 'H2H'      },
  { id: 'section-activity', label: 'Activity' },
];

// Renders the combined sticky bar: year dropdown | divider | section tabs.
// Called once after data loads; dropdown value is updated in-place on year change.
function renderSeasonSelector() {
  const years = SEASONS.filter(y => _allStandings.some(s => s.year === y));
  const root  = document.getElementById('section-nav-root');
  if (!root) return;

  root.innerHTML = `
    <div class="page-container page-container--wide"
         style="display:flex;align-items:center;gap:0.25rem;padding:0.25rem 1rem;">
      <select id="year-dropdown"
              style="font-size:0.75rem;font-weight:700;letter-spacing:0.04em;color:#011C45;background:rgba(1,28,69,0.08);border:1px solid rgba(1,28,69,0.2);border-radius:0.375rem;padding:0.3rem 0.5rem;cursor:pointer;outline:none;">
        ${[...years].reverse().map(y =>
          `<option value="${y}"${y === _selectedYear ? ' selected' : ''}>${y}</option>`
        ).join('')}
      </select>
      <div style="width:1px;height:18px;background:#d1d5db;margin:0 0.25rem;flex-shrink:0;"></div>
      ${SECTION_NAV_ITEMS.map(s =>
        `<button class="section-tab" data-target="${s.id}">${s.label}</button>`
      ).join('')}
    </div>`;

  document.getElementById('year-dropdown').addEventListener('change', async e => {
    const year = parseInt(e.target.value);
    if (year === _selectedYear) return;
    _selectedYear = year;
    await loadYear(year);
  });

  // Section tab clicks
  root.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-target]');
    if (tabBtn) {
      const target = document.getElementById(tabBtn.dataset.target);
      if (!target) return;
      const offset = root.getBoundingClientRect().bottom + 8;
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
    }
  });

  // Highlight active section tab on scroll
  const onScroll = () => {
    const threshold = root.getBoundingClientRect().bottom + 32;
    let activeId = SECTION_NAV_ITEMS[0].id;
    for (const { id } of SECTION_NAV_ITEMS) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= threshold) activeId = id;
    }
    root.querySelectorAll('[data-target]').forEach(b =>
      b.classList.toggle('section-tab--active', b.dataset.target === activeId)
    );
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ---------------------------------------------------------------------------
// Roster toggle handlers (called via inline onclick — avoids listener stacking)
// ---------------------------------------------------------------------------

function _toggleH2H(rid) {
  const detail  = document.getElementById(`h2h-detail-${rid}`);
  const chevron = document.getElementById(`h2h-chevron-${rid}`);
  if (!detail) return;
  const opening = detail.style.display === 'none';
  detail.style.display  = opening ? '' : 'none';
  if (chevron) chevron.style.transform = opening ? 'rotate(90deg)' : '';
}

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

  // Show skeletons for dynamic sections while loading
  document.getElementById('schedule-container').innerHTML =
    `<div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(10, 4)}</tbody></table></div>`;
  document.getElementById('activity-container').innerHTML =
    `<div style="display:flex;flex-direction:column;gap:0.5rem;">
       ${Array.from({length: 5}, () =>
         `<div class="skeleton rounded-lg" style="height:64px;"></div>`).join('')}
     </div>`;
  document.getElementById('roster-container').innerHTML =
    `<div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(14, 4)}</tbody></table></div>`;

  // Serve from cache if available
  if (_yearCache[year]) {
    renderYearSections(year, _yearCache[year]);
    return;
  }

  try {
    const [
      { data: rosterRows,  error: er },
      { data: matchups,    error: em },
      { data: yearOwners,  error: eo },
      { data: myTxnRows,   error: et },
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
      window.db.from('transaction_players')
        .select('transaction_id,type,action,player_name,player_position,nfl_team,roster_id,week')
        .eq('roster_id', _rosterId)
        .eq('year', year)
        .order('transaction_id', { ascending: false }),
    ]);
    if (er || em || eo || et) throw er || em || eo || et;

    // Fetch ALL trade rows for this year (can't use .in() on Sleeper 64-bit IDs — they lose
    // precision as JS numbers). Filter in JS using string comparison instead.
    const myTradeIdStrs = new Set(
      (myTxnRows || []).filter(r => r.type === 'trade').map(r => String(r.transaction_id))
    );

    const [{ data: allYearTradeRows }, { data: txnMeta }] = await Promise.all([
      myTradeIdStrs.size
        ? window.db.from('transaction_players')
            .select('transaction_id,type,action,player_name,player_position,nfl_team,roster_id,week')
            .eq('year', year)
            .eq('type', 'trade')
        : Promise.resolve({ data: [] }),
      window.db.from('transactions')
        .select('transaction_id,status_updated')
        .eq('year', year),
    ]);

    // Filter to only trades this team was involved in, then grab the other side(s).
    const allTradeRows  = (allYearTradeRows || []).filter(r => myTradeIdStrs.has(String(r.transaction_id)));
    const otherSideRows = allTradeRows.filter(r => String(r.roster_id) !== String(_rosterId));
    const activityRows  = [...(myTxnRows || []), ...otherSideRows];
    const txnMetaMap   = new Map((txnMeta || []).map(t => [String(t.transaction_id), t.status_updated]));

    const latestWeek = rosterRows?.[0]?.week ?? null;
    const roster = latestWeek !== null
      ? rosterRows.filter(r => r.week === latestWeek)
      : [];

    const opponentMap = {};
    for (const o of (yearOwners || [])) opponentMap[o.roster_id] = o;

    // Pre-season: show prev year stats; otherwise show stats for the displayed year
    const statsYear = (year === CURRENT_YEAR && latestWeek === 0) ? CURRENT_YEAR - 1 : year;

    // Fetch acquisition history for current roster players
    const rosterPlayerIds = roster.map(r => r.player_id).filter(Boolean);
    let acquisitionMap = {};
    if (rosterPlayerIds.length) {
      const { data: txnRows } = await window.db.from('transaction_players')
        .select('player_id,year,week,type')
        .eq('roster_id', _rosterId)
        .eq('action', 'add')
        .in('player_id', rosterPlayerIds)
        .order('year', { ascending: false })
        .order('week', { ascending: false });

      // Keep the most recent add per player (rows are already sorted desc)
      for (const row of (txnRows || [])) {
        if (!acquisitionMap[row.player_id]) acquisitionMap[row.player_id] = row;
      }
    }
    // Fill in drafted players from _draftPicks (most recent draft entry wins)
    for (const dp of _draftPicks) {
      if (dp.player_id && !acquisitionMap[dp.player_id]) {
        acquisitionMap[dp.player_id] = { type: 'draft', year: dp.year, week: 0, round: dp.round, overall_pick: dp.overall_pick };
      }
    }

    _yearCache[year] = { roster, latestWeek, matchups: matchups || [], opponentMap, statsYear, acquisitionMap, activityRows, txnMetaMap };

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

function renderYearSections(year, { roster, latestWeek, matchups, opponentMap, statsYear, acquisitionMap, activityRows, txnMetaMap }) {
  const isCurrentYear = year === CURRENT_YEAR;

  // Schedule
  document.getElementById('schedule-label').textContent = `${year} Schedule`;
  if (!matchups.length && isCurrentYear) {
    document.getElementById('schedule-container').innerHTML =
      `<p class="text-slate-500 text-sm">Season hasn't started yet.</p>`;
  } else {
    renderSchedule(matchups, opponentMap, year);
  }

  // Activity
  renderActivity(activityRows || [], txnMetaMap || new Map(), opponentMap);

  // Roster
  renderRoster(roster, latestWeek, year, _playerDetails, _statsByYear[statsYear] || {}, statsYear, acquisitionMap || {});
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
  document.getElementById('section-nav-root').innerHTML =
    `<div class="page-container page-container--wide" style="display:flex;align-items:center;gap:0.5rem;padding:0.25rem 1rem;">
      <div class="skeleton" style="height:30px;width:80px;border-radius:6px;"></div>
      <div style="width:1px;height:18px;background:#d1d5db;flex-shrink:0;"></div>
      ${Array.from({length: 5}, () =>
        `<div class="skeleton" style="height:30px;width:68px;border-radius:6px;"></div>`
      ).join('')}
     </div>`;
  document.getElementById('schedule-container').innerHTML =
    `<div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(10, 4)}</tbody></table></div>`;
  document.getElementById('activity-container').innerHTML =
    `<div style="display:flex;flex-direction:column;gap:0.5rem;">
       ${Array.from({length: 5}, () =>
         `<div class="skeleton rounded-lg" style="height:64px;"></div>`).join('')}
     </div>`;
  document.getElementById('roster-container').innerHTML =
    `<div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(14, 4)}</tbody></table></div>`;
  document.getElementById('history-container').innerHTML =
    `<div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(7, 6)}</tbody></table></div>`;
  document.getElementById('h2h-container').innerHTML =
    `<div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(10, 7)}</tbody></table></div>`;
  document.getElementById('draft-container').innerHTML =
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
       <div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(5, 3)}</tbody></table></div>
       <div class="card overflow-hidden"><table class="data-table"><tbody>${skeletonRows(5, 4)}</tbody></table></div>
     </div>`;
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function renderHero(owner) {
  const currentStanding = _allStandings.find(s => s.year === CURRENT_YEAR);
  const divisionName = owner.division || currentStanding?.division || null;
  const divLower = (divisionName || '').toLowerCase();
  const divLogo = divLower.includes('east') ? 'images/east_logo.png'
                : divLower.includes('west') ? 'images/west_logo.png'
                : null;
  const divBadge = divLogo
    ? `<img src="${divLogo}" alt="${esc(divisionName)}" style="height:28px;width:auto;">`
    : divisionName
      ? `<span class="badge" style="background:rgba(1,28,69,0.08);color:#011C45;border:1px solid rgba(1,28,69,0.2);font-size:0.65rem;">${esc(divisionName)}</span>`
      : '';

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
  // Split this owner's all-time matchups into regular season vs playoffs
  let regW = 0, regL = 0, regT = 0, regPF = 0, regPA = 0, regG = 0;
  let postW = 0, postL = 0, postT = 0, postPF = 0, postPA = 0, postG = 0;
  for (const m of _allMatchups) {
    if (m.result === 'BYE') continue;
    if (m.game_type === 'regular') {
      if (m.result === 'W') regW++; else if (m.result === 'L') regL++; else regT++;
      regPF += m.points || 0; regPA += m.opponent_points || 0; regG++;
    } else {
      if (m.result === 'W') postW++; else if (m.result === 'L') postL++; else postT++;
      postPF += m.points || 0; postPA += m.opponent_points || 0; postG++;
    }
  }

  // Build per-team stats for active teams (reg-season and overall)
  const maxYear = Math.max(...Object.values(_allOpponents).map(o => o.year));
  const activeIds = new Set(
    Object.values(_allOpponents).filter(o => o.year === maxYear).map(o => o.roster_id)
  );
  const stats_reg = {}, stats_post = {};
  for (const m of _leagueMatchups) {
    if (!activeIds.has(m.roster_id)) continue;
    const b = m.game_type === 'regular' ? stats_reg : stats_post;
    if (!b[m.roster_id]) b[m.roster_id] = { w: 0, g: 0, pf: 0 };
    b[m.roster_id].w  += m.result === 'W' ? 1 : 0;
    b[m.roster_id].g  += 1;
    b[m.roster_id].pf += m.points || 0;
  }

  const rankAmong = (statMap, sortFn) => {
    const sorted = [...activeIds].sort((a, b) => sortFn(statMap[b]) - sortFn(statMap[a]));
    const pos = sorted.indexOf(_rosterId) + 1;
    return pos > 0 ? ordinal(pos) : '';
  };

  const winPctVal = s => s ? s.w / s.g : 0;
  const avgPFVal  = s => s ? s.pf / s.g : 0;

  const regRecordRank  = rankAmong(stats_reg,  winPctVal);
  const postRecordRank = rankAmong(stats_post, winPctVal);
  const regPFRank      = rankAmong(stats_reg,  avgPFVal);
  const postPFRank     = rankAmong(stats_post, avgPFVal);

  // Format values
  const regRecord  = regT  ? `${regW}-${regL}-${regT}`   : `${regW}-${regL}`;
  const postRecord = postT ? `${postW}-${postL}-${postT}` : `${postW}-${postL}`;
  const avgRegPF   = regG  ? formatPts(regPF  / regG)  : '—';
  const avgPostPF  = postG ? formatPts(postPF / postG) : '—';
  const avgRegPA   = regG  ? formatPts(regPA  / regG)  : '—';
  const avgPostPA  = postG ? formatPts(postPA / postG) : '—';

  const championships    = _allStandings.filter(s => s.champion).length;
  const completedSeasons = _allStandings.filter(s => s.year < CURRENT_YEAR);
  const playoffApps      = completedSeasons.filter(s => s.made_playoffs).length;
  const totalWins        = _allStandings.reduce((sum, s) => sum + s.wins, 0);
  const totalGames       = _allStandings.reduce((sum, s) => sum + s.wins + s.losses + (s.ties || 0), 0);
  const allTimePct       = totalGames > 0
    ? ((totalWins / totalGames) * 100).toFixed(1) + '%' : '—';

  const stats = [
    {
      label: 'Record',
      value: `${regRecord}<span style="font-size:0.95rem;font-weight:700;color:#94a3b8;margin-left:6px;">(${postRecord})</span>`,
      sub:   `${regRecordRank} reg &bull; ${postRecordRank} playoffs`,
    },
    {
      label: 'Avg Score',
      value: `${avgRegPF}<span style="font-size:0.95rem;font-weight:700;color:#94a3b8;margin-left:6px;">(${avgPostPF})</span>`,
      sub:   `${regPFRank} reg &bull; ${postPFRank} playoffs`,
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
      sub:   `of ${completedSeasons.length} seasons`,
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
          <div style="font-family:'Roboto Condensed',sans-serif;font-weight:900;font-size:1.5rem;letter-spacing:0.04em;color:#0D0F11;line-height:1.1;display:flex;align-items:baseline;flex-wrap:wrap;">${s.value}</div>
          <div style="font-size:0.7rem;color:#94a3b8;margin-top:2px;">${s.sub}</div>
        </div>`).join('')}
    </div>`;
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

function renderActivity(txnRows, txnMetaMap, opponentMap) {
  const el = document.getElementById('activity-container');

  if (!txnRows?.length) {
    el.innerHTML = `<p class="text-slate-500 text-sm">No transactions this season.</p>`;
    return;
  }

  // Group rows by transaction_id
  const txnMap = new Map();
  for (const row of txnRows) {
    const key = String(row.transaction_id);
    if (!txnMap.has(key)) txnMap.set(key, { transaction_id: row.transaction_id, type: row.type, sides: new Map() });
    const txn = txnMap.get(key);
    if (!txn.sides.has(row.roster_id)) txn.sides.set(row.roster_id, { roster_id: row.roster_id, adds: [], drops: [] });
    const side = txn.sides.get(row.roster_id);
    (row.action === 'add' ? side.adds : side.drops).push(row);
  }

  const sorted = [...txnMap.values()].sort((a, b) => b.transaction_id - a.transaction_id);

  const fmtDate = isoStr => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const month = d.toLocaleString('en-US', { month: 'short' });
    const time  = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${month} ${d.getDate()}, ${d.getFullYear()} · ${time}`;
  };

  const assetLine = row =>
    `<div style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;color:#0D0F11;white-space:nowrap;">
       ${positionBadge(row.player_position)} ${esc(row.player_name)} ${nflTeamLogo(row.nfl_team)}
     </div>`;

  const items = sorted.map(txn => {
    const isTrade = txn.type === 'trade';
    const dateStr = fmtDate(txnMetaMap.get(String(txn.transaction_id)) ?? txnMetaMap.get(txn.transaction_id));
    const sides   = [...txn.sides.values()];

    let headerHtml, bodyHtml;

    if (isTrade) {
      headerHtml = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.6rem;">
          <span style="font-size:0.8rem;font-weight:700;color:#ef4444;">A trade has been completed!</span>
          <span style="font-size:0.7rem;color:#94a3b8;">${dateStr}</span>
        </div>`;
      bodyHtml = sides.map(side => {
        const owner = opponentMap[side.roster_id] || { display_name: `Team ${side.roster_id}`, avatar: null };
        return `
          <div style="margin-bottom:0.5rem;">
            <div style="font-size:0.75rem;font-weight:600;color:#0D0F11;margin-bottom:0.2rem;display:flex;align-items:center;gap:0.4rem;">
              ${avatarImg(owner.avatar, owner.display_name, 20)}
              <img src="images/trade_light_gray.png" alt="trade" style="width:18px;height:auto;flex-shrink:0;">
              <a href="team.html?roster_id=${side.roster_id}" class="team-link">${esc(owner.display_name)}</a> receives:
            </div>
            <div style="display:flex;flex-direction:column;gap:0.15rem;padding-left:0.5rem;">
              ${side.adds.map(assetLine).join('') || '<div style="font-size:0.8rem;color:#94a3b8;">—</div>'}
            </div>
          </div>`;
      }).join('');

    } else {
      const side      = sides[0];
      const owner     = opponentMap[side?.roster_id] || { display_name: `Team ${side?.roster_id}`, avatar: null };
      const typeLabel = txn.type === 'waiver' ? 'Waiver' : 'Free Agent';
      const typeColor = txn.type === 'waiver' ? '#10b981' : '#0ea5e9';
      headerHtml = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.4rem;">
          <span style="font-size:0.8rem;font-weight:400;color:#0D0F11;display:inline-flex;align-items:center;gap:0.4rem;">
            ${avatarImg(owner.avatar, owner.display_name, 20)}
            <a href="team.html?roster_id=${side?.roster_id}" class="team-link" style="font-weight:700;">${esc(owner.display_name)}</a>
            has made a <span style="color:${typeColor};">${typeLabel}</span> move:
          </span>
          <span style="font-size:0.7rem;color:#94a3b8;">${dateStr}</span>
        </div>`;
      bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:0.15rem;">
          ${(side?.adds  || []).map(r => `<div style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;color:#0D0F11;white-space:nowrap;"><span style="font-size:1rem;font-weight:900;color:#10b981;line-height:1;">+</span>${positionBadge(r.player_position)} ${esc(r.player_name)} ${nflTeamLogo(r.nfl_team)}</div>`).join('')}
          ${(side?.drops || []).map(r => `<div style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;color:#0D0F11;white-space:nowrap;"><span style="font-size:1rem;font-weight:900;color:#ef4444;line-height:1;">−</span>${positionBadge(r.player_position)} ${esc(r.player_name)} ${nflTeamLogo(r.nfl_team)}</div>`).join('')}
        </div>`;
    }

    return `<div class="card p-3">${headerHtml}${bodyHtml}</div>`;
  }).join('');

  el.innerHTML = `
    <div style="max-height:520px;overflow-y:auto;display:flex;flex-direction:column;gap:0.5rem;padding-right:2px;">
      ${items}
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

  const hardCap    = year === 2020 ? 16 : 17;
  const fifthPlace = matchups.find(m => m.game_type === 'fifth_place');
  const maxWeek    = !madePlayoffs  ? regularSeasonEnd
    : fifthPlace                    ? fifthPlace.week
    :                                 hardCap;

  const visible       = matchups.filter(m => m.week <= maxWeek);
  const regularRows   = visible.filter(m => m.game_type === 'regular' || m.result === 'BYE').map(buildRow).join('');
  const playoffRows   = visible.filter(m => m.game_type !== 'regular' && m.result !== 'BYE').map(buildRow).join('');

  const playoffDivider = madePlayoffs && playoffRows ? `
    <tr>
      <td colspan="4" style="padding:0.3rem 1rem;background:#f8f5ff;border-top:2px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
        <span style="font-size:0.6rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#a855f7;">Playoffs</span>
      </td>
    </tr>` : '';

  el.innerHTML = `
    <div class="card overflow-hidden" style="overflow-x:auto;">
      <table class="data-table">
        ${thead}
        <tbody>${regularRows}${playoffDivider}${playoffRows}</tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

const ACQ_BADGE_COLORS = {
  trade:      { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.35)', text: '#a855f7' },
  waiver:     { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', text: '#10b981' },
  free_agent: { bg: 'rgba(14,165,233,0.12)', border: 'rgba(14,165,233,0.35)', text: '#0ea5e9' },
  draft:      { bg: 'rgba(234,179,8,0.12)',  border: 'rgba(234,179,8,0.35)',  text: '#ca8a04' },
};

function fmtAcquisition(info, displayYear) {
  if (!info) return null;
  if (info.type === 'draft') {
    const numTeamsY = Object.keys(_allTeamStandings[info.year] || {}).length || 14;
    const pickInRound = ((info.overall_pick - 1) % numTeamsY) + 1;
    const pickLabel = `${info.round}.${String(pickInRound).padStart(2, '0')}`;
    return { badge: 'Draft', detail: `${pickLabel} '${String(info.year).slice(2)}`, type: 'draft' };
  }
  const typeStr = info.type === 'trade' ? 'Trade' : info.type === 'waiver' ? 'Waiver' : 'FA';
  const weekStr = info.week === 0 ? 'Off-Season' : `Wk ${info.week}`;
  const yearStr = info.year !== displayYear ? ` '${String(info.year).slice(2)}` : '';
  return { badge: typeStr, detail: `${weekStr}${yearStr}`.trim(), type: info.type };
}

function renderRoster(players, week, displayYear, playerDetails, stats, statsYear, acquisitionMap) {
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
  const SW = 'width:52px;text-align:center;'; // equal stat column width
  const theadCols = _rosterExpanded
    ? `<th>Player</th><th>Team</th><th style="${SW}">Age</th><th style="${SW}"></th><th style="${SW}" title="${statsYear} Total Pts">Pts</th><th style="${SW}" title="${statsYear} Avg / Rank">Avg&nbsp;&bull;&nbsp;Rank</th>`
    : `<th>Player</th><th>Team</th><th style="${SW}">Age</th><th style="${SW}"></th><th style="${SW}" title="${statsYear} Rank">Rank</th>`;

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

      const acq = fmtAcquisition(acquisitionMap?.[p.player_id], displayYear);
      const acqColors = acq ? (ACQ_BADGE_COLORS[acq.type] || ACQ_BADGE_COLORS.free_agent) : null;
      const acqHtml = acq
        ? `<span title="${esc(acq.detail)}" style="font-size:0.6rem;font-weight:700;letter-spacing:0.04em;color:${acqColors.text};background:${acqColors.bg};border:1px solid ${acqColors.border};border-radius:4px;padding:1px 5px;cursor:default;white-space:nowrap;">${esc(acq.badge)}</span>`
        : '';

      const statCell = _rosterExpanded ? `
        <td style="font-family:monospace;font-size:0.8rem;color:${pStats ? '#0D0F11' : '#94a3b8'};padding:0.5rem 0.25rem;text-align:center;">
          ${pStats ? formatPts(pStats.total_pts) : '—'}
        </td>
        <td style="padding:0.5rem 0.25rem;text-align:center;">
          <div style="display:inline-flex;align-items:center;flex-wrap:nowrap;gap:2px;">
            <span style="font-family:monospace;font-size:0.8rem;color:${pStats ? '#374151' : '#94a3b8'};">${pStats ? formatPts(pStats.avg_pts) : '—'}</span>
            ${pStats?.pos_rank ? `<span style="font-size:0.65rem;font-weight:700;color:#6366f1;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:4px;padding:1px 5px;">${p.mapped_position}${pStats.pos_rank}</span>` : ''}
            ${acqHtml}
          </div>
        </td>` : `
        <td style="padding:0.5rem 0.25rem;text-align:center;">
          <div style="display:inline-flex;align-items:center;flex-wrap:nowrap;gap:2px;">
            ${pStats?.pos_rank ? `<span style="font-size:0.65rem;font-weight:700;color:#6366f1;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:4px;padding:2px 7px;">${p.mapped_position}${pStats.pos_rank}</span>` : `<span style="color:#d1d5db;">—</span>`}
            ${acqHtml}
          </div>
        </td>`;

      return `
        <tr>
          <td style="padding:0.5rem 1rem;">
            <span style="font-size:0.85rem;font-weight:${dimmed ? '400' : '700'};color:#0D0F11;">${esc(p.player_name)}</span>
          </td>
          <td style="padding:0.5rem 0.5rem;">${teamCell}</td>
          <td style="padding:0.5rem 0.25rem;text-align:center;">${ageCell}</td>
          <td style="padding:0.5rem 0.25rem;text-align:center;">${slotPill(p.lineup_slot)}</td>
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

// ---------------------------------------------------------------------------
// Head-to-Head Records
// ---------------------------------------------------------------------------

function renderH2H() {
  const el = document.getElementById('h2h-container');

  // Aggregate W-L-T, PF, PA per opponent — split by regular vs. playoff
  // Only count games where the opponent's current user actually owned the team that year
  const records = {};
  for (const m of _allMatchups) {
    if (m.result === 'BYE' || !m.opponent_roster_id) continue;
    const rid = m.opponent_roster_id;
    if (_opponentOwnedYears[rid] && !_opponentOwnedYears[rid].has(m.year)) continue;
    if (!records[rid]) records[rid] = {
      reg:    { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 },
      post:   { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 },
      games:  [],
    };
    const bucket = m.game_type === 'regular' ? records[rid].reg : records[rid].post;
    if      (m.result === 'W') bucket.wins++;
    else if (m.result === 'L') bucket.losses++;
    else if (m.result === 'T') bucket.ties++;
    bucket.pf += m.points          || 0;
    bucket.pa += m.opponent_points || 0;
    records[rid].games.push(m);
  }

  const entries = Object.entries(records);
  if (!entries.length) {
    el.innerHTML = `<p class="text-slate-500 text-sm">No matchup data available.</p>`;
    return;
  }

  const totalGames = r => r.wins + r.losses + r.ties;

  entries.sort(([, a], [, b]) =>
    (totalGames(b.reg) + totalGames(b.post)) - (totalGames(a.reg) + totalGames(a.post))
  );

  const fmtRecord = r => {
    const g = totalGames(r);
    if (!g) return `<span style="color:#d1d5db;">—</span>`;
    const color = r.wins > r.losses ? '#10b981' : r.wins < r.losses ? '#ef4444' : '#94a3b8';
    const str   = r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
    return `<span style="font-family:'Roboto Condensed',sans-serif;font-weight:800;font-size:1rem;color:${color};">${str}</span>`;
  };

  const GAME_TYPE_META = {
    regular:      { label: 'Regular Season', color: '#6b7280' },
    wildcard:     { label: 'Wildcard',        color: '#a855f7' },
    divisional:   { label: 'Divisional',      color: '#a855f7' },
    championship: { label: 'Championship',    color: '#eab308' },
    third_place:  { label: '3rd Place',       color: '#f97316' },
    fifth_place:  { label: '5th Place',       color: '#f97316' },
    consolation:  { label: 'Consolation',     color: '#94a3b8' },
  };

  const seasonRecordStr = (year, rosterId) => {
    const s = (_allTeamStandings[year] || {})[rosterId];
    if (!s) return '—';
    return s.ties ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
  };

  const chevronSvg = `<svg id="h2h-chevron-RIDTOKEN" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.15s;flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>`;

  const rows = entries.map(([ridStr, r]) => {
    const rid    = parseInt(ridStr);
    const opp    = _allOpponents[rid] || { display_name: `Team ${rid}`, avatar: null };
    const allW   = r.reg.wins   + r.post.wins;
    const allL   = r.reg.losses + r.post.losses;
    const allT   = r.reg.ties   + r.post.ties;
    const allG   = allW + allL + allT;
    const allPF  = r.reg.pf + r.post.pf;
    const allPA  = r.reg.pa + r.post.pa;
    const winPct = allG ? (allW / allG * 100).toFixed(1) : '0.0';
    const avgPF  = allG ? formatPts(allPF / allG) : '—';
    const avgPA  = allG ? formatPts(allPA / allG) : '—';
    const diff   = allPF - allPA;

    // Individual games sorted: year desc, week asc
    const games = [...r.games].sort((a, b) => b.year - a.year || b.week - a.week);

    const gameRows = games.map(m => {
      const resultColor = m.result === 'W' ? '#10b981' : m.result === 'L' ? '#ef4444' : '#94a3b8';
      const meta        = GAME_TYPE_META[m.game_type] || { label: m.game_type, color: '#94a3b8' };
      const myRec       = seasonRecordStr(m.year, _rosterId);
      const oppRec      = seasonRecordStr(m.year, rid);
      return `
        <tr style="background:#f9fafb;">
          <td class="font-mono text-sm text-slate-500" style="padding-left:2.5rem;">Wk ${m.week}</td>
          <td class="font-mono text-sm text-slate-500">${m.year}</td>
          <td><span style="font-weight:800;font-size:0.85rem;color:${resultColor};">${m.result}</span></td>
          <td class="font-mono text-sm">
            <span style="font-weight:700;">${formatPts(m.points)}</span>
            <span style="color:#94a3b8;margin:0 3px;">–</span>
            <span style="color:#94a3b8;">${formatPts(m.opponent_points)}</span>
          </td>
          <td><span style="font-size:0.65rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${meta.color};background:${meta.color}1a;border:1px solid ${meta.color}40;border-radius:99px;padding:1px 7px;">${meta.label}</span></td>
          <td class="font-mono text-sm hidden md:table-cell">${myRec}</td>
          <td class="font-mono text-sm hidden md:table-cell text-slate-400">${oppRec}</td>
        </tr>`;
    }).join('');

    const detailRow = `
      <tr id="h2h-detail-${rid}" style="display:none;">
        <td colspan="7" style="padding:0;border-bottom:2px solid #e5e7eb;">
          <table class="data-table" style="width:100%;">
            <thead style="background:#f1f5f9;">
              <tr>
                <th style="padding-left:2.5rem;">Wk</th>
                <th>Season</th>
                <th>Result</th>
                <th>Score</th>
                <th>Type</th>
                <th class="hidden md:table-cell">Our Record</th>
                <th class="hidden md:table-cell">Their Record</th>
              </tr>
            </thead>
            <tbody>${gameRows}</tbody>
          </table>
        </td>
      </tr>`;

    const mainRow = `
      <tr style="cursor:pointer;" onclick="_toggleH2H(${rid})">
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="color:#6366f1;">${chevronSvg.replace('RIDTOKEN', rid)}</span>
            <a href="team.html?roster_id=${rid}" onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit;">
              ${avatarImg(opp.avatar, opp.display_name, 26)}
              <span style="font-size:0.85rem;font-weight:600;color:#0D0F11;">${esc(opp.display_name)}</span>
            </a>
          </div>
        </td>
        <td>${fmtRecord(r.reg)}</td>
        <td>${fmtRecord(r.post)}</td>
        <td class="font-mono text-sm">${winPct}%</td>
        <td class="font-mono text-sm hidden md:table-cell">${avgPF}</td>
        <td class="font-mono text-sm hidden md:table-cell text-slate-400">${avgPA}</td>
        <td class="font-mono text-sm hidden md:table-cell ${diffClass(diff)}">${diffLabel(diff)}</td>
      </tr>`;

    return mainRow + detailRow;
  }).join('');

  el.innerHTML = `
    <div class="card overflow-x-auto">
      <table class="data-table">
        <thead><tr>
          <th>Opponent</th>
          <th>Reg Season</th>
          <th>Playoffs</th>
          <th>Win%</th>
          <th class="hidden md:table-cell">Avg PF</th>
          <th class="hidden md:table-cell">Avg PA</th>
          <th class="hidden md:table-cell">+/-</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// Draft Picks
// ---------------------------------------------------------------------------

function renderDraftPicks() {
  const el = document.getElementById('draft-container');

  // ── Current picks owned ─────────────────────────────────────────────────
  // For each future/current pick_season, figure out which rounds this team owns.
  // Own picks (never traded away) + acquired picks from other teams.

  // Group traded_picks by pick_season
  const tradedBySeason = {};
  for (const p of _tradedPicks) {
    if (!tradedBySeason[p.pick_season]) tradedBySeason[p.pick_season] = [];
    tradedBySeason[p.pick_season].push(p);
  }

  // Derive effective round count: draft_metadata may be stale or missing,
  // so use the highest round seen in any traded pick as a floor.
  const maxRoundInLeague = _tradedPicks.length
    ? Math.max(..._tradedPicks.map(p => p.round))
    : 7;
  const numRounds = Math.max(_draftRounds, maxRoundInLeague);

  // Always show the current year (if undrafted) plus the next 2 seasons.
  // Don't rely on traded_picks data to determine which seasons to display —
  // every team owns all their own picks until traded away.
  const hasCurrentYearDraft = _draftPicks.some(p => p.year === CURRENT_YEAR);
  const startSeason = hasCurrentYearDraft ? CURRENT_YEAR + 1 : CURRENT_YEAR;
  const futureSeasons = [startSeason, startSeason + 1, startSeason + 2];

  // For each future season, build a list of picks this team owns
  const currentPicksHtml = futureSeasons.map(season => {
    const picksThisSeason = tradedBySeason[season] || [];

    // roster_id = original owner, original_owner_id = current holder (Sleeper convention)
    // Own picks traded away: this team is original owner, someone else currently holds it
    const tradedAwayRounds = new Set(
      picksThisSeason
        .filter(p => p.roster_id === _rosterId && p.original_owner_id !== _rosterId)
        .map(p => p.round)
    );

    // Acquired picks: someone else is original owner, this team currently holds it
    const acquired = picksThisSeason.filter(
      p => p.original_owner_id === _rosterId && p.roster_id !== _rosterId
    );

    // Draft slot: use (season-1) overall_rank → worst team = slot 1, best = slot N
    const prevStandings = _allTeamStandings[season - 1] || {};
    const numTeams = Object.keys(prevStandings).length || 14; // 14-team league
    const slotFor = rid => {
      const s = prevStandings[rid];
      if (!s || !s.overall_rank) return null;
      return numTeams + 1 - s.overall_rank; // rank 1 (best) picks last
    };
    const fmtPick = (round, rid) => {
      if (season > CURRENT_YEAR) return `Rd ${round}`;
      const slot = slotFor(rid);
      return slot ? `${round}.${String(slot).padStart(2, '0')}` : `Rd ${round}`;
    };

    const ownRounds = [];
    for (let r = 1; r <= numRounds; r++) {
      if (!tradedAwayRounds.has(r)) ownRounds.push(r);
    }

    const pickRows = [];

    // Own picks
    for (const r of ownRounds) {
      pickRows.push({ round: r, pickLabel: fmtPick(r, _rosterId), acquired: false });
    }

    // Acquired from others (roster_id = original owner)
    for (const p of acquired) {
      const originalOwner = _allOpponents[p.roster_id];
      const fromName = originalOwner ? originalOwner.display_name : `Team ${p.roster_id}`;
      const fromRid  = p.roster_id;
      pickRows.push({ round: p.round, pickLabel: fmtPick(p.round, p.roster_id), acquired: true, fromName, fromRid });
    }

    // Sort by round
    pickRows.sort((a, b) => a.round - b.round);

    if (!pickRows.length) return '';

    const rows = pickRows.map(p => {
      const roundCell = `<span style="font-size:0.8rem;font-weight:700;color:#0D0F11;">${p.pickLabel}</span>`;
      const fromCell = p.acquired
        ? `<span style="font-size:0.75rem;color:#6b7280;">via <a href="team.html?roster_id=${p.fromRid}" class="team-link" style="color:#6366f1;">${esc(p.fromName)}</a></span>`
        : `<span style="font-size:0.75rem;color:#94a3b8;">Own pick</span>`;
      return `<tr><td style="padding:0.4rem 1rem;">${roundCell}</td><td style="padding:0.4rem 0.5rem;">${fromCell}</td></tr>`;
    }).join('');

    return `
      <div style="margin-bottom:1rem;">
        <div style="font-size:0.65rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#6b7280;padding:0.35rem 1rem;background:#f9fafb;border-bottom:1px solid #e5e7eb;">${season} Draft</div>
        <table class="data-table" style="width:100%;">
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).filter(Boolean).join('');

  // ── Past draft history ───────────────────────────────────────────────────
  // _draftPicks is already filtered to ownedYears, ordered by year asc, round asc, overall_pick asc
  // Exclude 2020 (startup draft — not meaningful to display)
  const pastYears = [...new Set(_draftPicks.map(p => p.year))].filter(y => y !== 2020).sort((a, b) => b - a);

  const pastHtml = pastYears.map(year => {
    const yearPicks = _draftPicks.filter(p => p.year === year);
    const numTeamsY = Object.keys(_allTeamStandings[year] || {}).length || 14; // 14-team league

    const rows = yearPicks.map(p => {
      const pickInRound = ((p.overall_pick - 1) % numTeamsY) + 1;
      const pickLabel = `${p.round}.${String(pickInRound).padStart(2, '0')}`;
      const keeperBadge = p.is_keeper
        ? `<span style="font-size:0.6rem;font-weight:700;color:#eab308;background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:99px;padding:1px 6px;margin-left:4px;">Keeper</span>`
        : '';
      const posBadge = positionBadge(p.position);
      const teamLogo = p.nfl_team ? nflTeamLogo(p.nfl_team, 16) : '';
      return `
        <tr>
          <td style="padding:0.4rem 0.5rem;font-size:0.75rem;font-weight:700;color:#6b7280;white-space:nowrap;">
            ${pickLabel}
          </td>
          <td style="padding:0.4rem 0.5rem;">${posBadge}</td>
          <td style="padding:0.4rem 0.5rem;">
            <span style="font-size:0.85rem;font-weight:600;color:#0D0F11;">${esc(p.player_name || '—')}</span>${keeperBadge}
          </td>
          <td style="padding:0.4rem 0.5rem;">${teamLogo}</td>
        </tr>`;
    }).join('');

    return `
      <div style="margin-bottom:1rem;">
        <div style="font-size:0.65rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#6b7280;padding:0.35rem 1rem;background:#f9fafb;border-bottom:1px solid #e5e7eb;">${year} Draft</div>
        <table class="data-table" style="width:100%;">
          <thead>
            <tr>
              <th>Pick</th><th>Pos</th><th>Player</th><th>Team</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  const noCurrentPicks = !currentPicksHtml;
  const noPastPicks    = !pastHtml;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;align-items:start;">
      <div>
        <p style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;margin-bottom:0.75rem;">Current Picks Owned</p>
        <div class="card overflow-hidden">
          ${noCurrentPicks
            ? `<p class="text-slate-500 text-sm" style="padding:1rem;">No future picks on record.</p>`
            : currentPicksHtml}
        </div>
      </div>
      <div>
        <p style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;margin-bottom:0.75rem;">Draft History</p>
        <div class="card overflow-hidden">
          ${noPastPicks
            ? `<p class="text-slate-500 text-sm" style="padding:1rem;">No draft history available.</p>`
            : pastHtml}
        </div>
      </div>
    </div>`;
}

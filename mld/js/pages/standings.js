let selectedYear   = CURRENT_YEAR;
let allStandings   = null; // cached for historical grid
let allOwners      = null;
let isExpanded     = false;
let cachedRows     = null;
let cachedOwnerMap = null;
let cachedYear     = null;
let cachedPlayoffs = true;

document.addEventListener('DOMContentLoaded', async () => {
  renderNav('standings');

  // Year from query param if present
  const paramYear = parseInt(getQueryParam('year'));
  if (SEASONS.includes(paramYear)) selectedYear = paramYear;

  renderYearSelector();

  // Kick off both fetches in parallel
  await Promise.all([
    loadStandingsForYear(selectedYear),
    loadAllForHistoricalGrid(),
  ]);
});

// ---------------------------------------------------------------------------
// Year selector
// ---------------------------------------------------------------------------

function renderYearSelector() {
  const el = document.getElementById('year-selector');
  el.innerHTML = SEASONS.map(y => `
    <button class="year-pill${y === selectedYear ? ' year-pill--active' : ''}"
            data-year="${y}">${y}</button>
  `).join('');

  el.addEventListener('click', async e => {
    const btn = e.target.closest('[data-year]');
    if (!btn) return;
    selectedYear = parseInt(btn.dataset.year);

    // Update active pill
    el.querySelectorAll('.year-pill').forEach(b =>
      b.classList.toggle('year-pill--active', parseInt(b.dataset.year) === selectedYear));

    // Update URL without reload
    history.replaceState(null, '', `?year=${selectedYear}`);

    await loadStandingsForYear(selectedYear);
  });
}

// ---------------------------------------------------------------------------
// Season standings table
// ---------------------------------------------------------------------------

async function loadStandingsForYear(year) {
  const container = document.getElementById('standings-container');
  container.innerHTML = `
    <div class="card overflow-hidden">
      <table class="data-table">
        <thead><tr>
          <th style="width:40px">#</th><th>Team</th><th>W-L</th>
          <th class="hidden md:table-cell">Win%</th><th>PF</th>
          <th class="hidden md:table-cell">PA</th><th class="hidden md:table-cell">+/-</th>
          <th>Status</th>
        </tr></thead>
        <tbody>${skeletonRows(14, 8)}</tbody>
      </table>
    </div>`;

  try {
    const [{ data: rows, error: e1 }, { data: owners, error: e2 }, { data: weekRows, error: e3 }] = await Promise.all([
      window.db.from('standings').select('*').eq('year', year).order('overall_rank'),
      window.db.from('owners').select('year,roster_id,display_name,team_name,avatar,division').eq('year', year),
      window.db.from('matchups').select('week').eq('year', year).gt('points', 0).order('week', {ascending: false}).limit(1),
    ]);
    if (e1 || e2 || e3) throw e1 || e2 || e3;

    const currentWeek      = weekRows?.[0]?.week ?? 0;
    const playoffStartWeek = year <= 2020 ? 14 : 15;
    const playoffsStarted  = currentWeek >= playoffStartWeek;

    const ownerMap = buildOwnerMap(owners);
    cachedRows     = rows;
    cachedOwnerMap = ownerMap;
    cachedYear     = year;
    cachedPlayoffs = playoffsStarted;
    renderStandingsBody(rows, ownerMap, year, playoffsStarted);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="text-red-400 text-sm px-4 py-8">Failed to load standings.</p>`;
  }
}

function standingsRow(s, owner, rank, playoffsStarted = true) {
  const winPct = s.wins + s.losses + (s.ties || 0) > 0
    ? ((s.wins + (s.ties || 0) * 0.5) / (s.wins + s.losses + (s.ties || 0))).toFixed(3).replace(/^0/, '')
    : '.000';
  const diff = (s.points_for || 0) - (s.points_against || 0);

  const badges = [];
  if (s.champion)                                                    badges.push(`<span class="badge badge-champion">&#127942; Champ</span>`);
  if (s.runner_up)                                                   badges.push(`<span class="badge badge-runnerup">&#129352; Runner-up</span>`);
  if (s.div_champ)                                                   badges.push(divChampBadge(s.division || owner.division));
  if (s.made_playoffs && !s.champion && !s.runner_up && playoffsStarted) badges.push(`<span class="badge badge-playoffs">Playoffs</span>`);

  return `
    <tr>
      <td class="text-slate-500 font-mono text-sm">${rank}</td>
      <td>
        <a href="team.html?roster_id=${s.roster_id}" class="team-link flex items-center gap-2">
          ${avatarImg(owner.avatar, owner.display_name, 32)}
          <div class="min-w-0">
            <div class="font-semibold truncate-name" style="color:#0D0F11;">${esc(owner.team_name || owner.display_name)}</div>
            <div class="text-xs text-slate-500 truncate-name">${esc(owner.display_name)}</div>
          </div>
        </a>
      </td>
      <td class="font-semibold">${formatRecord(s.wins, s.losses, s.ties)}</td>
      <td class="hidden md:table-cell text-slate-400 font-mono text-sm">${winPct}</td>
      <td class="font-mono text-sm">${formatPts(s.points_for)}</td>
      <td class="hidden md:table-cell font-mono text-sm text-slate-400">${formatPts(s.points_against)}</td>
      <td class="hidden md:table-cell font-mono text-sm ${diffClass(diff)}">${diffLabel(diff)}</td>
      <td><div class="flex flex-wrap gap-1">${badges.join('') || '<span class="text-slate-600 text-xs">—</span>'}</div></td>
    </tr>`;
}

function divisionTable(divName, rows, ownerMap, year, playoffsStarted = true) {
  const thead = `
    <thead><tr>
      <th style="width:40px">#</th><th>Team</th><th>W-L</th><th>PF</th><th>Status</th>
    </tr></thead>`;
  const tbody = rows.map((s, i) => {
    const owner = getOwner(ownerMap, year, s.roster_id);
    const badges = [];
    if (s.champion)                                                          badges.push(`<span class="badge badge-champion">&#127942; Champ</span>`);
    if (s.runner_up)                                                         badges.push(`<span class="badge badge-runnerup">&#129352; Runner-up</span>`);
    if (s.div_champ)                                                         badges.push(divChampBadge(divName));
    if (s.made_playoffs && !s.champion && !s.runner_up && playoffsStarted)  badges.push(`<span class="badge badge-playoffs">Playoffs</span>`);
    const cutoffStyle = i === 1 ? 'border-bottom:2px solid #10b981;' : '';
    return `
      <tr style="${cutoffStyle}">
        <td class="text-slate-500 font-mono text-sm">${s.division_rank ?? i + 1}</td>
        <td>
          <a href="team.html?roster_id=${s.roster_id}" class="team-link flex items-center gap-2">
            ${avatarImg(owner.avatar, owner.display_name, 32)}
            <div class="min-w-0">
              <div class="font-semibold truncate-name" style="color:#0D0F11;">${esc(owner.team_name || owner.display_name)}</div>
              <div class="text-xs text-slate-500 truncate-name">${esc(owner.display_name)}</div>
            </div>
          </a>
        </td>
        <td class="font-semibold">${formatRecord(s.wins, s.losses, s.ties)}</td>
        <td class="font-mono text-sm">${formatPts(s.points_for)}</td>
        <td><div class="flex flex-wrap gap-1">${badges.join('') || '<span class="text-slate-600 text-xs">—</span>'}</div></td>
      </tr>`;
  }).join('');
  return `
    <div>
      <p class="section-label">${esc(divName)}</p>
      <div class="card overflow-hidden">
        <table class="data-table">${thead}<tbody>${tbody}</tbody></table>
      </div>
    </div>`;
}

function wildcardTableHtml(rows, ownerMap, year, playoffsStarted) {
  const thead = `
    <thead><tr>
      <th style="width:40px">#</th><th>Team</th><th>W-L</th><th>PF</th><th>Status</th>
    </tr></thead>`;
  const tbody = rows.map((s, i) => {
    const owner = getOwner(ownerMap, year, s.roster_id);
    const cutoffStyle = i === 1 ? 'border-bottom:2px solid #10b981;' : '';
    const badges = [];
    if (s.champion)                                                          badges.push(`<span class="badge badge-champion">&#127942; Champ</span>`);
    if (s.runner_up)                                                         badges.push(`<span class="badge badge-runnerup">&#129352; Runner-up</span>`);
    if (s.made_playoffs && !s.champion && !s.runner_up && playoffsStarted)  badges.push(`<span class="badge badge-playoffs">Playoffs</span>`);
    return `
      <tr style="${cutoffStyle}">
        <td class="text-slate-500 font-mono text-sm">${i + 1}</td>
        <td>
          <a href="team.html?roster_id=${s.roster_id}" class="team-link flex items-center gap-2">
            ${avatarImg(owner.avatar, owner.display_name, 32)}
            <div class="min-w-0">
              <div class="font-semibold truncate-name" style="color:#0D0F11;">${esc(owner.team_name || owner.display_name)}</div>
              <div class="text-xs text-slate-500 truncate-name">${esc(owner.display_name)}</div>
            </div>
          </a>
        </td>
        <td class="font-semibold">${formatRecord(s.wins, s.losses, s.ties)}</td>
        <td class="font-mono text-sm">${formatPts(s.points_for)}</td>
        <td><div class="flex flex-wrap gap-1">${badges.join('') || '<span class="text-slate-600 text-xs">—</span>'}</div></td>
      </tr>`;
  }).join('');
  return `
    <div style="margin-top:1.5rem;">
      <p class="section-label">Wildcard Race</p>
      <div class="card overflow-hidden">
        <table class="data-table">${thead}<tbody>${tbody}</tbody></table>
      </div>
    </div>`;
}

function renderStandingsBody(rows, ownerMap, year, playoffsStarted = true) {
  const container = document.getElementById('standings-container');
  if (!rows?.length) {
    container.innerHTML = `<p class="text-slate-500 text-sm">No data for ${year}.</p>`;
    return;
  }

  // Group by division
  const divisions = {};
  for (const s of rows) {
    const owner = getOwner(ownerMap, year, s.roster_id);
    const div = s.division || owner.division || 'League';
    if (!divisions[div]) divisions[div] = [];
    divisions[div].push(s);
  }

  const divNames = Object.keys(divisions).sort();
  const hasDivisions = divNames.length > 1;

  const fullTheadCols = `
    <th style="width:40px">#</th><th>Team</th><th>W-L</th>
    <th class="hidden md:table-cell">Win%</th><th>PF</th>
    <th class="hidden md:table-cell">PA</th><th class="hidden md:table-cell">+/-</th>
    <th>Status</th>`;

  // Single table (no divisions, or expanded mode)
  const singleTable = (teamRows, rankFn) => {
    const body = teamRows.map((s, i) => standingsRow(s, getOwner(ownerMap, year, s.roster_id), rankFn(s, i), playoffsStarted)).join('');
    return `
      <div class="card overflow-x-auto">
        <table class="data-table">
          <thead><tr>${fullTheadCols}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  };

  const expandBtn = hasDivisions ? `
    <div style="display:flex;justify-content:flex-end;margin-bottom:0.75rem;">
      <button id="expand-toggle" class="year-pill${isExpanded ? ' year-pill--active' : ''}" style="font-size:0.75rem;">
        ${isExpanded ? '&#8645; Collapse' : '&#8645; Expand'}
      </button>
    </div>` : '';

  if (!hasDivisions || isExpanded) {
    const divHtml = hasDivisions
      ? divNames.map(div => `
          <div>
            <p class="section-label">${esc(div)}</p>
            ${singleTable(divisions[div], (s, i) => s.division_rank ?? i + 1)}
          </div>`).join('')
      : singleTable(rows, (s, i) => s.overall_rank ?? i + 1);

    container.innerHTML = `${expandBtn}<div style="display:flex;flex-direction:column;gap:2rem;">${divHtml}</div>`;
  } else {
    // Wildcard: teams ranked 3rd or lower in their division, sorted by overall_rank
    const wildcardRows = divNames
      .flatMap(div => divisions[div].filter((s, i) => (s.division_rank ?? i + 1) > 2))
      .sort((a, b) => (a.overall_rank ?? 99) - (b.overall_rank ?? 99));

    const wildcardTable = wildcardRows.length ? wildcardTableHtml(wildcardRows, ownerMap, year, playoffsStarted) : '';

    container.innerHTML = `
      ${expandBtn}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        ${divNames.map(div => divisionTable(div, divisions[div], ownerMap, year, playoffsStarted)).join('')}
      </div>
      ${wildcardTable}`;
  }

  document.getElementById('expand-toggle')?.addEventListener('click', () => {
    isExpanded = !isExpanded;
    renderStandingsBody(cachedRows, cachedOwnerMap, cachedYear, cachedPlayoffs);
  });
}

// ---------------------------------------------------------------------------
// Historical grid  (all seasons)
// ---------------------------------------------------------------------------

async function loadAllForHistoricalGrid() {
  const container = document.getElementById('history-grid');
  container.innerHTML = `<div class="skeleton rounded-xl" style="height:200px;"></div>`;

  try {
    const [{ data: standings, error: e1 }, { data: owners, error: e2 }] = await Promise.all([
      window.db.from('standings')
        .select('year,roster_id,display_name,wins,losses,ties,made_playoffs,champion,runner_up')
        .order('year'),
      window.db.from('owners')
        .select('year,roster_id,display_name,team_name,avatar'),
    ]);
    if (e1 || e2) throw e1 || e2;

    allStandings = standings;
    allOwners    = owners;
    renderHistoricalGrid(standings, owners);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="text-red-400 text-sm">Failed to load history.</p>`;
  }
}

function renderHistoricalGrid(standings, owners) {
  // Build a lookup: [year][roster_id] = standing row
  const lookup = {};
  for (const s of standings) {
    if (!lookup[s.year]) lookup[s.year] = {};
    lookup[s.year][s.roster_id] = s;
  }

  // Get roster_ids from the most recent year, sorted by overall_rank
  const latestYear    = Math.max(...standings.map(s => s.year));
  const latestRosters = (lookup[latestYear] ? Object.values(lookup[latestYear]) : [])
    .sort((a, b) => (a.overall_rank ?? 99) - (b.overall_rank ?? 99));

  // Build owner map for team names/avatars (use latest year)
  const ownerMap = buildOwnerMap(owners);

  const years = SEASONS.filter(y => standings.some(s => s.year === y));

  const headerCols = years.map(y =>
    `<th style="padding:0.5rem 0.75rem;text-align:center;font-size:0.7rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#6b7280;white-space:nowrap;">${y}</th>`
  ).join('');

  const rows = latestRosters.map(lr => {
    const owner = getOwner(ownerMap, latestYear, lr.roster_id);

    const cells = years.map(y => {
      const s = (lookup[y] || {})[lr.roster_id];
      if (!s) return `<td class="hist-cell-empty" style="padding:0.4rem 0.75rem;text-align:center;font-size:0.75rem;border-bottom:1px solid #e5e7eb;">—</td>`;

      let cls = 'hist-cell-none';
      if (s.champion)          cls = 'hist-cell-champion';
      else if (s.runner_up)    cls = 'hist-cell-runnerup';
      else if (s.made_playoffs) cls = 'hist-cell-playoffs';

      const icon = s.champion ? ' &#127942;' : s.runner_up ? ' &#129352;' : '';

      return `<td class="${cls}" style="padding:0.4rem 0.75rem;text-align:center;font-size:0.75rem;font-weight:600;border-bottom:1px solid #e5e7eb;white-space:nowrap;">
        ${formatRecord(s.wins, s.losses, s.ties)}${icon}
      </td>`;
    }).join('');

    return `
      <tr>
        <td style="padding:0.4rem 1rem;white-space:nowrap;border-bottom:1px solid #e5e7eb;">
          <a href="team.html?roster_id=${lr.roster_id}" class="team-link" style="display:flex;align-items:center;gap:8px;">
            ${avatarImg(owner.avatar, owner.display_name, 24)}
            <span style="font-size:0.8rem;font-weight:600;color:#0D0F11;">${esc(owner.display_name)}</span>
          </a>
        </td>
        ${cells}
      </tr>`;
  }).join('');

  document.getElementById('history-grid').innerHTML = `
    <div class="card overflow-x-auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
        <thead>
          <tr>
            <th style="padding:0.5rem 1rem;text-align:left;font-size:0.7rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#64748b;white-space:nowrap;">Team</th>
            ${headerCols}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="margin-top:0.75rem;display:flex;flex-wrap:wrap;gap:0.5rem;">
      <span class="badge badge-champion">&#127942; Champion</span>
      <span class="badge badge-runnerup">&#129352; Runner-up</span>
      <span class="badge badge-playoffs">Playoffs</span>
      <span style="font-size:0.7rem;color:#f87171;padding:2px 8px;border-radius:99px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);">Missed</span>
    </div>`;
}

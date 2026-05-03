// ---------------------------------------------------------------------------
// teams.js — franchise directory page
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  renderNav('teams');
  renderSkeletons();

  try {
    const [
      { data: allOwners, error: e1 },
      { data: standings, error: e2 },
    ] = await Promise.all([
      window.db.from('owners')
        .select('roster_id,display_name,team_name,avatar,division,year')
        .order('year', { ascending: false }),
      window.db.from('standings')
        .select('year,roster_id,wins,losses,ties,made_playoffs,champion,overall_rank'),
    ]);
    if (e1 || e2) throw e1 || e2;

    // For each roster slot, use the most recent year's owner entry.
    // This handles teams whose data hasn't been ingested for CURRENT_YEAR yet.
    const ownerByRoster = {};
    for (const o of (allOwners || [])) {
      if (!ownerByRoster[o.roster_id]) ownerByRoster[o.roster_id] = o;
    }
    const owners = Object.values(ownerByRoster);

    renderTeamGrid(owners, standings || []);
  } catch (err) {
    console.error(err);
    document.getElementById('teams-grid').innerHTML =
      `<p class="text-red-400 text-sm">Failed to load teams.</p>`;
  }
});

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function renderSkeletons() {
  const skeletonGroup = (count) => `
    <div style="margin-bottom:2.5rem;">
      <div class="skeleton" style="height:22px;width:160px;border-radius:6px;margin-bottom:1rem;"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;">
        ${Array.from({ length: count }, () =>
          `<div class="skeleton rounded-xl" style="height:190px;"></div>`
        ).join('')}
      </div>
    </div>`;
  document.getElementById('teams-grid').innerHTML = skeletonGroup(7) + skeletonGroup(7);
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function renderTeamGrid(owners, standings) {
  // Build per-roster standings lookup
  const byRoster = {};
  for (const s of standings) {
    if (!byRoster[s.roster_id]) byRoster[s.roster_id] = [];
    byRoster[s.roster_id].push(s);
  }

  const teams = owners.map(owner => {
    const allTime = byRoster[owner.roster_id] || [];

    // Apply year exclusions for this owner
    const excluded = new Set(OWNER_YEAR_EXCLUSIONS[owner.display_name] || []);
    const filtered = allTime.filter(s => !excluded.has(s.year));

    const currentSeason  = filtered.find(s => s.year === CURRENT_YEAR);
    const completed      = filtered.filter(s => s.year < CURRENT_YEAR);
    const championships  = filtered.filter(s => s.champion && s.year < CURRENT_YEAR);
    const playoffApps    = completed.filter(s => s.made_playoffs).length;

    const totalWins  = filtered.reduce((n, s) => n + s.wins, 0);
    const totalGames = filtered.reduce((n, s) => n + s.wins + s.losses + (s.ties || 0), 0);
    const winPct     = totalGames > 0 ? (totalWins / totalGames * 100) : null;

    return { owner, currentSeason, championships, playoffApps, completedSeasons: completed.length, winPct };
  });

  // Sort by current season rank within each division; ties go alphabetical
  teams.sort((a, b) => {
    const ra = a.currentSeason?.overall_rank ?? 999;
    const rb = b.currentSeason?.overall_rank ?? 999;
    if (ra !== rb) return ra - rb;
    return (a.owner.display_name || '').localeCompare(b.owner.display_name || '');
  });

  // Group by division (East → West → unknown)
  const divOrder = ['east', 'west', ''];
  const byDiv = {};
  for (const t of teams) {
    const key = (t.owner.division || '').toLowerCase().includes('east') ? 'east'
              : (t.owner.division || '').toLowerCase().includes('west') ? 'west'
              : '';
    if (!byDiv[key]) byDiv[key] = [];
    byDiv[key].push(t);
  }

  const sections = divOrder
    .filter(key => byDiv[key]?.length)
    .map(key => {
      const divName  = key === 'east' ? 'East Division'
                     : key === 'west' ? 'West Division'
                     : 'Other';
      const logoHtml = key === 'east'
        ? `<img src="images/east_logo.png" alt="East" style="height:22px;width:auto;">`
        : key === 'west'
        ? `<img src="images/west_logo.png" alt="West" style="height:22px;width:auto;">`
        : '';
      const cards = byDiv[key].map(renderCard).join('');
      return `
        <div style="margin-bottom:2.5rem;">
          <div class="card" style="display:inline-flex;align-items:center;gap:0.6rem;padding:0.6rem 1.1rem;margin-bottom:1rem;">
            ${logoHtml}
            <span style="font-family:'Roboto Condensed',sans-serif;font-weight:900;font-size:1.1rem;letter-spacing:0.08em;text-transform:uppercase;color:#0D0F11;">${divName}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;">
            ${cards}
          </div>
        </div>`;
    }).join('');

  document.getElementById('teams-grid').innerHTML = sections;
}

// ---------------------------------------------------------------------------
// Individual card
// ---------------------------------------------------------------------------

function renderCard({ owner, currentSeason, championships, playoffApps, completedSeasons, winPct }) {
  // Current season record + rank
  const record = currentSeason
    ? formatRecord(currentSeason.wins, currentSeason.losses, currentSeason.ties)
    : '—';
  const rankBadge = currentSeason?.overall_rank
    ? `<span style="font-size:0.6rem;font-weight:700;color:#6366f1;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:4px;padding:1px 5px;white-space:nowrap;">${ordinal(currentSeason.overall_rank)}</span>`
    : '';

  // Championships
  const champCount = championships.length;
  const champYears = championships.map(s => s.year).sort((a, b) => b - a).join(', ');
  const champHtml  = champCount > 0
    ? `<span title="${champYears}">${'&#127942;'.repeat(Math.min(champCount, 3))}${champCount > 3 ? `<span style="font-size:0.7rem;font-weight:700;color:#ca8a04;"> ×${champCount}</span>` : ''}</span>`
    : `<span style="color:#d1d5db;">—</span>`;

  // Playoffs sub-label
  const playoffsSub = completedSeasons > 0
    ? `<span style="font-size:0.6rem;color:#94a3b8;">${playoffApps}/${completedSeasons} playoffs</span>`
    : `<span style="font-size:0.6rem;color:#d1d5db;">—</span>`;

  // All-time win%
  const winPctHtml = winPct != null
    ? `<span style="font-family:'Roboto Condensed',sans-serif;font-weight:800;font-size:1rem;color:#0D0F11;">${winPct.toFixed(1)}%</span>`
    : `<span style="color:#d1d5db;">—</span>`;

  return `
    <a href="team.html?roster_id=${owner.roster_id}" class="card card-hover"
       style="display:flex;flex-direction:column;padding:1.25rem;gap:0.875rem;text-decoration:none;">

      <!-- Identity row -->
      <div style="display:flex;align-items:center;gap:0.75rem;">
        ${avatarImg(owner.avatar, owner.display_name, 52)}
        <div style="min-width:0;flex:1;">
          <div style="font-family:'Roboto Condensed',sans-serif;font-weight:900;font-size:1rem;letter-spacing:0.04em;color:#0D0F11;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${esc(owner.team_name || owner.display_name)}
          </div>
          <div style="margin-top:3px;">
            <span style="font-size:0.75rem;color:#6b7280;">${esc(owner.display_name)}</span>
          </div>
        </div>
      </div>

      <!-- Stats row -->
      <div style="border-top:1px solid #e5e7eb;padding-top:0.75rem;display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.25rem;">

        <div style="text-align:center;padding:0.25rem 0;">
          <div style="font-size:0.55rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">${CURRENT_YEAR}</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:3px;flex-wrap:wrap;">
            <span style="font-family:'Roboto Condensed',sans-serif;font-weight:800;font-size:1rem;color:#0D0F11;">${record}</span>
            ${rankBadge}
          </div>
        </div>

        <div style="text-align:center;padding:0.25rem 0;border-left:1px solid #e5e7eb;">
          <div style="font-size:0.55rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">Champs</div>
          <div style="font-size:1rem;line-height:1;">${champHtml}</div>
          <div style="margin-top:3px;">${playoffsSub}</div>
        </div>

        <div style="text-align:center;padding:0.25rem 0;border-left:1px solid #e5e7eb;">
          <div style="font-size:0.55rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">Win%</div>
          ${winPctHtml}
        </div>

      </div>
    </a>`;
}

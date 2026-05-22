// ---------------------------------------------------------------------------
// draft.js  —  NFL-style Draft Tracker
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Page-level state
// ---------------------------------------------------------------------------
let _selectedYear = CURRENT_YEAR;
let _selectedRound = 'all'; // 'all', 1, 2, 3, etc.
let _highlightedTeam = null;
let _allSeasons = [];
let _currentDraft = null;
let _draftPicks = [];
let _owners = {};
let _ownersByUserId = {};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  renderNav('draft');

  try {
    // Load available draft seasons
    const { data: drafts, error } = await window.db.from('draft_metadata')
      .select('year,type,status,rounds,teams')
      .order('year', { ascending: false });

    if (error) {
      console.error('Error loading draft metadata:', error);
      throw error;
    }

    _allSeasons = drafts || [];
    console.log('Loaded seasons:', _allSeasons);

    // Debug: Check what's actually in the tables
    if (_allSeasons.length === 0) {
      console.log('No seasons found, checking tables directly...');
      const { data: allDraftMetadata } = await window.db.from('draft_metadata').select('*').limit(5);
      const { data: allDraftPicks } = await window.db.from('draft_picks').select('*').limit(5);
      console.log('Sample draft_metadata:', allDraftMetadata);
      console.log('Sample draft_picks:', allDraftPicks);
    }

    // Default to most recent season with draft data
    if (_allSeasons.length > 0) {
      _selectedYear = _allSeasons[0].year;
    }

    renderSeasonSelector();
    await loadDraftData(_selectedYear);

  } catch (err) {
    console.error('Failed to load draft data:', err);
    document.getElementById('season-selector').innerHTML =
      `<p class="text-red-500 text-sm">Failed to load draft seasons: ${err.message}</p>`;
    document.getElementById('draft-picks-container').innerHTML =
      `<div class="card p-6"><p class="text-red-500 text-sm">Failed to load draft data.</p></div>`;
  }
});

// ---------------------------------------------------------------------------
// Season selector
// ---------------------------------------------------------------------------

function renderSeasonSelector() {
  const container = document.getElementById('season-selector');

  if (!_allSeasons.length) {
    container.innerHTML = `<p class="text-slate-500 text-sm">No draft data available.</p>`;
    return;
  }

  const pills = _allSeasons.map(season => {
    const isActive = season.year === _selectedYear;
    const statusIcon = season.status === 'complete' ? '✓' :
                      season.status === 'in_progress' ? '⏳' : '⏸';

    return `
      <button onclick="loadSeason(${season.year})"
              class="year-pill ${isActive ? 'year-pill--active' : ''}"
              title="${season.type} - ${season.status}">
        ${statusIcon} ${season.year} ${season.type}
      </button>`;
  }).join('');

  container.innerHTML = pills;
}

async function loadSeason(year) {
  if (year === _selectedYear) return;
  _selectedYear = year;
  _selectedRound = 'all'; // Reset round filter
  _highlightedTeam = null; // Reset team highlight
  renderSeasonSelector();
  await loadDraftData(year);
}

// ---------------------------------------------------------------------------
// Draft data loader
// ---------------------------------------------------------------------------

async function loadDraftData(year) {
  try {
    // Show loading skeleton
    showLoadingSkeleton();

    console.log(`Loading draft data for year: ${year}`);

    // Load draft metadata and picks for the selected year
    const [
      { data: metadata, error: e1 },
      { data: picks, error: e2 },
      { data: owners, error: e3 }
    ] = await Promise.all([
      window.db.from('draft_metadata')
        .select('*')
        .eq('year', year)
        .single(),
      window.db.from('draft_picks')
        .select('*')
        .eq('year', year)
        .order('overall_pick'),
      window.db.from('owners')
        .select('roster_id,user_id,display_name,team_name,avatar')
        .eq('year', year)
    ]);

    console.log('Draft metadata result:', { data: metadata, error: e1 });
    console.log('Draft picks result:', { data: picks, error: e2, count: picks?.length });
    console.log('Owners result:', { data: owners, error: e3, count: owners?.length });

    if (e1) {
      console.error('Draft metadata error:', e1);
      throw new Error(`Draft metadata error: ${e1.message}`);
    }
    if (e2) {
      console.error('Draft picks error:', e2);
      throw new Error(`Draft picks error: ${e2.message}`);
    }
    if (e3) {
      console.error('Owners error:', e3);
      throw new Error(`Owners error: ${e3.message}`);
    }

    if (!metadata) {
      throw new Error(`No draft metadata found for year ${year}`);
    }

    _currentDraft = metadata;
    _draftPicks = picks || [];

    // Build owners lookup (both by roster_id and user_id)
    _owners = {};
    _ownersByUserId = {};
    for (const owner of (owners || [])) {
      _owners[owner.roster_id] = owner;
      _ownersByUserId[owner.user_id] = owner;
    }

    console.log('Loaded draft data:', {
      metadata: _currentDraft,
      picksCount: _draftPicks.length,
      ownersCount: Object.keys(_owners).length
    });

    renderDraftInfo();
    renderRoundFilter();
    renderDraftPicks();

  } catch (err) {
    console.error('Error loading draft data:', err);
    document.getElementById('draft-info').innerHTML = '';
    document.getElementById('round-filter').innerHTML = '';
    document.getElementById('draft-picks-container').innerHTML =
      `<div class="card p-6">
        <p class="text-red-500 text-sm mb-2">No draft data found for ${year}.</p>
        <p class="text-slate-500 text-xs">Error: ${err.message}</p>
        <p class="text-slate-500 text-xs mt-2">Check browser console for more details.</p>
      </div>`;
  }
}

// ---------------------------------------------------------------------------
// Draft info bar
// ---------------------------------------------------------------------------

function renderDraftInfo() {
  if (!_currentDraft) return;

  const statusBadge = _currentDraft.status === 'complete'
    ? `<span class="badge badge-playoffs">✓ Complete</span>`
    : _currentDraft.status === 'in_progress'
    ? `<span class="badge" style="background:rgba(234,179,8,0.1);color:#ca8a04;border:1px solid rgba(234,179,8,0.3);">⏳ In Progress</span>`
    : `<span class="badge" style="background:rgba(148,163,184,0.1);color:#64748b;border:1px solid rgba(148,163,184,0.3);">⏸ Pre-Draft</span>`;

  const totalPicks = _draftPicks.length;
  const rounds = _currentDraft.rounds || 5;
  const numTeams = _currentDraft.teams || 14;
  const expectedPicks = rounds * numTeams;

  document.getElementById('draft-info').innerHTML = `
    <div class="card p-4">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
        <div>
          <h2 style="font-size:1.25rem;font-weight:800;color:#0D0F11;margin-bottom:0.25rem;">
            ${_currentDraft.year} ${_currentDraft.type || 'Draft'}
          </h2>
          <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
            ${statusBadge}
            <span style="font-size:0.8rem;color:#6b7280;">
              ${totalPicks} of ${expectedPicks} picks completed
            </span>
          </div>
        </div>
        ${_currentDraft.pick_timer ? `
          <div style="text-align:right;">
            <div style="font-size:0.7rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Pick Timer</div>
            <div style="font-size:1.1rem;font-weight:700;color:#0D0F11;">${_currentDraft.pick_timer / 60} min</div>
          </div>
        ` : ''}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Horizontal Round Filter (NFL-style)
// ---------------------------------------------------------------------------

function renderRoundFilter() {
  if (!_currentDraft) return;

  const rounds = _currentDraft.rounds || 5;
  const roundTabs = [];

  // "All Rounds" tab
  roundTabs.push(`
    <button onclick="selectRound('all')"
            class="round-filter-btn ${_selectedRound === 'all' ? 'round-filter-btn--active' : ''}"
            style="flex-shrink:0;padding:0.5rem 1rem;border-radius:20px;font-size:0.8rem;font-weight:600;border:1px solid ${_selectedRound === 'all' ? '#3b82f6' : '#d1d5db'};background:${_selectedRound === 'all' ? '#3b82f6' : 'white'};color:${_selectedRound === 'all' ? 'white' : '#6b7280'};cursor:pointer;transition:all 0.15s;white-space:nowrap;">
      All Rounds
    </button>`);

  // Individual round tabs
  for (let round = 1; round <= rounds; round++) {
    const roundPicks = _draftPicks.filter(p => p.round === round);
    const isActive = _selectedRound === round;

    roundTabs.push(`
      <button onclick="selectRound(${round})"
              class="round-filter-btn ${isActive ? 'round-filter-btn--active' : ''}"
              style="flex-shrink:0;padding:0.5rem 1rem;border-radius:20px;font-size:0.8rem;font-weight:600;border:1px solid ${isActive ? '#3b82f6' : '#d1d5db'};background:${isActive ? '#3b82f6' : 'white'};color:${isActive ? 'white' : '#6b7280'};cursor:pointer;transition:all 0.15s;white-space:nowrap;">
        Round ${round} (${roundPicks.length})
      </button>`);
  }

  document.getElementById('round-filter').innerHTML = roundTabs.join('');
}

function selectRound(round) {
  _selectedRound = round;
  renderRoundFilter();
  renderDraftPicks();
}

// ---------------------------------------------------------------------------
// NFL-style Draft Picks Table
// ---------------------------------------------------------------------------

function renderDraftPicks() {
  let filteredPicks = _draftPicks;

  // Filter by round
  if (_selectedRound !== 'all') {
    filteredPicks = filteredPicks.filter(p => p.round === _selectedRound);
  }

  if (filteredPicks.length === 0) {
    document.getElementById('draft-picks-container').innerHTML = `
      <div class="card p-8 text-center">
        <p style="font-size:1.1rem;color:#6b7280;margin-bottom:0.5rem;">No picks found</p>
        <p style="font-size:0.85rem;color:#9ca3af;">
          ${_selectedRound !== 'all' ? `No picks in Round ${_selectedRound}` : 'No draft picks available'}
        </p>
      </div>`;
    return;
  }

  const pickRows = filteredPicks.map(pick => renderNFLPickRow(pick)).join('');

  document.getElementById('draft-picks-container').innerHTML = `
    <div class="card">
      <div class="draft-picks-table">
        ${pickRows}
      </div>
    </div>`;
}

function renderNFLPickRow(pick) {
  const owner = _owners[pick.roster_id] || { display_name: `Team ${pick.roster_id}`, team_name: `Team ${pick.roster_id}`, avatar: null };
  const posColor = getPositionColor(pick.position);

  // Check if this pick was traded
  // Compare picked_by (user_id) with current owner's user_id
  const currentOwner = _owners[pick.roster_id];
  const originalOwner = pick.picked_by && currentOwner && pick.picked_by !== currentOwner.user_id
    ? _ownersByUserId[pick.picked_by] || null
    : null;

  // Debug logging for first few picks
  if (pick.overall_pick <= 5) {
    console.log(`Pick ${pick.overall_pick} debug:`, {
      player_name: pick.player_name,
      roster_id: pick.roster_id,
      picked_by: pick.picked_by,
      currentOwner_user_id: currentOwner?.user_id,
      picked_by_type: typeof pick.picked_by,
      currentOwner_user_id_type: typeof currentOwner?.user_id,
      is_different: pick.picked_by !== currentOwner?.user_id,
      originalOwner_found: !!originalOwner,
      originalOwner_name: originalOwner?.display_name
    });
  }


  return `
    <div class="draft-pick-row"
         onclick="showPickDetails(${JSON.stringify(pick).replace(/"/g, '&quot;')})"
         style="display:flex;align-items:center;gap:1.5rem;padding:1.25rem 1.5rem;border-bottom:1px solid #f3f4f6;cursor:pointer;transition:all 0.15s;"
         onmouseover="this.style.backgroundColor='#f9fafb'"
         onmouseout="this.style.backgroundColor='transparent'">

      <!-- Pick Number -->
      <div class="pick-number" style="min-width:60px;text-align:center;flex-shrink:0;">
        <div style="font-size:1.25rem;font-weight:800;color:#0D0F11;line-height:1;">${pick.overall_pick}</div>
        <div style="font-size:0.75rem;color:#6b7280;font-weight:600;margin-top:2px;">R${pick.round}</div>
      </div>

      <!-- Owner Avatar -->
      <div class="owner-avatar" style="flex-shrink:0;">
        ${avatarImg(owner.avatar, owner.display_name, 52)}
      </div>

      <!-- Player Picture Placeholder -->
      <div class="player-picture" style="flex-shrink:0;">
        <div style="width:64px;height:64px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;border:2px solid #e5e7eb;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        </div>
      </div>

      <!-- Player Info -->
      <div class="player-info" style="flex:1;min-width:200px;max-width:none;">
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;flex-wrap:wrap;">
          <div style="font-size:1.2rem;font-weight:800;color:#0D0F11;line-height:1.1;word-break:break-word;">
            ${esc(pick.player_name)}
          </div>
          ${pick.is_keeper ? `
            <span style="background:#eab308;color:white;font-size:0.65rem;font-weight:700;padding:0.25rem 0.5rem;border-radius:4px;flex-shrink:0;">
              KEEPER
            </span>
          ` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:0.25rem;">
          <div style="font-size:0.9rem;font-weight:600;color:#0D0F11;word-break:break-word;">
            ${owner.display_name}
          </div>
          ${originalOwner ? `
            <div style="font-size:0.75rem;color:#6b7280;word-break:break-word;">
              <span style="font-weight:500;">Originally:</span> ${originalOwner.display_name}
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Position -->
      <div class="position" style="min-width:50px;text-align:center;flex-shrink:0;">
        <span class="pos-badge" style="background:${posColor};color:white;font-size:0.8rem;padding:0.375rem 0.625rem;border-radius:5px;font-weight:700;">
          ${pick.position}
        </span>
      </div>

      <!-- NFL Team -->
      <div class="nfl-team" style="min-width:60px;text-align:right;flex-shrink:0;">
        <div style="font-size:0.9rem;font-weight:700;color:#0D0F11;">
          ${pick.nfl_team || '—'}
        </div>
      </div>

    </div>`;
}

// ---------------------------------------------------------------------------
// Pick details modal (same as before)
// ---------------------------------------------------------------------------

function showPickDetails(pick) {
  const owner = _owners[pick.roster_id] || { display_name: `Team ${pick.roster_id}`, avatar: null };
  const posColor = getPositionColor(pick.position);

  // Check if this pick was traded
  // Compare picked_by (user_id) with current owner's user_id
  const currentOwnerData = _owners[pick.roster_id];
  const originalOwner = pick.picked_by && currentOwnerData && pick.picked_by !== currentOwnerData.user_id
    ? _ownersByUserId[pick.picked_by] || null
    : null;

  // Calculate pick within round
  const numTeams = Object.keys(_owners).length || 14;
  const pickInRound = ((pick.overall_pick - 1) % numTeams) + 1;

  const modal = document.getElementById('pick-modal');
  modal.innerHTML = `
    <div class="modal-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:1rem;" onclick="closePickModal()">
      <div class="modal-content" style="background:white;border-radius:1rem;padding:1.5rem;max-width:400px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.15);" onclick="event.stopPropagation()">

        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;">
          <h3 style="font-size:1.25rem;font-weight:800;color:#0D0F11;margin:0;">Pick Details</h3>
          <button onclick="closePickModal()" style="background:none;border:none;font-size:1.5rem;color:#6b7280;cursor:pointer;padding:0;line-height:1;">&times;</button>
        </div>

        <div style="text-align:center;margin-bottom:1.5rem;">
          <div style="font-size:1.5rem;font-weight:900;color:#0D0F11;margin-bottom:0.5rem;">${esc(pick.player_name)}</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:0.5rem;margin-bottom:1rem;">
            <span class="pos-badge" style="background:${posColor};color:white;padding:4px 8px;">${pick.position}</span>
            ${pick.nfl_team ? `<span style="font-size:0.9rem;color:#6b7280;">${pick.nfl_team}</span>` : ''}
            ${pick.is_keeper ? `<span class="badge" style="background:#eab308;color:white;border:none;">Keeper</span>` : ''}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
          <div style="text-align:center;">
            <div style="font-size:0.7rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Overall Pick</div>
            <div style="font-size:1.5rem;font-weight:900;color:#0D0F11;">${pick.overall_pick}</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:0.7rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Round Pick</div>
            <div style="font-size:1.5rem;font-weight:900;color:#0D0F11;">${pick.round}.${String(pickInRound).padStart(2, '0')}</div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:0.75rem;padding:1rem;background:#f9fafb;border-radius:8px;">
          ${avatarImg(owner.avatar, owner.display_name, 40)}
          <div style="flex:1;">
            <div style="font-size:0.9rem;font-weight:700;color:#0D0F11;">${esc(owner.team_name || owner.display_name)}</div>
            <div style="font-size:0.8rem;color:#6b7280;">${esc(owner.display_name)}</div>
            ${originalOwner ? `
              <div style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;border-top:1px solid #e5e7eb;padding-top:0.25rem;">
                <span style="font-weight:600;">Originally owned by:</span> ${esc(originalOwner.team_name || originalOwner.display_name)}
              </div>
            ` : ''}
          </div>
        </div>

      </div>
    </div>`;

  modal.style.display = 'block';
}

function closePickModal() {
  document.getElementById('pick-modal').style.display = 'none';
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncateTeamName(name) {
  if (!name) return '';
  return name.length > 12 ? name.substring(0, 10) + '...' : name;
}

function getPositionColor(position) {
  const colors = {
    'QB': '#dc2626', 'RB': '#059669', 'WR': '#2563eb', 'TE': '#7c2d12',
    'K': '#6b7280', 'DL': '#991b1b', 'LB': '#92400e', 'DB': '#1e40af'
  };
  return colors[position] || '#6b7280';
}

function showLoadingSkeleton() {
  document.getElementById('draft-info').innerHTML = `
    <div class="card p-4">
      <div class="skeleton" style="width:300px;height:24px;border-radius:6px;margin-bottom:0.5rem;"></div>
      <div class="skeleton" style="width:200px;height:16px;border-radius:6px;"></div>
    </div>`;

  document.getElementById('round-filter').innerHTML =
    Array.from({length: 6}, () =>
      `<div class="skeleton" style="width:100px;height:36px;border-radius:20px;flex-shrink:0;"></div>`
    ).join('');
}
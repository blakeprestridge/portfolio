document.addEventListener('DOMContentLoaded', async () => {
  renderNav('home');
  renderSkeletons();

  try {
    const [
      { data: standings, error: e1 },
      { data: matchups,  error: e2 },
      { data: owners,    error: e3 },
      { data: recentTxns, error: e4 },
    ] = await Promise.all([
      window.db.from('standings')
        .select('year,roster_id,display_name,wins,losses,ties,points_for,points_against,made_playoffs,champion,runner_up')
        .order('year'),
      window.db.from('matchups')
        .select('year,week,roster_id,points,opponent_points,result')
        .neq('result', 'BYE').gt('points', 0),
      window.db.from('owners')
        .select('year,roster_id,display_name,team_name,avatar'),
      window.db.from('transaction_players')
        .select('year,week,type,action,player_name,player_position,roster_id')
        .eq('action', 'add')
        .order('year',  { ascending: false })
        .order('week',  { ascending: false })
        .limit(12),
    ]);

    if (e1 || e2 || e3 || e4) throw e1 || e2 || e3 || e4;

    const ownerMap  = buildOwnerMap(owners);
    const champions = standings.filter(s => s.champion).sort((a, b) => b.year - a.year);
    const latest    = champions[0];

    renderHero(latest, ownerMap);
    renderChampions(champions, ownerMap);
    renderLeagueRecords(standings, matchups, ownerMap);
    renderRecentActivity(recentTxns, ownerMap);
  } catch (err) {
    console.error(err);
    document.getElementById('champions-row').innerHTML =
      `<p class="text-red-400 col-span-full text-sm">Failed to load data. Check your Supabase anon key in config.js.</p>`;
  }
});

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function renderSkeletons() {
  document.getElementById('champions-row').innerHTML    = skeletonCards(6);
  document.getElementById('league-records').innerHTML   = skeletonCards(4);
  document.getElementById('recent-activity').innerHTML  =
    Array.from({ length: 8 }, () =>
      `<div class="skeleton rounded-lg" style="height:56px;"></div>`
    ).join('');
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function renderHero(champ, ownerMap) {
  if (!champ) return;
  const owner = getOwner(ownerMap, champ.year, champ.roster_id);

  document.getElementById('hero-champion').innerHTML = `
    <span class="text-gold text-xs font-bold uppercase tracking-widest">${champ.year} Champion</span>
    ${avatarImg(owner.avatar, owner.display_name, 36)}
    <div>
      <div class="font-bold text-white leading-tight">${esc(owner.team_name || owner.display_name)}</div>
      <div class="text-xs text-slate-400">${esc(owner.display_name)} &mdash; ${formatRecord(champ.wins, champ.losses, champ.ties)}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Champions row
// ---------------------------------------------------------------------------

function renderChampions(champions, ownerMap) {
  const el = document.getElementById('champions-row');
  if (!champions.length) { el.innerHTML = '<p class="text-slate-500 text-sm col-span-full">No data.</p>'; return; }

  el.innerHTML = champions.map(c => {
    const owner = getOwner(ownerMap, c.year, c.roster_id);
    return `
      <div class="card card-hover p-4 flex flex-col items-center gap-2 text-center">
        <span class="text-xs font-bold text-gold tracking-widest">${c.year}</span>
        ${avatarImg(owner.avatar, owner.display_name, 52)}
        <div>
          <div class="font-bold text-sm text-white leading-tight truncate-name">${esc(owner.team_name || owner.display_name)}</div>
          <div class="text-xs text-slate-400">${esc(owner.display_name)}</div>
        </div>
        <div class="text-xs font-semibold text-slate-300">${formatRecord(c.wins, c.losses, c.ties)}</div>
        <span class="badge badge-champion">&#127942; Champion</span>
      </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// League records
// ---------------------------------------------------------------------------

function renderLeagueRecords(standings, matchups, ownerMap) {
  const el = document.getElementById('league-records');

  // Highest single-game score
  const topScore = matchups.reduce((best, m) =>
    (m.points > (best?.points ?? 0)) ? m : best, null);

  // Most wins in a season
  const topWins = standings.reduce((best, s) =>
    (s.wins > (best?.wins ?? 0)) ? s : best, null);

  // Most points for in a season
  const topPF = standings.reduce((best, s) =>
    (s.points_for > (best?.points_for ?? 0)) ? s : best, null);

  // Biggest blowout (margin)
  const topBlowout = matchups.reduce((best, m) => {
    const margin = m.points - (m.opponent_points ?? 0);
    return margin > (best?.margin ?? 0) ? { ...m, margin } : best;
  }, null);

  const records = [
    {
      label: 'Highest Single Score',
      value: topScore ? formatPts(topScore.points) + ' pts' : '—',
      sub:   topScore ? `${esc(getOwner(ownerMap, topScore.year, topScore.roster_id).display_name)} &bull; Wk&nbsp;${topScore.week} ${topScore.year}` : '',
      icon:  '&#9889;',
    },
    {
      label: 'Most Wins in a Season',
      value: topWins ? `${topWins.wins}-${topWins.losses}` : '—',
      sub:   topWins ? `${esc(topWins.display_name)} &bull; ${topWins.year}` : '',
      icon:  '&#127942;',
    },
    {
      label: 'Highest Season Total',
      value: topPF ? formatPts(topPF.points_for) + ' pts' : '—',
      sub:   topPF ? `${esc(topPF.display_name)} &bull; ${topPF.year}` : '',
      icon:  '&#128200;',
    },
    {
      label: 'Biggest Blowout',
      value: topBlowout ? `+${topBlowout.margin.toFixed(1)}` : '—',
      sub:   topBlowout ? `${esc(getOwner(ownerMap, topBlowout.year, topBlowout.roster_id).display_name)} &bull; Wk&nbsp;${topBlowout.week} ${topBlowout.year}` : '',
      icon:  '&#128293;',
    },
  ];

  el.innerHTML = records.map(r => `
    <div class="card p-4">
      <div class="text-xl mb-1">${r.icon}</div>
      <div class="section-label mb-1" style="margin-bottom:2px;">${r.label}</div>
      <div class="text-xl font-black text-white">${r.value}</div>
      <div class="text-xs text-slate-500 mt-1">${r.sub}</div>
    </div>`
  ).join('');
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

function renderRecentActivity(txns, ownerMap) {
  const el = document.getElementById('recent-activity');
  if (!txns?.length) {
    el.innerHTML = '<p class="text-slate-500 text-sm">No recent activity.</p>';
    return;
  }

  const typeLabel = { trade: 'TRADE', waiver: 'WAIVER', free_agent: 'FA' };
  const typeColor = { trade: '#f59e0b', waiver: '#10b981', free_agent: '#0ea5e9' };

  el.innerHTML = txns.map(t => {
    const owner = getOwner(ownerMap, t.year, t.roster_id);
    const color  = typeColor[t.type] || '#94a3b8';
    const label  = typeLabel[t.type] || t.type.toUpperCase();
    return `
      <div class="card p-3 flex items-center gap-3">
        <div class="flex-shrink-0">
          ${avatarImg(owner.avatar, owner.display_name, 32)}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span style="color:${color};font-size:0.65rem;font-weight:700;letter-spacing:0.07em;">${label}</span>
            <span class="text-xs text-slate-500">Wk&nbsp;${t.week} ${t.year}</span>
          </div>
          <div class="text-sm text-white font-medium leading-tight truncate">
            ${esc(owner.display_name)} added ${positionBadge(t.player_position)} ${esc(t.player_name)}
          </div>
        </div>
      </div>`;
  }).join('');
}

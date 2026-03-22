document.addEventListener('DOMContentLoaded', async () => {
    renderNav('home');
    renderSkeletons();

    try {
        const [
            {data: standings, error: e1},
            {data: matchups, error: e2},
            {data: owners, error: e3},
            {data: recentTxns, error: e4},
            {data: txnMeta, error: e5},
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
                .select('year,week,transaction_id,type,action,player_name,player_position,roster_id')
                .order('year', {ascending: false})
                .order('week', {ascending: false})
                .order('transaction_id', {ascending: false})
                .limit(150),
            window.db.from('transactions')
                .select('transaction_id,status_updated')
                .order('transaction_id', {ascending: false})
                .limit(200),
        ]);

        if (e1 || e2 || e3 || e4 || e5) throw e1 || e2 || e3 || e4 || e5;

        const txnMetaMap = new Map((txnMeta || []).map(t => [String(t.transaction_id), t.status_updated]));

        const ownerMap = buildOwnerMap(owners);
        const champions = standings.filter(s => s.champion).sort((a, b) => b.year - a.year);
        const latest = champions[0];

        renderHero(latest, ownerMap);
        renderChampions(champions, ownerMap);
        renderLeagueRecords(standings, matchups, ownerMap);
        renderRecentActivity(recentTxns, ownerMap, txnMetaMap);
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
    document.getElementById('champions-row').innerHTML = skeletonCards(6);
    document.getElementById('league-records').innerHTML = skeletonCards(4);
    document.getElementById('recent-activity').innerHTML =
        Array.from({length: 8}, () =>
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
    <div class="ribbon" style="margin-bottom:1.25rem;">${champ.year} Champion</div>
    <div style="display:flex;align-items:center;justify-content:center;gap:0.75rem;">
      <img src="images/trophy_icon.png" alt="Trophy" style="height:120px;width:auto;flex-shrink:0;" />
      <div style="display:flex;justify-content:center;gap:1rem;flex-wrap:wrap;align-items:stretch;">
        <div style="background:rgba(214, 219, 228, 0.7);border-radius:0.75rem;padding:1rem;display:flex;flex-direction:column;align-items:center;gap:0.5rem;min-width:110px;">
          ${avatarImg(owner.avatar, owner.display_name, 64)}
          <div style="font-size:0.7rem;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${esc(owner.display_name)}</div>
          <div style="font-family:'Roboto Condensed',sans-serif;font-weight:900;font-size:1.25rem;letter-spacing:0.08em;color:#0D0F11;">${esc(owner.team_name || owner.display_name)}</div>
        </div>
        <div style="background:rgba(214, 219, 228, 0.7);border-radius:0.75rem;padding:1rem;display:flex;flex-direction:column;justify-content:center;gap:0.75rem;min-width:110px;">
          <div style="border-bottom:1px solid #b6b7c6;padding-bottom:0.5rem;">
            <div style="font-size:0.6rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#6b7280;">Record</div>
            <div style="font-family:'Roboto Condensed',sans-serif;font-weight:900;font-size:1.75rem;letter-spacing:0.06em;color:#0D0F11;">${formatRecord(champ.wins, champ.losses, champ.ties)}</div>
          </div>
          <div>
            <div style="font-size:0.6rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#6b7280;">Season PF</div>
            <div style="font-family:'Roboto Condensed',sans-serif;font-weight:900;font-size:1.75rem;letter-spacing:0.06em;color:#0D0F11;">${formatPts(champ.points_for)}</div>
          </div>
        </div>
      </div>
      <img src="images/trophy_icon.png" alt="Trophy" style="height:120px;width:auto;flex-shrink:0;" />
    </div>`;
}

// ---------------------------------------------------------------------------
// Champions row
// ---------------------------------------------------------------------------

function renderChampions(champions, ownerMap) {
    const el = document.getElementById('champions-row');
    if (!champions.length) {
        el.innerHTML = '<p class="text-slate-500 text-sm col-span-full">No data.</p>';
        return;
    }

    el.innerHTML = champions.map(c => {
        const owner = getOwner(ownerMap, c.year, c.roster_id);
        return `
      <div class="card card-hover p-4 flex flex-col items-center gap-2 text-center">
        <span class="text-xs font-bold text-gold tracking-widest">${c.year}</span>
        ${avatarImg(owner.avatar, owner.display_name, 52)}
        <div>
          <div class="font-bold text-sm leading-tight truncate-name" style="color:#0D0F11;">${esc(owner.team_name || owner.display_name)}</div>
          <div class="text-xs text-slate-500">${esc(owner.display_name)}</div>
        </div>
        <div class="text-xs font-semibold text-slate-600">${formatRecord(c.wins, c.losses, c.ties)}</div>
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
        return margin > (best?.margin ?? 0) ? {...m, margin} : best;
    }, null);

    const records = [
        {
            label: 'Highest Single Score',
            value: topScore ? formatPts(topScore.points) + ' pts' : '—',
            sub: topScore ? `${esc(getOwner(ownerMap, topScore.year, topScore.roster_id).display_name)} &bull; Wk&nbsp;${topScore.week} ${topScore.year}` : '',
            icon: '&#9889;',
        },
        {
            label: 'Most Wins in a Season',
            value: topWins ? `${topWins.wins}-${topWins.losses}` : '—',
            sub: topWins ? `${esc(topWins.display_name)} &bull; ${topWins.year}` : '',
            icon: '&#127942;',
        },
        {
            label: 'Highest Season Total',
            value: topPF ? formatPts(topPF.points_for) + ' pts' : '—',
            sub: topPF ? `${esc(topPF.display_name)} &bull; ${topPF.year}` : '',
            icon: '&#128200;',
        },
        {
            label: 'Biggest Blowout',
            value: topBlowout ? `+${topBlowout.margin.toFixed(1)}` : '—',
            sub: topBlowout ? `${esc(getOwner(ownerMap, topBlowout.year, topBlowout.roster_id).display_name)} &bull; Wk&nbsp;${topBlowout.week} ${topBlowout.year}` : '',
            icon: '&#128293;',
        },
    ];

    el.innerHTML = records.map(r => `
    <div class="card p-4" style="display:flex;flex-direction:column;align-items:center;text-align:center;">
      <div class="text-xl mb-1">${r.icon}</div>
      <div style="margin-bottom:2px;font-weight:600;text-transform:uppercase;">${r.label}</div>
      <div style="font-family:'Roboto Condensed',sans-serif;font-weight:900;font-size:1.75rem;letter-spacing:0.06em;color:#0D0F11;">${r.value}</div>
      <div class="text-xs text-slate-500 mt-1">${r.sub}</div>
    </div>`
    ).join('');
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

function fmtTxnDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const month = d.toLocaleString('en-US', {month: 'short'});
    const day   = d.getDate();
    const year  = d.getFullYear();
    const time  = d.toLocaleString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true});
    return `${month} ${day}, ${year} · ${time}`;
}

function renderRecentActivity(txns, ownerMap, txnMetaMap) {
    const el = document.getElementById('recent-activity');
    if (!txns?.length) {
        el.innerHTML = '<p class="text-slate-500 text-sm">No recent activity.</p>';
        return;
    }

    // Group all rows by transaction_id; each transaction has one or more sides (roster_ids)
    const txnMap = new Map();
    for (const row of txns) {
        const key = String(row.transaction_id);
        if (!txnMap.has(key)) {
            txnMap.set(key, {
                transaction_id: row.transaction_id,
                type: row.type,
                year: row.year,
                sides: new Map(),
            });
        }
        const txn = txnMap.get(key);
        if (!txn.sides.has(row.roster_id)) {
            txn.sides.set(row.roster_id, {roster_id: row.roster_id, adds: [], drops: []});
        }
        const side = txn.sides.get(row.roster_id);
        if (row.action === 'add') side.adds.push(row);
        else side.drops.push(row);
    }

    // Sort by transaction_id desc, take 10 most recent (TODO: remove trade filter)
    const txns10 = [...txnMap.values()]
        .filter(t => t.type === 'trade')
        .sort((a, b) => b.transaction_id - a.transaction_id)
        .slice(0, 10);

    const assetLine = row =>
        `<div style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;color:#0D0F11;">
           ${positionBadge(row.player_position)} ${esc(row.player_name)}
         </div>`;

    el.innerHTML = txns10.map(txn => {
        const isTrade = txn.type === 'trade';
        const dateStr = fmtTxnDate(txnMetaMap.get(String(txn.transaction_id)));
        const sides = [...txn.sides.values()];

        let headerHtml, bodyHtml;

        if (isTrade) {
            headerHtml = `
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.6rem;">
                <span style="font-size:0.8rem;font-weight:700;color:#ef4444;">A trade has been completed!</span>
                <span style="font-size:0.7rem;color:#94a3b8;">${dateStr}</span>
              </div>`;

            bodyHtml = sides.map(side => {
                const owner = getOwner(ownerMap, txn.year, side.roster_id);
                return `
                <div style="margin-bottom:0.5rem;">
                  <div style="font-size:0.75rem;font-weight:600;color:#0D0F11;margin-bottom:0.2rem;">
                    ${esc(owner.display_name)} receives:
                  </div>
                  <div style="display:flex;flex-direction:column;gap:0.15rem;padding-left:0.5rem;">
                    ${side.adds.map(assetLine).join('') || '<div style="font-size:0.8rem;color:#94a3b8;">—</div>'}
                  </div>
                </div>`;
            }).join('');

        } else {
            const side = sides[0];
            const owner = getOwner(ownerMap, txn.year, side.roster_id);
            const typeLabel = txn.type === 'waiver' ? 'Waiver' : 'Free Agent';
            const typeColor = txn.type === 'waiver' ? '#10b981' : '#0ea5e9';

            headerHtml = `
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.4rem;">
                <span style="font-size:0.8rem;font-weight:600;color:#0D0F11;">
                  ${esc(owner.display_name)} has made a
                  <span style="color:${typeColor};">${typeLabel}</span> move:
                </span>
                <span style="font-size:0.7rem;color:#94a3b8;">${dateStr}</span>
              </div>`;

            bodyHtml = `
              <div style="display:flex;flex-direction:column;gap:0.15rem;">
                ${side.adds.map(r => `<div style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;color:#0D0F11;"><span style="font-size:0.6rem;font-weight:700;color:#10b981;min-width:3.5rem;">ADDED</span>${positionBadge(r.player_position)} ${esc(r.player_name)}</div>`).join('')}
                ${side.drops.map(r => `<div style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;color:#0D0F11;"><span style="font-size:0.6rem;font-weight:700;color:#ef4444;min-width:3.5rem;">DROPPED</span>${positionBadge(r.player_position)} ${esc(r.player_name)}</div>`).join('')}
              </div>`;
        }

        return `<div class="card p-3">${headerHtml}${bodyHtml}</div>`;
    }).join('');
}

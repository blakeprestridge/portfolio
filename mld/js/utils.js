// ---------------------------------------------------------------------------
// Sleeper avatars
// ---------------------------------------------------------------------------

function avatarUrl(hash) {
  if (!hash) return null;
  return `https://sleepercdn.com/avatars/thumbs/${hash}`;
}

function divChampBadge(division) {
  const div = (division || '').toLowerCase();
  if (div.includes('east')) return `<span class="badge badge-divchamp-east">East Champ</span>`;
  if (div.includes('west')) return `<span class="badge badge-divchamp-west">West Champ</span>`;
  return `<span class="badge badge-divchamp">Div Champ</span>`;
}

const SLEEPER_TO_ESPN_ABBR = { WAS: 'wsh', WSH: 'wsh' };

const NFL_FALLBACK_LOGO = 'https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png';

function nflTeamLogo(team, sizePx = 20) {
  const abbr = team ? (SLEEPER_TO_ESPN_ABBR[team] || team).toLowerCase() : null;
  const url = abbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png` : NFL_FALLBACK_LOGO;
  const style = `width:${sizePx}px;height:${sizePx}px;min-width:${sizePx}px;object-fit:contain;`;
  return `<img src="${url}" alt="${esc(team || 'NFL')}" style="${style}" onerror="this.src='${NFL_FALLBACK_LOGO}'">`;
}

/** Renders a circular avatar image, falling back to initials on error. */
function avatarImg(hash, name, sizePx = 32) {
  const url = avatarUrl(hash);
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const bg = nameToColor(name || '');
  const style = `width:${sizePx}px;height:${sizePx}px;min-width:${sizePx}px;font-size:${Math.round(sizePx * 0.38)}px`;

  if (url) {
    return `<img src="${url}" alt="${esc(name)}"
      style="${style};border-radius:50%;object-fit:cover;"
      onerror="this.outerHTML=\`<div class='avatar-fallback' style='${style};border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;'>${initials}</div>\`">`;
  }
  return `<div class="avatar-fallback" style="${style};border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;">${initials}</div>`;
}

function nameToColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue},45%,35%)`;
}

// ---------------------------------------------------------------------------
// Position badges
// ---------------------------------------------------------------------------

const POSITION_COLORS = {
  QB: '#6366f1', RB: '#10b981', WR: '#0ea5e9', TE: '#f97316',
  K:  '#64748b', DL: '#ef4444', LB: '#eab308', DB: '#a855f7',
  DE: '#ef4444', DT: '#ef4444', CB: '#a855f7', S: '#a855f7',
  FLEX: '#94a3b8', SUPER_FLEX: '#94a3b8', IDP_FLEX: '#94a3b8', DEF: '#94a3b8',
};

function positionBadge(pos) {
  const color = POSITION_COLORS[pos] || '#94a3b8';
  return `<span class="pos-badge" style="background:${color};color:#fff;border:1px solid ${color};">${esc(pos || '?')}</span>`;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatRecord(w, l, t) {
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function formatPts(pts) {
  return pts == null ? '—' : Number(pts).toFixed(1);
}

function diffClass(diff) {
  if (diff > 0) return 'text-emerald-400';
  if (diff < 0) return 'text-red-400';
  return 'text-slate-400';
}

function diffLabel(diff) {
  if (diff == null) return '—';
  const n = Number(diff).toFixed(1);
  return diff > 0 ? `+${n}` : n;
}

function epochToDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// URL params
// ---------------------------------------------------------------------------

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// ---------------------------------------------------------------------------
// Owner map helpers
// ---------------------------------------------------------------------------

/**
 * Builds a nested map: ownerMap[year][roster_id] = owner row.
 */
function buildOwnerMap(owners) {
  const map = {};
  for (const o of (owners || [])) {
    if (!map[o.year]) map[o.year] = {};
    map[o.year][o.roster_id] = o;
  }
  return map;
}

/**
 * Look up owner info by year + roster_id with a safe fallback.
 */
function getOwner(ownerMap, year, rosterId) {
  return (ownerMap[year] || {})[rosterId] || { display_name: 'Unknown', team_name: 'Unknown', avatar: null };
}

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

function skeletonRows(count, cols) {
  return Array.from({ length: count }, () => `
    <tr>
      ${Array.from({ length: cols }, (_, i) => `
        <td class="px-4 py-3">
          <div class="skeleton" style="height:14px;width:${60 + (i * 13) % 40}%;border-radius:4px;"></div>
        </td>`).join('')}
    </tr>`).join('');
}

function skeletonCards(count) {
  return Array.from({ length: count }, () =>
    `<div class="skeleton rounded-xl" style="height:120px;"></div>`
  ).join('');
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---------------------------------------------------------------------------
// Simple session cache
// ---------------------------------------------------------------------------

const _cache = {};
function cacheGet(key) {
  const entry = _cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > 5 * 60 * 1000) { delete _cache[key]; return null; }
  return entry.data;
}
function cacheSet(key, data) {
  _cache[key] = { data, ts: Date.now() };
  return data;
}

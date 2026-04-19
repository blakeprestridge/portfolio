const NAV_PAGES = [
  { label: 'Home',      href: 'index.html',     id: 'home'      },
  { label: 'Standings', href: 'standings.html',  id: 'standings' },
  { label: 'Teams',     href: 'teams.html',      id: 'teams'     },
  { label: 'Matchups',  href: 'matchups.html',   id: 'matchups'  },
  { label: 'Players',   href: 'players.html',    id: 'players'   },
  { label: 'Trades',    href: 'trades.html',     id: 'trades'    },
  { label: 'Draft',     href: 'draft.html',      id: 'draft'     },
  { label: 'Records',   href: 'records.html',    id: 'records'   },
];

const CHEVRON_SVG = `<svg style="width:10px;height:10px;flex-shrink:0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/>
</svg>`;

function _teamsDropdownSkeleton() {
  return [140, 120, 155, 130, 145, 120, 135, 150, 125, 140, 130, 160]
    .map(w => `<div class="skeleton" style="height:13px;width:${w}px;border-radius:4px;margin:5px 8px;"></div>`)
    .join('');
}

function renderNav(activePage) {
  const active = id => id === activePage;

  // Desktop links
  const desktopLinks = NAV_PAGES.map(p => {
    if (p.id === 'teams') {
      return `
        <div class="nav-dropdown">
          <a href="teams.html" class="nav-link${active('teams') ? ' nav-link--active' : ''}"
             style="gap:5px;">
            Teams ${CHEVRON_SVG}
          </a>
          <div class="nav-dropdown-menu" id="teams-dropdown-menu">
            ${_teamsDropdownSkeleton()}
          </div>
        </div>`;
    }
    return `<a href="${p.href}" class="nav-link${active(p.id) ? ' nav-link--active' : ''}">${p.label}</a>`;
  }).join('');

  // Mobile links
  const mobileLinks = NAV_PAGES.map(p => {
    if (p.id === 'teams') {
      return `
        <div>
          <button id="teams-mobile-btn"
                  class="nav-link${active('teams') ? ' nav-link--active' : ''}"
                  style="width:100%;justify-content:space-between;border:none;background:none;cursor:pointer;">
            <span>Teams</span>
            <svg id="teams-mobile-chevron" style="width:11px;height:11px;transition:transform 0.2s;"
                 fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
          <div id="teams-mobile-sub" class="hidden" style="padding-left:0.75rem;">
            ${_teamsDropdownSkeleton()}
          </div>
        </div>`;
    }
    return `<a href="${p.href}" class="nav-link${active(p.id) ? ' nav-link--active' : ''}">${p.label}</a>`;
  }).join('');

  document.getElementById('header-root').innerHTML = `
    <header style="background:#ffffff;border-bottom:3px solid #0D0F11;text-align:center;padding:1.25rem 1rem 0.75rem;">
      <a href="index.html" style="text-decoration:none;display:inline-flex;flex-direction:column;align-items:center;gap:0.25rem;">
        <img src="images/MLD_logo.png" alt="MLD" style="height:72px;width:auto;" />
        <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:2.25rem;letter-spacing:0.08em;text-transform:uppercase;color:#0D0F11;line-height:1;">Major League Dynasty</div>
        <div style="font-size:0.65rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#6b7280;margin-top:2px;">Est. 2016</div>
      </a>
    </header>`;

  document.getElementById('nav-root').innerHTML = `
    <nav style="background:#ffffff;border-bottom:1px solid #e5e7eb;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
      <div class="page-container" style="max-width:680px;margin:0 auto;padding:0 1rem;">

        <div class="hidden lg:flex items-center justify-center gap-1 h-11">
          ${desktopLinks}
        </div>

        <div class="lg:hidden flex items-center justify-between h-11">
          <a href="index.html" style="text-decoration:none;display:flex;align-items:center;">
            <img src="images/MLD_logo.png" alt="MLD" style="height:32px;width:auto;" />
          </a>
          <button id="mobile-menu-btn" class="p-2 rounded-md transition-colors" style="color:#2B3544;" aria-label="Menu">
            <svg id="icon-open"   class="w-6 h-6"        fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
            <svg id="icon-closed" class="w-6 h-6 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div id="mobile-menu" class="hidden lg:hidden pb-3 flex flex-col items-center gap-1">
          ${mobileLinks}
        </div>
      </div>
    </nav>`;

  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    const menu = document.getElementById('mobile-menu');
    const open = menu.classList.toggle('hidden');
    document.getElementById('icon-open').classList.toggle('hidden', !open);
    document.getElementById('icon-closed').classList.toggle('hidden', open);
  });

  document.getElementById('teams-mobile-btn')?.addEventListener('click', () => {
    const sub     = document.getElementById('teams-mobile-sub');
    const chevron = document.getElementById('teams-mobile-chevron');
    const nowHidden = sub.classList.toggle('hidden');
    chevron.style.transform = nowHidden ? '' : 'rotate(180deg)';
  });

  _loadTeamsDropdown();
}

async function _loadTeamsDropdown() {
  if (!window.db) return;
  try {
    const { data: owners, error } = await window.db
      .from('owners')
      .select('roster_id,display_name,avatar')
      .eq('year', CURRENT_YEAR)
      .order('display_name');

    if (error || !owners?.length) return;

    const desktopItems =
      `<a href="teams.html" class="nav-dropdown-item" style="color:#6366f1;font-size:0.75rem;padding:0.3rem 0.625rem;">
         All Teams &rarr;
       </a>
       <hr style="border:none;border-top:1px solid #e5e7eb;margin:4px 0;">` +
      owners.map(o => `
      <a href="team.html?roster_id=${o.roster_id}" class="nav-dropdown-item">
        ${avatarImg(o.avatar, o.display_name, 22)}
        ${esc(o.display_name)}
      </a>`).join('');

    const mobileItems =
      `<a href="teams.html" class="nav-link"
          style="display:flex;align-items:center;gap:8px;padding:0.3rem 0.5rem;font-size:0.78rem;justify-content:flex-start;color:#6366f1;">
         All Teams &rarr;
       </a>` +
      owners.map(o => `
      <a href="team.html?roster_id=${o.roster_id}"
         class="nav-link"
         style="display:flex;align-items:center;gap:8px;padding:0.3rem 0.5rem;font-size:0.78rem;justify-content:flex-start;">
        ${avatarImg(o.avatar, o.display_name, 20)}
        ${esc(o.display_name)}
      </a>`).join('');

    const desktopMenu = document.getElementById('teams-dropdown-menu');
    if (desktopMenu) desktopMenu.innerHTML = desktopItems;

    const mobileSub = document.getElementById('teams-mobile-sub');
    if (mobileSub) mobileSub.innerHTML = mobileItems;

  } catch (err) {
    console.error('Failed to load teams dropdown:', err);
  }
}

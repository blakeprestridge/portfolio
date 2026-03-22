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

function renderNav(activePage) {
  const links = NAV_PAGES.map(p => {
    const active = p.id === activePage;
    return `<a href="${p.href}" class="nav-link${active ? ' nav-link--active' : ''}">${p.label}</a>`;
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
          ${links}
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
          ${links}
        </div>
      </div>
    </nav>`;

  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    const menu = document.getElementById('mobile-menu');
    const open = menu.classList.toggle('hidden');
    document.getElementById('icon-open').classList.toggle('hidden', !open);
    document.getElementById('icon-closed').classList.toggle('hidden', open);
  });
}

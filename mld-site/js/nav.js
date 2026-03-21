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

  document.getElementById('nav-root').innerHTML = `
    <nav class="sticky top-0 z-50 border-b border-slate-800" style="background:rgba(15,23,42,0.97);backdrop-filter:blur(8px);">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">

          <a href="index.html" class="flex items-center gap-3 no-underline">
            <span class="text-2xl font-black text-gold leading-none">MLD</span>
            <span class="hidden sm:block text-xs font-semibold text-slate-500 uppercase tracking-widest">Major League Dynasty</span>
          </a>

          <div class="hidden lg:flex items-center gap-1">
            ${links}
          </div>

          <button id="mobile-menu-btn" class="lg:hidden p-2 rounded-md text-slate-400 hover:text-white transition-colors" aria-label="Menu">
            <svg id="icon-open"   class="w-6 h-6"        fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
            <svg id="icon-closed" class="w-6 h-6 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div id="mobile-menu" class="hidden lg:hidden pb-4 flex flex-col gap-1">
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

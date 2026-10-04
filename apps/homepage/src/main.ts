// Apple HIG & macOS Native Startpage Controller

interface Engine {
  id: string;
  name: string;
  url: string;
  icon: string;
}

interface DockSite {
  id: string;
  name: string;
  url: string;
}

const ENGINES: Engine[] = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=', icon: 'https://www.google.com/favicon.ico' },
  { id: 'github', name: 'GitHub', url: 'https://github.com/search?q=', icon: 'https://github.githubassets.com/favicons/favicon.svg' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=', icon: 'https://www.bing.com/favicon.ico' },
  { id: 'bilibili', name: 'Bilibili', url: 'https://search.bilibili.com/all?keyword=', icon: 'https://www.bilibili.com/favicon.ico' },
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=', icon: 'https://www.baidu.com/favicon.ico' },
];

const DEFAULT_SITES: DockSite[] = [
  { id: 'd1', name: 'GitHub', url: 'https://github.com' },
  { id: 'd2', name: 'Claude', url: 'https://claude.ai' },
  { id: 'd3', name: 'ChatGPT', url: 'https://chatgpt.com' },
  { id: 'd4', name: 'Linear', url: 'https://linear.app' },
  { id: 'd5', name: 'YouTube', url: 'https://www.youtube.com' },
  { id: 'd6', name: 'Bilibili', url: 'https://www.bilibili.com' },
  { id: 'd7', name: 'V2EX', url: 'https://www.v2ex.com' },
  { id: 'd8', name: 'Rust Docs', url: 'https://doc.rust-lang.org/book/' },
];

class AppleStartpage {
  private activeEngineIndex = 0;
  private dockSites: DockSite[] = [];

  constructor() {
    this.loadState();
    this.initClock();
    this.renderEngine();
    this.renderDock();
    this.initSearch();
    this.initSheet();
    this.initKeybindings();
  }

  private loadState() {
    try {
      const savedEngine = localStorage.getItem('apple_engine');
      if (savedEngine) {
        const idx = ENGINES.findIndex(e => e.id === savedEngine);
        if (idx !== -1) this.activeEngineIndex = idx;
      }

      const savedSites = localStorage.getItem('apple_sites');
      if (savedSites) {
        this.dockSites = JSON.parse(savedSites);
      } else {
        this.dockSites = [...DEFAULT_SITES];
        this.saveSites();
      }
    } catch {
      this.dockSites = [...DEFAULT_SITES];
    }
  }

  private saveSites() {
    localStorage.setItem('apple_sites', JSON.stringify(this.dockSites));
  }

  // 1. Apple Ultralight Clock & Date
  private initClock() {
    const clockEl = document.getElementById('liveClock');
    const dateEl = document.getElementById('liveDate');

    const update = () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      if (clockEl) {
        clockEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      }
      if (dateEl) {
        const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        dateEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${days[now.getDay()]}`;
      }
    };

    update();
    setInterval(update, 1000);
  }

  // 2. Spotlight Engine Switcher
  private renderEngine() {
    const current = ENGINES[this.activeEngineIndex];
    const iconEl = document.getElementById('engineIcon') as HTMLImageElement | null;
    const labelEl = document.getElementById('engineLabel');
    const inputEl = document.getElementById('spotlightInput') as HTMLInputElement | null;

    if (iconEl) iconEl.src = current.icon;
    if (labelEl) labelEl.textContent = current.name;
    if (inputEl) inputEl.placeholder = `在 ${current.name} 聚焦搜索或输入网址...`;

    const items = document.querySelectorAll('.menu-item');
    items.forEach((item, idx) => {
      if (idx === this.activeEngineIndex) item.classList.add('active');
      else item.classList.remove('active');
    });
  }

  private cycleEngine() {
    this.activeEngineIndex = (this.activeEngineIndex + 1) % ENGINES.length;
    localStorage.setItem('apple_engine', ENGINES[this.activeEngineIndex].id);
    this.renderEngine();
  }

  private initSearch() {
    const form = document.getElementById('spotlightForm');
    const input = document.getElementById('spotlightInput') as HTMLInputElement | null;
    const engineBtn = document.getElementById('engineBtn');
    const menu = document.getElementById('engineMenu');

    engineBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      menu?.classList.toggle('open');
    });

    document.addEventListener('click', () => menu?.classList.remove('open'));

    const items = document.querySelectorAll('.menu-item');
    items.forEach((item, idx) => {
      item.addEventListener('click', () => {
        this.activeEngineIndex = idx;
        localStorage.setItem('apple_engine', ENGINES[idx].id);
        this.renderEngine();
        menu?.classList.remove('open');
        input?.focus();
      });
    });

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input) return;
      const q = input.value.trim();
      if (!q) return;

      const isUrl = /^((https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?)$/i.test(q) && !q.includes(' ');
      if (isUrl) {
        window.location.href = q.startsWith('http') ? q : `https://${q}`;
        return;
      }

      const eng = ENGINES[this.activeEngineIndex];
      window.location.href = `${eng.url}${encodeURIComponent(q)}`;
    });
  }

  // 3. Apple Squircle Dock
  private getDomainMeta(url: string) {
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`);
      return {
        host: u.hostname.replace('www.', ''),
        icon: `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`,
      };
    } catch {
      return { host: url, icon: '' };
    }
  }

  private renderDock() {
    const shelf = document.getElementById('dockShelf');
    if (!shelf) return;
    shelf.innerHTML = '';

    this.dockSites.forEach(site => {
      const tile = document.createElement('a');
      tile.className = 'dock-tile';
      tile.href = site.url;

      const meta = this.getDomainMeta(site.url);
      const initial = site.name.charAt(0).toUpperCase();

      tile.innerHTML = `
        <div class="app-squircle">
          <img class="app-icon" src="${meta.icon}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';" />
          <span class="app-initial" style="display:none;">${initial}</span>
        </div>
        <div class="app-info">
          <span class="app-name">${site.name}</span>
          <span class="app-domain">${meta.host}</span>
        </div>
        <button type="button" class="tile-delete-btn" title="移除">✕</button>
      `;

      const delBtn = tile.querySelector('.tile-delete-btn');
      delBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dockSites = this.dockSites.filter(s => s.id !== site.id);
        this.saveSites();
        this.renderDock();
      });

      shelf.appendChild(tile);
    });

    // Add Tile
    const addTile = document.createElement('div');
    addTile.className = 'dock-tile dock-tile-add';
    addTile.title = '添加自定义站点';
    addTile.innerHTML = `
      <div class="app-squircle">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </div>
      <div class="app-info">
        <span class="app-name">添��站点</span>
        <span class="app-domain">Shortcut</span>
      </div>
    `;

    addTile.addEventListener('click', () => {
      this.openSheet();
    });

    shelf.appendChild(addTile);
  }

  // 4. macOS Sheet Dialog
  private openSheet() {
    const scrim = document.getElementById('sheetScrim');
    const form = document.getElementById('sheetForm') as HTMLFormElement | null;
    form?.reset();
    scrim?.classList.add('open');
    (document.getElementById('siteTitleInput') as HTMLInputElement)?.focus();
  }

  private closeSheet() {
    document.getElementById('sheetScrim')?.classList.remove('open');
  }

  private initSheet() {
    const cancelBtn = document.getElementById('sheetCancelBtn');
    const closeBtn = document.getElementById('sheetCloseBtn');
    const form = document.getElementById('sheetForm') as HTMLFormElement | null;

    cancelBtn?.addEventListener('click', () => this.closeSheet());
    closeBtn?.addEventListener('click', () => this.closeSheet());

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = (document.getElementById('siteTitleInput') as HTMLInputElement).value.trim();
      let url = (document.getElementById('siteUrlInput') as HTMLInputElement).value.trim();

      if (name && url) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`;
        }
        this.dockSites.push({ id: `site-${Date.now()}`, name, url });
        this.saveSites();
        this.renderDock();
        this.closeSheet();
      }
    });
  }

  // 5. Keybindings & Haptics
  private initKeybindings() {
    const input = document.getElementById('spotlightInput') as HTMLInputElement | null;

    window.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      const isInput = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA';

      // Tab cycles search engine
      if (e.key === 'Tab' && (!isInput || activeEl === input)) {
        e.preventDefault();
        this.cycleEngine();
        return;
      }

      // / or Space focuses spotlight if not typing
      if ((e.key === '/' || e.code === 'Space') && !isInput) {
        e.preventDefault();
        input?.focus();
        input?.select();
        return;
      }

      // Esc dismisses sheet / dropdown
      if (e.key === 'Escape') {
        this.closeSheet();
        document.getElementById('engineMenu')?.classList.remove('open');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new AppleStartpage();
});

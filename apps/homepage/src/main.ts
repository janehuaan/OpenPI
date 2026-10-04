// Zen Command Startpage - Pure, Fast, Zero-Clutter Architecture

interface Engine {
  id: string;
  name: string;
  url: string;
  icon: string;
}

interface ShortcutItem {
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

const DEFAULT_SHORTCUTS: ShortcutItem[] = [
  { id: 's1', name: 'GitHub', url: 'https://github.com' },
  { id: 's2', name: 'Claude', url: 'https://claude.ai' },
  { id: 's3', name: 'ChatGPT', url: 'https://chatgpt.com' },
  { id: 's4', name: 'Linear', url: 'https://linear.app' },
  { id: 's5', name: 'YouTube', url: 'https://www.youtube.com' },
  { id: 's6', name: 'Bilibili', url: 'https://www.bilibili.com' },
  { id: 's7', name: 'V2EX', url: 'https://www.v2ex.com' },
  { id: 's8', name: 'Rust Docs', url: 'https://doc.rust-lang.org/book/' },
];

class ZenStartpage {
  private activeEngineIndex = 0;
  private shortcuts: ShortcutItem[] = [];

  constructor() {
    this.loadState();
    this.initClock();
    this.renderEngine();
    this.renderShortcuts();
    this.initSearch();
    this.initModal();
    this.initKeybindings();
  }

  private loadState() {
    try {
      const savedEngine = localStorage.getItem('zen_engine');
      if (savedEngine) {
        const idx = ENGINES.findIndex(e => e.id === savedEngine);
        if (idx !== -1) this.activeEngineIndex = idx;
      }

      const savedShortcuts = localStorage.getItem('zen_shortcuts');
      if (savedShortcuts) {
        this.shortcuts = JSON.parse(savedShortcuts);
      } else {
        this.shortcuts = [...DEFAULT_SHORTCUTS];
        this.saveShortcuts();
      }
    } catch {
      this.shortcuts = [...DEFAULT_SHORTCUTS];
    }
  }

  private saveShortcuts() {
    localStorage.setItem('zen_shortcuts', JSON.stringify(this.shortcuts));
  }

  // 大时钟与日期
  private initClock() {
    const timeEl = document.getElementById('heroTime');
    const dateEl = document.getElementById('headerDate');

    const update = () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      if (timeEl) {
        timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      }
      if (dateEl) {
        const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '��期五', '星期六'];
        dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${days[now.getDay()]}`;
      }
    };

    update();
    setInterval(update, 1000);
  }

  // 搜索引擎切换
  private renderEngine() {
    const current = ENGINES[this.activeEngineIndex];
    const iconEl = document.getElementById('engineIcon') as HTMLImageElement | null;
    const labelEl = document.getElementById('engineLabel');
    const inputEl = document.getElementById('searchInput') as HTMLInputElement | null;

    if (iconEl) iconEl.src = current.icon;
    if (labelEl) labelEl.textContent = current.name;
    if (inputEl) inputEl.placeholder = `在 ${current.name} 中搜索或直达网址...`;

    const items = document.querySelectorAll('.engine-item');
    items.forEach((item, idx) => {
      if (idx === this.activeEngineIndex) item.classList.add('active');
      else item.classList.remove('active');
    });
  }

  private cycleEngine() {
    this.activeEngineIndex = (this.activeEngineIndex + 1) % ENGINES.length;
    localStorage.setItem('zen_engine', ENGINES[this.activeEngineIndex].id);
    this.renderEngine();
  }

  private initSearch() {
    const form = document.getElementById('searchForm');
    const input = document.getElementById('searchInput') as HTMLInputElement | null;
    const engineBtn = document.getElementById('engineBtn');
    const menu = document.getElementById('engineMenu');

    engineBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      menu?.classList.toggle('open');
    });

    document.addEventListener('click', () => menu?.classList.remove('open'));

    const items = document.querySelectorAll('.engine-item');
    items.forEach((item, idx) => {
      item.addEventListener('click', () => {
        this.activeEngineIndex = idx;
        localStorage.setItem('zen_engine', ENGINES[idx].id);
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

  // 快捷磁贴
  private getDomainMeta(url: string) {
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`);
      return {
        host: u.hostname.replace('www.', ''),
        icon: `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=48`,
      };
    } catch {
      return { host: url, icon: '' };
    }
  }

  private renderShortcuts() {
    const grid = document.getElementById('rackGrid');
    if (!grid) return;
    grid.innerHTML = '';

    this.shortcuts.forEach(item => {
      const card = document.createElement('a');
      card.className = 'rack-card';
      card.href = item.url;

      const meta = this.getDomainMeta(item.url);
      const initial = item.name.charAt(0).toUpperCase();

      card.innerHTML = `
        <div class="rack-icon-wrap">
          <img class="rack-favicon" src="${meta.icon}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
          <span style="display:none; font-weight:700; color:#fff;">${initial}</span>
        </div>
        <span class="rack-title" title="${item.name}">${item.name}</span>
        <span class="rack-domain">${meta.host}</span>
        <button type="button" class="rack-del-btn" title="删除该捷径">✕</button>
      `;

      const delBtn = card.querySelector('.rack-del-btn');
      delBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.shortcuts = this.shortcuts.filter(s => s.id !== item.id);
        this.saveShortcuts();
        this.renderShortcuts();
      });

      grid.appendChild(card);
    });

    // 末尾添加按钮
    const addCard = document.createElement('div');
    addCard.className = 'rack-card add-card';
    addCard.title = '添加自定义捷径';
    addCard.innerHTML = `
      <div class="rack-icon-wrap">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </div>
      <span class="rack-title">添加站点</span>
      <span class="rack-domain">Shortcut</span>
    `;

    addCard.addEventListener('click', () => {
      this.openModal();
    });

    grid.appendChild(addCard);
  }

  // 模态弹窗
  private openModal() {
    const modal = document.getElementById('siteModal');
    const form = document.getElementById('siteForm') as HTMLFormElement | null;
    form?.reset();
    modal?.classList.add('open');
    (document.getElementById('siteNameInput') as HTMLInputElement)?.focus();
  }

  private closeModal() {
    document.getElementById('siteModal')?.classList.remove('open');
  }

  private initModal() {
    const cancelBtn = document.getElementById('modalCancelBtn');
    const closeBtn = document.getElementById('modalCloseBtn');
    const form = document.getElementById('siteForm') as HTMLFormElement | null;

    cancelBtn?.addEventListener('click', () => this.closeModal());
    closeBtn?.addEventListener('click', () => this.closeModal());

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = (document.getElementById('siteNameInput') as HTMLInputElement).value.trim();
      let url = (document.getElementById('siteUrlInput') as HTMLInputElement).value.trim();

      if (name && url) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`;
        }
        this.shortcuts.push({ id: `s-${Date.now()}`, name, url });
        this.saveShortcuts();
        this.renderShortcuts();
        this.closeModal();
      }
    });
  }

  // 键盘快捷键
  private initKeybindings() {
    const input = document.getElementById('searchInput') as HTMLInputElement | null;

    window.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      const isInput = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA';

      if (e.key === 'Tab' && (!isInput || activeEl === input)) {
        e.preventDefault();
        this.cycleEngine();
        return;
      }

      if (e.key === '/' && !isInput) {
        e.preventDefault();
        input?.focus();
        input?.select();
        return;
      }

      if (e.key === 'Escape') {
        this.closeModal();
        document.getElementById('engineMenu')?.classList.remove('open');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ZenStartpage();
});

(function (global) {
  'use strict';

  const INDEX_KEY = 'life_health_index_v1';
  const FAV_KEY = 'life_health_favorites';
  const OFFICIAL_SEARCH = 'https://www.msdmanuals.cn/home/searchresults?query=';
  const TIPS = [
    { text: '记录月经周期、经量和伴随症状，有助于发现异常变化。若出血量突然增多、经期明显延长或疼痛加重，建议及时就医。', cat: 'menstrual' },
    { text: '备孕期间保持规律作息，提前补充叶酸，并可就用药、疫苗和基础疾病咨询医生。', cat: 'infertility' },
    { text: '孕期出现阴道流血、剧烈腹痛、持续呕吐或明显水肿时，不要等待，应尽快就医。', cat: 'pregnancy-symptoms' },
    { text: '产后情绪低落很常见，但若持续两周以上或影响照顾自己和宝宝，请主动寻求专业帮助。', cat: 'postpartum' },
    { text: '更年期潮热、睡眠和情绪变化因人而异。症状明显影响生活时，可与医生讨论个体化方案。', cat: 'menopause' },
    { text: '乳房出现新肿块、乳头溢液或皮肤改变时，建议尽快到正规医疗机构评估。', cat: 'breast' },
    { text: '阴道分泌物的颜色、气味和伴随瘙痒变化可能提示感染，不建议自行反复用药。', cat: 'infection' },
    { text: '避孕方式需要结合健康状况、生育计划和便利性选择，可向医生咨询适合自己的方案。', cat: 'contraception' }
  ];
  let index = null;
  let loading = null;
  let activeCategory = 'all';
  let query = '';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function allLinks() {
    if (!index) return [];
    return index.categories.reduce((out, cat) => {
      cat.links.forEach(link => out.push({ ...link, categoryId: cat.id, categoryName: cat.name, categoryIcon: cat.icon, categoryStages: cat.stages }));
      return out;
    }, []);
  }

  function getFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  }

  function saveFavorites(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch {}
  }

  function isFavorite(url) {
    return getFavorites().includes(url);
  }

  function toggleFavorite(url) {
    const list = getFavorites();
    const next = list.includes(url) ? list.filter(x => x !== url) : list.concat(url);
    saveFavorites(next);
    renderResults();
  }

  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    loading = fetch(new URL('health-links.json', document.baseURI).href, { cache: 'no-cache' })
      .then(response => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(data => {
        index = data;
        try { localStorage.setItem(INDEX_KEY, JSON.stringify(data)); } catch {}
        return data;
      })
      .catch(error => {
        try {
          const cached = localStorage.getItem(INDEX_KEY);
          if (cached) { index = JSON.parse(cached); return index; }
        } catch {}
        throw error;
      })
      .finally(() => { loading = null; });
    return loading;
  }

  function statusText(text) {
    const el = document.getElementById('healthIndexStatus');
    if (el) el.textContent = text;
  }

  function renderCategories() {
    const cont = document.getElementById('healthCategories');
    if (!cont) return;
    const favorites = getFavorites();
    const chips = [
      `<button class="health-category-chip ${activeCategory === 'all' ? 'active' : ''}" data-health-cat="all">全部</button>`,
      `<button class="health-category-chip ${activeCategory === 'favorites' ? 'active' : ''}" data-health-cat="favorites">⭐ 收藏</button>`
    ];
    (index.categories || []).forEach(cat => {
      chips.push(`<button class="health-category-chip ${activeCategory === cat.id ? 'active' : ''}" data-health-cat="${esc(cat.id)}">${esc(cat.icon)} ${esc(cat.name)}</button>`);
    });
    cont.innerHTML = chips.join('');
    cont.querySelectorAll('[data-health-cat]').forEach(btn => {
      btn.addEventListener('click', () => setCategory(btn.dataset.healthCat));
    });
  }

  function setCategory(cat) {
    activeCategory = cat;
    query = '';
    const input = document.getElementById('healthSearchInput');
    if (input) input.value = '';
    renderHome();
  }

  function matches(link, q) {
    if (!q) return true;
    const haystack = [link.title, link.categoryName, ...(link.tags || []), ...(link.keywords || [])].join(' ').toLowerCase();
    return haystack.includes(q);
  }

  function linkMarkup(link) {
    const fav = isFavorite(link.url);
    return `<div class="health-link-row">
      <a class="health-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">
        <div class="health-link-title">${esc(link.title)}</div>
        <div class="health-link-meta">${esc(link.categoryIcon || '')} ${esc(link.categoryName || '')} · 默沙东诊疗手册</div>
      </a>
      <button class="health-fav ${fav ? 'active' : ''}" data-health-fav="${esc(link.url)}" title="${fav ? '取消收藏' : '收藏'}" aria-label="${fav ? '取消收藏' : '收藏'}">${fav ? '★' : '☆'}</button>
    </div>`;
  }

  function renderResults() {
    if (!index) return;
    const results = document.getElementById('healthResults');
    const notice = document.getElementById('healthSearchNotice');
    if (!results) return;
    let list = allLinks();
    if (query) {
      list = list.filter(link => matches(link, query));
    } else if (activeCategory === 'favorites') {
      const favs = getFavorites();
      list = list.filter(link => favs.includes(link.url));
    } else if (activeCategory !== 'all') {
      list = list.filter(link => link.categoryId === activeCategory);
    }
    if (notice) {
      notice.style.display = 'none';
      notice.innerHTML = '';
    }
    if (!list.length) {
      results.innerHTML = `<div class="health-empty">${query ? '本地索引没有找到匹配内容。' : activeCategory === 'favorites' ? '还没有收藏任何条目。' : '暂无条目。'}</div>`;
      if (query && notice) {
        notice.style.display = 'block';
        notice.innerHTML = `可前往默沙东诊疗手册官方站内搜索：<a href="${OFFICIAL_SEARCH + encodeURIComponent(query)}" target="_blank" rel="noopener noreferrer">搜索“${esc(query)}” →</a>`;
      }
      return;
    }
    results.innerHTML = list.map(linkMarkup).join('') + (query ? `<div class="health-search-notice">以上为本地索引结果；也可<a href="${OFFICIAL_SEARCH + encodeURIComponent(query)}" target="_blank" rel="noopener noreferrer">在默沙东官方站内搜索“${esc(query)}”</a>。</div>` : '');
    results.querySelectorAll('[data-health-fav]').forEach(btn => {
      btn.addEventListener('click', () => toggleFavorite(btn.dataset.healthFav));
    });
  }

  function renderHome() {
    if (!index) {
      statusText('正在加载本地健康索引…');
      loadIndex().then(() => {
        renderHome();
        if (typeof global.renderTodayHealth === 'function') global.renderTodayHealth();
      }).catch(() => {
        statusText('健康索引未加载。联网后会自动重试；也可以直接使用默沙东官方站内搜索。');
      });
      return;
    }
    const total = allLinks().length;
    statusText(`已收录 ${total} 个官方主题 · 仅提供链接，不复制内容`);
    renderCategories();
    renderResults();
  }

  function search(value) {
    query = String(value || '').trim().toLowerCase();
    activeCategory = 'all';
    renderHome();
  }

  function renderRelated(stage, elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const run = () => {
      if (!index) { el.innerHTML = ''; return; }
      const list = allLinks().filter(link => (link.tags || []).includes(stage)).slice(0, 4);
      if (!list.length) { el.innerHTML = ''; return; }
      el.innerHTML = list.map(link => `<a class="health-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer"><div class="health-link-title">${esc(link.title)}</div><div class="health-link-meta">默沙东诊疗手册 · 仅供参考</div></a>`).join('');
    };
    if (index) run();
    else loadIndex().then(run).catch(() => { el.innerHTML = ''; });
  }

  function getDailyTip() {
    const now = new Date();
    const day = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const tip = TIPS[day % TIPS.length];
    const cat = index && index.categories.find(c => c.id === tip.cat);
    const link = cat && cat.links[0];
    if (!link) return esc(tip.text);
    return `<div class="muted" style="margin-bottom:10px;">${esc(tip.text)}</div><a class="health-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer"><div class="health-link-title">${esc(link.title)} →</div><div class="health-link-meta">默沙东诊疗手册 · 仅供参考</div></a>`;
  }

  global.LifeHealth = {
    loadIndex,
    renderHome,
    renderResults,
    renderRelated,
    search,
    setCategory,
    getDailyTip,
    isReady: () => !!index,
    allLinks
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => loadIndex().catch(() => {}));
  } else {
    loadIndex().catch(() => {});
  }
})(window);

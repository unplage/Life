const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const { webcrypto } = require('node:crypto');
const { TextEncoder, TextDecoder } = require('node:util');

const ROOT = path.resolve(__dirname, '..');
const HEALTH_JSON = fs.readFileSync(path.join(ROOT, 'health-links.json'), 'utf8');
let HEALTH_JS = fs.readFileSync(path.join(ROOT, 'health.js'), 'utf8');

function prepareHtml() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace('<script src="./echarts.min.js" defer></script>', '');
  html = html.replace('<script src="./health.js"></script>', `<script>${HEALTH_JS}</script>`);
  return html;
}

async function waitFor(fn, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fn()) return true;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('waitFor timeout');
}

async function createApp(options = {}) {
  const alerts = [];
  const prompts = [];
  let confirmValue = true;
  const factory = new IDBFactory();
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => {
    if (!/Not implemented: navigation/.test(error.message)) console.error(error);
  });
  const dom = new JSDOM(prepareHtml(), {
    url: 'https://example.test/Life/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.indexedDB = factory;
      window.IDBKeyRange = IDBKeyRange;
      window.alert = message => alerts.push(String(message));
      window.confirm = () => confirmValue;
      window.prompt = () => prompts.length ? prompts.shift() : null;
      window.fetch = async url => {
        const target = String(url);
        if (target.includes('health-links.json')) {
          return { ok: true, status: 200, json: async () => JSON.parse(HEALTH_JSON) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      };
      window.__downloads = [];
      window.__blobs = new Map();
      let blobSeq = 0;
      window.URL.createObjectURL = blob => {
        const url = 'blob:test-' + (++blobSeq);
        window.__blobs.set(url, blob);
        return url;
      };
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = function () {
        window.__downloads.push({ href: this.href, download: this.download });
      };
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.scrollTo = () => {};
      window.Notification = class {
        static permission = 'denied';
        static requestPermission = async () => 'denied';
        constructor() {}
      };
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    }
  });
  const window = dom.window;
  await waitFor(() => window.__lifeReady === true);
  await new Promise(r => setTimeout(r, 80));
  return {
    dom,
    window,
    alerts,
    prompts,
    setConfirm(value) { confirmValue = value; },
    async readBlob(blob) {
      return new Promise((resolve, reject) => {
        const reader = new window.FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsText(blob);
      });
    },
    lastDownload() {
      const item = window.__downloads[window.__downloads.length - 1];
      if (!item) return null;
      return { ...item, blob: window.__blobs.get(item.href) };
    },
    async close() { await new Promise(r => setTimeout(r, 250)); dom.window.close(); }
  };
}

test('pure date and cycle logic', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const d = t.parseLocalDate('2026-11-10');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 10);
    assert.equal(d.getDate(), 10);
    assert.equal(t.getLocalDateString(d), '2026-11-10');
    assert.equal(t.normalizeDateString('2026年1月2日'), '2026-01-02');
    assert.equal(t.normalizeDateString('not-a-date'), null);
    assert.equal(t.normalizeDateString('2026-02-30'), null);
    assert.equal(t.normalizeDateString('2026/2/28'), '2026-02-28');
    assert.equal(t.normalizeDateString('2026-02-28abc'), null);
    const todayStr = t.getLocalDateString();
    const todayDate = t.parseLocalDate(todayStr);
    assert.equal(t.calculateCountdown(todayStr).text, '今天');
    assert.equal(t.calculateCountdown(t.getLocalDateString(t.addDays(todayDate, -1))).text, '已过去');
    assert.equal(t.calculateCountdown(t.getLocalDateString(t.addDays(todayDate, 1))).text, '1天');

    const pred = t.predictCycle([
      { startDate: '2026-01-01' },
      { startDate: '2026-01-29' },
      { startDate: '2026-02-26' }
    ], '2026-03-01');
    assert.equal(pred.hasData, true);
    assert.equal(pred.avgCycle, 28);
    assert.equal(pred.cycleDay, 4);
    assert.equal(t.getLocalDateString(pred.nextStart), '2026-03-26');
    assert.equal(pred.daysToNext, 25);
    assert.equal(pred.isLate, false);

    const irregular = t.predictCycle([
      { startDate: '2026-01-01' },
      { startDate: '2026-01-22' },
      { startDate: '2026-02-26' }
    ], '2026-03-01');
    assert.equal(irregular.isIrregular, true);

    const lunar = t.parseLunarDate('1999-09-09');
    assert.equal(lunar.year, 1999);
    assert.equal(lunar.month, 9);
    assert.equal(lunar.day, 9);
    assert.equal(t.parseLunarDate('1899-09-09'), null);
  } finally { await app.close(); }
});

test('anniversary today is shown as today, not next year', async () => {
  const app = await createApp();
  try {
    const today = app.window.__lifeTest.getLocalDateString();
    await app.window.__lifeTest.db.addData('couple_info', { maleName: '先生', femaleName: '女士', meetDate: today });
    await app.window.renderAnniversary();
    const text = app.window.document.getElementById('upcomingList').textContent;
    assert.match(text, /相识纪念/);
    assert.match(text, /今天/);
  } finally { await app.close(); }
});

test('period create, edit, delete and history labels', async () => {
  const app = await createApp();
  try {
    const doc = app.window.document;
    const today = app.window.__lifeTest.getLocalDateString();
    doc.getElementById('periodStart').value = today;
    doc.getElementById('periodFlow').value = '中';
    doc.getElementById('periodPain').value = '轻';
    doc.getElementById('periodNotes').value = '测试备注';
    doc.querySelector('.period-symptom[value="痛经"]').checked = true;
    await app.window.savePeriod();
    await new Promise(r => setTimeout(r, 50));
    let periods = await app.window.__lifeTest.db.getAllData('periods');
    assert.equal(periods.length, 1);
    assert.equal(periods[0].flow, '中');
    assert.equal(periods[0].notes, '测试备注');
    assert.match(doc.getElementById('periodHistory').textContent, /流量中/);
    assert.match(doc.getElementById('periodHistory').textContent, /测试备注/);

    await app.window.editPeriod(periods[0].id);
    assert.equal(doc.getElementById('periodFlow').value, '中');
    assert.equal(doc.getElementById('periodNotes').value, '测试备注');
    assert.equal(doc.getElementById('periodSaveBtn').textContent, '更新记录');

    app.setConfirm(true);
    await app.window.deletePeriod(periods[0].id);
    await new Promise(r => setTimeout(r, 50));
    periods = await app.window.__lifeTest.db.getAllData('periods');
    assert.equal(periods.length, 0);
    assert.equal(doc.getElementById('periodStart').value, today);
  } finally { await app.close(); }
});

test('diary detail closes and deletes with the correct modal id', async () => {
  const app = await createApp();
  try {
    const doc = app.window.document;
    await app.window.__lifeTest.db.addData('diaries', { date: '2026-11-10', title: '标题', content: '内容', mood: 'happy', timestamp: Date.now() });
    const list = await app.window.__lifeTest.db.getAllData('diaries');
    await app.window.showDiaryDetail(list[0].id);
    assert.equal(doc.getElementById('diaryModal').classList.contains('active'), true);
    app.setConfirm(true);
    await app.window.deleteDiary(list[0].id);
    assert.equal(doc.getElementById('diaryModal').classList.contains('active'), false);
    assert.equal((await app.window.__lifeTest.db.getAllData('diaries')).length, 0);
  } finally { await app.close(); }
});

test('vaccine stores nextDate and renders it', async () => {
  const app = await createApp();
  try {
    const doc = app.window.document;
    doc.getElementById('vaccineName').value = '流感疫苗';
    doc.getElementById('vaccineDate').value = '2026-11-01';
    doc.getElementById('vaccineNext').value = '2027-11-01';
    await app.window.addVaccine();
    const list = await app.window.__lifeTest.db.getAllData('vaccines');
    assert.equal(list.length, 1);
    assert.equal(list[0].nextDate, '2027-11-01');
    assert.equal(list[0].next, undefined);
    await app.window.loadVaccines();
    assert.match(doc.getElementById('vaccineList').textContent, /2027-11-01/);
  } finally { await app.close(); }
});

test('user text is escaped in outfit history and closet categories', async () => {
  const app = await createApp();
  try {
    const doc = app.window.document;
    await app.window.__lifeTest.db.addData('outfits', { date: '2026-11-10', note: '<img src="x" onerror="alert(1)">', temp: 20, timestamp: Date.now() });
    await app.window.loadOutfitHistory();
    const history = doc.getElementById('outfitHistory');
    assert.match(history.textContent, /<img src="x"/);
    assert.equal(history.querySelector('img[src="x"]'), null);

    await app.window.__lifeTest.db.addData('closetCategories', { name: '<script>window.__xss=1</script>' });
    await app.window.loadClosetCategories();
    assert.equal(doc.querySelector('#closetCategories script'), null);
    assert.equal(app.window.__xss, undefined);
    assert.match(doc.getElementById('closetCategories').textContent, /<script>/);
  } finally { await app.close(); }
});

test('local health index, search, favorites and related links', async () => {
  const app = await createApp();
  try {
    const health = app.window.LifeHealth;
    const data = await health.loadIndex();
    const total = data.categories.reduce((n, c) => n + c.links.length, 0);
    assert.equal(total, 158);
    health.renderHome();
    assert.match(app.window.document.getElementById('healthIndexStatus').textContent, /158/);
    health.search('痛经');
    const results = app.window.document.getElementById('healthResults');
    assert.match(results.textContent, /痛经/);
    const firstLink = results.querySelector('a.health-link');
    assert.ok(firstLink);
    assert.match(firstLink.href, /^https:\/\/www\.msdmanuals\.cn\//);
    assert.equal(firstLink.target, '_blank');
    assert.match(firstLink.rel, /noopener/);
    assert.equal(app.window.document.querySelector('#view-health iframe'), null);

    health.search('不存在的关键词xyz');
    assert.equal(app.window.document.getElementById('healthSearchNotice').style.display, 'block');
    assert.match(app.window.document.getElementById('healthSearchNotice').textContent, /官方站内搜索/);

    health.renderRelated('period', 'periodRelated');
    await new Promise(r => setTimeout(r, 20));
    assert.ok(app.window.document.getElementById('periodRelated').querySelectorAll('a').length > 0);
  } finally { await app.close(); }
});

test('5-tab routing and subviews', async () => {
  const app = await createApp();
  try {
    const doc = app.window.document;
    app.window.switchSection('period');
    assert.equal(doc.getElementById('view-cycle').classList.contains('active'), true);
    assert.equal(doc.getElementById('period-section').classList.contains('active'), true);
    app.window.switchSection('diary');
    assert.equal(doc.getElementById('view-record').classList.contains('active'), true);
    assert.equal(doc.getElementById('diary-section').classList.contains('active'), true);
    assert.match(app.window.location.hash, /record\/diary/);
    app.window.switchTab('health');
    assert.equal(doc.getElementById('view-health').classList.contains('active'), true);
    app.window.switchTab('me');
    assert.equal(doc.getElementById('view-me').classList.contains('active'), true);
    app.window.switchTab('today');
    assert.equal(doc.getElementById('view-today').classList.contains('active'), true);
  } finally { await app.close(); }
});

test('app lock hashes PIN and unlocks', async () => {
  const app = await createApp();
  try {
    const doc = app.window.document;
    app.prompts.push('123456', '123456');
    await app.window.setupAppLock();
    const cfg = JSON.parse(app.window.localStorage.getItem('life_app_lock'));
    assert.ok(cfg && cfg.salt && cfg.hash);
    assert.equal(cfg.hash.includes('1234'), false);
    app.window.showLockScreen();
    assert.equal(doc.getElementById('lockScreen').classList.contains('active'), true);
    doc.getElementById('unlockPin').value = '0000';
    await app.window.unlockApp();
    assert.equal(doc.getElementById('lockScreen').classList.contains('active'), true);
    doc.getElementById('unlockPin').value = '123456';
    await app.window.unlockApp();
    assert.equal(doc.getElementById('lockScreen').classList.contains('active'), false);
  } finally { await app.close(); }
});

test('import accepts partial files and normalizes legacy fields', async () => {
  const app = await createApp();
  try {
    await app.window.applyImportedData({
      schemaVersion: 3,
      periods: [{ startDate: '2026年1月2日', endDate: '2026年1月6日', symptoms: [] }],
      vaccines: [{ name: '旧疫苗', date: '2026-01-01', next: '2027年1月1日' }]
    });
    const periods = await app.window.__lifeTest.db.getAllData('periods');
    const vaccines = await app.window.__lifeTest.db.getAllData('vaccines');
    assert.equal(periods[0].startDate, '2026-01-02');
    assert.equal(periods[0].endDate, '2026-01-06');
    assert.equal(vaccines[0].nextDate, '2027-01-01');
    assert.equal(vaccines[0].next, undefined);
  } finally { await app.close(); }
});

test('upcoming reminders dedupe, sort, preview and ICS export', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const today = t.getLocalDateString();
    const inOne = t.getLocalDateString(t.addDays(t.parseLocalDate(today), 1));
    const inTwo = t.getLocalDateString(t.addDays(t.parseLocalDate(today), 2));
    await t.db.addData('todos', { title: '同一待办', due: inOne, done: false, type: 'todo' });
    await t.db.addData('todos', { title: '同一待办', due: inOne, done: false, type: 'todo' });
    await t.db.addData('todos', { title: '已完成', due: today, done: true, type: 'todo' });
    await t.db.addData('vaccines', { name: '流感疫苗', date: today, nextDate: inTwo });
    const items = await app.window.collectUpcomingReminders(7);
    assert.equal(items.filter(i => i.label === '同一待办').length, 1);
    assert.equal(items.some(i => i.label === '已完成'), false);
    assert.ok(items.every((item, i, arr) => i === 0 || arr[i - 1].diff <= item.diff));

    await app.window.scheduleReminders();
    assert.match(app.window.document.getElementById('reminderPreviewList').textContent, /同一待办/);
    assert.match(app.window.document.getElementById('reminderPreviewList').textContent, /流感疫苗/);

    await app.window.exportRemindersICS();
    const download = app.lastDownload();
    assert.ok(download);
    assert.match(download.download, /\.ics$/);
    const ics = await app.readBlob(download.blob);
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /DTSTART;VALUE=DATE:/);
    assert.match(ics, /SUMMARY:.*同一待办/);
    assert.match(ics, /END:VCALENDAR/);
  } finally { await app.close(); }
});

test('encrypted backup roundtrip restores data', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    await t.db.addData('periods', { startDate: '2026-01-01', endDate: '2026-01-05', symptoms: [], flow: '中', pain: '无', mood: '平静', notes: '加密备份测试', timestamp: Date.now() });

    app.prompts.push('password123', 'password123');
    await app.window.exportEncryptedBackup();
    const download = app.lastDownload();
    assert.ok(download);
    assert.match(download.download, /\.lifeenc$/);
    const raw = await app.readBlob(download.blob);
    const payload = JSON.parse(raw);
    assert.equal(payload.format, 'life-encrypted-backup');
    assert.ok(payload.salt && payload.iv && payload.data);
    assert.equal(raw.includes('加密备份测试'), false);

    await t.db.clearStore('periods');
    assert.equal((await t.db.getAllData('periods')).length, 0);

    app.prompts.push('password123');
    const input = { files: [{ text: async () => raw, name: 'backup.lifeenc' }], value: 'x' };
    await app.window.importEncryptedBackup(input);
    const periods = await t.db.getAllData('periods');
    assert.equal(periods.length, 1);
    assert.equal(periods[0].notes, '加密备份测试');
  } finally { await app.close(); }
});

test('wrong encrypted backup password does not import', async () => {
  const app = await createApp();
  try {
    await app.window.__lifeTest.db.addData('periods', { startDate: '2026-02-01', symptoms: [] });
    app.prompts.push('password123', 'password123');
    await app.window.exportEncryptedBackup();
    const raw = await app.readBlob(app.lastDownload().blob);
    await app.window.__lifeTest.db.clearStore('periods');
    app.prompts.push('wrongpassword');
    await app.window.importEncryptedBackup({ files: [{ text: async () => raw }], value: 'x' });
    assert.match(app.alerts.join('\n'), /密码错误|损坏/);
    assert.equal((await app.window.__lifeTest.db.getAllData('periods')).length, 0);
  } finally { await app.close(); }
});

test('clearAllData clears database and life_* storage', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    await t.db.addData('periods', { startDate: '2026-03-01', symptoms: [] });
    app.window.localStorage.setItem('life_notify_enabled', '1');
    app.window.localStorage.setItem('life_health_index_v1', '{}');
    app.setConfirm(true);
    await app.window.clearAllData();
    await new Promise(r => setTimeout(r, 50));
    assert.equal((await t.db.getAllData('periods')).length, 0);
    assert.equal(app.window.localStorage.getItem('life_notify_enabled'), null);
    assert.equal(app.window.localStorage.getItem('life_health_index_v1'), null);
  } finally { await app.close(); }
});

test('weight history escapes injected HTML and tolerates string values', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    await t.db.addData('weight', { date: '2026-11-01', weight: 55.5, bodyFat: 18.2, timestamp: 1 });
    await t.db.addData('weight', { date: '<img src="x" onerror="window.__w=1">', weight: '<b>bad</b>', bodyFat: null, timestamp: 2 });
    await app.window.loadWeightData();
    const history = doc.getElementById('weightHistory');
    assert.equal(doc.getElementById('currentWeight').textContent, '--');
    assert.equal(doc.getElementById('currentBodyFat').textContent, '--');
    assert.equal(history.querySelector('img'), null);
    assert.equal(history.querySelector('b'), null);
    assert.match(history.textContent, /<img src="x"/);
    assert.equal(app.window.__w, undefined);
    assert.match(history.textContent, /55\.5kg \(18\.2%\)/);
  } finally { await app.close(); }
});

test('pregnancy settings modal validates dates and computes due date', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    const tomorrow = t.getLocalDateString(t.addDays(t.parseLocalDate(t.getLocalDateString()), 1));
    const yesterday = t.getLocalDateString(t.addDays(t.parseLocalDate(t.getLocalDateString()), -1));

    await app.window.showPregnancySettings();
    assert.equal(doc.getElementById('pregnancySettingsModal').classList.contains('active'), true);
    assert.ok(doc.getElementById('pregLmpInput').max);

    // 未来日期被拒绝
    doc.getElementById('pregLmpInput').value = tomorrow;
    app.window.updatePregnancyDuePreview();
    await app.window.savePregnancySettingsFromModal();
    assert.match(app.alerts.join('\n'), /不能晚于今天/);
    assert.equal(doc.getElementById('pregnancySettingsModal').classList.contains('active'), true);
    assert.equal((await t.db.getAllData('pregnancy_settings')).length, 0);

    // 合法日期：预产期 = LMP + 280 天
    doc.getElementById('pregLmpInput').value = yesterday;
    app.window.updatePregnancyDuePreview();
    const expectedDue = t.computeDueFromLmp(yesterday);
    assert.ok(expectedDue);
    assert.match(doc.getElementById('pregDuePreview').textContent, new RegExp(expectedDue.replace(/-/g, '\\-')));
    await app.window.savePregnancySettingsFromModal();
    const settings = await t.db.getAllData('pregnancy_settings');
    assert.equal(settings.length, 1);
    assert.equal(settings[0].lastMenstrualDate, yesterday);
    assert.equal(settings[0].expectedDue, expectedDue);
    assert.equal(doc.getElementById('pregnancySettingsModal').classList.contains('active'), false);
    assert.match(app.alerts.join('\n'), /预产期大约为/);
  } finally { await app.close(); }
});

test('pregnancy header shows overdue instead of negative due days', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    const lmp = t.getLocalDateString(t.addDays(t.parseLocalDate(t.getLocalDateString()), -300));
    const due = t.getLocalDateString(t.addDays(t.parseLocalDate(t.getLocalDateString()), -20));
    await t.db.addData('pregnancy_settings', { lastMenstrualDate: lmp, expectedDue: due });
    await app.window.updatePregnancyHeader();
    assert.match(doc.getElementById('pregnancyStatus').textContent, /已过预产期 20天/);
    assert.match(doc.getElementById('gestationalWeek').textContent, /\d+周\+\d+天/);
  } finally { await app.close(); }
});

test('pregnancy and postpartum pause cycle prediction', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    const now = new Date();
    await t.db.addData('periods', { startDate: t.getLocalDateString(t.addDays(now, -56)), symptoms: [] });
    await t.db.addData('periods', { startDate: t.getLocalDateString(t.addDays(now, -28)), symptoms: [] });
    const lmp = t.getLocalDateString(t.addDays(now, -70));
    await t.db.addData('pregnancy_settings', { lastMenstrualDate: lmp, expectedDue: t.computeDueFromLmp(lmp) });

    await app.window.loadPeriodData();
    assert.equal(doc.getElementById('cyclePauseNotice').style.display, 'block');
    assert.match(doc.getElementById('cyclePauseNotice').textContent, /已进入孕期/);
    assert.equal(doc.getElementById('cycleDay').textContent, '--');
    assert.match(doc.getElementById('predictionDetail').textContent, /暂停/);

    await app.window.renderToday();
    assert.equal(doc.getElementById('todayCycleLabel').textContent, '孕周');
    assert.match(doc.getElementById('todayCycleStatus').textContent, /孕期/);

    const items = await app.window.collectUpcomingReminders(7);
    assert.equal(items.some(i => i.label === '预计生理期'), false);

    const deliveryDate = t.getLocalDateString(t.addDays(now, -5));
    await t.db.addData('pregnancy_records', { stage: 'delivery', date: deliveryDate, data: {} });
    await app.window.loadPeriodData();
    assert.match(doc.getElementById('cyclePauseNotice').textContent, /产后/);
    assert.match(doc.getElementById('cyclePauseNotice').textContent, /恢复/);

    // 产后 42 天以上且尚无新经期：继续暂停，记录新经期后恢复预测
    await t.db.clearStore('pregnancy_records');
    await t.db.clearStore('pregnancy_settings');
    await t.db.clearStore('periods');
    await t.db.addData('pregnancy_records', { stage: 'delivery', date: t.getLocalDateString(t.addDays(now, -100)), data: {} });
    await app.window.loadPeriodData();
    assert.match(doc.getElementById('cyclePauseNotice').textContent, /尚未记录新的经期/);
    await t.db.addData('periods', { startDate: t.getLocalDateString(t.addDays(now, -10)), symptoms: [] });
    await app.window.loadPeriodData();
    assert.equal(doc.getElementById('cyclePauseNotice').style.display, 'none');
    assert.match(doc.getElementById('predictionDetail').textContent, /预测下次/);
  } finally { await app.close(); }
});

test('pregnancy checks keep images and survive export/import', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    const blob = 'data:image/png;base64,ZmFrZS1wbmc=';
    await t.db.addData('pregnancy_checks', {
      date: t.getLocalDateString(),
      title: '<img src=x onerror=window.__px=1>',
      hospital: '市妇幼',
      result: '一切正常',
      note: '',
      photos: [blob],
      createdAt: 1
    });
    await app.window.loadPregnancyChecks();
    const cont = doc.getElementById('checkHistoryList');
    assert.match(cont.textContent, /<img src=x/);
    assert.equal(cont.querySelector('img[src="x"]'), null);
    assert.equal(app.window.__px, undefined);
    assert.ok(cont.querySelector('img.check-thumb'));

    const exported = await app.window.buildExportObject();
    assert.equal(exported.schemaVersion, 5);
    assert.equal(exported.pregnancy_checks[0].photos[0], blob);

    await t.db.clearStore('pregnancy_checks');
    await app.window.applyImportedData(exported);
    const list = await t.db.getAllData('pregnancy_checks');
    assert.equal(list.length, 1);
    assert.equal(list[0].title, '<img src=x onerror=window.__px=1>');
    assert.equal(list[0].photos.length, 1);

    app.window.openStoredImage(new app.window.Blob(['view-me'], { type: 'image/png' }));
    assert.equal(doc.getElementById('photoModal').classList.contains('active'), true);
    app.window.closePhotoModal();
    assert.equal(doc.getElementById('photoModal').classList.contains('active'), false);
  } finally { await app.close(); }
});

test('baby photo album shows age from delivery date', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    const today = t.parseLocalDate(t.getLocalDateString());
    const birth = t.getLocalDateString(t.addDays(today, -100));
    await t.db.addData('pregnancy_records', { stage: 'delivery', date: birth, data: {} });
    const blob = 'data:image/jpeg;base64,ZmFrZS1qcGc=';
    const shot = t.getLocalDateString(t.addDays(t.parseLocalDate(birth), 40));
    await t.db.addData('baby_photos', {
      date: shot,
      title: '<b>第一次笑</b>',
      milestone: '第一次微笑',
      imageBlob: blob,
      createdAt: 1
    });
    await app.window.loadBabyPhotos();
    const timeline = doc.getElementById('babyPhotoTimeline');
    assert.match(timeline.textContent, /第一次笑/);
    assert.equal(timeline.querySelector('b'), null);
    assert.match(timeline.textContent, /约1个月/);
    assert.match(timeline.textContent, /第一次微笑/);
    assert.match(doc.getElementById('babyBirthInfo').textContent, /已出生 100 天/);
    assert.ok(timeline.querySelector('img'));

    const list = await t.db.getAllData('baby_photos');
    await app.window.viewBabyPhoto(list[0].id);
    assert.equal(doc.getElementById('photoModal').classList.contains('active'), true);
    app.window.closePhotoModal();
  } finally { await app.close(); }
});

test('app lock rate-limits repeated failed attempts', async () => {
  const app = await createApp();
  try {
    const doc = app.window.document;
    app.prompts.push('123456', '123456');
    await app.window.setupAppLock();
    app.window.showLockScreen();
    const input = doc.getElementById('unlockPin');
    const err = doc.getElementById('lockError');
    for (let i = 0; i < 5; i++) {
      input.value = '0000';
      await app.window.unlockApp();
    }
    const attempts = JSON.parse(app.window.localStorage.getItem('life_app_lock_fails'));
    assert.equal(attempts.count, 5);
    assert.ok(attempts.until > Date.now());
    // 冷却期内即使密码正确也被拒绝
    input.value = '1234';
    await app.window.unlockApp();
    assert.match(err.textContent, /秒后再试/);
    assert.equal(doc.getElementById('lockScreen').classList.contains('active'), true);
  } finally { await app.close(); }
});

test('lunar leap month parsing and conversion', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    // 2020 年闰四月
    assert.equal(t.lunar.getLeapMonth(2020 - 1900), 4);
    const reg = t.lunar.lunarToSolar(2020, 4, 1, false);
    const leap = t.lunar.lunarToSolar(2020, 4, 1, true);
    assert.ok(!isNaN(reg) && !isNaN(leap));
    // 闰四月初一 = 四月初一 + 该月天数(29 或 30)
    const diffDays = Math.round((leap - reg) / 86400000);
    assert.ok(diffDays === 29 || diffDays === 30, `diff=${diffDays}`);
    // 缺省参数保持旧算法可用
    const legacy = t.lunar.lunarToSolar(1999, 9, 9);
    assert.ok(!isNaN(legacy));
    // 解析闰月写法
    const parsed = t.parseLunarDate('2020-闰4-01');
    assert.ok(parsed);
    assert.equal(parsed.month, 4);
    assert.equal(parsed.day, 1);
    assert.equal(parsed.leap, true);
    const plain = t.parseLunarDate('2020-04-01');
    assert.equal(plain.leap, false);
    // 无闰月的年份拒绝闰月写法（1901 年无闰月）
    assert.equal(t.lunar.getLeapMonth(1901 - 1900), 0);
    assert.equal(t.parseLunarDate('1901-闰1-01'), null);
    assert.match(app.alerts.join('\n'), /没有闰1月/);
  } finally { await app.close(); }
});

test('period calendar supports month navigation', async () => {
  const app = await createApp();
  try {
    const doc = app.window.document;
    const now = new Date();
    const currentTitle = `${now.getFullYear()}年${now.getMonth() + 1}月`;
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextTitle = `${next.getFullYear()}年${next.getMonth() + 1}月`;
    assert.equal(doc.getElementById('calendarTitle').textContent, currentTitle);
    assert.ok(doc.getElementById('periodCalendar').querySelectorAll('.calendar-day').length >= 28);

    app.window.shiftCalendar(1);
    await new Promise(r => setTimeout(r, 80));
    assert.equal(doc.getElementById('calendarTitle').textContent, nextTitle);
    assert.ok(doc.getElementById('periodCalendar').querySelectorAll('.calendar-day').length >= 28);

    app.window.shiftCalendar(-2);
    await new Promise(r => setTimeout(r, 80));
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    assert.equal(doc.getElementById('calendarTitle').textContent, `${prev.getFullYear()}年${prev.getMonth() + 1}月`);

    app.window.gotoCalendarToday();
    await new Promise(r => setTimeout(r, 80));
    assert.equal(doc.getElementById('calendarTitle').textContent, currentTitle);
  } finally { await app.close(); }
});

test('vaccine reminder label does not duplicate the word vaccine', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const inTwo = t.getLocalDateString(t.addDays(t.parseLocalDate(t.getLocalDateString()), 2));
    await t.db.addData('vaccines', { name: '流感疫苗', date: '2026-01-01', nextDate: inTwo });
    await t.db.addData('vaccines', { name: '乙肝', date: '2026-01-01', nextDate: inTwo });
    const items = await app.window.collectUpcomingReminders(7);
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('流感疫苗'), labels.join(','));
    assert.ok(labels.includes('乙肝疫苗'), labels.join(','));
    assert.equal(labels.some(l => l.includes('疫苗疫苗')), false);
  } finally { await app.close(); }
});

test('closet zoom image releases its object URL on close', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    const blob = new app.window.Blob(['fake-image'], { type: 'image/png' });
    const cat = await t.db.addData('closetCategories', { name: '上衣' });
    await t.db.addData('clothes', { categoryId: cat, code: 'T01', imageBlob: blob, timestamp: Date.now() });
    let revoked = 0;
    const origRevoke = app.window.URL.revokeObjectURL;
    app.window.URL.revokeObjectURL = url => { if (url && String(url).startsWith('blob:')) revoked++; };
    try {
      await app.window.viewClothesImage(1);
      assert.ok(doc.getElementById('photoModal').classList.contains('active'));
      assert.ok(doc.getElementById('photoModalImg').src.startsWith('blob:'));
      app.window.closePhotoModal();
      assert.equal(revoked, 1);
      assert.equal(doc.getElementById('photoModal').classList.contains('active'), false);
      assert.equal(doc.getElementById('photoModalImg').getAttribute('src'), '');
    } finally { app.window.URL.revokeObjectURL = origRevoke; }
  } finally { await app.close(); }
});

test('future dates are rejected by record forms', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    const tomorrow = t.getLocalDateString(t.addDays(t.parseLocalDate(t.getLocalDateString()), 1));
    doc.getElementById('diaryDate').value = tomorrow;
    doc.getElementById('diaryTitle').value = '未来日记';
    await app.window.saveDiary();
    assert.match(app.alerts.join('\n'), /不能晚于今天/);
    assert.equal((await t.db.getAllData('diaries')).length, 0);
    doc.getElementById('diaryDate').value = t.getLocalDateString();
  } finally { await app.close(); }
});

test('export records backup time and renders backup status', async () => {
  const app = await createApp();
  try {
    const doc = app.window.document;
    await app.window.exportData();
    assert.ok(app.window.localStorage.getItem('life_last_backup'));
    assert.match(doc.getElementById('backupStatus').textContent, /上次备份/);
    // 30 天前的备份给出警告
    app.window.localStorage.setItem('life_last_backup', String(Date.now() - 40 * 86400000));
    app.window.renderBackupStatus();
    assert.match(doc.getElementById('backupStatus').textContent, /40 天前，建议重新导出/);
  } finally { await app.close(); }
});

test('install prompt button appears on beforeinstallprompt', async () => {
  const app = await createApp();
  try {
    const doc = app.window.document;
    const btn = doc.getElementById('installAppBtn');
    assert.equal(btn.style.display, 'none');
    let prompted = false;
    const event = new app.window.Event('beforeinstallprompt', { cancelable: true });
    event.prompt = () => { prompted = true; };
    app.window.dispatchEvent(event);
    assert.equal(btn.style.display, 'inline-block');
    app.window.promptInstallApp();
    assert.equal(prompted, true);
    assert.equal(btn.style.display, 'none');
  } finally { await app.close(); }
});

test('escape closes the topmost modal', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    await t.db.addData('diaries', { date: '2026-11-10', title: 'T', content: 'C', mood: '', timestamp: Date.now() });
    const list = await t.db.getAllData('diaries');
    await app.window.showDiaryDetail(list[0].id);
    assert.equal(doc.getElementById('diaryModal').classList.contains('active'), true);
    doc.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(doc.getElementById('diaryModal').classList.contains('active'), false);
  } finally { await app.close(); }
});

test('bottom navigation uses real buttons and echarts is lazy-loaded', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    assert.equal(doc.querySelector('.nav-item').tagName, 'BUTTON');
    // 静态 HTML 不再阻断式引用 echarts
    const rawHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.equal(rawHtml.includes('<script src="./echarts.min.js"'), false);
    // 图表调用后注入脚本并显示加载占位
    await t.db.addData('weight', { date: '2026-11-01', weight: 55, bodyFat: null, timestamp: 1 });
    await t.db.addData('weight', { date: '2026-11-05', weight: 54.5, bodyFat: null, timestamp: 2 });
    await app.window.loadWeightData();
    const container = doc.getElementById('weightChartContainer');
    assert.match(container.dataset.chartMsg || container.textContent, /图表加载中|图表不可用/);
    assert.ok(doc.querySelector('script[src*="echarts"]'));
    assert.match(doc.getElementById('weightHistory').textContent, /55\.0kg/);
  } finally { await app.close(); }
});

test('toast and one-second quick records work without alerts', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    const alertBefore = app.alerts.length;
    doc.getElementById('quickWeightInput').value = '56.7';
    await app.window.quickLogWeight();
    const weights = await t.db.getAllData('weight');
    assert.equal(weights.length, 1);
    assert.equal(weights[0].weight, 56.7);
    assert.match(doc.getElementById('toastStack').textContent, /体重已记录/);
    assert.equal(app.alerts.length, alertBefore);

    await app.window.quickLogPeriod();
    await app.window.quickLogPeriod();
    assert.equal((await t.db.getAllData('periods')).length, 1);
    assert.match(doc.getElementById('toastStack').textContent, /已经记录过/);
  } finally { await app.close(); }
});

test('pregnancy vitals thresholds produce warnings and are shown in history', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    doc.getElementById('pregDate').value = t.getLocalDateString();
    doc.getElementById('pregBp').value = '150/100';
    doc.getElementById('pregFetalHr').value = '100';
    await app.window.savePregnancyRecord();
    const list = await t.db.getAllData('pregnancy_records');
    assert.equal(list.length, 1);
    assert.ok(list[0].warnings.some(w => w.level === 'danger' && /血压/.test(w.text)));
    assert.ok(list[0].warnings.some(w => /胎心率/.test(w.text)));
    assert.match(doc.getElementById('pregClinicalAlert').textContent, /140\/90/);
    await app.window.loadPregnancyHistory();
    assert.match(doc.getElementById('pregHistoryList').textContent, /血压 150\/100/);
    assert.match(doc.getElementById('pregHistoryList').textContent, /胎心率 100/);
  } finally { await app.close(); }
});

test('EPDS screening stores score and gives referral guidance', async () => {
  const app = await createApp();
  try {
    const doc = app.window.document;
    app.window.openEpds();
    for (let i = 0; i < 10; i++) {
      const radio = doc.querySelector(`input[name="epds${i}"][value="3"]`);
      radio.checked = true;
    }
    await app.window.submitEpds();
    const list = await app.window.__lifeTest.db.getAllData('epds_records');
    assert.equal(list.length, 1);
    assert.equal(list[0].total, 30);
    assert.equal(list[0].critical, true);
    assert.match(doc.getElementById('epdsResult').textContent, /立即联系家人/);
    assert.match(doc.getElementById('epdsResult').textContent, /专业评估/);
  } finally { await app.close(); }
});

test('generic edit updates any stored record', async () => {
  const app = await createApp();
  try {
    const t = app.window.__lifeTest;
    const doc = app.window.document;
    await t.db.addData('baby_records', { date: '2026-11-01', weight: 5, height: 55, head: 38, timestamp: 1 });
    const list = await t.db.getAllData('baby_records');
    await app.window.openGenericEdit('baby_records', list[0].id);
    const field = doc.querySelector('#genericEditFields [data-field="weight"]');
    field.value = '5.6';
    await app.window.saveGenericEdit();
    const updated = await t.db.getAllData('baby_records');
    assert.equal(updated[0].weight, '5.6');
    assert.equal(doc.getElementById('genericEditModal').classList.contains('active'), false);
  } finally { await app.close(); }
});

test('ultrasound due date and import validation', async () => {
  const app = await createApp();
  try {
    const due = app.window.computeDueFromUltrasound('2026-10-01', 12, 0);
    assert.ok(due);
    const check = app.window.validateImportedObject({
      app: 'Life', schemaVersion: 5,
      periods: [{ startDate: '2026-01-01', notes: 'x'.repeat(210000) }]
    });
    assert.equal(check.ok, false);
    assert.match(check.message, /内容过长/);
  } finally { await app.close(); }
});

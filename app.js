'use strict';

/* ====== 全局错误捕获 ====== */
window.onerror = function(msg, src, line, col, err) {
  console.error('JS错误:', msg, '\n位置:', src, ':', line);
  return false;
};

/* ====== Dexie IndexedDB ====== */
let db = null;
try {
  db = new Dexie('AccountBookDB');
  db.version(1).stores({ records: 'id, date, type, cat' });
} catch(e) {
  console.error('Dexie 初始化失败:', e);
  // 降级到 localStorage
}

// 种子数据直接初始化（不依赖异步链，确保打开即有数据）
var _seed = (typeof window !== 'undefined' && window.SEED_DATA && window.SEED_DATA.records) ? window.SEED_DATA.records : null;
var records = _seed ? _seed.slice() : [];
let currentMonth = new Date().toISOString().slice(0,7);
let currentTab = 0;
let currentType = '支出';
let selectedCat = '';
let selectedPay = '';
let pieChart = null, lineChart = null;
let editingId = null;
let syncTimer = null;

/* ====== 分类 & 支付方式 ====== */
const CATS = {
  '支出': [
    {name:'餐饮',icon:'🍜'},{name:'交通',icon:'🚌'},{name:'购物',icon:'🛒'},
    {name:'娱乐',icon:'🎮'},{name:'居住',icon:'🏠'},{name:'医疗',icon:'💊'},
    {name:'教育',icon:'📚'},{name:'通讯',icon:'📱'},{name:'服饰',icon:'👔'},
    {name:'美容',icon:'💅'},{name:'运动',icon:'⚽'},{name:'宠物',icon:'🐾'},
    {name:'人情',icon:'🎁'},{name:'旅行',icon:'✈️'},{name:'其他',icon:'📦'}
  ],
  '收入': [
    {name:'工资',icon:'💰'},{name:'奖金',icon:'🏆'},{name:'兼职',icon:'💼'},
    {name:'理财',icon:'📈'},{name:'红包',icon:'🧧'},{name:'退款',icon:'↩️'},
    {name:'其他',icon:'💵'}
  ]
};
const PAYS = ['微信','支付宝','银行卡','校园卡','现金','其他'];
const BUDGETS = {餐饮:800,交通:200,购物:500,娱乐:300,居住:1500,医疗:200,教育:200,通讯:50,服饰:200,美容:100,运动:100,其他:300};

/* ====== Gitee API 同步 ====== */
const GITEE = {
  owner: 'huang-rutong',
  repo: 'account-book',
  path: 'data/records.json'
};

function getToken() { return localStorage.getItem('gitee_token') || ''; }
function setToken(t) { localStorage.setItem('gitee_token', t); }
function isSyncEnabled() { return !!getToken(); }

async function giteeApi(method, url, body, extraHeaders) {
  const token = getToken();
  if (!token) return null;
  const headers = Object.assign(
    { 'Content-Type': 'application/json', 'Authorization': 'token ' + token },
    extraHeaders || {}
  );
  const opts = { method: method, headers: headers };
  if (body) opts.body = JSON.stringify(body);
  const isRaw = headers['Accept'] === 'application/vnd.gitee.raw';
  try {
    const res = await fetch('https://gitee.com/api/v5' + url, opts);
    if (!res.ok) {
      console.error('Gitee API HTTP error:', res.status, res.statusText);
      return null;
    }
    return isRaw ? await res.text() : await res.json();
  } catch(e) {
    console.error('Gitee API error:', e);
    return null;
  }
}

function updateSyncUI(status, text) {
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncText');
  const badge = document.getElementById('syncStatusBadge');
  dot.className = 'sync-dot' + (status === 'syncing' ? ' syncing' : status === 'ok' ? ' ok' : status === 'error' ? ' error' : '');
  txt.textContent = text;
  if (badge) {
    badge.textContent = isSyncEnabled() ? '已配置' : '未配置';
    badge.className = 'si-status ' + (isSyncEnabled() ? 'on' : 'off');
  }
}

async function pullFromGitee() {
  if (!isSyncEnabled()) return;
  updateSyncUI('syncing', '正在拉取...');
  // 使用 raw 模式直接获取纯文本 JSON，彻底绕过 base64 解码链，支持中文不乱码
  const text = await giteeApi(
    'GET',
    '/repos/' + GITEE.owner + '/' + GITEE.repo + '/contents/' + GITEE.path,
    null,
    { 'Accept': 'application/vnd.gitee.raw' }
  );
  if (text) {
    try {
      const json = JSON.parse(text);
      if (json.records && Array.isArray(json.records)) {
        fixRecordTypes(json.records);
        const localIds = new Set(records.map(r => r.id));
        let newCount = 0;
        for (const r of json.records) {
          if (!localIds.has(r.id)) { records.push(r); newCount++; }
        }
        records.sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
        if (newCount > 0) await db.records.bulkPut(records);
        updateSyncUI('ok', newCount > 0 ? '已同步（拉取'+newCount+'条新记录）' : '已是最新');
        renderAll();
      }
    } catch(e) { console.error('Parse gitee data error:', e); updateSyncUI('error','拉取解析失败'); }
  } else {
    updateSyncUI('ok', '云端暂无数据，可先在本地记账后同步');
  }
}

async function pushToGitee() {
  if (!isSyncEnabled()) return;
  updateSyncUI('syncing', '正在推送...');
  let content;
  try {
    const jsonStr = JSON.stringify({ version:2, updated:new Date().toISOString(), count:records.length, records });
    content = btoa(unescape(encodeURIComponent(jsonStr)));
  } catch(e) {
    console.error('Gitee push encode error:', e);
    updateSyncUI('error', '数据编码失败');
    return;
  }
  const payload = {
    access_token: getToken(),
    message: 'sync: ' + new Date().toLocaleString('zh-CN'),
    content: content
  };
  // 检查文件是否已存在（需要 sha）
  const existing = await giteeApi('GET', '/repos/' + GITEE.owner + '/' + GITEE.repo + '/contents/' + GITEE.path);
  if (existing && existing.sha) payload.sha = existing.sha;
  const result = await giteeApi('POST', '/repos/' + GITEE.owner + '/' + GITEE.repo + '/contents/' + GITEE.path, payload);
  if (result && result.content) {
    updateSyncUI('ok', '已同步到云端');
  } else {
    updateSyncUI('error', '推送失败');
  }
}

function schedulePush() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushToGitee(), 5000);
}

async function triggerSync() {
  if (!isSyncEnabled()) { showToast('请先配置 Gitee Token'); return; }
  await pullFromGitee();
  schedulePush();
}

/* ====== 数据操作（多级回退加载 + 双写保存） ====== */

/**
 * 从 localStorage 读取备份记录（内部辅助函数）
 * @returns {Array|null} 解析后的记录数组，失败返回 null
 */
function _loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem('accountbook_records');
    if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed) && parsed.length > 0) return parsed; }
  } catch(e) { console.warn('localStorage 读取失败:', e); }
  return null;
}

/**
 * 多级有序回退加载记录
 * 优先级：IndexedDB > localStorage 备份 > 保持当前(种子数据)
 * 找到有效数据即停止，确保任何单一数据源失效都能恢复
 */
async function loadRecords() {
  // Level 1: IndexedDB（主存储）
  if (db) {
    try {
      const dbRecords = await db.records.toArray();
      if (dbRecords && dbRecords.length > 0) {
        records = dbRecords;
        console.log('[loadRecords] Level1 ✓ IndexedDB 加载 ' + records.length + ' 条');
        return;
      }
    } catch(e) { console.warn('[loadRecords] IndexedDB 读取异常:', e); }
  }

  // Level 2: localStorage 热备份（即使 db 对象存在但 DB 被清空，也能从此恢复）
  const lsData = _loadFromLocalStorage();
  if (lsData && lsData.length > 0) {
    records = lsData;
    console.log('[loadRecords] Level2 ✓ localStorage 备份恢复 ' + records.length + ' 条');
    // 恢复后立即写回 IndexedDB，让主存储也同步
    if (db) { try { await db.records.clear(); await db.records.bulkPut(records); } catch(e) {} }
    return;
  }

  // Level 3+ : 均未命中 → 保持当前 records 不变（可能是种子数据或空数组）
  console.log('[loadRecords] Level3○ IDB 和 localStorage 均无数据，保持当前 (' + records.length + ' 条)');
}

async function saveToDb() {
  const jsonStr = JSON.stringify(records);
  // 【核心修复】始终同步写入 localStorage 作为热备份（不会被浏览器静默清理 IndexedDB 时连带清除）
  try { localStorage.setItem('accountbook_records', jsonStr); localStorage.setItem('ab_last_save', Date.now().toString()); } catch(e) { console.warn('localStorage 写入失败:', e); }
  // 同时写 IndexedDB（主存储，支持大数据量）
  if (db) {
    try {
      await db.records.clear();
      if (records.length > 0) await db.records.bulkPut(records);
    } catch(e) { console.warn('IndexedDB 写入失败，数据已保存在 localStorage:', e); }
  }
}

/* ====== localStorage 迁移 ====== */
async function migrateFromLocalStorage() {
  if (!db) return; // 无需迁移
  const old = localStorage.getItem('accountbook_records');
  if (old) {
    try {
      const oldRecords = JSON.parse(old);
      if (Array.isArray(oldRecords) && oldRecords.length > 0) {
        const localIds = new Set((await db.records.toArray()).map(r => r.id));
        const fresh = oldRecords.filter(r => !localIds.has(r.id));
        if (fresh.length > 0) await db.records.bulkPut(fresh);
        // 【修复】不再删除 localStorage，因为新版双写机制依赖它作为热备份
        if (fresh.length > 0) showToast('已从旧版本迁移 ' + fresh.length + ' 条记录');
      }
    } catch(e) { console.error('Migration error:', e); }
  }
}

/* ====== Toast & Confirm ====== */
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function showConfirm(title, msg, onOk) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  document.getElementById('confirmOverlay').classList.add('open');
  document.getElementById('confirmOk').onclick = function() { closeConfirm(); onOk(); };
}
function closeConfirm() { document.getElementById('confirmOverlay').classList.remove('open'); }

/* ====== Tab 切换 ====== */
function switchTab(idx) {
  currentTab = idx;
  document.querySelectorAll('.tab-panel').forEach((p,i) => p.classList.toggle('active', i===idx));
  document.querySelectorAll('.tab-item').forEach((t,i) => t.classList.toggle('active', i===idx));
  document.getElementById('fab').classList.toggle('hidden', idx === 2);
  if (idx === 0) renderOverview();
  if (idx === 1) renderRecords();
}

/* ====== 月份导航（防重复触发） ====== */
let pickerYear = new Date().getFullYear();
var _monthChanging = false;  // 标志锁，防止快速重复点击

function changeMonth(delta) {
  if (_monthChanging) return;   // 上一次操作还在进行中，忽略
  _monthChanging = true;        // 加锁

  var y, m, d, ny, nm;
  var parts = currentMonth.split('-').map(Number);
  y = parts[0]; m = parts[1];
  d = new Date(y, m - 1 + delta, 1);
  ny = d.getFullYear();
  nm = String(d.getMonth() + 1).padStart(2, '0');
  currentMonth = ny + '-' + nm;
  document.getElementById('monthLabel').textContent = ny + '年' + (d.getMonth() + 1) + '月';
  renderOverview();

  // 200ms后解锁（足够单次操作完成）
  setTimeout(function() { _monthChanging = false; }, 200);
}

function openMonthPicker() {
  const [y] = currentMonth.split('-').map(Number);
  pickerYear = y;
  renderPickerMonths();
  document.getElementById('monthPicker').classList.add('open');
}
function closeMonthPicker() {
  document.getElementById('monthPicker').classList.remove('open');
}
function changePickerYear(delta) {
  pickerYear += delta;
  renderPickerMonths();
}
function renderPickerMonths() {
  document.getElementById('pickerYearLabel').textContent = pickerYear;
  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const dataMonths = new Set(records.map(r => r.date.slice(0,7)));
  const html = monthNames.map((name, i) => {
    const m = i + 1;
    const val = pickerYear + '-' + String(m).padStart(2,'0');
    const isCurrent = val === currentMonth;
    const hasData = dataMonths.has(val);
    let cls = 'picker-month';
    if (isCurrent) cls += ' current';
    if (hasData) cls += ' has-data';
    return '<div class="' + cls + '" onclick="selectMonth(' + pickerYear + ',' + m + ')">' + name + '</div>';
  }).join('');
  document.getElementById('pickerMonths').innerHTML = html;
}
function selectMonth(y, m) {
  currentMonth = y + '-' + String(m).padStart(2,'0');
  document.getElementById('monthLabel').textContent = y + '年' + m + '月';
  closeMonthPicker();
  renderOverview();
}

/* ====== 概览页渲染 ====== */
function getMonthRecords() {
  return records.filter(r => r.date && r.date.startsWith(currentMonth));
}

function renderOverview() {
  const mr = getMonthRecords();
  const income = mr.filter(r=>r.type==='收入').reduce((s,r)=>s+r.amt,0);
  const expense = mr.filter(r=>r.type==='支出').reduce((s,r)=>s+r.amt,0);
  document.getElementById('overviewCards').innerHTML =
    '<div class="ov-card income"><div class="ov-label">本月收入</div><div class="ov-amount">+'+income.toFixed(2)+'</div></div>'+
    '<div class="ov-card expense"><div class="ov-label">本月支出</div><div class="ov-amount">-'+expense.toFixed(2)+'</div></div>'+
    '<div class="ov-card balance"><div class="ov-label">本月结余</div><div class="ov-amount">'+(income-expense).toFixed(2)+'</div></div>'+
    '<div class="ov-card count"><div class="ov-label">记账笔数</div><div class="ov-amount">'+mr.length+'</div></div>';
  renderPieChart(mr);
  renderLineChart(mr);
  renderBudget(mr);
}

function renderPieChart(mr) {
  const exps = mr.filter(r=>r.type==='支出');
  const catMap = {};
  exps.forEach(r => { catMap[r.cat] = (catMap[r.cat]||0) + r.amt; });
  const labels = Object.keys(catMap);
  const data = Object.values(catMap);
  const colors = ['#6366f1','#8b5cf6','#f43f5e','#f59e0b','#10b981','#06b6d4','#3b82f6','#ec4899','#14b8a6','#ef4444','#a855f7','#84cc16','#0ea5e9','#d946ef','#f97316'];
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('pieChart'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors.slice(0,labels.length), borderWidth:0, hoverOffset:8 }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:'62%', plugins:{ legend:{ position:'right', labels:{ boxWidth:10, font:{size:11}, padding:10, usePointStyle:true, pointStyle:'circle' } } } }
  });
}

function renderLineChart(mr) {
  const exps = mr.filter(r=>r.type==='支出');
  const dayMap = {};
  exps.forEach(r => { dayMap[r.date] = (dayMap[r.date]||0) + r.amt; });
  const days = Object.keys(dayMap).sort();
  if (lineChart) lineChart.destroy();
  lineChart = new Chart(document.getElementById('lineChart'), {
    type: 'line',
    data: { labels: days.map(d=>d.slice(5)), datasets: [{ label:'每日支出', data: days.map(d=>dayMap[d]), borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,0.08)', fill:true, tension:0.4, pointRadius:3, pointBackgroundColor:'#6366f1', pointBorderWidth:0, borderWidth:2.5 }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{ backgroundColor:'rgba(30,27,75,0.9)', cornerRadius:10, padding:10, titleFont:{size:12}, bodyFont:{size:13,weight:'bold'} } }, scales:{ y:{ beginAtZero:true, ticks:{ font:{size:10}, color:'#94a3b8' }, grid:{color:'rgba(99,102,241,0.06)'} }, x:{ ticks:{ font:{size:10}, color:'#94a3b8' }, grid:{display:false} } } }
  });
}

function renderBudget(mr) {
  const exps = mr.filter(r=>r.type==='支出');
  const catMap = {};
  exps.forEach(r => { catMap[r.cat] = (catMap[r.cat]||0) + r.amt; });
  let html = '';
  for (const [cat, budget] of Object.entries(BUDGETS)) {
    const spent = catMap[cat] || 0;
    const pct = Math.min(spent/budget*100, 100);
    const color = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#10b981';
    const catInfo = CATS['支出']?.find(c=>c.name===cat) || {icon:'📦'};
    html += '<div class="budget-item"><div class="bi-row"><span class="bi-name">'+catInfo.icon+' '+cat+'</span><span class="bi-num">¥'+spent.toFixed(0)+' / ¥'+budget+'</span></div><div class="progress-track"><div class="progress-fill" style="width:'+pct+'%;background:'+color+'"></div></div></div>';
  }
  document.getElementById('budgetList').innerHTML = html || '<div style="text-align:center;color:var(--text-muted);padding:16px">暂无支出数据</div>';
}

/* ====== 明细页渲染 ====== */
let filterType = '全部';
function renderRecords() {
  const container = document.getElementById('recordList');
  const table = document.getElementById('recordTable');
  const empty = document.getElementById('emptyState');
  document.getElementById('recordCount').textContent = records.length + '条';
  // 筛选按钮
  const types = ['全部','收入','支出'];
  document.getElementById('recordsFilter').innerHTML = types.map(t =>
    '<button class="'+(filterType===t?'active':'')+'" onclick="setFilter(\''+t+'\')">'+t+'</button>'
  ).join('');
  const filtered = filterType === '全部' ? records : records.filter(r => r.type === filterType);
  if (filtered.length === 0) { container.innerHTML=''; table.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display = 'none';
  // 移动端卡片
  container.innerHTML = filtered.map(r => {
    const catInfo = CATS[r.type]?.find(c=>c.name===r.cat) || {icon:'📦'};
    const isIncome = r.type==='收入';
    return '<div class="record-card '+(isIncome?'income-card':'expense-card')+'" onclick="editRecord(\''+r.id+'\')">'+
      '<div class="rc-icon '+(isIncome?'income-icon':'expense-icon')+'">'+catInfo.icon+'</div>'+
      '<div class="rc-info"><div class="rc-top"><span class="rc-cat">'+r.cat+'</span>'+
      '<span class="rc-amt '+(isIncome?'income':'expense')+'">'+(isIncome?'+':'-')+r.amt.toFixed(2)+'</span></div>'+
      '<div class="rc-bot"><span class="rc-note">'+escapeHtml(r.note)+'</span><span class="rc-date">'+r.date+'</span></div></div></div>';
  }).join('');
  // 桌面端表格
  table.innerHTML = filtered.map(r =>
    '<tr><td>'+r.date+'</td><td><span class="tag '+(r.type==='收入'?'income':'expense')+'">'+r.type+'</span></td><td>'+r.cat+'</td><td style="font-weight:700;color:'+(r.type==='收入'?'var(--income)':'var(--expense)')+'">'+(r.type==='收入'?'+':'-')+r.amt.toFixed(2)+'</td><td>'+r.pay+'</td><td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary)">'+escapeHtml(r.note||'')+'</td><td><button onclick="event.stopPropagation();deleteRecord(\''+r.id+'\')" style="background:none;border:none;color:var(--expense);cursor:pointer;font-size:16px;padding:4px">✕</button></td></tr>'
  ).join('');
}
function setFilter(t) { filterType = t; renderRecords(); }

/* ====== 记账面板 ====== */
function openSheet(id) {
  editingId = id || null;
  const sheet = document.getElementById('sheet');
  const overlay = document.getElementById('sheetOverlay');
  if (id) {
    const r = records.find(x => x.id === id);
    if (!r) return;
    currentType = r.type; selectedCat = r.cat; selectedPay = r.pay || '微信';
    document.getElementById('displayAmount').textContent = r.amt.toFixed(2);
    document.getElementById('noteInput').value = r.note || '';
    document.getElementById('dateInput').value = r.date;
    document.getElementById('sheetTitle').textContent = '编辑记录';
    document.getElementById('submitBtn').textContent = '保存修改';
  } else {
    currentType = '支出'; selectedCat = ''; selectedPay = '';
    document.getElementById('displayAmount').textContent = '0.00';
    document.getElementById('noteInput').value = '';
    document.getElementById('dateInput').value = new Date().toISOString().slice(0,10);
    document.getElementById('sheetTitle').textContent = '记一笔支出';
    document.getElementById('submitBtn').textContent = '确认记录';
  }
  renderTypeToggle(); renderCatGrid(); renderPayGrid();
  sheet.classList.add('open'); overlay.classList.add('open');
  setTimeout(() => document.getElementById('hiddenAmtInput').focus(), 300);
}
function closeSheet() {
  document.getElementById('sheet').classList.remove('open');
  document.getElementById('sheetOverlay').classList.remove('open');
  editingId = null;
}

function setType(t) { currentType = t; selectedCat = ''; renderTypeToggle(); renderCatGrid(); renderPayGrid(); }
function renderTypeToggle() {
  document.querySelectorAll('.type-btn').forEach(b => {
    b.classList.toggle('active', b.textContent === currentType);
  });
  document.getElementById('paySection').style.display = currentType === '支出' ? '' : 'none';
  document.getElementById('sheetTitle').textContent = editingId ? '编辑记录' : '记一笔'+currentType;
}
function renderCatGrid() {
  const cats = CATS[currentType] || [];
  document.getElementById('catGrid').innerHTML = cats.map(c =>
    '<div class="cat-item'+(selectedCat===c.name?' selected':'')+'" onclick="selectCat(\''+c.name+'\')"><span class="ci-icon">'+c.icon+'</span><span class="ci-name">'+c.name+'</span></div>'
  ).join('');
}
function selectCat(name) { selectedCat = name; renderCatGrid(); }
function renderPayGrid() {
  document.getElementById('payGrid').innerHTML = PAYS.map(p =>
    '<div class="pay-item'+(selectedPay===p?' selected':'')+'" onclick="selectPay(\''+p+'\')">'+p+'</div>'
  ).join('');
}
function selectPay(p) { selectedPay = p; renderPayGrid(); }

/* ====== 金额输入 ====== */
document.addEventListener('DOMContentLoaded', function() {
  const hInput = document.getElementById('hiddenAmtInput');
  const dAmount = document.getElementById('displayAmount');
  hInput.addEventListener('input', function() {
    let v = this.value.replace(/[^\d.]/g,'');
    const parts = v.split('.');
    if (parts.length > 2) v = parts[0]+'.'+parts.slice(1).join('');
    if (parts[1] && parts[1].length > 2) v = parts[0]+'.'+parts[1].slice(0,2);
    this.value = v;
    dAmount.textContent = v ? parseFloat(v).toFixed(2) : '0.00';
  });

  /* ====== 快捷金额按钮 ====== */
  const qaBtns = document.querySelectorAll('.qa-btn');
  qaBtns.forEach(btn => {
    let longPressTimer = null;
    const amt = parseFloat(btn.dataset.amt);

    function setAmount() {
      // 直接设值为该按钮金额（而非累加）
      hInput.value = amt.toFixed(2);
      dAmount.textContent = hInput.value;
      hInput.dispatchEvent(new Event('input'));
      // 高亮当前按钮
      updateQaHighlight(btn);
    }
    function clearAmount() {
      hInput.value = '';
      dAmount.textContent = '0.00';
      hInput.dispatchEvent(new Event('input'));
      updateQaHighlight(null);  // 清除所有高亮
    }

    btn.addEventListener('click', function(e) {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      setAmount();
    });

    // 长按清零（移动端 touchstart / 桌面端 mousedown）
    function startLongPress(e) {
      longPressTimer = setTimeout(function() {
        longPressTimer = null;
        clearAmount();
        showToast('金额已清零');
      }, 500);
    }
    function cancelLongPress() {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }

    btn.addEventListener('touchstart', function(e) { startLongPress(e); }, { passive:true });
    btn.addEventListener('touchend', cancelLongPress);
    btn.addEventListener('touchmove', cancelLongPress);
    btn.addEventListener('mousedown', startLongPress);
    btn.addEventListener('mouseup', cancelLongPress);
    btn.addEventListener('mouseleave', cancelLongPress);
  });

  /* 快捷按钮高亮管理 */
  window.updateQaHighlight = function(activeBtn) {
    qaBtns.forEach(b => b.classList.toggle('highlight', b === activeBtn));
  };

  /* 手动输入时清除快捷按钮高亮 */
  hInput.addEventListener('input', function() {
    // 如果手动修改了输入框，取消快捷按钮高亮
    var v = this.value.replace(/[^\d.]/g,'');
    const parts = v.split('.');
    if (parts.length > 2) v = parts[0]+'.'+parts.slice(1).join('');
    if (parts[1] && parts[1].length > 2) v = parts[0]+'.'+parts[1].slice(0,2);
    this.value = v;
    dAmount.textContent = v ? parseFloat(v).toFixed(2) : '0.00';

    // 检查当前值是否匹配某个快捷按钮
    var currentVal = parseFloat(v) || 0;
    var matched = null;
    for (var i = 0; i < qaBtns.length; i++) {
      if (parseFloat(qaBtns[i].dataset.amt) === currentVal) {
        matched = qaBtns[i];
        break;
      }
    }
    updateQaHighlight(matched);
  });
});

/* ====== 提交/编辑/删除 ====== */
async function submitRecord() {
  try {
    const amtStr = document.getElementById('hiddenAmtInput').value;
    const amt = parseFloat(amtStr);
    if (!amt || amt <= 0) { showToast('请输入金额'); return; }
    if (!selectedCat) { showToast('请选择分类'); return; }
    const pay = currentType === '支出' ? (selectedPay || '其他') : '';
    const note = document.getElementById('noteInput').value.trim();
    const date = document.getElementById('dateInput').value;
    if (!date) { showToast('请选择日期'); return; }

    if (editingId) {
      const idx = records.findIndex(r => r.id === editingId);
      if (idx >= 0) {
        records[idx] = { ...records[idx], type:currentType, cat:selectedCat, amt, pay, note, date };
        console.log('[编辑] 记录已更新:', records[idx]);
        showToast('已更新');
      } else {
        showToast('找不到要编辑的记录');
        return;
      }
    } else {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      records.unshift({ id, date, type:currentType, cat:selectedCat, amt, pay, note });
      console.log('[新增] 记录已添加:', { id, date, type: currentType, cat: selectedCat, amt });
      showToast('已记录');
    }
    records.sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    await saveToDb();
    closeSheet();
    renderAll();
    
    // 立即推送（防止云端旧数据覆盖本地新操作）
    if (isSyncEnabled()) { pushToGitee(); } else { schedulePush(); }
  } catch(err) {
    console.error('[submitRecord] 错误:', err);
    showToast('保存失败：' + err.message);
    // 即使 DB 失败也更新内存中的数据
    renderAll();
  }
}

function editRecord(id) {
  console.log('[编辑] 打开记录:', id);
  const r = records.find(x => x.id === id);
  if (!r) { showToast('记录不存在'); return; }
  openSheet(id);
}

async function deleteRecord(id) {
  console.log('[删除] 准备删除:', id);
  showConfirm('删除记录', '确定要删除这条记录吗？', async function() {
    try {
      const beforeLen = records.length;
      records = records.filter(r => r.id !== id);
      console.log('[删除] 完成: ' + beforeLen + ' → ' + records.length + ' 条');
      
      // 立即持久化到本地
      await saveToDb();
      
      // 立即渲染更新（在推送之前，确保UI先反映变化）
      renderAll();
      showToast('已删除 (' + records.length + '条)');
      
      // 如果开启了同步，立即推送删除操作到云端（不等5秒debounce）
      // 防止下次加载时pullFromGitee把已删除的记录拉回来
      if (isSyncEnabled()) {
        await pushToGitee();
        console.log('[删除] 已同步到云端');
      }
    } catch(err) {
      console.error('[deleteRecord] 错误:', err);
      showToast('删除失败：' + err.message);
      // 内存中已删除，即使DB失败也刷新显示
      renderAll();
    }
  });
}

async function confirmClearAll() {
  showConfirm('清空数据', '确定要删除所有记账记录吗？此操作不可恢复！', async function() {
    records = [];
    await saveToDb();
    renderAll();
    schedulePush();
    showToast('已清空');
  });
}

/* ====== Excel 导入导出 ====== */
function importExcel() { document.getElementById('fileInput').click(); }
function handleFileImport(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      const wb = XLSX.read(ev.target.result, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      let count = 0;
      for (const row of rows) {
        const date = row['日期'] || row['date'] || '';
        const type = row['类型'] || row['type'] || '支出';
        const cat = row['分类'] || row['cat'] || '其他';
        const amt = parseFloat(row['金额'] || row['amt'] || 0);
        const pay = row['支付方式'] || row['pay'] || '';
        const note = row['备注'] || row['note'] || '';
        if (!date || !amt) continue;
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2,6) + count;
        records.push({ id, date, type, cat, amt, pay, note });
        count++;
      }
      records.sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
      fixRecordTypes(records);
      await saveToDb();
      renderAll();
      schedulePush();
      showToast('导入 ' + count + ' 条记录');
    } catch(err) { showToast('导入失败：' + err.message); }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

function exportExcel() {
  const data = records.map(r => ({ '日期':r.date, '类型':r.type, '分类':r.cat, '金额':r.amt, '支付方式':r.pay, '备注':r.note }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '记账明细');
  XLSX.writeFile(wb, '记账数据_' + new Date().toISOString().slice(0,10) + '.xlsx');
  showToast('Excel 已导出');
}

function exportCSV() {
  const bom = '\uFEFF';
  const header = '日期,类型,分类,金额,支付方式,备注\n';
  const rows = records.map(r => [r.date,r.type,r.cat,r.amt,r.pay||'',r.note||''].join(',')).join('\n');
  downloadFile(bom + header + rows, '记账数据_' + new Date().toISOString().slice(0,10) + '.csv', 'text/csv;charset=utf-8');
  showToast('CSV 已导出');
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ====== JSON 备份/恢复 ====== */
function backupData() {
  if (records.length === 0) { showToast('没有数据可备份'); return; }
  const payload = {
    version: 2,
    app: '个人记账本',
    backedUp: new Date().toISOString(),
    count: records.length,
    records: records
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '记账备份_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('备份成功（' + records.length + '条记录）');
}

let restoreFile = null;
function handleRestore(e) {
  const file = e.target.files[0]; if (!file) return;
  restoreFile = file;
  document.getElementById('restoreModal').classList.add('open');
  e.target.value = '';
}
function closeRestoreModal() {
  document.getElementById('restoreModal').classList.remove('open');
  restoreFile = null;
}
async function executeRestore(mode) {
  if (!restoreFile) return;
  try {
    const text = await restoreFile.text();
    const data = JSON.parse(text);
    const incoming = data.records || data;
    if (!Array.isArray(incoming)) { showToast('备份文件格式错误'); return; }
    if (mode === 'overwrite') {
      records = incoming;
      fixRecordTypes(records);
      showToast('已覆盖恢复 ' + records.length + ' 条记录');
    } else {
      const existingIds = new Set(records.map(r => r.id));
      let newCount = 0;
      for (const r of incoming) {
        if (!existingIds.has(r.id)) { records.push(r); newCount++; }
      }
      fixRecordTypes(records);
      showToast('合并完成，新增 ' + newCount + ' 条记录');
    }
    records.sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    await saveToDb();
    closeRestoreModal();
    renderAll();
    schedulePush();
  } catch(err) { showToast('恢复失败：' + err.message); }
}

/* ====== Token 配置 ====== */
function openTokenModal() {
  document.getElementById('tokenInput').value = getToken();
  document.getElementById('tokenModal').classList.add('open');
}
function closeTokenModal() { document.getElementById('tokenModal').classList.remove('open'); }
async function saveToken() {
  const t = document.getElementById('tokenInput').value.trim();
  setToken(t);
  closeTokenModal();
  if (t) {
    showToast('Token 已保存');
    await pullFromGitee();
  } else {
    showToast('Token 已清除');
    updateSyncUI('', '同步未启用');
  }
}

/* ====== 渲染所有 ====== */
function formatMonthLabel(cm) {
  const [y,m] = cm.split('-').map(Number);
  return y + '年' + m + '月';
}
function renderAll() {
  document.getElementById('monthLabel').textContent = formatMonthLabel(currentMonth);
  renderOverview();
  renderRecords();
}

/* ====== 静态数据回退加载（GitHub Pages / 新用户首次打开） ====== */
const STATIC_DATA_URLS = [
  'data/records.json',
  'https://raw.githubusercontent.com/3596994723-spec/AccountBook/main/data/records.json'
];

async function loadStaticFallback() {
  // 仅在本地无数据时才尝试静态加载
  if (records.length > 0) return false;
  for (const url of STATIC_DATA_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      if (json.records && Array.isArray(json.records) && json.records.length > 0) {
        records = json.records;
        fixRecordTypes(records);
        await saveToDb();
        console.log('静态数据已加载 (' + records.length + ' 条):', url);
        return true;
      }
    } catch(e) { /* 继续尝试下一个 */ }
  }
  return false;
}

/* ====== 数据兼容性修复 ====== */
function fixRecordTypes(recs) {
  let fixed = false;
  for (const r of recs) {
    // type: 数字 0/1 → 字符串 '收入'/'支出'
    if (typeof r.type === 'number') { r.type = r.type === 0 ? '收入' : '支出'; fixed = true; }
    // amount 字段名 → amt
    if (r.amount !== undefined && r.amt === undefined) { r.amt = r.amount; delete r.amount; fixed = true; }
  }
  if (fixed) console.log('已修复记录格式兼容性');
  return fixed;
}

/* ====== 页面卸载前保底保存 ====== */
// 确保用户关闭/刷新页面时，最后一次操作不丢失（同步写入，不可被中断）
window.addEventListener('pagehide', function() {
  try { localStorage.setItem('accountbook_records', JSON.stringify(records)); localStorage.setItem('ab_last_save', Date.now().toString()); } catch(e) {}
}, { capture: true });
// 兼容传统桌面浏览器
window.addEventListener('beforeunload', function() {
  try { localStorage.setItem('accountbook_records', JSON.stringify(records)); } catch(e) {}
});

/* ====== 初始化（带安全门守卫） ====== */
(async function init() {
  try {
    console.log('[初始化] 开始，当前记录数: ' + records.length + ' (来源: ' + (_seed ? '种子数据' : '空') + ')');

    // 【安全门】检查 localStorage 备份是否比当前内存中的数据更丰富
    const lsBackup = _loadFromLocalStorage();
    if (lsBackup && lsBackup.length > records.length) {
      console.log('[初始化] 安全门触发：localStorage 备份 (' + lsBackup.length + '条) 比当前内存 (' + records.length + '条) 更丰富，优先使用备份');
      records = lsBackup;
    }

    await migrateFromLocalStorage();   // 可能从旧版 localStorage 迁移更多记录到 DB
    await loadRecords();                // 多级回退加载：IDB → localStorage → seed
    fixRecordTypes(records);            // 兼容性修复（type数字→字符串, amount→amt）

    // 【安全门】二次校验：如果所有加载路径都返回了空数据，但 localStorage 有备份，强制恢复
    if (records.length === 0 && lsBackup && lsBackup.length > 0) {
      console.warn('[初始化] 安全门兜底：所有主加载路径为空，但检测到 localStorage 备份 (' + lsBackup.length + '条)，强制恢复');
      records = lsBackup;
      fixRecordTypes(records);
    }

    saveToDb();                        // 双写持久化：IndexedDB + localStorage
    renderAll();                       // 渲染界面

    if (isSyncEnabled()) {
      await pullFromGitee();           // 有 Token 则拉取云端最新并合并
    } else if (records.length === 0) {
      // 极端情况：种子数据和本地存储都没有 → 尝试静态文件/GitHub raw
      var loaded = await loadStaticFallback();
      if (loaded) { renderAll(); updateSyncUI('', '已加载远程数据'); }
      else { updateSyncUI('', '暂无数据'); }
    } else {
      updateSyncUI('', '本地数据 (' + records.length + '条)');
    }

    console.log('[初始化] 完成，最终记录数: ' + records.length);
  } catch(e) {
    console.error('[初始化] 错误:', e);
    // 崩溃时多重保底：localStorage 备份 > 种子数据
    const crashBackup = _loadFromLocalStorage();
    if (crashBackup && crashBackup.length > 0) { records = crashBackup; console.log('[初始化] 崩溃恢复：从 localStorage 加载 ' + records.length + ' 条'); }
    else if (records.length === 0 && _seed) { records = _seed.slice(); console.log('[初始化] 崩溃恢复：使用种子数据'); }
    fixRecordTypes(records);
    renderAll();
    showToast('部分功能可能异常，已尝试恢复数据');
  }
})();

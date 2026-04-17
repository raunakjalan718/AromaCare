/**
 * app.js — AromaCare | Real ESP32 Integration Controller
 * Polls /status from the ESP32 WiFi web server every 2 seconds.
 * Stores readings in the LocalStorage JSON database.
 * SEPM Project 2026
 */
'use strict';

/* ══════════════════════════════════════════════════════════════
   GLOBAL STATE
══════════════════════════════════════════════════════════════ */
const APP = {
    loggedIn:       false,
    streaming:      false,
    esp32Ip:        '',
    connState:      'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'error'
    consecutiveErr: 0,
    maxRetries:     4,
    analyticsRange: 30,
    historyFilter:  'all',
    historySearch:  '',
    liveChart:      null,
    aCharts:        {},
    streamTimer:    null,
    toastTimer:     null,
    modalCb:        null,
};

let _historyData = [];

/* ══════════════════════════════════════════════════════════════
   BOOTSTRAP
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    DB.init();
    APP.esp32Ip = DB.getIP();
    setupScrollObserver();
    lucide.createIcons();
});

/* ══════════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════════ */
function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById('page-' + id);
    if (!el) return;
    el.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'instant' });
    setTimeout(() => lucide.createIcons(), 60);

    document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('nav-link-active'));
    const map = { dashboard: 'nl-dash', analytics: 'nl-analytics', history: 'nl-history', settings: 'nl-settings' };
    if (map[id]) document.getElementById(map[id])?.classList.add('nav-link-active');

    switch (id) {
        case 'dashboard': initDashboard();    break;
        case 'analytics': renderAnalytics();  break;
        case 'history':   renderHistory();    break;
        case 'settings':  loadSettings();     break;
    }
}

function scrollToSection(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ══════════════════════════════════════════════════════════════
   AUTH
══════════════════════════════════════════════════════════════ */
function handleLogin() {
    const user   = document.getElementById('username').value.trim();
    const pass   = document.getElementById('password').value;
    const errEl  = document.getElementById('login-error');
    const btn    = document.getElementById('login-btn');
    const btnTxt = document.getElementById('login-btn-text');

    if (user === 'admin' && pass === 'password123') {
        errEl.style.display = 'none';
        btnTxt.textContent  = 'Authenticating…';
        btn.disabled = true;
        setTimeout(() => {
            btn.disabled = false;
            btnTxt.textContent = 'Login to Portal';
            APP.loggedIn = true;
            document.getElementById('nav-auth-area').style.display  = 'none';
            document.getElementById('nav-user-area').style.display  = 'flex';
            document.getElementById('nav-landing-links').style.display = 'none';
            document.getElementById('nav-app-links').style.display  = 'flex';
            showPage('dashboard');
        }, 900);
    } else {
        errEl.style.display = 'flex';
        btn.style.animation = 'shake 0.35s ease';
        setTimeout(() => btn.style.animation = '', 400);
        lucide.createIcons();
    }
}

function logout() {
    APP.loggedIn  = false;
    APP.streaming = false;
    clearInterval(APP.streamTimer);
    APP.streamTimer = null;
    if (APP.liveChart) { APP.liveChart.destroy(); APP.liveChart = null; }
    Object.values(APP.aCharts).forEach(c => { try { c.destroy(); } catch(e){} });
    APP.aCharts = {};

    document.getElementById('nav-auth-area').style.display    = '';
    document.getElementById('nav-user-area').style.display    = 'none';
    document.getElementById('nav-landing-links').style.display = 'flex';
    document.getElementById('nav-app-links').style.display    = 'none';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    showPage('landing');
    showToast('Logged out successfully.');
}

/* ══════════════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════════════ */
function initDashboard() {
    if (!APP.liveChart) buildLiveChart();
    renderAlertLog();

    // Restore last saved reading to cards immediately
    const recent = DB.getReadings(1);
    if (recent.length) {
        const r = recent[0];
        refreshStatCards(r.mq135, r.mq135s, r.mq136, r.mq136s, r.mq137, r.mq137s);
        setLastUpdated(r.ts);
        prefillLiveChart();
    }

    if (!APP.streaming) {
        APP.streaming = true;
        startStream();
    }
}

/* ══════════════════════════════════════════════════════════════
   ESP32 FETCH — REAL DATA
══════════════════════════════════════════════════════════════ */
function startStream() {
    if (APP.streamTimer) return;
    tick(); // immediate first poll
    APP.streamTimer = setInterval(tick, 2000);
}

async function tick() {
    const ip = APP.esp32Ip;

    if (!ip) {
        setConnState('disconnected');
        return;
    }

    setConnState('connecting');

    try {
        // No custom headers — keeps request "simple" and avoids CORS preflight
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 5000);

        const resp = await fetch(`http://${ip}/status`, {
            method: 'GET',
            mode:   'cors',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        const data = await resp.json();
        APP.consecutiveErr = 0;
        setConnState('connected');
        processESP32Data(data);

    } catch (err) {
        APP.consecutiveErr++;
        console.warn('[ESP32] Fetch failed:', err.message, `(${APP.consecutiveErr}/${APP.maxRetries})`);
        if (APP.consecutiveErr >= APP.maxRetries) {
            setConnState('error');
        }
    }
}

function processESP32Data(data) {
    /*
     * Expected shape from ESP32:
     * { mq135, mq135_status, mq136, mq136_status, mq137, mq137_status, fan, time_left }
     */
    const mq135   = parseInt(data.mq135, 10)   || 0;
    const mq135s  = data.mq135_status           || 'GOOD';
    const mq136   = parseInt(data.mq136, 10)   || 0;
    const mq136s  = data.mq136_status           || 'GOOD';
    const mq137   = parseInt(data.mq137, 10)   || 0;
    const mq137s  = data.mq137_status           || 'GOOD';
    const fan     = data.fan                    || 'OFF';
    const timeLeft = parseInt(data.time_left, 10) || 0;

    const isAlert = (mq135s === 'BAD' || mq136s === 'BAD' || mq137s === 'BAD');
    const msgs    = [];
    if (mq135s === 'BAD') msgs.push(`MQ-135 Air Quality: ${mq135} ADC (threshold 400)`);
    if (mq136s === 'BAD') msgs.push(`MQ-136 Gas: ${mq136} ADC (threshold 400)`);
    if (mq137s === 'BAD') msgs.push(`MQ-137 Ammonia: ${mq137} ADC (threshold 400)`);
    if (fan     === 'ON')  msgs.push('Fan activated by ESP32');

    // Save to DB
    const entry = DB.saveReading(mq135, mq135s, mq136, mq136s, mq137, mq137s, fan, timeLeft, isAlert, msgs.join(' · '));

    // Update UI
    refreshStatCards(mq135, mq135s, mq136, mq136s, mq137, mq137s);
    setLastUpdated(entry.ts);
    pushLiveChart({ mq135, mq136, mq137 }, entry.ts);

    if (isAlert) {
        showAlertBanner(msgs.join(' · '));
        pushAlertToLog(entry.ts, msgs.join(' · '));
    }
}

/* ══════════════════════════════════════════════════════════════
   CONNECTION STATE UI
══════════════════════════════════════════════════════════════ */
function setConnState(state) {
    APP.connState = state;

    const badge = document.getElementById('conn-badge');
    const text  = document.getElementById('conn-badge-text');
    const sysBadge = document.getElementById('sys-badge');
    if (!badge || !text) return;

    badge.style.display = 'flex';

    switch (state) {
        case 'disconnected':
            badge.className  = 'status-pill warning';
            text.textContent = APP.esp32Ip ? 'No IP Configured' : 'ESP32 Not Configured';
            if (sysBadge) sysBadge.style.display = 'none';
            break;
        case 'connecting':
            badge.className  = 'status-pill warning';
            text.textContent = 'Connecting…';
            break;
        case 'connected':
            badge.className  = 'status-pill ok';
            text.textContent = 'ESP32 Connected';
            if (sysBadge) sysBadge.style.display = 'flex';
            break;
        case 'error':
            badge.className  = 'status-pill alert';
            text.textContent = 'ESP32 Unreachable';
            if (sysBadge) sysBadge.style.display = 'none';
            break;
    }

    // Toggle the explicit No-IP dashboard card warning
    const noIpNotice = document.getElementById('no-ip-notice');
    if (noIpNotice) {
        noIpNotice.style.display = (state === 'connected' || state === 'connecting') ? 'none' : 'flex';
    }

    // Update Settings connection indicator
    updateSettingsConnUI(state);
}

function updateSettingsConnUI(state) {
    const indicator = document.getElementById('sett-conn-indicator');
    const statusTxt = document.getElementById('sett-conn-status');
    if (!indicator || !statusTxt) return;

    const map = {
        disconnected: ['#f59e0b', 'Not configured — enter IP below'],
        connecting:   ['#06b6d4', 'Connecting…'],
        connected:    ['#10b981', `Connected to ${APP.esp32Ip}`],
        error:        ['#ef4444', `Unreachable: ${APP.esp32Ip} — check IP & WiFi`],
    };
    const [color, txt] = map[state] || map.disconnected;
    indicator.style.background = color;
    indicator.style.boxShadow  = `0 0 8px ${color}`;
    statusTxt.textContent = txt;
}

/* ══════════════════════════════════════════════════════════════
   STAT CARDS
══════════════════════════════════════════════════════════════ */
// Alert thresholds matching ESP32 firmware
const THRESHOLDS = { mq135: 2300, mq136: 1750, mq137: 1750 };

function refreshStatCards(mq135, mq135s, mq136, mq136s, mq137, mq137s) {
    updateCard('mq135', mq135, mq135s === 'BAD', THRESHOLDS.mq135);
    updateCard('mq136', mq136, mq136s === 'BAD', THRESHOLDS.mq136);
    updateCard('mq137', mq137, mq137s === 'BAD', THRESHOLDS.mq137);

    const isAlert = (mq135s === 'BAD' || mq136s === 'BAD' || mq137s === 'BAD');
    updateSysBadge(isAlert);
}

function updateCard(sensor, val, exceeded, thr = 400) {
    setText('val-' + sensor, val);
    const pct   = Math.min((val / thr) * 100, 100);
    const barEl = document.getElementById('bar-' + sensor);
    if (barEl) barEl.style.width = pct + '%';

    const pill = document.getElementById('pill-' + sensor);
    if (pill) {
        pill.textContent = exceeded ? 'ALERT' : 'Good';
        pill.className   = 'stat-pill ' + (exceeded ? 'alert' : 'normal');
    }

    const card = document.getElementById('card-' + sensor);
    if (card) {
        if (exceeded) {
            card.style.borderColor = 'rgba(239,68,68,0.42)';
            card.style.boxShadow   = '0 0 32px rgba(239,68,68,0.14)';
        } else {
            card.style.borderColor = '';
            card.style.boxShadow   = '';
        }
    }
}

function updateFanCard(fan, timeLeft) {
    const isOn     = fan === 'ON';
    const fanState = document.getElementById('val-fan');
    if (fanState) fanState.textContent = fan;

    const pill = document.getElementById('pill-fan');
    if (pill) {
        pill.textContent = isOn ? 'Active' : 'Idle';
        pill.className   = 'stat-pill ' + (isOn ? 'alert' : 'normal');
    }

    // Time left display
    const tl = document.getElementById('fan-timeleft');
    if (tl && typeof timeLeft === 'number') {
        const sec = Math.ceil(timeLeft / 1000);
        tl.textContent = `Next cycle: ${sec}s`;
    }

    const card = document.getElementById('card-fan');
    if (card) {
        if (isOn) {
            card.style.borderColor = 'rgba(239,68,68,0.42)';
            card.style.boxShadow   = '0 0 32px rgba(239,68,68,0.14)';
        } else {
            card.style.borderColor = '';
            card.style.boxShadow   = '';
        }
    }
}

function updateSysBadge(isAlert) {
    const badge = document.getElementById('sys-badge');
    const text  = document.getElementById('sys-badge-text');
    if (!badge || !text) return;
    badge.className  = isAlert ? 'status-pill alert' : 'status-pill ok';
    text.textContent = isAlert ? 'ANOMALY DETECTED' : 'Air Quality Normal';
}

function setLastUpdated(ts) {
    const el = document.getElementById('last-upd');
    if (el) el.textContent = 'Updated: ' + new Date(ts).toLocaleTimeString();
}

function showAlertBanner(msg) {
    const banner = document.getElementById('alert-banner');
    const msgEl  = document.getElementById('alert-msg-text');
    if (!banner || !msgEl) return;
    msgEl.textContent    = msg;
    banner.style.display = 'flex';
    clearTimeout(APP._bannerTimer);
    APP._bannerTimer = setTimeout(() => { banner.style.display = 'none'; }, 10000);
}

function dismissAlert() {
    const banner = document.getElementById('alert-banner');
    if (banner) banner.style.display = 'none';
}

/* ══════════════════════════════════════════════════════════════
   ALERT LOG
══════════════════════════════════════════════════════════════ */
function pushAlertToLog(ts, msg) {
    const log   = document.getElementById('alert-log-body');
    if (!log) return;
    const empty = log.querySelector('.empty-msg');
    if (empty) empty.remove();

    const el = document.createElement('div');
    el.className = 'alert-item';
    el.innerHTML = `<span class="ai-time">${new Date(ts).toLocaleString()}</span><span class="ai-msg">${msg}</span>`;
    log.insertBefore(el, log.firstChild);

    const count = log.querySelectorAll('.alert-item').length;
    setText('alert-count-pill', count + ' alert' + (count !== 1 ? 's' : ''));
}

function renderAlertLog() {
    const log = document.getElementById('alert-log-body');
    if (!log) return;
    const alerts = DB.getAlerts().slice().reverse();
    if (!alerts.length) {
        log.innerHTML = `
            <div class="empty-msg">
                <i data-lucide="check-circle" style="color:var(--green)"></i>
                <strong>No alerts</strong>
                <span>All sensors within normal range</span>
            </div>`;
    } else {
        log.innerHTML = alerts.map(a => `
            <div class="alert-item">
                <span class="ai-time">${new Date(a.ts).toLocaleString()}</span>
                <span class="ai-msg">${a.message}</span>
            </div>`).join('');
    }
    setText('alert-count-pill', alerts.length + ' alert' + (alerts.length !== 1 ? 's' : ''));
    lucide.createIcons();
}

/* ══════════════════════════════════════════════════════════════
   LIVE CHART
══════════════════════════════════════════════════════════════ */
function buildLiveChart() {
    const ctx = document.getElementById('liveChart');
    if (!ctx) return;

    const ds = (label, color) => ({
        label, data: [],
        borderColor: color, pointBackgroundColor: color,
        pointRadius: 2, pointHoverRadius: 5,
        borderWidth: 2, fill: false, tension: 0.4, spanGaps: true
    });

    APP.liveChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                ds('MQ-135 (ADC)', '#06b6d4'),
                ds('MQ-136 (ADC)', '#a855f7'),
                ds('MQ-137 (ADC)', '#10b981'),
            ]
        },
        options: liveChartOptions()
    });

    prefillLiveChart();
}

function prefillLiveChart() {
    if (!APP.liveChart) return;
    APP.liveChart.data.labels   = [];
    APP.liveChart.data.datasets.forEach(ds => ds.data = []);

    const readings = DB.getReadings(25);
    readings.forEach(r => {
        const t = new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second:'2-digit' });
        APP.liveChart.data.labels.push(t);
        APP.liveChart.data.datasets[0].data.push(r.mq135 ?? null);
        APP.liveChart.data.datasets[1].data.push(r.mq136 ?? null);
        APP.liveChart.data.datasets[2].data.push(r.mq137 ?? null);
    });
    APP.liveChart.update('none');
}

function pushLiveChart(data, ts) {
    if (!APP.liveChart) return;
    const MAX = 30;
    const t   = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    APP.liveChart.data.labels.push(t);
    APP.liveChart.data.datasets[0].data.push(data.mq135);
    APP.liveChart.data.datasets[1].data.push(data.mq136);
    APP.liveChart.data.datasets[2].data.push(data.mq137);

    if (APP.liveChart.data.labels.length > MAX) {
        APP.liveChart.data.labels.shift();
        APP.liveChart.data.datasets.forEach(ds => ds.data.shift());
    }
    APP.liveChart.update();
}

function liveChartOptions() {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: {
            legend: { display: true, position: 'top', align: 'end',
                labels: { font: { family:'Inter', size:11 }, color:'#64748b', boxWidth:14, padding:12 } },
            tooltip: {
                backgroundColor: 'rgba(5,5,20,0.93)',
                borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 12,
                titleColor: '#94a3b8', bodyColor: '#e2e8f0',
                bodyFont:  { family:'Inter', size:12, weight:'600' },
                titleFont: { family:'Inter', size:11 },
                callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} ADC` }
            }
        },
        scales: {
            x: { grid: { color:'rgba(255,255,255,0.04)', drawBorder:false },
                 ticks:{ color:'#475569', font:{family:'Inter', size:10}, maxTicksLimit:8 } },
            y: { min: 0, max: 4095,
                 grid: { color:'rgba(255,255,255,0.04)', drawBorder:false },
                 ticks:{ color:'#475569', font:{family:'Inter', size:10} },
                 title:{ display:true, text:'ADC Value (0–4095)', color:'#475569', font:{family:'Inter', size:10} } }
        },
        interaction: { mode:'index', intersect:false },
        animation: { duration: 350 }
    };
}

/* ══════════════════════════════════════════════════════════════
   DOWNSAMPLE — one reading per minute
   Returns readings sorted oldest → newest, one per calendar minute.
══════════════════════════════════════════════════════════════ */
function downsamplePerMinute(readings) {
    const map = {};
    readings.forEach(r => {
        const key = r.ts.slice(0, 16); // e.g. "2026-04-17T09:34"
        // keep the last (most recent) reading in each minute bucket
        if (!map[key] || r.ts > map[key].ts) map[key] = r;
    });
    return Object.values(map).sort((a, b) => a.ts.localeCompare(b.ts));
}

/* ══════════════════════════════════════════════════════════════
   ANALYTICS
══════════════════════════════════════════════════════════════ */
function setRange(n, btn) {
    APP.analyticsRange = n;
    document.querySelectorAll('.range-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderAnalytics();
}

function renderAnalytics() {
    const limit    = APP.analyticsRange || 0;
    // Get readings then downsample to 1-per-minute for charting
    const raw      = DB.getReadings(limit);
    const readings = downsamplePerMinute(raw);
    const stats    = DB.getStats(raw); // stats always on full dataset

    const sensors = [
        { key:'mq135', id:'chartMQ135', color:'#06b6d4', label:'MQ-135 Air Quality (ADC)' },
        { key:'mq136', id:'chartMQ136', color:'#a855f7', label:'MQ-136 Gas Detection (ADC)' },
        { key:'mq137', id:'chartMQ137', color:'#10b981', label:'MQ-137 Ammonia (ADC)' },
    ];

    sensors.forEach(s => {
        if (stats && stats[s.key]) {
            setText('min-' + s.key, stats[s.key].min);
            setText('avg-' + s.key, stats[s.key].avg);
            setText('max-' + s.key, stats[s.key].max);
        }

        const labels = readings.map(r => {
            const d = new Date(r.ts);
            return d.toLocaleDateString([], { month:'short', day:'numeric' })
                 + ' ' + d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
        });
        const data   = readings.map(r => r[s.key] ?? null);

        // Destroy old chart
        if (APP.aCharts[s.key]) { try { APP.aCharts[s.key].destroy(); } catch(e){} delete APP.aCharts[s.key]; }

        const ctx = document.getElementById(s.id);
        if (!ctx) return;

        APP.aCharts[s.key] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: s.label, data,
                        borderColor: s.color, backgroundColor: s.color + '14',
                        pointBackgroundColor: s.color, fill: true,
                        tension: 0.4, pointRadius: readings.length > 40 ? 1 : 2,
                        pointHoverRadius: 5, borderWidth: 2,
                    },
                    // ADC threshold line at 400
                    {
                        label: 'Alert Threshold (400 ADC)',
                        data: readings.map(() => 400),
                        borderColor: 'rgba(239,68,68,0.55)',
                        borderDash: [5,5], borderWidth: 1.5,
                        pointRadius: 0, fill: false,
                    }
                ]
            },
            options: analyticsChartOptions()
        });
    });
}

function analyticsChartOptions() {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: {
            legend: { display: true, position: 'top', align: 'end',
                labels: { font:{family:'Inter', size:10}, color:'#64748b', boxWidth:12, padding:10 } },
            tooltip: {
                backgroundColor: 'rgba(5,5,20,0.93)',
                borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 12,
                titleColor: '#94a3b8', bodyColor: '#e2e8f0',
                bodyFont:  { family:'Inter', size:12, weight:'600' },
                titleFont: { family:'Inter', size:11 },
            }
        },
        scales: {
            x: { grid:{color:'rgba(255,255,255,0.04)', drawBorder:false},
                 ticks:{color:'#475569', font:{family:'Inter',size:9}, maxTicksLimit:8, maxRotation:30} },
            y: { min:0, max:4095,
                 grid:{color:'rgba(255,255,255,0.04)', drawBorder:false},
                 ticks:{color:'#475569', font:{family:'Inter',size:10}} }
        },
        interaction: { mode:'index', intersect:false },
        animation: { duration:400 }
    };
}

/* ══════════════════════════════════════════════════════════════
   HISTORY TABLE
══════════════════════════════════════════════════════════════ */
function renderHistory() {
    _historyData = DB.getReadings(0).slice().reverse();
    updateHistorySummary();
    applyFilters();
}

function updateHistorySummary() {
    const all    = DB.getReadings(0);
    const alerts = all.filter(r => r.isAlert).length;
    setText('total-records', all.length);
    setText('total-alerts',  alerts);
    setText('normal-count',  all.length - alerts);
    setText('sett-rec-count', all.length);

    if (all.length > 0) {
        const f = new Date(all[0].ts);
        setText('first-date', f.toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' }));
    } else {
        setText('first-date', '--');
    }
}

function setFilter(filter, btn) {
    APP.historyFilter = filter;
    document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyFilters();
}

function filterHistory() {
    APP.historySearch = (document.getElementById('search-input')?.value || '').toLowerCase();
    applyFilters();
}

function applyFilters() {
    let data = _historyData; // newest first, full dataset
    if (APP.historyFilter === 'alert')  data = data.filter(r =>  r.isAlert);
    if (APP.historyFilter === 'normal') data = data.filter(r => !r.isAlert);
    if (APP.historySearch) {
        data = data.filter(r => {
            const flat = `${r.ts} ${r.mq135} ${r.mq135s} ${r.mq136} ${r.mq136s} ${r.mq137} ${r.mq137s} ${r.fan}`.toLowerCase();
            return flat.includes(APP.historySearch);
        });
    }
    // Downsample to 1 per minute, then restore newest-first order for table
    const sampled = downsamplePerMinute(data).reverse();
    renderTable(sampled);
}

function renderTable(data) {
    const tbody = document.getElementById('history-body');
    const table = document.getElementById('main-table');
    const empty = document.getElementById('table-empty');
    if (!tbody) return;

    if (!data.length) {
        tbody.innerHTML = '';
        if (table) table.style.display = 'none';
        if (empty) empty.style.display = 'flex';
    } else {
        if (table) table.style.display = 'table';
        if (empty) empty.style.display = 'none';

        tbody.innerHTML = data.map((r, idx) => {
            const d       = new Date(r.ts);
            const dateStr = d.toLocaleDateString([], { year:'numeric', month:'short', day:'numeric' });
            const timeStr = d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });

            const badge135 = statusBadge(r.mq135s || 'GOOD');
            const badge136 = statusBadge(r.mq136s || 'GOOD');
            const badge137 = statusBadge(r.mq137s || 'GOOD');

            const mainStatus = r.isAlert
                ? `<span class="badge-alert"><i data-lucide="alert-triangle"></i> Alert</span>`
                : `<span class="badge-normal"><i data-lucide="check"></i> Normal</span>`;

            return `<tr>
                <td style="color:var(--text-muted);font-size:0.76rem">${idx + 1}</td>
                <td class="td-date">${dateStr}</td>
                <td class="td-time">${timeStr}</td>
                <td>
                    <span style="color:var(--cyan);font-weight:600;font-size:1rem">${r.mq135 ?? '--'}</span>
                    <span style="display:block;font-size:0.72rem;margin-top:3px">${badge135}</span>
                </td>
                <td>
                    <span style="color:var(--purple);font-weight:600;font-size:1rem">${r.mq136 ?? '--'}</span>
                    <span style="display:block;font-size:0.72rem;margin-top:3px">${badge136}</span>
                </td>
                <td>
                    <span style="color:var(--green);font-weight:600;font-size:1rem">${r.mq137 ?? '--'}</span>
                    <span style="display:block;font-size:0.72rem;margin-top:3px">${badge137}</span>
                </td>
                <td>${mainStatus}</td>
            </tr>`;
        }).join('');

        setTimeout(() => lucide.createIcons(), 60);
    }
}

function statusBadge(s) {
    return s === 'BAD'
        ? `<span style="background:rgba(239,68,68,0.12);color:#f87171;padding:2px 7px;border-radius:50px;border:1px solid rgba(239,68,68,0.25)">BAD</span>`
        : `<span style="background:rgba(16,185,129,0.1);color:#10b981;padding:2px 7px;border-radius:50px;border:1px solid rgba(16,185,129,0.2)">GOOD</span>`;
}

/* ══════════════════════════════════════════════════════════════
   CSV EXPORT
══════════════════════════════════════════════════════════════ */
function downloadCSV() {
    const readings = DB.getReadings(0);
    if (!readings.length) { showToast('No data to export yet.', true); return; }

    let csv = 'Record #,Date,Time,MQ-135 Air Quality (ADC),MQ-135 Status,MQ-136 Gas (ADC),MQ-136 Status,MQ-137 Ammonia (ADC),MQ-137 Status,Fan,Time Left (ms),Alert Status\n';
    readings.forEach((r, i) => {
        const d    = new Date(r.ts);
        const date = d.toLocaleDateString();
        const time = d.toLocaleTimeString();
        csv += `${i+1},${date},${time},${r.mq135},${r.mq135s||''},${r.mq136},${r.mq136s||''},${r.mq137},${r.mq137s||''},${r.fan||''},${r.timeLeft||''},${r.isAlert ? 'ALERT' : 'Normal'}\n`;
    });

    const blob   = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url    = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href  = url;
    anchor.download = `ENose_ESP32_Export_${new Date().toLocaleDateString().replace(/\//g,'-')}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    showToast('CSV exported — ' + readings.length + ' records.');
}

/* ══════════════════════════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════════════════════════ */
function loadSettings() {
    const ip  = DB.getIP();
    const ipEl = document.getElementById('sett-esp32-ip');
    if (ipEl) ipEl.value = ip;
    APP.esp32Ip = ip;

    // Thresholds (read-only display, ESP32 handles this)
    setText('sett-thr-mq135', '400 ADC');
    setText('sett-thr-mq136', '400 ADC');
    setText('sett-thr-mq137', '400 ADC');

    setText('sett-rec-count', DB.getReadings(0).length);
    updateSettingsConnUI(APP.connState);
}

async function connectESP32() {
    const ipInput = document.getElementById('sett-esp32-ip');
    if (!ipInput) return;
    const ip = ipInput.value.trim();

    if (!ip) { showToast('Please enter the ESP32 IP address.', true); return; }

    const btn = document.getElementById('btn-connect-esp32');
    if (btn) { btn.textContent = 'Testing…'; btn.disabled = true; }

    setConnState('connecting');

    try {
        // Simple GET, no custom headers — avoids CORS preflight
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 6000);

        const resp = await fetch(`http://${ip}/status`, {
            method: 'GET',
            mode:   'cors',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        await resp.json(); // Validate JSON

        APP.esp32Ip        = ip;
        APP.consecutiveErr = 0;
        DB.saveIP(ip);
        setConnState('connected');

        // Start the live stream from Dashboard if logged in
        if (APP.loggedIn && !APP.streamTimer) {
            APP.streaming = true;
            startStream();
        }

        showToast(`✓ Connected to ESP32 at ${ip}`);

    } catch (err) {
        setConnState('error');
        console.error('[ESP32 Connect]', err);

        // Detect likely CORS / Private Network Access or Mixed Content block
        const isCors = err.name === 'TypeError';
        const isHttps = window.location.protocol === 'https:';
        let msg = `Cannot reach ${ip} — check IP & WiFi. (${err.message})`;
        
        if (isCors) {
            if (isHttps) {
                msg = `Vercel (HTTPS) blocks local IPs. Click 🔒 in URL bar -> Site Settings -> Allow Insecure Content.`;
            } else {
                msg = `Blocked by browser CORS/PNA — see the fix instructions below.`;
            }
        }
        showToast(msg, true);
    }

    if (btn) { btn.textContent = 'Connect'; btn.disabled = false; }
}

function disconnectESP32() {
    APP.esp32Ip       = '';
    APP.consecutiveErr = 0;
    DB.clearIP();
    setConnState('disconnected');

    const ipEl = document.getElementById('sett-esp32-ip');
    if (ipEl) ipEl.value = '';
    showToast('ESP32 disconnected.');
}

/* ══════════════════════════════════════════════════════════════
   DATA MANAGEMENT
══════════════════════════════════════════════════════════════ */
function promptClear() {
    showModal(
        'Clear All Records',
        'This will permanently delete all stored sensor readings and alert logs. This cannot be undone.',
        clearAllData
    );
}

function clearAllData() {
    DB.clearAll();
    _historyData = [];
    closeModal();
    renderHistory();
    renderAlertLog();
    showToast('All records cleared from database.');
}

/* ══════════════════════════════════════════════════════════════
   MODAL
══════════════════════════════════════════════════════════════ */
function showModal(title, msg, cb) {
    setText('modal-title', title);
    setText('modal-msg',   msg);
    APP.modalCb = cb;
    const ok = document.getElementById('modal-ok');
    if (ok) ok.onclick = () => { if (APP.modalCb) APP.modalCb(); };
    document.getElementById('modal').style.display = 'flex';
    lucide.createIcons();
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
    APP.modalCb = null;
}

/* ══════════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════════ */
function showToast(msg, isError = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'toast show' + (isError ? ' error' : '');
    clearTimeout(APP.toastTimer);
    APP.toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

/* ══════════════════════════════════════════════════════════════
   SCROLL ANIMATIONS
══════════════════════════════════════════════════════════════ */
function setupScrollObserver() {
    const io = new IntersectionObserver(
        entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
        { threshold: 0.12 }
    );
    document.querySelectorAll('.anim-el').forEach(el => io.observe(el));
}

/* ══════════════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════════════ */
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

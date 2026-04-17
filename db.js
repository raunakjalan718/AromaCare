/**
 * db.js — E-Nose Pro JSON LocalStorage Database Layer
 * Schema v3 — Real ESP32 MQ135/MQ136/MQ137 Data
 * SEPM Project 2026
 */

const DB_KEY       = 'enose_pro_v4_esp32';
const DB_CONN_KEY  = 'enose_esp32_ip';

const DB = {

    // ── Initializer ──────────────────────────────────────────────────────
    init() {
        if (!localStorage.getItem(DB_KEY)) {
            this._save({
                readings:   [],
                alerts:     [],
                thresholds: { mq135: 400, mq136: 400, mq137: 400 },
                meta:       { created: new Date().toISOString(), version: '4.0' }
            });
        }
        // Schema guard
        const d = this._get();
        let dirty = false;
        if (!d.alerts)     { d.alerts = [];                                          dirty = true; }
        if (!d.thresholds) { d.thresholds = { mq135: 400, mq136: 400, mq137: 400 }; dirty = true; }
        if (dirty) this._save(d);
    },

    _get()            { return JSON.parse(localStorage.getItem(DB_KEY)); },
    _save(data)       { localStorage.setItem(DB_KEY, JSON.stringify(data)); },

    // ── ESP32 IP persistence ─────────────────────────────────────────────
    saveIP(ip)        { localStorage.setItem(DB_CONN_KEY, ip); },
    getIP()           { return localStorage.getItem(DB_CONN_KEY) || ''; },
    clearIP()         { localStorage.removeItem(DB_CONN_KEY); },

    // ── Save a sensor reading ────────────────────────────────────────────
    /**
     * @param {number} mq135     - ADC value 0-4095
     * @param {string} mq135s    - "GOOD" | "BAD"
     * @param {number} mq136     - ADC value 0-4095
     * @param {string} mq136s    - "GOOD" | "BAD"
     * @param {number} mq137     - ADC value 0-4095
     * @param {string} mq137s    - "GOOD" | "BAD"
     * @param {string} fan       - "ON" | "OFF"
     * @param {number} timeLeft  - ms remaining in fan cycle
     * @param {boolean} isAlert
     * @param {string} alertMsg
     */
    saveReading(mq135, mq135s, mq136, mq136s, mq137, mq137s, fan, timeLeft, isAlert = false, alertMsg = '') {
        const data  = this._get();
        const entry = {
            id:       Date.now().toString(),
            ts:       new Date().toISOString(),
            mq135:    parseInt(mq135,  10),
            mq135s,
            mq136:    parseInt(mq136,  10),
            mq136s,
            mq137:    parseInt(mq137,  10),
            mq137s,
            fan,
            timeLeft: parseInt(timeLeft, 10),
            isAlert
        };
        data.readings.push(entry);
        if (data.readings.length > 500) data.readings.shift();

        if (isAlert && alertMsg) {
            data.alerts.push({ ts: entry.ts, message: alertMsg });
            if (data.alerts.length > 150) data.alerts.shift();
        }
        this._save(data);
        return entry;
    },

    // ── Getters ──────────────────────────────────────────────────────────
    getReadings(limit = 0) {
        const r = this._get().readings;
        return limit > 0 ? r.slice(-limit) : [...r];
    },
    getAlerts()     { return this._get().alerts || []; },
    getThresholds() { return this._get().thresholds || { mq135: 400, mq136: 400, mq137: 400 }; },

    // ── Setters ──────────────────────────────────────────────────────────
    setThresholds(t) {
        const data = this._get();
        data.thresholds = { ...data.thresholds, ...t };
        this._save(data);
    },

    // ── Computed statistics per sensor ───────────────────────────────────
    getStats(readings) {
        const r = readings || this.getReadings();
        if (!r.length) return null;
        const keys = ['mq135', 'mq136', 'mq137'];
        const out  = {};
        keys.forEach(k => {
            const vals = r.map(x => x[k]).filter(v => typeof v === 'number' && !isNaN(v));
            out[k] = {
                min: vals.length ? Math.min(...vals).toFixed(0) : '--',
                max: vals.length ? Math.max(...vals).toFixed(0) : '--',
                avg: vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(0) : '--'
            };
        });
        return out;
    },

    // ── Clear data ───────────────────────────────────────────────────────
    clearAll() {
        const data = this._get();
        data.readings = [];
        data.alerts   = [];
        this._save(data);
    }
};

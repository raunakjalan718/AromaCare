# E-Nose Pro Website

## Running the Site

Simply open `index.html` in any modern web browser (Chrome, Edge, Firefox).

No server or installation required — it's a fully self-contained HTML/CSS/JS application.

## Credentials
- **Username:** `admin`
- **Password:** `password123`

## File Structure

```
SEPM/
├── index.html   — Complete single-page application (all pages)
├── style.css    — Full premium dark glassmorphic design system
├── db.js        — JSON LocalStorage database layer
└── app.js       — Main application controller
```

## Pages

| Page | Description |
|---|---|
| **Landing** | Hero, How It Works, Sensor Array, Features, CTA |
| **Login** | Secure authentication portal |
| **Dashboard** | Live 4-sensor readings, real-time chart, alert log |
| **Analytics** | 4 individual per-sensor charts with min/max/avg stats |
| **History** | Full data table with date/time, filter, search, CSV export |
| **Settings** | Configure thresholds, recalibrate, system info, clear DB |

## Sensors

| Sensor | Detects | Unit | Default Alert |
|---|---|---|---|
| MQ-2 | Smoke / LPG | ppm | 500 ppm |
| MQ-3 | Alcohol Vapour | mg/L | 2.5 mg/L |
| MQ-135 | Air Quality / NH₃ | ppm | 450 ppm |
| MQ-8 | Hydrogen Gas | ppm | 350 ppm |

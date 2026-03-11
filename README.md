# pch-watch-data

Automated scraper for [www.pch.dz](https://www.pch.dz) — runs every 6 hours via GitHub Actions.

## Setup (5 minutes)

1. Create a **new public GitHub repo** named `pch-watch-data`
2. Upload these files as-is
3. Go to **Actions** tab → enable workflows
4. Click **"PCH Watch — Scraper"** → **"Run workflow"** to test immediately
5. Copy your raw data URL:
   ```
   https://raw.githubusercontent.com/YOUR_USERNAME/pch-watch-data/main/data.json
   ```
6. In **PCH Watch** app → Settings (⚙️) → paste that URL in the GitHub Data URL field

## How it works

- GitHub Actions runs `scripts/scraper.js` every 6 hours
- The script fetches pch.dz directly from **GitHub's servers** (ASN 36459 — not blocked by the WAF)
- Results are saved to `data.json` and committed back to this repo
- PCH Watch reads `data.json` via `raw.githubusercontent.com` (no WAF involved)

## Schedule

- 00:00, 06:00, 12:00, 18:00 UTC
- = 01h00, 07h00, 13h00, 19h00 (Algiers time, UTC+1)

## Files

```
pch-watch-data/
├── .github/
│   └── workflows/
│       └── scrape.yml    ← GitHub Actions config
├── scripts/
│   └── scraper.js        ← Node.js scraper
└── data.json             ← Auto-updated every 6 hours ← READ THIS
```

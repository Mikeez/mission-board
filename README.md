# Mission Board

A Hermes web-dashboard plugin: one tab that merges your day into a single view —

- 📅 Calendar (today + next 2 days, via Secretary's read-only Google Calendar access)
- ✅ Open to-dos from the Obsidian Daily Planner note, flagged when stale (3+ days untouched)
- 🗂️ Open Kanban cards across every Hermes profile (Brain, Secretary, Housekeeper, Journalist, …)
- ⚠️ A "Needs your input" banner surfacing blocked Kanban cards and stale to-dos first

## Install

Copy (or symlink) this repo into `~/.hermes/plugins/mission-board/`, then
**Settings → Plugins → enable `mission-board`** in the Hermes web dashboard
(`hermes dashboard`), and refresh.

```bash
cp -r mission-board ~/.hermes/plugins/mission-board
```

## Layout

```
mission-board/
├── plugin.yaml                     # general plugin manifest
└── dashboard/
    ├── manifest.json                # tab config (icon, path, entry)
    ├── plugin_api.py                 # FastAPI backend — /api/plugins/mission-board/snapshot
    └── dist/
        ├── index.js                  # plain IIFE UI bundle (Hermes Plugin SDK)
        └── style.css
```

## Configuration

Paths are hardcoded in `dashboard/plugin_api.py` for this setup (Mike's
vault + profile layout):

- `DAILY_PLANNER_PATH` — Obsidian Daily Planner note
- `SECRETARY_HOME` / `GOOGLE_API_SCRIPT` — read-only calendar lookup
- `PROFILE_HOMES` — every Hermes profile's `kanban.db` to scan

Edit these if paths change. All calendar access is read-only — the plugin
never creates/edits/deletes events or Daily Planner lines.

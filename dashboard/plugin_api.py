"""Mission Board dashboard plugin backend.

Combines three data sources into one JSON payload for the Mission Board tab:

1. Today's (and next 2 days') calendar events — shells out to Secretary's
   Google Calendar script (read-only; never creates/edits/deletes events).
2. Open to-dos from Mike's Obsidian Daily Planner note, with "age" tracked
   in this plugin's own small state file (first time we see a to-do line we
   stamp it; we never write back to the Obsidian note itself).
3. Open Kanban cards across every Hermes profile's kanban.db (read-only
   sqlite reads), with blocked cards flagged as "needs your input".

Mounted at /api/plugins/mission-board/ by the Hermes dashboard.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from hermes_constants import get_hermes_home
except ImportError:  # pragma: no cover - fallback for standalone testing
    def get_hermes_home() -> Path:
        val = (os.environ.get("HERMES_HOME") or "").strip()
        return Path(val) if val else Path.home() / ".hermes"

try:
    from fastapi import APIRouter
except Exception:  # pragma: no cover - allows import without fastapi installed
    class APIRouter:  # type: ignore
        def get(self, *_args, **_kwargs):
            return lambda fn: fn

        def post(self, *_args, **_kwargs):
            return lambda fn: fn

router = APIRouter()

# ---------------------------------------------------------------------------
# Config — adjust paths here if the user's setup changes.
# ---------------------------------------------------------------------------

DAILY_PLANNER_PATH = Path("/share/vault/Notes/Daily Planner.md")
SECRETARY_HOME = Path("/config/.hermes/profiles/secretary")
GOOGLE_API_SCRIPT = Path(
    "/config/.hermes/skills/productivity/google-workspace/scripts/google_api.py"
)
# Every known Hermes profile's kanban.db — read-only scan across the fleet.
PROFILE_HOMES = {
    "brain": Path("/config/.hermes"),
    "secretary": Path("/config/.hermes/profiles/secretary"),
    "housekeeper": Path("/config/.hermes/profiles/housekeeper"),
    "journalist": Path("/config/.hermes/profiles/journalist"),
    "executive": Path("/config/.hermes/profiles/executive"),
    "traveller": Path("/config/.hermes/profiles/traveller"),
}

STATE_DIR = get_hermes_home() / "plugins" / "mission-board"
TODO_AGE_STATE_PATH = STATE_DIR / "todo_first_seen.json"
STALE_TODO_DAYS = 3

CACHE_TTL_SECONDS = 60
_CACHE_LOCK = threading.Lock()
_CACHE: Optional[Dict[str, Any]] = None
_CACHE_AT = 0.0


# ---------------------------------------------------------------------------
# Daily Planner (Obsidian) — open to-dos with aging
# ---------------------------------------------------------------------------

TODO_LINE_RE = re.compile(r"^\s*-\s*\[\s\]\s*(.+?)\s*$")
SECTION_RE = re.compile(r"^#{1,6}\s*(.+?)\s*$")
DUE_DATE_RE = re.compile(r"\bdue\s+(\d{4}-\d{2}-\d{2})\b", re.I)


def _load_todo_age_state() -> Dict[str, float]:
    try:
        return json.loads(TODO_AGE_STATE_PATH.read_text())
    except Exception:
        return {}


def _save_todo_age_state(state: Dict[str, float]) -> None:
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        TODO_AGE_STATE_PATH.write_text(json.dumps(state))
    except Exception:
        pass  # Non-fatal — aging just resets next time.


def get_todos() -> List[Dict[str, Any]]:
    """Parse open (unchecked) to-do lines from the Daily Planner note.

    Tracks each distinct to-do text's "first seen" timestamp in our own
    state file so we can flag stale items, without ever writing to the
    Obsidian note itself.
    """
    try:
        text = DAILY_PLANNER_PATH.read_text(encoding="utf-8")
    except Exception as exc:
        return [{"error": f"Could not read Daily Planner note: {exc}"}]

    section = None
    items: List[Dict[str, Any]] = []
    seen_now = set()
    age_state = _load_todo_age_state()
    now = time.time()
    changed = False

    for line in text.splitlines():
        sec_match = SECTION_RE.match(line)
        if sec_match:
            section = sec_match.group(1)
            continue
        todo_match = TODO_LINE_RE.match(line)
        if not todo_match:
            continue
        todo_text = todo_match.group(1)
        seen_now.add(todo_text)
        if todo_text not in age_state:
            age_state[todo_text] = now
            changed = True
        first_seen = age_state[todo_text]
        age_days = max(0.0, (now - first_seen) / 86400.0)

        due_date = None
        due_match = DUE_DATE_RE.search(todo_text)
        days_until_due = None
        overdue = False
        if due_match:
            due_date = due_match.group(1)
            try:
                import datetime as _dt

                due_dt = _dt.date.fromisoformat(due_date)
                days_until_due = (due_dt - _dt.date.today()).days
                overdue = days_until_due < 0
            except Exception:
                pass

        items.append(
            {
                "text": todo_text,
                "section": section or "Today",
                "age_days": round(age_days, 1),
                "stale": age_days >= STALE_TODO_DAYS,
                "due_date": due_date,
                "days_until_due": days_until_due,
                "overdue": overdue,
            }
        )

    # Prune state entries for to-dos that are no longer open (done/removed).
    stale_keys = [k for k in age_state if k not in seen_now]
    for k in stale_keys:
        del age_state[k]
        changed = True
    if changed:
        _save_todo_age_state(age_state)

    items.sort(
        key=lambda it: (
            not it["overdue"],
            it["days_until_due"] if it["days_until_due"] is not None else 9999,
            -it["age_days"],
        )
    )
    return items


# ---------------------------------------------------------------------------
# Calendar — borrows Secretary's read-only Google Calendar access
# ---------------------------------------------------------------------------


def get_calendar_events(days_ahead: int = 2) -> List[Dict[str, Any]]:
    if not GOOGLE_API_SCRIPT.exists():
        return [{"error": "Secretary's Google Workspace script not found."}]

    import datetime

    today = datetime.date.today()
    start = f"{today.isoformat()}T00:00:00-04:00"
    end_date = today + datetime.timedelta(days=days_ahead)
    end = f"{end_date.isoformat()}T23:59:59-04:00"

    env = dict(os.environ)
    env["HERMES_HOME"] = str(SECRETARY_HOME)

    import sys as _sys

    try:
        proc = subprocess.run(
            [
                _sys.executable,
                str(GOOGLE_API_SCRIPT),
                "calendar",
                "list",
                "--start",
                start,
                "--end",
                end,
            ],
            capture_output=True,
            text=True,
            timeout=25,
            env=env,
        )
    except Exception as exc:
        return [{"error": f"Calendar lookup failed: {exc}"}]

    if proc.returncode != 0:
        return [{"error": f"Calendar lookup error: {proc.stderr.strip()[:300]}"}]

    try:
        events = json.loads(proc.stdout)
    except Exception:
        return [{"error": "Calendar lookup returned unparseable output."}]

    if not isinstance(events, list):
        return []
    return _dedupe_overlapping_events(events)


def _dedupe_overlapping_events(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Merge calendar entries that are really the same appointment.

    Mike's calendar often has two separate events for one real appointment
    (e.g. a personal reminder + a booking-system confirmation) that share the
    same start time. Rather than showing both as separate cards, merge any
    events whose start timestamps match exactly into a single card with a
    combined title, keeping whichever location/description is non-empty.
    """
    groups: Dict[str, List[Dict[str, Any]]] = {}
    order: List[str] = []
    for ev in events:
        if not isinstance(ev, dict) or ev.get("error"):
            continue
        start = ev.get("start")
        if isinstance(start, dict):
            key = start.get("dateTime") or start.get("date") or ""
        else:
            key = start or ""
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(ev)

    merged: List[Dict[str, Any]] = []
    for key in order:
        group = groups[key]
        if len(group) == 1:
            merged.append(group[0])
            continue
        titles = [g.get("summary") or g.get("title") or "(untitled)" for g in group]
        location = next((g.get("location") for g in group if g.get("location")), "")
        description = next((g.get("description") for g in group if g.get("description")), "")
        combined = dict(group[0])
        combined["summary"] = " / ".join(dict.fromkeys(titles))  # dedupe identical titles too
        combined["location"] = location
        combined["description"] = description
        combined["merged_count"] = len(group)
        merged.append(combined)
    return merged


# ---------------------------------------------------------------------------
# Kanban — read-only scan across every profile's kanban.db
# ---------------------------------------------------------------------------

OPEN_STATUSES = {"todo", "ready", "running", "blocked", "review", "triage", "scheduled"}
STUCK_RUNNING_SECONDS = 2 * 3600  # flag a 'running' task as possibly stuck after 2h


def _read_kanban_db(profile: str, db_path: Path) -> List[Dict[str, Any]]:
    if not db_path.exists():
        return []
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=3)
        cur = con.cursor()
        cur.execute(
            "SELECT id, title, assignee, status, priority, created_at, completed_at, started_at "
            "FROM tasks WHERE status IN ({}) ORDER BY priority DESC, created_at ASC".format(
                ",".join("?" for _ in OPEN_STATUSES)
            ),
            tuple(OPEN_STATUSES),
        )
        rows = cur.fetchall()
        con.close()
    except Exception:
        return []

    out = []
    for r in rows:
        task_id, title, assignee, status, priority, created_at, completed_at, started_at = r
        stuck = False
        if status == "running" and started_at:
            try:
                stuck = (time.time() - float(started_at)) > STUCK_RUNNING_SECONDS
            except Exception:
                stuck = False
        out.append(
            {
                "id": task_id,
                "title": title,
                "assignee": assignee,
                "status": status,
                "priority": priority,
                "created_at": created_at,
                "board_profile": profile,
                "needs_input": status == "blocked" or status == "review" or stuck,
                "stuck": stuck,
            }
        )
    return out


def get_kanban_cards() -> List[Dict[str, Any]]:
    cards: List[Dict[str, Any]] = []
    for profile, home in PROFILE_HOMES.items():
        cards.extend(_read_kanban_db(profile, home / "kanban.db"))
    cards.sort(key=lambda c: (not c["needs_input"], -(c["priority"] or 0)))
    return cards


# ---------------------------------------------------------------------------
# Aggregate snapshot (cached briefly so rapid dashboard refreshes are cheap)
# ---------------------------------------------------------------------------


def build_snapshot() -> Dict[str, Any]:
    todos = get_todos()
    events = get_calendar_events()
    kanban = get_kanban_cards()

    needs_input = [c for c in kanban if c.get("needs_input")]
    stale_todos = [t for t in todos if t.get("stale") or t.get("overdue")]

    return {
        "generated_at": time.time(),
        "calendar": events,
        "todos": todos,
        "kanban": kanban,
        "needs_input_count": len(needs_input) + len(stale_todos),
        "needs_input": {
            "kanban": needs_input,
            "stale_todos": stale_todos,
        },
    }


@router.get("/snapshot")
async def snapshot(force: bool = False):
    global _CACHE, _CACHE_AT
    with _CACHE_LOCK:
        now = time.time()
        if not force and _CACHE is not None and (now - _CACHE_AT) < CACHE_TTL_SECONDS:
            return _CACHE
        data = build_snapshot()
        _CACHE = data
        _CACHE_AT = now
        return data

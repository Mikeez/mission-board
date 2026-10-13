// ~/.hermes/plugins/mission-board/dashboard/dist/index.js
// Mission Board — unified daily dashboard, Kanban-style columns.
// Plain IIFE, no build step. Uses the Hermes Dashboard Plugin SDK only.
(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  const { React } = SDK;
  const { useState, useEffect, useCallback } = SDK.hooks;
  const { Card, CardHeader, CardTitle, CardContent, Badge, Button } = SDK.components;
  const { cn, timeAgo } = SDK.utils;
  const h = React.createElement;

  const REFRESH_MS = 60000;

  function useSnapshot() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback((force) => {
      const qs = force ? "?force=true" : "";
      SDK.fetchJSON("/api/plugins/mission-board/snapshot" + qs)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((err) => setError(String(err && err.message ? err.message : err)))
        .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
      load(false);
      const id = setInterval(() => load(false), REFRESH_MS);
      return () => clearInterval(id);
    }, [load]);

    return { data, error, loading, reload: () => load(true) };
  }

  // --- Needs-input banner -------------------------------------------------

  function NeedsInputBanner({ snapshot }) {
    const count = snapshot && snapshot.needs_input_count;
    if (!count) return null;
    const kanban = snapshot.needs_input.kanban || [];
    const stale = snapshot.needs_input.stale_todos || [];
    return h(
      Card,
      { className: "border-destructive/40" },
      h(
        CardHeader,
        { className: "py-3" },
        h(
          CardTitle,
          { className: "text-sm flex items-center gap-2" },
          "⚠️ Needs your input",
          h(Badge, { variant: "destructive" }, String(count))
        )
      ),
      h(
        CardContent,
        { className: "text-sm space-y-1 pt-0" },
        kanban.map((c) =>
          h(
            "div",
            { key: c.id, className: "flex items-center justify-between" },
            h("span", null, "🗂️ ", c.title),
            h(Badge, { className: "ml-2" }, c.status + " · " + c.board_profile)
          )
        ),
        stale.map((t) =>
          h(
            "div",
            { key: t.text, className: "flex items-center justify-between" },
            h("span", null, t.overdue ? "🔴 " : "⏳ ", t.text),
            h(
              Badge,
              { className: "ml-2", variant: t.overdue ? "destructive" : "secondary" },
              t.overdue
                ? Math.abs(t.days_until_due) + "d overdue"
                : Math.round(t.age_days) + "d old"
            )
          )
        )
      )
    );
  }

  // --- Generic board column ------------------------------------------------

  function BoardColumn({ title, icon, count, children, emptyText }) {
    return h(
      "div",
      { className: "flex flex-col gap-2 min-w-[260px] flex-1" },
      h(
        "div",
        { className: "flex items-center gap-2 px-1" },
        h("span", null, icon),
        h("span", { className: "font-medium text-sm" }, title),
        count != null ? h(Badge, { className: "ml-auto" }, String(count)) : null
      ),
      h(
        "div",
        { className: "flex flex-col gap-2 bg-muted/30 rounded-lg p-2 min-h-[120px]" },
        React.Children.count(children) === 0
          ? h("div", { className: "text-xs text-muted-foreground p-2" }, emptyText)
          : children
      )
    );
  }

  function BoardCardShell({ children, highlight }) {
    return h(
      Card,
      { className: cn("shadow-sm", highlight && "border-destructive/50") },
      h(CardContent, { className: "p-3 text-sm space-y-1" }, children)
    );
  }

  // --- To-Dos column --------------------------------------------------------

  function TodoCard({ todo }) {
    const highlight = todo.overdue || todo.stale;
    return h(
      BoardCardShell,
      { highlight },
      h("div", { className: "font-medium" }, todo.text),
      h(
        "div",
        { className: "flex items-center gap-2 flex-wrap" },
        h(Badge, { variant: "secondary" }, todo.section),
        todo.due_date
          ? h(
              Badge,
              { variant: todo.overdue ? "destructive" : "default" },
              todo.overdue
                ? Math.abs(todo.days_until_due) + "d overdue"
                : "due " + todo.due_date
            )
          : null,
        !todo.due_date && todo.stale
          ? h(Badge, { variant: "destructive" }, Math.round(todo.age_days) + "d old")
          : null
      )
    );
  }

  function TodosColumn({ todos }) {
    const list = Array.isArray(todos) ? todos : [];
    const errorItem = list.find((t) => t && t.error);
    if (errorItem) {
      return h(BoardColumn, { title: "Open To-Dos", icon: "✅", emptyText: "" },
        h(BoardCardShell, { highlight: true }, errorItem.error));
    }
    return h(
      BoardColumn,
      { title: "Open To-Dos", icon: "✅", count: list.length, emptyText: "Nothing pending" },
      list.map((t, i) => h(TodoCard, { key: i, todo: t }))
    );
  }

  // --- Calendar column -------------------------------------------------------

  function EventCard({ ev }) {
    const start = (ev.start && (ev.start.dateTime || ev.start.date)) || ev.start || "";
    return h(
      BoardCardShell,
      null,
      h("div", { className: "font-medium" }, ev.summary || ev.title || "(untitled)"),
      h("div", { className: "text-xs text-muted-foreground" }, start),
      ev.location
        ? h("div", { className: "text-xs text-muted-foreground" }, "📍 " + ev.location)
        : null
    );
  }

  function CalendarColumn({ events }) {
    const list = Array.isArray(events) ? events : [];
    const errorItem = list.find((e) => e && e.error);
    if (errorItem) {
      return h(BoardColumn, { title: "Calendar (next 3 days)", icon: "📅", emptyText: "" },
        h(BoardCardShell, { highlight: true }, errorItem.error));
    }
    return h(
      BoardColumn,
      { title: "Calendar (next 3 days)", icon: "📅", count: list.length, emptyText: "No events" },
      list.map((e, i) => h(EventCard, { key: i, ev: e }))
    );
  }

  // --- Kanban column ---------------------------------------------------------

  function KanbanCardItem({ card }) {
    return h(
      BoardCardShell,
      { highlight: card.needs_input },
      h("div", { className: "font-medium" }, card.needs_input ? "⚠️ " : "", card.title),
      h(
        "div",
        { className: "flex items-center gap-2 flex-wrap" },
        h(Badge, { variant: "secondary" }, card.board_profile),
        h(Badge, { variant: card.needs_input ? "destructive" : "default" }, card.status),
        card.assignee ? h(Badge, { variant: "outline" }, "@" + card.assignee) : null
      )
    );
  }

  function KanbanColumn({ kanban }) {
    const list = Array.isArray(kanban) ? kanban : [];
    return h(
      BoardColumn,
      { title: "Agent Kanban Cards", icon: "🗂️", count: list.length, emptyText: "Board is clear" },
      list.map((c) => h(KanbanCardItem, { key: c.id, card: c }))
    );
  }

  // --- Page -------------------------------------------------------------------

  function MissionBoardPage() {
    const { data, error, loading, reload } = useSnapshot();

    return h(
      "div",
      { className: "flex flex-col gap-4 p-4" },
      h(
        "div",
        { className: "flex items-center justify-between" },
        h("h1", { className: "text-lg font-semibold" }, "Mission Board"),
        h(
          "div",
          { className: "flex items-center gap-2" },
          data && data.generated_at
            ? h("span", { className: "text-xs text-muted-foreground" }, "Updated " + timeAgo(data.generated_at))
            : null,
          h(Button, { variant: "outline", size: "sm", onClick: reload }, loading ? "Refreshing…" : "Refresh")
        )
      ),
      error
        ? h(Card, { className: "border-destructive/40" }, h(CardContent, { className: "py-3 text-sm" }, "Failed to load: " + error))
        : null,
      data ? h(NeedsInputBanner, { snapshot: data }) : null,
      h(
        "div",
        { className: "flex gap-4 overflow-x-auto pb-2" },
        h(TodosColumn, { todos: data ? data.todos : [] }),
        h(CalendarColumn, { events: data ? data.calendar : [] }),
        h(KanbanColumn, { kanban: data ? data.kanban : [] })
      )
    );
  }

  window.__HERMES_PLUGINS__.register("mission-board", MissionBoardPage);
})();

// ~/.hermes/plugins/mission-board/dashboard/dist/index.js
// Mission Board — unified daily dashboard: calendar + to-dos + Kanban cards.
// Plain IIFE, no build step. Uses the Hermes Dashboard Plugin SDK only.
(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  const { React } = SDK;
  const { useState, useEffect, useCallback } = SDK.hooks;
  const {
    Card,
    CardHeader,
    CardTitle,
    CardContent,
    Badge,
    Button,
    Separator,
  } = SDK.components;
  const { cn, isoTimeAgo } = SDK.utils;
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

  function SectionTitle({ icon, children, count }) {
    return h(
      "div",
      { className: "flex items-center gap-2 mb-2" },
      h("span", { className: "text-base" }, icon),
      h("span", { className: "font-medium text-sm" }, children),
      count != null
        ? h(Badge, { className: "ml-1" }, String(count))
        : null
    );
  }

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
            h("span", null, "⏳ ", t.text),
            h(Badge, { className: "ml-2" }, Math.round(t.age_days) + "d old")
          )
        )
      )
    );
  }

  function CalendarCard({ events }) {
    const list = Array.isArray(events) ? events : [];
    const errorItem = list.find((e) => e && e.error);
    return h(
      Card,
      null,
      h(CardHeader, { className: "py-3" }, h(SectionTitle, { icon: "📅", count: errorItem ? null : list.length }, "Calendar (next 3 days)")),
      h(
        CardContent,
        { className: "text-sm space-y-1 pt-0" },
        errorItem
          ? h("div", { className: "text-muted-foreground" }, errorItem.error)
          : list.length === 0
          ? h("div", { className: "text-muted-foreground" }, "No events today")
          : list.map((e, i) =>
              h(
                "div",
                { key: i, className: "flex flex-col border-b border-border/40 pb-1 last:border-0" },
                h("span", { className: "font-medium" }, e.summary || e.title || "(untitled)"),
                h(
                  "span",
                  { className: "text-xs text-muted-foreground" },
                  (e.start && (e.start.dateTime || e.start.date)) || ""
                )
              )
            )
      )
    );
  }

  function TodosCard({ todos }) {
    const list = Array.isArray(todos) ? todos : [];
    const errorItem = list.find((t) => t && t.error);
    return h(
      Card,
      null,
      h(CardHeader, { className: "py-3" }, h(SectionTitle, { icon: "✅", count: errorItem ? null : list.length }, "Open To-Dos")),
      h(
        CardContent,
        { className: "text-sm space-y-1 pt-0" },
        errorItem
          ? h("div", { className: "text-muted-foreground" }, errorItem.error)
          : list.length === 0
          ? h("div", { className: "text-muted-foreground" }, "Nothing pending")
          : list.map((t, i) =>
              h(
                "div",
                { key: i, className: "flex items-center justify-between border-b border-border/40 pb-1 last:border-0" },
                h("span", null, t.text),
                t.stale
                  ? h(Badge, { variant: "destructive" }, Math.round(t.age_days) + "d")
                  : h("span", { className: "text-xs text-muted-foreground" }, t.section)
              )
            )
      )
    );
  }

  function KanbanCard({ kanban }) {
    const list = Array.isArray(kanban) ? kanban : [];
    const byStatus = {};
    list.forEach((c) => {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    });
    return h(
      Card,
      null,
      h(CardHeader, { className: "py-3" }, h(SectionTitle, { icon: "🗂️", count: list.length }, "Open Kanban Cards (all agents)")),
      h(
        CardContent,
        { className: "text-sm space-y-1 pt-0" },
        list.length === 0
          ? h("div", { className: "text-muted-foreground" }, "Board is clear")
          : list.map((c) =>
              h(
                "div",
                { key: c.id, className: "flex items-center justify-between border-b border-border/40 pb-1 last:border-0" },
                h(
                  "span",
                  { className: cn(c.needs_input && "font-medium") },
                  c.needs_input ? "⚠️ " : "",
                  c.title
                ),
                h(
                  "div",
                  { className: "flex items-center gap-1" },
                  h(Badge, null, c.board_profile),
                  h(Badge, { variant: c.needs_input ? "destructive" : "secondary" }, c.status)
                )
              )
            )
      )
    );
  }

  function MissionBoardPage() {
    const { data, error, loading, reload } = useSnapshot();

    return h(
      "div",
      { className: "flex flex-col gap-4 p-4 max-w-3xl mx-auto" },
      h(
        "div",
        { className: "flex items-center justify-between" },
        h("h1", { className: "text-lg font-semibold" }, "Mission Board"),
        h(
          Button,
          { variant: "outline", size: "sm", onClick: reload },
          loading ? "Refreshing…" : "Refresh"
        )
      ),
      error
        ? h(Card, { className: "border-destructive/40" }, h(CardContent, { className: "py-3 text-sm" }, "Failed to load: " + error))
        : null,
      data ? h(NeedsInputBanner, { snapshot: data }) : null,
      h(CalendarCard, { events: data ? data.calendar : [] }),
      h(TodosCard, { todos: data ? data.todos : [] }),
      h(KanbanCard, { kanban: data ? data.kanban : [] }),
      data
        ? h(
            "div",
            { className: "text-xs text-muted-foreground text-right" },
            "Updated " + (data.generated_at ? SDK.utils.timeAgo(data.generated_at) : "just now")
          )
        : null
    );
  }

  window.__HERMES_PLUGINS__.register("mission-board", MissionBoardPage);
})();

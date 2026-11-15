// Todoist tasks in a Herdr panel, read through the `td` CLI. Click the circle to complete,
// the header to pick which list to show.
//
// Block props (all optional):
//   filter   Todoist filter query shown until a list is picked   default "today | overdue"
//   title    header label for that default list                  default "Today"
//   refresh  seconds between reads (>= 15)                       default 60
//   key      keeps the picked list apart when several panels are shown
//
// Commands: todoist.refresh, todoist.menu. The panel takes the keyboard from pane.go (ctrl-h).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { exec, theme, props, shared, setShared, openOverlay, closeOverlay, nextCommand, run } from "herdr";

const DEFAULT_FILTER = "today | overdue";
const DEFAULT_REFRESH_S = 60;
const INSTALL_HINT = "brew install todoist-cli, then td auth login";

const PRESETS = [
  { kind: "query", query: "today | overdue", label: "Today" },
  { kind: "query", query: "7 days | overdue", label: "Next 7 days" },
  { kind: "query", query: "overdue", label: "Overdue" },
  { kind: "query", query: "p1", label: "Priority 1" },
  { kind: "query", query: "no date", label: "No date" },
];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Markdown links in titles show as their text.
const plain = (s) => (s ?? "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

// The API's priority 4 is the app's p1.
const priorityColor = (t, p) => ({ 4: t.ansi1, 3: t.ansi3, 2: t.ansi4 })[p] ?? t.dim;

const config = () => {
  const p = props() ?? {};
  return {
    filter: p.filter || DEFAULT_FILTER,
    title: p.title || "Today",
    refresh: Math.max(15, Number(p.refresh) || DEFAULT_REFRESH_S) * 1000,
    key: `todoist.view.${p.key || "default"}`,
  };
};

// The picked list, else the block's default query.
const currentView = (key = config().key) => {
  const c = config();
  return shared(key) ?? { kind: "query", query: c.filter, label: c.title };
};

const viewKey = (v) => v?.query ?? v?.id ?? v?.name;
const sameView = (a, b) => a?.kind === b?.kind && viewKey(a) === viewKey(b);

// td prints API errors as JSON: keep their message, and say how labels and projects are written.
const errorText = (e, view) => {
  let msg = String(e?.message ?? e);
  try {
    msg = JSON.parse(msg)?.error?.message ?? msg;
  } catch {}
  return view?.kind === "query" && /query/i.test(msg) ? `${msg}. Labels are @name, projects #name.` : msg;
};

const listArgs = (view) =>
  view.kind === "filter" ? ["filter", "view", `id:${view.id}`, "--json", "--all"]
  : view.kind === "project" ? ["task", "list", "--project", `id:${view.id}`, "--json", "--all"]
  : view.kind === "label" ? ["task", "list", "--label", view.name, "--json", "--all"]
  : ["task", "list", "--filter", view.query, "--json", "--all"];

// `td` comes from the user's PATH; a failed start means it isn't installed.
async function td(args) {
  let r;
  try {
    r = await exec("td", args, { timeout: 20000 });
  } catch (e) {
    const err = new Error(String(e?.message ?? e));
    err.missing = true;
    throw err;
  }
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `td exited ${r.code}`);
  return r.stdout;
}

export default class Todoist extends View {
  init(_props, cx) {
    if (props()?.menu) return this.initMenu(cx);
    this.tasks = [];
    this.error = null;
    this.missing = false;
    this.loading = true;
    this.refreshing = false;
    this.again = false;
    this.pending = new Set();
    this.hovered = null;
    this.sel = 0;
    this.handle = cx.focus_handle();
    this.listScroll = ScrollHandle.new();
    cx.timer.every(config().refresh, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "refresh") this.refresh(cx);
        else if (c === "menu") this.openMenu("dialog");
        // pane.go landed here, or a popup over the panel closed.
        else if (c === "focus") this.handle.focus();
        cx.notify();
      }
    });
    this.refresh(cx);
  }

  refresh(cx) {
    // One read at a time; a request during a read runs once it ends.
    if (this.refreshing) {
      this.again = true;
      return;
    }
    this.refreshing = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const view = currentView();
      try {
        const out = await td(listArgs(view));
        this.tasks = (JSON.parse(out).results ?? []).sort(
          (a, b) => (b.priority ?? 1) - (a.priority ?? 1) || (a.due?.date ?? "9").localeCompare(b.due?.date ?? "9"),
        );
        this.loadedView = view;
        this.error = null;
        this.missing = false;
      } catch (e) {
        this.missing = Boolean(e.missing);
        this.error = e.missing ? null : errorText(e, view);
        // Rows of another list would read as this one's.
        if (!sameView(view, this.loadedView)) this.tasks = [];
        this.loadedView = view;
      }
      this.loading = false;
      this.refreshing = false;
      this.updated = new Date();
      if (this.again) {
        this.again = false;
        this.refresh(cx);
      }
      cx.notify();
    });
  }

  complete(task, cx) {
    if (this.pending.has(task.id)) return;
    this.pending.add(task.id);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await td(["task", "complete", `id:${task.id}`]);
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.pending.delete(task.id);
      this.refresh(cx);
    });
  }

  // A popup at the pointer from a click; a dialog from a key or command, which has no pointer.
  openMenu(kind = "popup") {
    openOverlay({ mod: "todoist", kind, width: 280, height: 440, props: { menu: true, key: config().key } });
  }

  // j/k move, x completes, Enter opens, r refreshes, / or m picks a list, l or Esc goes back.
  panelKey(e, cx) {
    const k = e.key;
    const n = this.tasks.length;
    const move = (to) => {
      this.sel = Math.max(0, Math.min(n - 1, to));
      this.listScroll.scroll_to_item(this.sel);
    };
    const task = this.tasks[this.sel];
    if (e.modifiers?.control || e.modifiers?.platform) return;
    if (k === "j" || k === "down") move(this.sel + 1);
    else if (k === "k" || k === "up") move(this.sel - 1);
    else if (k === "G" || (k === "g" && e.modifiers?.shift)) move(n - 1);
    else if (k === "g") move(0);
    else if (k === "x" || k === "space") task && this.complete(task, cx);
    else if (k === "enter" || k === "o") task && td(["task", "browse", `id:${task.id}`]).catch(() => {});
    else if (k === "r") this.refresh(cx);
    else if (k === "/" || k === "m") this.openMenu("dialog");
    else if (k === "l" || k === "escape") run("pane.go", { direction: "right" });
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  row(t, task, now, i, focused) {
    const selected = focused && i === this.sel;
    const done = this.pending.has(task.id);
    const overdue = Boolean(task.due?.date) && task.due.date < now;
    const color = priorityColor(t, task.priority);
    return h_flex()
      .id(`td-${task.id}`)
      .px(8)
      .h(30)
      .flex_none()
      .rounded(8)
      .items_center()
      .gap(9)
      .when(selected, (el) => el.bg(t.selected))
      .hover((s) => s.bg(selected ? t.selected : t.hover))
      .on_hover((on, cx) => {
        if (on) this.hovered = task.id;
        else if (this.hovered === task.id) this.hovered = null;
        cx.notify();
      })
      .child(
        div()
          .id(`td-check-${task.id}`)
          .flex_none()
          .size(14)
          .rounded(7)
          .border(1.5)
          .border_color(color)
          .cursor_pointer()
          .when(done || this.hovered === task.id, (el) => el.bg(color))
          .tooltip("Complete")
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.complete(task, cx);
          }),
      )
      .child(
        div()
          .id(`td-open-${task.id}`)
          .flex_1()
          .min_w(0)
          .truncate()
          .cursor_pointer()
          .text_color(done ? t.dim : t.foreground)
          .tooltip("Open in Todoist")
          .on_click(() => td(["task", "browse", `id:${task.id}`]).catch(() => {}))
          .child(plain(task.content)),
      )
      .when(overdue, (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi1).child(task.due.string)));
  }

  render(cx) {
    if (props()?.menu) return this.renderMenu(cx);
    const t = theme();
    const now = today();
    const view = currentView();
    // A list picked in the menu, or by another copy: read it once.
    if (this.loadedView && !this.refreshing && !sameView(view, this.loadedView)) {
      this.loadedView = view;
      cx.spawn(async (cx) => this.refresh(cx));
    }
    const note = (text, color) => div().px(16).pb(6).text_size(12).text_color(color).child(text);
    const focused = this.handle.is_focused();
    this.sel = Math.max(0, Math.min(this.tasks.length - 1, this.sel));
    const updated = this.updated ? `Refresh · updated ${this.updated.toLocaleTimeString().slice(0, 5)}` : "Refresh";
    return v_flex()
      .id("td-panel")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.panelKey(e, cx))
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .child(
        h_flex()
          .px(16)
          .h(41)
          .pt(14)
          .pb(5)
          .flex_none()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .id("td-pick")
              .min_w(0)
              .gap(4)
              .items_center()
              .cursor_pointer()
              .text_size(11.5)
              .font_medium()
              .text_color(t.dim)
              .hover((s) => s.text_color(t.foreground))
              .tooltip("Choose a list")
              .on_click(() => this.openMenu())
              .child(div().min_w(0).truncate().child(this.missing ? "Todoist" : `${view.label} · ${this.tasks.length}`))
              .child(svg("mods/todoist/chevron-down.svg").size(12).flex_none()),
          )
          .child(
            div()
              .id("td-refresh")
              .flex_none()
              .cursor_pointer()
              .text_color(this.refreshing ? t.foreground : t.dim)
              .hover((s) => s.text_color(t.foreground))
              .tooltip(updated)
              .on_click((_e, cx) => this.refresh(cx))
              .child(
                this.refreshing
                  ? svg("mods/todoist/refresh.svg").size(14).spin(900)
                  : svg("mods/todoist/refresh.svg").size(14),
              ),
          ),
      )
      .when(this.missing, (el) => el.child(note("The td CLI isn't installed or isn't on PATH.", t.foreground)).child(note(INSTALL_HINT, t.dim)))
      .when(Boolean(this.error), (el) => el.child(note(this.error, t.ansi1)))
      .when(this.loading, (el) => el.child(note("Loading…", t.dim)))
      .when(!this.loading && !this.error && !this.missing && this.tasks.length === 0, (el) => el.child(note("Nothing to do.", t.dim)))
      .child(
        v_flex()
          .id("td-list")
          .flex_1()
          .min_h(0)
          .px(8)
          .overflow_y_scrollbar()
          .track_scroll(this.listScroll)
          .children(this.tasks.map((task, i) => this.row(t, task, now, i, focused))),
      )
      .when(focused, (el) =>
        el.child(
          div()
            .px(16)
            .py(6)
            .flex_none()
            .text_size(10.5)
            .text_color(t.dim)
            .child("j/k move · x done · ⏎ open · / list · l back"),
        ),
      );
  }

  // The list menu: presets, saved Todoist filters, labels, projects and a free query.

  initMenu(cx) {
    this.filters = [];
    this.labels = [];
    this.projects = [];
    this.at = null;
    this.moved = false;
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ value: "", placeholder: "Filter, e.g. @flow & today  ( / )" });
    this.input.on("submit", () => {
      const query = this.input.value().trim();
      if (query) this.pick({ kind: "query", query, label: query });
    });
    this.inputFocused = false;
    this.input.on("focus", (_e, cx) => {
      this.inputFocused = true;
      cx.notify();
    });
    this.input.on("blur", (_e, cx) => {
      this.inputFocused = false;
      cx.notify();
    });
    // The list has the keyboard first, so j/k move at once; / or i types a query.
    this.handle = cx.focus_handle();
    this.handle.focus();
    // A dialog puts the first input in focus: take it back unless / or i asked for it.
    this.wantInput = false;
    cx.timer.after(300, () => this.wantInput || this.handle.focus());
    cx.spawn(async (cx) => {
      const read = async (args) => JSON.parse(await td(args)).results ?? [];
      const [filters, labels, projects] = await Promise.all([
        read(["filter", "list", "--json"]).catch(() => []),
        read(["label", "list", "--json"]).catch(() => []),
        read(["project", "list", "--json", "--all"]).catch(() => []),
      ]);
      this.filters = filters.map((f) => ({ kind: "filter", id: f.id, label: f.name }));
      this.labels = labels.map((l) => ({ kind: "label", name: l.name, label: `@${l.name}` }));
      this.projects = projects.map((p) => ({ kind: "project", id: p.id, label: p.name }));
      cx.notify();
    });
  }

  sections() {
    return [
      { title: "Lists", items: PRESETS },
      { title: "Filters", items: this.filters },
      { title: "Labels", items: this.labels },
      { title: "Projects", items: this.projects },
    ].filter((s) => s.items.length > 0);
  }

  pick(view) {
    const p = props();
    setShared(p.key, view);
    closeOverlay(p.overlay);
    run("todoist.refresh");
  }

  // Up/down/j/k move by one, h/l to the previous/next section's first item, g/G to the ends.
  menuKey(e, cx, items, starts) {
    const k = e.key;
    const ctrl = e.modifiers?.control;
    const move = (to) => {
      this.moved = true;
      this.at = Math.max(0, Math.min(items.length - 1, to));
      this.scroll.scroll_to_item(this.rowOf[this.at]);
    };
    if (k === "escape") {
      if (this.inputFocused) this.handle.focus();
      else closeOverlay(props().overlay);
    } else if (k === "down" || (ctrl && (k === "j" || k === "n"))) move(this.at + 1);
    else if (k === "up" || (ctrl && (k === "k" || k === "p"))) move(this.at - 1);
    else if (this.inputFocused) return;
    else if (k === "j") move(this.at + 1);
    else if (k === "k") move(this.at - 1);
    else if (k === "l") move(starts.find((s) => s > this.at) ?? this.at);
    else if (k === "h") move([...starts].reverse().find((s) => s < this.at) ?? 0);
    else if (k === "G" || (k === "g" && e.modifiers?.shift)) move(items.length - 1);
    else if (k === "g") move(0);
    else if (k === "enter") items[this.at] && this.pick(items[this.at]);
    else if (k === "/" || k === "i") {
      this.wantInput = true;
      this.input.focus();
    }
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  renderMenu() {
    const t = theme();
    const on = currentView(props().key);
    const sections = this.sections();
    const items = sections.flatMap((s) => s.items);
    const starts = [];
    for (let i = 0, n = 0; i < sections.length; n += sections[i].items.length, i++) starts.push(n);
    // Until a key moves it, the selection follows the current list, which may load late (labels, projects).
    if (!this.moved || this.at >= items.length) this.at = Math.max(0, items.findIndex((v) => sameView(v, on)));
    // The list's children are headers and rows: where each item's row sits, for scrolling.
    this.rowOf = [];
    let row = 0;
    for (const s of sections) {
      row++;
      for (const _ of s.items) this.rowOf.push(row++);
    }
    const section = (text) => div().px(8).pt(8).pb(4).text_size(11).text_color(t.dim).child(text);
    let index = 0;
    const item = (v) => {
      const i = index++;
      const selected = i === this.at;
      return h_flex()
        .id(`td-menu-${v.kind}-${v.id ?? v.name ?? v.query}`)
        .h(30)
        .px(8)
        .gap(9)
        .flex_none()
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .cursor_pointer()
        .when(selected, (el) => el.bg(t.selected))
        .hover((el) => el.bg(selected ? t.selected : t.hover))
        .on_click(() => this.pick(v))
        .child(div().flex_1().min_w(0).truncate().child(v.label))
        .when(sameView(v, on), (el) => el.child(svg("mods/todoist/check.svg").size(14).flex_none()));
    };
    return v_flex()
      .id("td-menu")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.menuKey(e, cx, items, starts))
      .size_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(
        div()
          .px(4)
          .pt(4)
          .pb(2)
          .child(
            Input.new(this.input)
              .h(30)
              .px(8)
              .rounded(7)
              .border_1()
              .border_color(this.inputFocused ? t.accent : t.input)
              .bg(t.background)
              .text_size(12.5),
          ),
      )
      .child(
        v_flex()
          .id("td-menu-list")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .track_scroll(this.scroll)
          .children(sections.flatMap((s) => [section(s.title), ...s.items.map(item)])),
      )
      .child(
        div()
          .px(8)
          .pt(4)
          .pb(2)
          .flex_none()
          .text_size(10.5)
          .text_color(t.dim)
          .child(this.inputFocused ? "⏎ search · ↑↓ move · esc back" : "j/k move · h/l section · ⏎ pick · / search"),
      );
  }
}

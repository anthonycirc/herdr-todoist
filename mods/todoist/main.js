// Todoist tasks in a Herdr panel, read through the `td` CLI. Click the circle to complete.
//
// Block props (all optional):
//   filter   Todoist filter query            default "today | overdue"
//   title    header label                    default "Todoist"
//   refresh  seconds between reads (>= 15)   default 60

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, props } from "herdr";

const DEFAULT_FILTER = "today | overdue";
const DEFAULT_REFRESH_S = 60;
const INSTALL_HINT = "brew install todoist-cli, then td auth login";

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
    title: p.title || "Todoist",
    refresh: Math.max(15, Number(p.refresh) || DEFAULT_REFRESH_S) * 1000,
  };
};

export default class Todoist extends View {
  init(_props, cx) {
    this.tasks = [];
    this.error = null;
    this.missing = false;
    this.loading = true;
    this.pending = new Set();
    this.hovered = null;
    cx.timer.every(config().refresh, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  // `td` comes from the user's PATH; a failed start means it isn't installed.
  async td(args) {
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

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        const out = await this.td(["task", "list", "--filter", config().filter, "--json", "--all"]);
        this.tasks = (JSON.parse(out).results ?? []).sort(
          (a, b) => (b.priority ?? 1) - (a.priority ?? 1) || (a.due?.date ?? "").localeCompare(b.due?.date ?? ""),
        );
        this.error = null;
        this.missing = false;
      } catch (e) {
        this.missing = Boolean(e.missing);
        this.error = e.missing ? null : String(e?.message ?? e);
      }
      this.loading = false;
      cx.notify();
    });
  }

  complete(task, cx) {
    if (this.pending.has(task.id)) return;
    this.pending.add(task.id);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.td(["task", "complete", `id:${task.id}`]);
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.pending.delete(task.id);
      this.refresh(cx);
    });
  }

  row(t, task, now) {
    const done = this.pending.has(task.id);
    const overdue = (task.due?.date ?? now) < now;
    const color = priorityColor(t, task.priority);
    return h_flex()
      .id(`td-${task.id}`)
      .px(8)
      .h(30)
      .flex_none()
      .rounded(8)
      .items_center()
      .gap(9)
      .hover((s) => s.bg(t.hover))
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
          .on_click(() => this.td(["task", "browse", `id:${task.id}`]).catch(() => {}))
          .child(plain(task.content)),
      )
      .when(overdue, (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi1).child(task.due.string)));
  }

  render(cx) {
    const t = theme();
    const now = today();
    const { title } = config();
    const note = (text, color) => div().px(16).pb(6).text_size(12).text_color(color).child(text);
    return v_flex()
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
          .child(div().text_size(11.5).font_medium().text_color(t.dim).child(this.missing ? title : `${title} · ${this.tasks.length}`))
          .child(
            div()
              .id("td-refresh")
              .text_color(t.dim)
              .hover((s) => s.text_color(t.foreground))
              .tooltip("Refresh")
              .on_click((_e, cx) => this.refresh(cx))
              .child(svg("mods/todoist/refresh.svg").size(14)),
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
          .children(this.tasks.map((task) => this.row(t, task, now))),
      );
  }
}

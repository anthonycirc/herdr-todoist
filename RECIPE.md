# todoist

A panel of your Todoist tasks, due today and overdue by default, in your
existing Herdr window. Each row has a priority-colored circle that completes
the task and a title that opens it in Todoist.

## What you see

- A panel with a 41px header: the title and task count (`Todoist · 6`) at
  11.5px in `dim`, and a 14px refresh icon on the right.
- 30px rows, 8px rounded, `hover` background: a 14px circle with a 1.5px
  border colored by priority (p1 `ansi1`, p2 `ansi3`, p3 `ansi4`, p4 `dim`),
  the task title in `foreground`, truncated, and for overdue tasks their due
  string at 11px in `ansi1`.
- Markdown links in titles show as their text.
- `chrome` background with a top `border`, so it sits like the sidebar's
  other lists. Empty: "Nothing to do." Without `td`: "The td CLI isn't
  installed or isn't on PATH." and the install hint.

## How it behaves

- Reads tasks on start, every `refresh` seconds (default 60, minimum 15) and
  when the refresh icon is clicked. Sorted by priority, then due date.
- Hovering a circle fills it. Clicking it completes the task (`td task
  complete`), greys the row while pending, then reads the list again.
  Completing a recurring task moves it to its next date.
- Clicking a title opens the task (`td task browse`).
- A failed `td` call shows its error in `ansi1` above the list and keeps
  the last rows.

## Built from

- `mods/todoist/main.js`: one `View`. Imports `View`, `div`, `svg` from
  `gpui-kit`, `v_flex`, `h_flex` from `gpui-base`, `exec`, `theme`, `props`
  from `herdr`. `mod.json`: `{ "place": "none" }`. `refresh.svg`: a tinted icon.
- Block props: `filter` (Todoist filter query, default `today | overdue`),
  `title` (default `Todoist`), `refresh` (seconds).
- Programs: `td` (Doist's official `todoist-cli`), run locally through
  `exec("td", …)` with the user's PATH. No network access from the mod
  itself, no token stored: `td` holds the login.

## Watch out

- `exec` rejects when `td` can't start: that is the "not installed" state,
  distinct from a non-zero exit (an error to show).
- `td task list --json` returns `{ results, nextCursor }`; pass `--all` or
  long lists get cut.
- The API's priority 4 is the app's p1.
- Don't keep a `cx`: the refresh and complete tasks take their own from
  `cx.spawn`.
- Herdr's shipped layouts can't be edited: add the block to a clone.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/todoist` passes.
- The panel lists the same tasks as `td task list --filter "today | overdue"`.
- Clicking a circle completes that task in Todoist and the row disappears.
- Clicking a title opens the task.
- With a `filter` prop, the panel lists that filter's tasks.
- With `td` off the PATH, the panel shows the install hint instead of an error.

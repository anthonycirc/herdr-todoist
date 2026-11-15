# herdr-todoist

A [Herdr](https://herdr.dev) desktop mod that shows your Todoist tasks in a
panel, next to your terminals and agents. Click a task's circle to complete
it, click its title to open it in Todoist, click the header to pick which
list to show.

It reads Todoist through the official [`td` CLI](https://github.com/todoist/todoist-cli),
so the mod stores no token: `td` keeps your login.

## Requirements

- Herdr desktop app
- `td`, logged in:

  ```sh
  brew install todoist-cli
  td auth login
  ```

  `td` must be on the PATH of your login shell. If it isn't, the panel says so
  instead of listing tasks.

## Install

### With the Herdr app's agent

Ask the agent in Herdr:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod:
> https://github.com/anthonycirc/herdr-todoist

It follows [`RECIPE.md`](RECIPE.md).

### By hand

1. Copy the mod into Herdr's home:

   ```sh
   git clone https://github.com/anthonycirc/herdr-todoist
   cp -R herdr-todoist/mods/todoist ~/.config/herdr-app/mods/
   ```

2. Add a block to your layout (`~/.config/herdr-app/layouts/<name>.json`).
   Herdr's own layouts can't be edited: clone one first (`layout.clone`).
   For example, under the agents list in the sidebar's `sidebar-lists` column:

   ```json
   { "id": "todoist", "type": "block", "content": { "mod": "todoist" }, "size": { "weight": 1 }, "min": 90 }
   ```

3. Check it:

   ```sh
   herdr-app check ~/.config/herdr-app/mods/todoist
   ```

## Pick a list

Click the header (`Today · 6 ⌄`) to choose what the panel shows:

- **Lists**: Today (default), Next 7 days, Overdue, Priority 1, No date
- **Filters**: your saved Todoist filters
- **Projects**: your Todoist projects
- **Any query**: type a [Todoist filter query](https://todoist.com/help/articles/introduction-to-filters-V98wIH)
  in the field at the top and press Enter

The choice is kept across restarts. The refresh icon spins while the list is
read; its tooltip says when it was last updated.

## Configure

Set `props` on the block. All of them are optional.

| Prop      | Default             | What it does                                          |
|-----------|---------------------|-------------------------------------------------------|
| `filter`  | `"today \| overdue"` | The query shown until a list is picked              |
| `title`   | `"Today"`           | The label of that default list                        |
| `refresh` | `60`                | Seconds between reads (minimum 15)                    |
| `key`     | `"default"`         | Keeps each panel's pick apart when several are shown  |

Two panels side by side:

```json
{ "id": "todoist-work", "type": "block", "content": { "mod": "todoist", "props": { "key": "work", "title": "Work", "filter": "#Work & (today | overdue)" } } }
```

## Commands and keys

| Command           | What it does              |
|-------------------|---------------------------|
| `todoist.refresh` | Reads the list again      |
| `todoist.menu`    | Opens the list picker     |

Bind them in `~/.config/herdr-app/keys.json`, for example:

```json
{ "global": { "cmd-shift-t": "todoist.menu" } }
```

## What it runs

- `td task list --filter <query> --json --all`, `td filter view id:<id>` or
  `td task list --project id:<id>` on each refresh, depending on the list
- `td filter list` and `td project list` when the list picker opens
- `td task complete id:<id>` when you complete a task
- `td task browse id:<id>` when you open a task

Everything runs on the local machine. Todoist tasks belong to your account,
not to a machine, so remote Herdr machines show the same list.

## Uninstall

Remove the block from your layout and delete `~/.config/herdr-app/mods/todoist`.

## License

MIT

# Asks: every question your agents ask, in one Herdr panel

![Asks panel](https://raw.githubusercontent.com/sachin-philip/herdr-agent-ask/8d6e2ec/preview.png)

Every question your agents ask in a space, in one side panel. Run several agents and the
questions pile up in different terminals: one stops at a permission dialog, one offers a menu
of options, one simply ends its turn with a paragraph that asks you something. All of them
appear in the panel as cards the moment they happen, plain-text questions included, so you
see what every agent is waiting on and keep track of the space as a whole without opening
each terminal.

Answer on the card and the answer goes straight into that agent's terminal: a key press for a
dialog, a message for a plain-text question. Each answer is appended to `docs/decisions.md` in
the agent's workspace so the next agent can read it instead of asking again.

**Version:** 0.3.0 (see `CHANGELOG.md`). Herdr desktop app only; the TUI plugin is planned (see `docs/PRD.md`).

## What you get

- An **Asks** button in the tab bar beside Files and Changes, with a count of questions waiting in
  the shown space (and `+N` when other spaces have some).
- The **Asks panel** on the right, same width rules as Files, hidden until you open it.
  Click the button or press `cmd-shift-a`. One panel per space; `All` shows every space.
- **Cards** with the agent, the kind (`APPROVAL`, `DECISION`, `QUESTION`, `UNCLEAR`), the
  question, the options verbatim with the agent's recommendation marked, an `Other answer`
  box, `Open terminal` and `Dismiss`.
- An **Answered** list under the cards, and a line per answer in `docs/decisions.md`.

## How it works

Herdr already knows when an agent is blocked. Claude Code goes further and reports what it
is asking in its status (`kind: question` with the options, or `kind: permission` with the
tool and target). The panel reads that report, then reads the screen for the option numbers and
the line of context. No model is involved for Claude Code.

**Finished turns count too.** When an agent ends a turn with plain-text questions instead
of a dialog, the engine reads that last message and asks `claude -p` (Haiku) whether the agent is
actually waiting on you. If so it becomes a `QUESTION` card; clicking an option or typing an
answer sends it to the agent as a message. Rhetorical "let me know if…" endings are skipped.
A message that asks several questions at once becomes one card that lists them. Click a
question to unfold the choices the agent gave for it (or type your own); each pick is kept as a
draft and `Send answers (2/3)` delivers them together as one numbered message. The questions
themselves are never offered as clickable answers.

**Spaces show a count too.** The spaces list in the sidebar gets a red pill with the number of
asks waiting in each space, so a space you are not looking at still tells you it needs you.

For agents that only report "blocked", the engine parses the numbered options on screen. If that
fails it asks `claude -p` (Haiku, structured output) to classify the dialog, and only trusts
the answer when every option it returns appears verbatim on screen. Otherwise the card is
`UNCLEAR` and offers only `Open terminal`.

Answers go through `hc`: the option's number key, then Enter if the dialog is still there.
Typed answers use `hc send --force` into the dialog. Before anything is sent, the panel checks
the agent still sits at the same dialog; if you answered it in the terminal meanwhile, the
card closes as "Resolved in terminal".

Nothing is ever answered without you clicking it.

## Install

**As a layout** (the gallery way): ask your agent to read `~/.config/herdr-app/AGENTS.md` and add
the layout at `herdr.dev/layouts/sachin-philip/herdr-agent-ask`. It copies `layouts/asks.json`
and the three mods, merges `keys.json`, and switches to the layout. `ctrl-shift-l` switches back.

**Keeping your own layout:**

Needs the Herdr desktop app (0.1.13 or later) and Node 18+.

```sh
git clone https://github.com/sachin-philip/herdr-agent-ask
node herdr-agent-ask/install.mjs
```

The installer copies two mods into `~/.config/herdr-app/mods/`, clones your shown layout
as `asks` with the panel and button added, binds `cmd-shift-a` under `layout:asks`, runs
`herdr-app check` on both mods and switches to the new layout. `cmd-shift-l` switches back;
`node herdr-agent-ask/install.mjs --uninstall` removes everything.

The repo is laid out the way the [Herdr gallery](https://herdr.dev/gallery/) expects a layout
(`layouts/asks.json`, `mods/`, `RECIPE.md`, `preview.png`, a `keys.json` snippet at the
root). The layout is Herdr's main layout with the tab bar and spaces list pointed at the two
clones and the panel added, which is also exactly what the installer does to a clone of yours.

Or ask an agent in a Herdr terminal:

```
Read ~/.config/herdr-app/AGENTS.md, then add this layout: herdr.dev/layouts/sachin-philip/herdr-agent-ask
Follow its RECIPE.md.
```

Tell the person before installing: the mods run `hc` (to read screens and press keys) and
`claude -p` (Haiku) on each finished turn that contains a question mark, and on dialogs
the engine cannot parse. That sends the agent's last message to Anthropic through the person's
own Claude Code login, a few seconds and well under a cent per call. `trailing_questions:
false` keeps it to dialogs only; `classify: "off"` never calls a model.

## Configure

`~/.config/herdr-app/asks.json`, all optional:

```json
{
  "label": "Asks",
  "log": "docs/decisions.md",
  "classify": "auto",
  "model": "haiku",
  "trailing_questions": true,
  "toast": false,
  "debug": false,
  "group_spaces_by_machine": true
}
```

- `label`: the words on the tab-bar button and the panel header.
- `log`: where answers are appended, relative to the agent's folder (`""` disables). `~/…` and
  absolute paths work too. Inside a git checkout the default `docs/decisions.md` shows up in
  `git status`, and an agent that commits everything will commit it: add it to `.gitignore`, or
  point `log` outside the repo, e.g. `"~/.config/herdr-app/decisions.md"`.
- `classify`: `auto` (model only when the report and screen say nothing usable), `always`
  (also adds a context line for parsed asks), `off` (never call a model).
- `trailing_questions`: check every finished turn for a plain-text question (needs the model).
  A terminal labelled `asks.trailing=off` is left out: for a tool that shows that agent's
  questions in its own card, so the question isn't carded twice. `hc label <terminal>
  asks.trailing=off` sets it and `hc label <terminal> asks.trailing=` takes it off, which checks
  the turn the terminal last finished then: so the tool can hand a question back to Asks. A card
  made from the terminal before the label came goes, noted `Asked elsewhere`; its dialogs still
  make cards.
- `group_spaces_by_machine`: once another machine is added, the spaces list puts a header per
  machine over its spaces, as Herdr's own list does; `false` keeps one flat list with no
  headers.

The installer puts three mods in place: `asks` (the panel), `tabs-asks` (the tab bar with the
button and the detection engine) and `spaces-asks` (the spaces list with the per-space count).
The last two are clones of Herdr's shipped mods with a few lines added; the layout `asks` points
at them.
- `debug`: append one line per detection step to `~/.config/herdr-app/asks.log`.
- `toast`: Herdr already toasts "needs you" for a blocked agent; `true` adds a second toast
  with the question.

Keys: `tabs-asks.toggle` shows or hides the panel, `tabs-asks.open` opens it,
`tabs-asks.recheck` re-reads every agent's current turn (after a rule change or a miss),
`asks.accept` answers the newest waiting ask in the shown space with the recommended option
(not bound by default).

## Develop

```sh
herdr-app check mods/asks
herdr-app check mods/tabs-asks
herdr-app check mods/spaces-asks
cp -R herdr-app/mods/asks/. ~/.config/herdr-app/mods/asks/      # the app reloads on save
```

`mods/asks/state.js` and `mods/tabs-asks/state.js` must stay identical; mods import only
their own folder. Detection lives in `tabs-asks` because the tab bar is always shown, so
questions are found before the panel is ever opened.

## License

MIT.

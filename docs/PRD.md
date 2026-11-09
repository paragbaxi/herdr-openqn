# Asks — PRD

**Status:** v0.1 built and installed · 2026-11-07 (see §17 for what changed during the build)
**Owner:** Sachin Philip
**Name:** **Asks** (button, panel, README, recipe, gallery; configurable `label`); repo `herdr-agent-ask`; mod folders `asks` / `tabs-asks` / `spaces-asks`. Decided 2026-11-09, see §13.

---

## 1. Summary

Asks is a Herdr plugin that turns "an agent is blocked somewhere" into "a decision is waiting for you". It watches every agent in a space, notices when one stops to ask a question or request approval, understands what is being asked, and shows it as a card in a hideable right-hand panel. You answer on the card and Asks delivers the answer to the right agent. Every answer is logged so the next agent does not ask again.

One line: **poll for blocked → read the dialog → classify in the background → show a card → user answers → send-keys or prompt → log it.**

## 2. Problem

Running six agents across two spaces means six terminals to babysit. The real cost is not watching them work. It is that an agent stalls quietly on a question, or guesses and keeps going. Today the only signals are Herdr's `blocked` status glyph and the `Needs you` section, which tell you *that* an agent stopped, not *what* it wants or whether it matters. To answer, you must focus the terminal, read back through scrollback for context, and type into a dialog you did not see appear.

Herdr already detects the stop. Asks owns everything after that.

## 3. Goals

1. One place per space that lists every pending decision, newest first, with enough context to answer without opening the terminal.
2. Answer from the card. Menu picks, yes/no, and free text all reach the correct agent without the user touching the terminal.
3. A background step that separates real decisions from routine approval prompts, and summarises each in one or two lines.
4. A durable decision log per workspace that agents can read.
5. The panel is invisible when there is nothing to decide. Hidden by default, togglable, never covering the terminal.

## 4. Non-goals (v1)

- Auto-answering anything, including "safe" permission prompts. The human stays in the loop. Herdr's own guidance is to inspect a blocked UI and ask the user before answering; Asks *is* that step.
- Agent supervision, steering, or nudging agents that are not blocked.
- Changing an agent's status, name, or Herdr's own notification behaviour.
- Cross-machine aggregation beyond what `herdr agent list` already returns for remote agents.
- A TUI pane. Desktop app first (§9); the TUI plugin pane is milestone 3.

## 5. Users and primary scenario

**User:** one person running several coding agents (Claude Code, Codex, others Herdr recognises) in two or more Herdr spaces.

**Scenario:** Builder in space League hits an `AskUserQuestion` with three options. Security Harness in the same space wants permission to run a shell command. looper in Cyborg finished and asked a free-text question in its last message. The user is heads-down in Horn.

With it installed: the `Asks` button in the top bar shows `3`. The user opens the panel. Three cards, newest first. The first is the permission prompt, labelled *Approval* with the exact command. One click: Allow. The second is Builder's three options with the agent's own recommendation highlighted. The user picks option B. The third is looper's free-text question; the user types two sentences and presses Enter. Three agents resume. The user never left Horn. `docs/decisions.md` in each workspace gained a line.

## 6. UX

### 6.1 Panel placement and visibility

The panel behaves exactly like the shipped **Files** panel in the Herdr desktop app:

- A toggle button **`Asks`** in the top bar, to the left of `Files`, in the same style (icon + label). When there are pending asks it carries a count badge, e.g. `Asks 3`. With zero pending it shows no badge.
- Clicking the button opens the panel as a right-hand column beside the terminal area, pushing the terminal narrower, never overlaying it. Clicking again hides it. Only one of Asks / Files / Changes is open at a time, matching current behaviour of that button group.
- **Width:** same width constraint as the Files panel. Match whatever the shipped layout gives Files; on a 1440-pt-wide window it measures roughly 370 pt. Asks must never exceed the Files panel's max width.
- **Hidden by default.** The open/closed state persists per layout across restarts, same as Files.
- Keyboard: `cmd-shift-a` toggles the panel. Must not collide with an existing binding; install asks before replacing one.
- The panel is **scoped to the focused space**. Switching spaces swaps the list. A small `All spaces` toggle in the panel header shows everything, grouped by space, for people who want one inbox.

### 6.2 Panel layout

```
┌─────────────────────────────────────────┐
│ Asks                        League  ⋯  │  header: title, space name, menu
│ 3 pending · 12 answered today           │
├─────────────────────────────────────────┤
│ ● Builder                       2m ago  │  card: agent, age
│ DECISION                                │  kind chip
│ Which auth strategy for the new API?    │  summary (model-written, ≤ 2 lines)
│ ○ Session cookies                       │  options, verbatim from the dialog
│ ● JWT with refresh  (agent recommends)  │
│ ○ API keys only                         │
│ [Answer]  [Open terminal]  [Dismiss]    │
├─────────────────────────────────────────┤
│ ● Security Harness              4m ago  │
│ APPROVAL                                │
│ Run: rm -rf dist && npm run build       │
│ [Allow once] [Allow always] [Deny]      │
│ [Open terminal]                         │
├─────────────────────────────────────────┤
│ ● looper                       11m ago  │
│ QUESTION                                │
│ Should the retry loop cap at 3 or 5?    │
│ ┌─────────────────────────────────────┐ │
│ │ type an answer…              ⏎ send │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 6.3 Card anatomy

| Element | Source | Rule |
|---|---|---|
| Agent name, program icon, age | `herdr agent list --json` | Same row style as the Agents sidebar |
| Kind chip | classifier | One of `APPROVAL`, `DECISION`, `QUESTION`, `UNCLEAR` |
| Summary | classifier | ≤ 2 lines, plain language, no code unless the ask *is* a command |
| Options | dialog text | Verbatim. Never paraphrased, never reordered. Recommendation marked if the agent stated one |
| Context line | classifier | Optional, ≤ 1 line: what the agent was doing when it stopped |
| Actions | kind | Approval: Allow / Allow always / Deny. Decision: pick one. Question: free text. Unclear: Open terminal only |
| Open terminal | always | `herdr agent focus <agent>` |
| Dismiss | always | Hides the card without answering; the agent stays blocked and the badge count drops |

### 6.4 States

- **Pending:** card shown, badge counted.
- **Sending:** actions disabled, spinner, ≤ 5 s.
- **Delivered:** card collapses to a one-line receipt (`Answered "JWT with refresh" · 2m ago`) and leaves the pending list within 3 s. Receipts live in a collapsible `Answered` section at the bottom.
- **Stale:** the agent left `blocked` before an answer was sent (user answered in the terminal, or the agent timed out). Card collapses to `Resolved in terminal` and leaves the pending list.
- **Failed:** `send-keys` or `prompt` returned an error. Card stays pending with the error text and a Retry button.
- **Empty:** "No asks waiting in League. Agents will appear here when they stop to ask you something."

### 6.5 Sidebar touch points

- Agents sidebar: no changes. Herdr's `blocked` glyph and `Needs you` section remain the source of truth for status.
- Space row: optional count badge, off by default. Herdr already shows per-space indicators (`↑2` in the screenshot); do not add noise unless the user turns it on.

## 7. Functional requirements

### 7.1 Detect

- **R1.** Asks treats an agent as having an ask when Herdr reports state `blocked`. No heuristic parsing of arbitrary output in v1.
- **R2.** Detection runs in a background service (§9) that polls `herdr agent list --json` every 2 s, or uses `herdr agent wait <agent> --until blocked` per agent when the agent count is small (≤ 8). Implementation picks the cheaper of the two and may switch at runtime.
- **R3.** An ask is keyed by `(agent address, blocked-since timestamp)`. The same dialog is never shown twice.
- **R4.** Optional, config-gated: agents that end a turn in `idle` or `done` whose last message ends with a question mark are also surfaced, as kind `QUESTION`. Off by default. This is the only heuristic in v1 and is clearly labelled as such.

### 7.2 Understand and validate

- **R5.** On detection the service reads the dialog with `herdr agent read <agent> --source detection` and the last 60 lines of context with `--source recent --lines 60`.
- **R6.** Both are sent to a model (§10) that returns structured JSON: kind, summary, options, recommended option, context line, delivery method, and a confidence score.
- **R7.** Validation rules applied to the model output before a card is shown:
  - Options must each appear verbatim in the dialog text, otherwise fall back to kind `UNCLEAR`.
  - Confidence below 0.6 → kind `UNCLEAR`, Open terminal only.
  - If the dialog is a recognised permission prompt pattern for the agent program, kind is forced to `APPROVAL` regardless of model output.
- **R8.** If the model call fails or exceeds 8 s, the card is shown as `UNCLEAR` with the raw first 10 lines of the dialog. Never block the panel on the model.

### 7.3 Present

- **R9.** Cards are ordered newest first within the focused space.
- **R10.** New pending ask: badge count increments and, if the panel is closed, a Herdr toast `Builder is asking: Which auth strategy…` for 4 s. Toasts are suppressed when the blocked agent is the focused terminal.
- **R11.** The panel re-renders within 1 s of a state change in the service.

### 7.4 Answer

- **R12.** Delivery method is chosen by current agent state at send time, not at detection time:

| Agent state at send | Command | Notes |
|---|---|---|
| `blocked` | `herdr agent send-keys <agent> <keys>` | `agent prompt` refuses blocked agents with `agent_blocked`. For menus send the arrow keys to the chosen option then Enter. For yes/no send the program's expected key |
| `idle` / `done` | `herdr agent prompt <agent> "<text>" --wait --timeout 15000` | Honours bracketed paste, sends Enter, waits for settled state |
| `working` | refuse | Card shows `Agent resumed on its own`, moves to Stale |

- **R13.** Menu navigation is program-aware. Each supported program has a small key map (Claude Code: ↑/↓ then Enter; numeric shortcut where the dialog shows numbers). Unknown program → free-text only.
- **R14.** After sending, the service re-reads agent state within 3 s. If still `blocked` on the same dialog, mark Failed with the text "The agent did not accept the answer" and offer Retry and Open terminal.
- **R15.** Free-text answers are sent exactly as typed. No model rewriting of the user's words.

### 7.5 Log

- **R16.** Every delivered answer appends one entry to `<workspace cwd>/docs/decisions.md` (path configurable, can be disabled):

```
- 2026-11-07 22:41 · Builder · DECISION · Which auth strategy for the new API? → JWT with refresh
```

- **R17.** The log is append-only and plain markdown so any agent can read it with its normal file tools. Asks never edits earlier lines.
- **R18.** Dismissed and stale asks are not logged.

## 8. Naming and copy

- Button and panel title: `Asks`. Noun, reads as a count (`Asks 3`), does not read as a command. Decided 2026-11-09; the mod ids are `asks` / `tabs-asks` / `spaces-asks`.
- Kind chips: `APPROVAL`, `DECISION`, `QUESTION`, `UNCLEAR`. Uppercase, 10 px, same pill style as the `unread` badge in herdr-marks.
- Never say "blocked" to the user. Herdr owns that word for status; Asks talks about what the agent *wants*.

## 9. Architecture

Three parts. The service is shared; the two front ends are thin.

```
┌──────────────────────────┐    reads     ┌──────────────────────────┐
│ Herdr desktop app mod    │◄────────────►│ asksd (Node service)      │
│  mods/asks-panel/        │  state.json  │  poll herdr agent list    │
│  renders cards, sends    │              │  read dialog + context    │
│  answers via hc/herdr    │              │  classify (model)         │
└──────────────────────────┘              │  write state.json         │
┌──────────────────────────┐              │  append decisions.md      │
│ Herdr TUI plugin pane    │◄────────────►│  deliver answers          │
│  (milestone 3)           │              └─────────────┬────────────┘
└──────────────────────────┘                            │ herdr CLI
                                                        ▼
                                               Herdr server / agents
```

### 9.1 Service `asksd`

- Node 18+, started by the plugin's `setup` action and kept alive while a Herdr session exists. One instance per Herdr server. Idempotent start.
- State lives in the plugin's Herdr-provided state directory as `state.json` (atomic write, versioned schema). Front ends watch the file.
- Also writes a label `herdr.ask=pending|answered` on the agent's terminal via `hc label`, so other clients and future Herdr features can see it. Labels are a mirror, not the source of truth.
- All Herdr interaction goes through the `herdr` / `hc` CLIs, never the socket directly, so it survives API changes the same way herdr-marks does.

### 9.2 Desktop app mod `asks-panel`

- Follows the herdr-marks recipe: a mod in `~/.config/herdr-app/mods/asks-panel/`, a cloned layout `asks` that adds the panel block and the top-bar button, `keys.json` entry for `cmd-shift-a`.
- The top-bar button and right column must reuse the same layout primitives the shipped `Files` panel uses so width, toggle behaviour and persistence match for free. If those primitives are not exposed to mods, the mod clones the Files block and swaps its content; that fallback is documented as a known drift risk, as in herdr-marks.
- Uses `hc`, `herdr`, `nextCommand`, `notify`, `focused()`, `terminals()`.

### 9.3 TUI plugin (milestone 3)

- `herdr-plugin.toml` with a `[[panes]]` entry, opened via `herdr plugin pane open --placement split --direction right --workspace <id>`, plus an action `toggle` bound to `prefix+a`. Renders the same `state.json`.

### 9.4 Data model

```json
{
  "schema": 1,
  "asks": [{
    "id": "w1:p3@1762551660",
    "agent": "Builder",
    "address": "w1:p3",
    "program": "claude-code",
    "workspace": "League",
    "cwd": "/Users/labtocat/Code/portfolio-remix",
    "detected_at": "2026-11-07T22:41:00Z",
    "state": "pending",
    "kind": "DECISION",
    "summary": "Which auth strategy for the new API?",
    "options": ["Session cookies", "JWT with refresh", "API keys only"],
    "recommended": 1,
    "context": "Scaffolding /api/auth after finishing the user model",
    "delivery": "send-keys",
    "confidence": 0.91,
    "raw_dialog": "…",
    "answer": null,
    "answered_at": null,
    "error": null
  }]
}
```

## 10. Classifier

- **Input:** dialog text, last 60 lines of context, agent program, workspace name.
- **Output:** the JSON object in §9.4 minus bookkeeping fields. Enforced with a JSON schema; invalid output → `UNCLEAR`.
- **Model:** `claude-haiku-5-5` by default. Latency target p50 < 2 s, p95 < 6 s.
- **Transport:** `claude -p --output-format json` using the user's existing Claude Code login, so no new key is needed. Fallback: `ANTHROPIC_API_KEY` from the plugin config. Transport is a config switch.
- **Prompt contract:**
  - Classify kind. `APPROVAL` = a permission or confirmation gate the program raised. `DECISION` = the agent offers enumerated options. `QUESTION` = open-ended ask. `UNCLEAR` = anything else.
  - Copy options verbatim. Do not invent, merge, or reorder.
  - Summary ≤ 160 characters, in the user's language, no preamble.
  - Context ≤ 120 characters, past tense, what the agent was doing.
  - State a recommendation only if the agent stated one.
  - Return a confidence in [0, 1].
- **Privacy:** the dialog and context lines leave the machine. The install step says so plainly and offers a `local_only` mode in which no model is called and every ask is shown as `UNCLEAR` with raw text.

## 11. Edge cases

| Case | Behaviour |
|---|---|
| User answers in the terminal while the card is open | Service sees `blocked` clear with no send from the panel → Stale, no log entry |
| Agent closes or pane is lost | Card removed; if it was pending, a receipt `Agent closed` |
| Two asks from the same agent in a row | Second ask gets a new id; first is Stale if its dialog is gone |
| Remote agent (`machine/t7`) | Addresses passed through unchanged; model latency adds to send time budget |
| Dialog longer than the read window | Classifier gets the detection snapshot in full; context truncated from the top |
| Model returns options not in dialog | R7 → `UNCLEAR` |
| Herdr server restarts | Service re-scans; asks with no matching live terminal are dropped |
| Panel open while switching spaces | List swaps; scroll position reset |
| Program Herdr marks `unknown` | Not an ask. Never shown |

## 12. Configuration (`config.toml` in the plugin config dir)

```toml
poll_interval_ms = 2000
model = "claude-haiku-5-5"
transport = "claude-cli"        # or "api" or "local_only"
log_path = "docs/decisions.md"  # relative to workspace cwd; "" disables
surface_trailing_questions = false   # R4
toast = true
space_badge = false
```

## 13. Unresolved questions

1. **Name.** Decided 2026-11-09: `Asks`, repo `herdr-agent-ask`, gallery id `herdr-agent-ask`. `Asks` was the label for a day; `Decisions`, `Resolve`, `Inbox` were considered.
2. Can a desktop-app mod add a button to the top-bar group next to `Files` and `Changes`, or only clone a layout? Answer determines §9.2's fallback. Spike first.
3. Does Herdr emit a plugin event on agent state change? If yes, replace polling. herdr-marks only uses focus events, so assume no until proven.
4. Per-program key maps for menus: confirm Claude Code's `AskUserQuestion` accepts numeric shortcuts in the current version, and what Codex and Gemini CLI dialogs look like.
5. Should the decisions log also be written as a label on the workspace so Herdr's own UI could surface it later?

## 14. Milestones

| # | Scope | Done when |
|---|---|---|
| 0 | Spikes for §13 Q2–Q4 | Written answers in `docs/spikes.md` |
| 1 | `asksd` + desktop panel, detect / understand / present / answer / log, `APPROVAL` and `DECISION` only, Claude Code only | Scenario in §5 works end to end on one machine; every row in §11 has a test |
| 2 | `QUESTION` kind, free text, `All spaces`, Codex key map, install script, README | Installable from GitHub with `herdr plugin install`; privacy notice shown |
| 3 | TUI plugin pane | Same state, same actions, `prefix+a` |
| 4 | Config-gated R4 trailing-question heuristic; space badge | Off by default, documented |

## 15. Success metrics (first two weeks of personal use)

- Fraction of asks answered from the panel rather than the terminal. Target ≥ 70 %.
- Time from `blocked` to answer, median. Target under half of the pre-install baseline, measured for one week before install.
- `UNCLEAR` rate. Target < 15 % on Claude Code.
- Failed deliveries. Target < 2 %.
- Zero cases of an answer reaching the wrong agent. This is the only hard gate.

## 16. Risks

- **Wrong-agent delivery.** Mitigation: deliver by pane address, re-verify `agent get` returns the same agent and the same `blocked` dialog hash immediately before sending.
- **Layout drift.** A cloned layout or Files block does not follow Herdr updates. Mitigation: prefer exposed primitives; pin the Herdr app version in the README; `herdr-app check` in CI.
- **Classifier over-confidence.** Mitigation: verbatim-options check, confidence floor, `UNCLEAR` as the default failure mode, human always in the loop.
- **Dialog text leaving the machine.** Mitigation: explicit notice at install, `local_only` mode.

## 17. Build notes (2026-11-07)

What the v0.1 build does differently from the sections above, and why.

- **No separate service.** The desktop app's mod API already exposes live agent state, `hc`, `exec`, timers and a persisted shared store. Detection runs inside the tab-bar mod (`tabs-asks`), because a mod copy only starts once it is shown and the tab bar always is. The panel mod (`asks`) renders the shared state and delivers answers. §9's `asksd` is not needed for the app; it may still be the right shape for the TUI pane (milestone 3).
- **Claude Code needs no model.** Its status report carries the dialog: `kind: question`, `msg: "answer: <question> (<opt> · <opt>)"`, or `kind: permission`, `msg: "approve <Tool>: <target>"`. R6 therefore applies only to agents whose report says nothing usable; for them the screen's numbered options are parsed first and `claude -p` (Haiku, JSON schema) is the last resort. R7's verbatim-options and confidence checks are implemented as written.
- **Delivery.** Through `hc`, not the TUI's `herdr agent` commands (the app's agents live in herdr-core). Option: `hc keys <t> <n>`, then Enter only if the same dialog is still up (Claude Code selects on the number alone). Free text: `hc send --force` into the dialog, which Claude Code's question dialog accepts as the answer, so QUESTION/free text is not limited to idle agents as §7.4 assumed. State is re-verified immediately before any key is pressed (R12, §16).
- **Toasts off by default.** Herdr already posts "Claude Code needs you" for a blocked agent; a second toast was noise. `toast: true` adds one that carries the question (R10 otherwise as written).
- **Badge.** The count is the shown space's; other spaces show as dim `+N` / `N elsewhere` rather than a red pill.
- **Verified end to end** on this machine: a Claude Code AskUserQuestion became a DECISION card within 2 s with options numbered from the screen and the recommendation marked; `asks.accept` pressed `1`, the agent answered `Geist (Recommended)`, the card moved to Answered and `docs/decisions.md` gained the line; a permission prompt produced the `kind: permission` report; a free-text answer sent with `hc send --force` was accepted by the dialog; a dialog answered in the terminal turned its card stale.
- **Unresolved questions answered.** §13 Q2: a mod cannot add a button to the shipped tab bar; the tab bar mod is cloned (`tabs-asks`) and the layout points at it. Q3: no state-change plugin event was found; the engine ticks every 2 s and on every redraw (cheap, since `terminals()` is live). Q4: Claude Code takes the option number directly; Codex and Gemini still unverified.
- **R4 shipped, on by default.** The user named finished turns that end in prose questions as the main pain, so trailing-question detection is in v0.1 and on by default (`trailing_questions`). It is the one place a model runs for Claude Code: each finished turn with a `?` in the agent's last message is sent to Haiku, which decides whether the agent is waiting on the person. Answers to those cards are sent as messages, not key presses. A message with several questions (a numbered list of nine, say) is one card listing the questions with a single typed answer; the first build offered the questions themselves as clickable options, which would have sent a question back as the answer. Each listed question unfolds the choices the agent gave for it; picks are drafted and sent together as one numbered message.
- **Space badge shipped.** The spaces list is a clone (`spaces-asks`) with a red count pill per space, fed from the same shared state as the tab-bar button.
- **Still to do from the plan.** Milestone 2's Codex key map and the GitHub install path, milestone 3's TUI pane, the space badge, and trademark checks before publishing.

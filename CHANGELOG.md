# Changelog

## 0.2.0 · 2026-11-09

- **Named Asks.** Button, panel, README, recipe and gallery entry all say Asks. The default
  tab-bar label is `Asks`; a `label` in `asks.json` still wins.
- **Shared as a layout.** `layouts/asks.json` is Herdr's main layout with the tab bar and
  spaces list pointed at the clones and the panel added, so the gallery's own install flow
  works. `install.mjs` stays for people who keep their own layout.
- **Plain-text questions.** A finished turn that ends by asking you something becomes a card
  (`trailing_questions`, on by default). Text typed into the prompt box but not sent no longer
  hides the agent's message.
- **Several questions at once.** One card lists them; click a question to unfold the options
  the agent gave for it, draft an answer per question, and send them together as one message.
- **Count per space.** The spaces list shows a red pill with the number of asks waiting in each
  space (`spaces-asks`).
- `tabs-asks.recheck` re-reads every agent's current turn after a rule change.
- Fixed a panel re-render failure that froze it on its last good frame.

## 0.1.0 · 2026-11-07

- First build: cards for Claude Code permission dialogs and option menus, answered from the
  panel with a key press or typed text; `Answered` list; one line per answer in
  `docs/decisions.md`; `All` scope; `asks.accept`; installer with `--uninstall`.

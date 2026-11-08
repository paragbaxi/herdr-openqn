// The Asks panel: every decision an agent in the shown space is waiting on, as a card you
// answer from here. Detection lives in mods/tabs-asks (always shown); this mod shows the
// shared state and delivers answers with hc.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, focused, run, theme, hc, exec, nextCommand } from "herdr";
import { readState, update, stillAsking, stillIdle, age, loadConfig } from "./state.js";

const KIND = { APPROVAL: "blocked", DECISION: "accent", QUESTION: "working", UNCLEAR: "dim" };
const stamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const one = (s) => (s ?? "").replace(/\s+/g, " ").trim();

function iconOf(p, size, color) {
  if (!p?.icon) return div().size(size).rounded(4).bg(color).opacity(0.3);
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Asks extends View {
  init(_props, cx) {
    this.all = localStorage.getItem("scope") === "all";
    this.showAnswered = false;
    this.other = null; this.otherText = "";
    this.input = InputState.new({ placeholder: "Type a different answer, Enter to send" });
    this.input.on("change", (_e, cx) => { this.otherText = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => { const ask = readState().asks.find((a) => a.id === this.other); if (ask && this.otherText.trim()) this.sendText(ask, this.otherText.trim(), cx); });
    this.config = null;
    const config = (cx) => cx.spawn(async (cx) => { this.config = await loadConfig(); cx.notify(); });
    config(cx);
    cx.timer.every(30000, (cx) => { config(cx); cx.notify(); });
    // Key commands ("asks.accept" in keys.json): accept answers the newest waiting ask in the
    // shown space with the option its agent recommends (or the first, for an approval).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "accept") {
          const spaceId = spaces().find((s) => s.active)?.id ?? focused()?.space;
          const ask = readState().asks.find((a) => a.state === "pending" && (this.all || a.space === spaceId) && a.options.length && a.kind !== "UNCLEAR");
          if (ask) this.answer(ask, ask.options[ask.recommended ?? 0], cx);
        }
        cx.notify();
      }
    });
  }

  set(id, patch) { update((s) => { const a = s.asks.find((x) => x.id === id); if (a) Object.assign(a, patch); }); }

  stale(ask) { this.set(ask.id, { state: "stale", note: "Resolved in terminal", ended_at: Date.now() }); }

  async probe(address) {
    const r = await hc(["get", address, "--json"]);
    if (r.code !== 0) return null;
    const g = JSON.parse(r.stdout);
    const st = typeof g.status === "string" ? g.status : g.status?.state ?? null;
    return { state: g.state === "live" ? st : "gone", msg: typeof g.status === "object" ? g.status?.msg ?? "" : "" };
  }

  // Press the option's number; Enter only if the dialog is still there (Claude Code selects on the number alone).
  answer(ask, option, cx) {
    // A prose question: the option is sent as a message, not pressed as a key.
    if (ask.delivery === "send") return this.sendText(ask, option.label.replace(/\s*\(recommended\)\s*$/i, ""), cx);
    if (!stillAsking(ask)) return this.stale(ask);
    this.set(ask.id, { state: "sending", answer: option.label, chosen: option, error: null });
    this.deliver(ask, cx, async (sleep) => {
      let r = await hc(["keys", ask.address, String(option.n)]);
      if (r.code !== 0) throw new Error(one(r.stderr) || "Could not press the key");
      await sleep(900);
      let g = await this.probe(ask.address);
      if (g && g.state === "blocked" && g.msg === ask.msg) {
        r = await hc(["keys", ask.address, "enter"]);
        if (r.code !== 0) throw new Error(one(r.stderr) || "Could not press Enter");
        await sleep(1500);
        g = await this.probe(ask.address);
      }
      return g;
    });
  }

  // Free text into a dialog (Claude Code's question dialog takes typed text as its own answer) or to an idle agent.
  sendText(ask, text, cx) {
    const live = stillAsking(ask);
    if (!live && !stillIdle(ask)) return this.set(ask.id, { state: "stale", note: ask.delivery === "send" ? "Answered in terminal" : "Resolved in terminal", ended_at: Date.now() });
    this.set(ask.id, { state: "sending", answer: text, chosen: { text }, error: null });
    this.other = null; this.input.set_value(""); this.otherText = "";
    this.deliver(ask, cx, async (sleep) => {
      const r = await hc(live ? ["send", "--force", ask.address, text] : ["send", ask.address, text]);
      if (r.code !== 0) throw new Error(one(r.stderr) || "Could not send the answer");
      await sleep(1500);
      const g = await this.probe(ask.address);
      // A message to an idle agent is delivered once it is working (or at a new dialog).
      if (!live) return g && (g.state === "idle" || g.state === "done") ? { state: "blocked", msg: ask.msg } : null;
      return g;
    });
  }

  deliver(ask, cx, act) {
    cx.spawn(async (cx) => {
      const sleep = (ms) => new Promise((res) => cx.timer.after(ms, () => res()));
      try {
        const g = await act(sleep);
        if (g && g.state === "blocked" && g.msg === ask.msg) throw new Error(ask.delivery === "send" ? "The agent did not pick the message up" : "The agent did not accept the answer");
        const now = Date.now();
        this.set(ask.id, { state: "delivered", answered_at: now, error: null });
        await this.log(ask, now);
      } catch (e) {
        this.set(ask.id, { state: "failed", error: String(e?.message ?? e) });
      } finally { cx.notify(); }
    });
  }

  async log(ask, at) {
    const rel = this.config?.log ?? "docs/decisions.md";
    if (!rel || !ask.cwd) return;
    const path = rel.startsWith("/") ? rel : `${ask.cwd}/${rel}`;
    const answer = readState().asks.find((a) => a.id === ask.id)?.answer ?? ask.answer ?? "";
    const line = `- ${stamp(new Date(at))} · ${one(ask.agent)} · ${ask.kind} · ${one(ask.question)} → ${one(answer)}`;
    try { await exec("sh", ["-c", 'd=$(dirname "$2"); mkdir -p "$d" && printf "%s\\n" "$1" >> "$2"', "asks", line, path]); } catch {}
  }

  retry(ask, cx) {
    if (ask.chosen?.text) return this.sendText(ask, ask.chosen.text, cx);
    if (ask.chosen) return this.answer(ask, ask.chosen, cx);
    this.set(ask.id, { state: "pending", error: null });
  }

  open(ask) {
    if (ask.pane) run("pane.focus", { pane: ask.pane });
    else run("agent.focus", { terminal: ask.address });
  }

  card(ask, t, now) {
    const sending = ask.state === "sending", failed = ask.state === "failed";
    const color = t[KIND[ask.kind] ?? "dim"];
    const chip = (text, c) => div().px(5).h(16).flex_none().flex().items_center().rounded(4).text_size(10).font_semibold().bg(c).opacity(0.9).text_color(t.background).child(text);
    const action = (id, icon, label, fn, primary) => h_flex().id(id).h(26).px(8).gap(5).items_center().rounded(7).flex_none().text_size(11.5).cursor_pointer()
      .border_1().border_color(primary ? t.input : t.border).bg(primary ? t.raised : t.surface).text_color(primary ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => fn(cx)).child(svg(icon).size(12)).child(label);
    const option = (o, i) => v_flex().id(`opt-${ask.id}-${o.n}`).w_full().px(10).py(6).gap(2).rounded(8).border_1().border_color(ask.recommended === i ? t.accent : t.border).bg(t.background)
      .when(!sending, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).border_color(t.input)).on_click((_e, cx) => this.answer(ask, o, cx)))
      .child(h_flex().gap(8).items_center()
        .child(div().w(18).h(18).flex_none().rounded(4).flex().items_center().justify_center().text_size(10.5).font_semibold().bg(t.raised).text_color(t.muted).child(String(o.n)))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).tooltip(o.label).child(o.label))
        .when(ask.recommended === i, (el) => el.child(div().text_size(10).flex_none().text_color(t.accent).child("recommends"))))
      .when(Boolean(o.detail), (el) => el.child(div().pl(26).text_size(11).text_color(t.dim).truncate().child(o.detail)));
    return v_flex().id(`ask-${ask.id}`).w_full().p(12).gap(8).rounded(10).bg(t.surface).border_1().border_color(failed ? t.blocked : t.border)
      .child(h_flex().gap(8).items_center()
        .child(iconOf(ask.program, 16, t.muted))
        .child(div().min_w(0).truncate().font_semibold().text_size(12.5).child(ask.agent))
        .when(this.all && Boolean(ask.space_name), (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(`· ${ask.space_name}`)))
        .child(div().flex_1())
        .when(sending, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(age(now - ask.detected_at))))
      .child(h_flex().gap(8).items_center().child(chip(ask.kind, color))
        .when(Boolean(ask.context), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).tooltip(ask.context).child(ask.context))))
      .child(div().w_full().text_size(13).text_color(t.foreground).child(ask.question || (ask.enriched ? "Needs you in the terminal" : "Reading the dialog…")))
      .when(ask.options.length > 0 && ask.kind !== "UNCLEAR", (el) => el.child(v_flex().w_full().gap(5).children(ask.options.map(option))))
      .when((ask.questions?.length ?? 0) > 1, (el) => el.child(v_flex().w_full().gap(4).children(ask.questions.map((q, i) =>
        h_flex().id(`q-${ask.id}-${i}`).w_full().gap(8).items_start()
          .child(div().w(18).h(18).flex_none().rounded(4).flex().items_center().justify_center().text_size(10.5).font_semibold().bg(t.raised).text_color(t.muted).child(String(i + 1)))
          .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child(q))))))
      .when(ask.kind === "UNCLEAR" && ask.enriched, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Asks could not read this dialog. Open the terminal to answer it.")))
      .when(this.other === ask.id, (el) => el.child(Input.new(this.input).w_full().h(32).px(10).rounded(8).border_1().border_color(t.accent).bg(t.background).text_size(12.5).text_color(t.foreground)))
      .when(failed, (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(ask.error ?? "Failed")))
      .child(h_flex().gap(6).items_center().flex_wrap()
        .when(failed, (el) => el.child(action(`retry-${ask.id}`, "mods/asks/send.svg", "Retry", (cx) => this.retry(ask, cx), true)))
        .when(!sending && ask.kind !== "UNCLEAR" && ask.kind !== "APPROVAL", (el) => el.child(action(`other-${ask.id}`, "mods/asks/send.svg", this.other === ask.id ? "Cancel" : ask.options.length ? "Other answer" : "Answer", (cx) => {
          this.other = this.other === ask.id ? null : ask.id;
          if (this.other) this.input.focus();
          cx.notify();
        })))
        .child(action(`open-${ask.id}`, "mods/asks/terminal.svg", "Open terminal", () => this.open(ask)))
        .child(div().flex_1())
        .when(!sending, (el) => el.child(action(`dismiss-${ask.id}`, "mods/asks/x.svg", "Dismiss", () => this.set(ask.id, { state: "dismissed", ended_at: Date.now() })))));
  }

  receipt(ask, t, now) {
    const delivered = ask.state === "delivered";
    return h_flex().id(`rc-${ask.id}`).w_full().h(26).px(8).gap(7).items_center().rounded(7).text_size(11.5).text_color(t.muted).hover((s) => s.bg(t.hover))
      .cursor_pointer().on_click(() => this.open(ask))
      .child(svg(delivered ? "mods/asks/check.svg" : "mods/asks/x.svg").size(11).flex_none().text_color(delivered ? t.done : t.dim))
      .child(div().flex_none().max_w(90).truncate().text_color(t.foreground).child(ask.agent))
      .child(div().flex_1().min_w(0).truncate().child(delivered ? `→ ${one(ask.answer)}` : ask.note ?? ask.state))
      .child(div().flex_none().text_color(t.dim).child(age(now - (ask.answered_at ?? ask.ended_at ?? ask.detected_at))));
  }

  render(cx) {
    const t = theme(), now = Date.now();
    const space = spaces().find((s) => s.active), spaceId = space?.id ?? focused()?.space;
    const all = readState().asks.filter((a) => this.all || a.space === spaceId);
    const pending = all.filter((a) => a.state === "pending" || a.state === "sending" || a.state === "failed");
    const done = all.filter((a) => !pending.includes(a) && a.state !== "dismissed");
    const today = done.filter((a) => a.state === "delivered" && now - a.answered_at < 86400000).length;
    const toggle = (id, label, on, fn) => div().id(id).h(20).px(7).flex_none().flex().items_center().rounded(5).text_size(11).cursor_pointer()
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.dim).hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { fn(); cx.notify(); }).child(label);
    return v_flex().id("asks").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(this.config?.label ?? "Open questions"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.all ? "All spaces" : space?.name ?? ""))
        .child(toggle("asks-all", "All", this.all, () => { this.all = !this.all; localStorage.setItem("scope", this.all ? "all" : "space"); })))
      .child(div().px(14).py(7).flex_none().text_size(11.5).text_color(t.dim).child(`${pending.length} waiting · ${today} answered today`))
      .child(v_flex().id("asks-list").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8).gap(8)
        .children(pending.map((a) => this.card(a, t, now)))
        .when(pending.length === 0, (el) => el.child(div().p(10).text_size(12).text_color(t.dim).child(`No open questions in ${this.all ? "any space" : space?.name ?? "this space"}. Agents show up here when they stop to ask you something.`)))
        .when(done.length > 0, (el) => el.child(v_flex().w_full().gap(2).pt(6)
          .child(h_flex().id("asks-done").h(24).px(8).gap(6).items_center().text_size(11).font_medium().text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { this.showAnswered = !this.showAnswered; cx.notify(); })
            .child(div().child("Answered")).child(div().child(String(done.length))).child(div().flex_1())
            .child(svg(`mods/workspace-chrome/chevron-${this.showAnswered ? "down" : "right"}.svg`).size(11).text_color(t.dim)))
          .when(this.showAnswered, (el) => el.children(done.slice(0, 30).map((a) => this.receipt(a, t, now)))))));
  }
}

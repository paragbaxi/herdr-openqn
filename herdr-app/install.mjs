#!/usr/bin/env node
// Installs the Asks mods into the Herdr desktop app, clones the shown layout as `asks` with
// the Asks panel and tab-bar button, and binds cmd-shift-a. Idempotent; --uninstall reverses it.
//   node herdr-app/install.mjs [--layout <source>] [--as asks] [--no-switch] [--uninstall]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HERDR_APP_HOME || path.join(os.homedir(), ".config", "herdr-app");
const MODS = ["asks", "tabs-asks", "spaces-asks"];
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const AS = opt("--as", "asks");
const KEY = "cmd-shift-a", ACTION = "tabs-asks.toggle";

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const app = (...a) => { try { return execFileSync("herdr-app", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return e.stdout || e.stderr || String(e); } };
const run = (cmd, params) => { const out = app("do", cmd, ...Object.entries(params).flatMap(([k, v]) => [`--${k}`, String(v)])); if (out.includes('"error"')) throw new Error(`${cmd}: ${out.trim()}`); return out; };
const find = (node, pred) => { if (!node) return null; if (pred(node)) return node; for (const c of node.children ?? []) { const f = find(c, pred); if (f) return f; } return null; };
// Our folders: the panel and tab bar carry state.js + asks.svg; the spaces clone says so in its header.
const ours = (dir) => (fs.existsSync(path.join(dir, "state.js")) && fs.existsSync(path.join(dir, "asks.svg")))
  || (() => { try { return fs.readFileSync(path.join(dir, "main.js"), "utf8").slice(0, 400).includes("herdr-openqn"); } catch { return false; } })();

if (!fs.existsSync(HOME)) { console.error(`No Herdr app home at ${HOME}. Open the Herdr app once first.`); process.exit(1); }
const shared = readJson(path.join(HOME, "shared.json"), {});
const layoutFile = path.join(HOME, "layouts", `${AS}.json`);
const keysFile = path.join(HOME, "keys.json");

if (flag("--uninstall")) {
  const existing = readJson(layoutFile, null);
  const back = existing?.cloned_from?.name ?? "main";
  if (shared.layout === AS) run("layout.switch", { name: back });
  if (existing) fs.rmSync(layoutFile);
  for (const m of MODS) { const d = path.join(HOME, "mods", m); if (fs.existsSync(d) && ours(d)) fs.rmSync(d, { recursive: true }); }
  const keys = readJson(keysFile, {});
  delete keys[`layout:${AS}`];
  writeJson(keysFile, keys);
  console.log(`Removed the ${AS} layout, the Asks mods and their keys. Shown layout: ${back}.`);
  process.exit(0);
}

// 1. Mods. Only ever replace folders that are ours.
for (const m of MODS) {
  const src = path.join(here, "mods", m), dst = path.join(HOME, "mods", m);
  if (fs.existsSync(dst) && !ours(dst)) { console.error(`mods/${m} exists and is not Asks. Move it aside first.`); process.exit(1); }
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true, filter: (p) => !/gpui-kit\.d\.ts$|jsconfig\.json$/.test(p) });
}
console.log(`Copied mods: ${MODS.join(", ")}`);

// 2. Layout: clone the shown one (or --layout) unless our clone is already there.
let source = opt("--layout", null);
let layout = readJson(layoutFile, null);
if (!layout) {
  source ??= shared.layout && shared.layout !== AS ? shared.layout : "main";
  if (!fs.existsSync(path.join(HOME, "layouts", `${source}.json`))) { console.error(`No layout named ${source}.`); process.exit(1); }
  try { run("layout.clone", { name: source, as: AS }); }
  catch (e) {
    // The window is closed: copy the file ourselves.
    const copy = readJson(path.join(HOME, "layouts", `${source}.json`), null);
    copy.cloned_from = { name: source, version: readJson(path.join(HOME, "installed.json"), {}).version ?? "unknown" };
    writeJson(layoutFile, copy);
  }
  layout = readJson(layoutFile, null);
  if (!layout) { console.error("Could not clone the layout."); process.exit(1); }
  console.log(`Cloned layout ${source} as ${AS}`);
} else source ??= layout.cloned_from?.name ?? "main";

// 3. Patch: tab bar → tabs-asks; spaces list → spaces-asks (count pill per space);
//    panel-body stack gets an asks block.
const tabs = find(layout, (n) => n.content?.mod === "tabs" || n.content?.mod === "tabs-asks");
if (!tabs) { console.error("This layout has no tab bar block (content.mod = tabs); Asks needs one for its button."); process.exit(1); }
tabs.content.mod = "tabs-asks";
const spacesBlock = find(layout, (n) => n.content?.mod === "spaces" || n.content?.mod === "spaces-asks");
if (spacesBlock) spacesBlock.content.mod = "spaces-asks";
else console.warn("This layout has no spaces list (content.mod = spaces); skipping the per-space count.");
const body = find(layout, (n) => n.id === "panel-body" && n.type === "stack");
const panel = find(layout, (n) => n.id === "panel");
if (!body || !panel) { console.error("This layout has no right-hand panel stack (ids panel / panel-body); Asks needs one."); process.exit(1); }
if (!body.children.some((c) => c.id === "asks")) body.children.push({ id: "asks", type: "block", content: { mod: "asks" } });
writeJson(layoutFile, layout);
console.log(`Patched layouts/${AS}.json: tab bar uses tabs-asks${spacesBlock ? ", spaces list uses spaces-asks" : ""}, panel stack has asks (width ${panel.size?.px ?? "?"}px, max ${panel.max ?? "?"}px, same as Files)`);

// 4. Keys: our section, carrying the source layout's keys along (e.g. herdr-marks' cmd-shift-m).
const keys = readJson(keysFile, {});
fs.copyFileSync(keysFile, `${keysFile}.before-asks-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`);
const section = { ...(keys[`layout:${source}`] ?? {}), ...(keys[`layout:${AS}`] ?? {}) };
const taken = Object.entries(keys.global ?? {}).concat(Object.entries(section)).find(([k, v]) => k === KEY && v !== ACTION);
if (taken) console.warn(`Not binding ${KEY}: it already runs ${taken[1]}. Add "${KEY}": "${ACTION}" under "layout:${AS}" yourself.`);
else section[KEY] = ACTION;
keys[`layout:${AS}`] = section;
writeJson(keysFile, keys);
console.log(`Keys: layout:${AS} → ${JSON.stringify(section)}`);

// 5. Check the mods, then show the layout.
let bad = false;
for (const m of MODS) {
  const out = app("check", path.join(HOME, "mods", m));
  const ok = !/error/i.test(out) || /"errors":\s*\[\]/.test(out);
  console.log(`check ${m}: ${ok ? "ok" : out.trim()}`);
  bad ||= !ok;
}
if (bad) process.exit(1);
if (!flag("--no-switch")) { try { run("layout.switch", { name: AS }); console.log(`Switched to layout ${AS}`); } catch (e) { console.warn(`Could not switch layouts (is the window open?): ${e.message}`); } }
const status = readJson(null, null) ?? (() => { try { return JSON.parse(app("status")); } catch { return null; } })();
if (status) console.log(`Status: layout=${status.layout} errors=${JSON.stringify(status.errors)}`);
console.log("Done. Click Asks in the tab bar, or press cmd-shift-a.");

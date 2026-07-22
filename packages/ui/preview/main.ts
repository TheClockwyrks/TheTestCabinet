// A tiny standalone player for the Lattice renderer — no backend, no run record.
// It instantiates the SAME vendored engine (lattice-core.wasm) and sprite sheet the
// app bundles, loads a crafted scenario, and steps + draws it exactly the way
// LatticePlaybackSection's PlaybackOverlay does. Purely a local dev preview for
// eyeballing renderer/engine changes.
//
// Three groups are shown: the PRE-FLIGHT SMOKE TESTS (tiny per-behavior scenarios,
// each run headlessly to a pass/fail — the cheap gate a real test case runs before
// the expensive stress scenarios), the splitter demo SCENARIOS, and PORTIONS of the
// held-out scored `bus` factories (representative top-of-factory crops, so the
// interconnected main-bus layouts can be eyeballed without a full run). All playable.

import {
  Engine,
  loadSheet,
  Renderer,
  type Atlas,
  type Board,
  type Sheet,
  type Snapshot,
} from "../src/app/pages/runs/lattice/renderer";
import latticeCoreWasmUrl from "../src/app/pages/runs/lattice/assets/lattice-core.wasm?url";
import sheetPngUrl from "../src/app/pages/runs/lattice/assets/sheet.png?url";
import atlas from "../src/app/pages/runs/lattice/assets/sheet.json";
import { PRESETS } from "./scenarios";
import { SCORED_PORTIONS } from "./preview-scenarios";
import { SMOKE, SMOKE_CHECKS } from "./smoke";

// Mirror the app's playback constants.
const BASE_TICKS_PER_SECOND = 20;
const DRAW_EVERY_TICK_BELOW = 4;
const SPEEDS = [0.5, 1, 2, 4] as const;
const SCALE = 3; // upscale a small factory so it's easy to watch (pixel-crisp)
// Cap the displayed width so a big scored factory (48–72 tiles at a 32px cell) fits
// on screen: tiny smoke/demo scenarios keep the full SCALE, wide ones scale down to
// fit. The internal canvas is always full-resolution; only the CSS size changes.
const MAX_CSS_WIDTH = 1400;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("c");
const presetSel = $<HTMLSelectElement>("preset");
const playBtn = $<HTMLButtonElement>("play");
const restartBtn = $<HTMLButtonElement>("restart");
const speedsBar = $<HTMLDivElement>("speeds");
const tickEl = $<HTMLSpanElement>("tick");
const blurbEl = $<HTMLParagraphElement>("blurb");
const errEl = $<HTMLDivElement>("err");
const verdictEl = $<HTMLParagraphElement>("verdict");
const smokeListEl = $<HTMLUListElement>("smoke-list");

// The flat, playable list: smoke tests first, then the splitter scenarios, then
// portions of the held-out scored `bus` factories. A smoke test's position here
// equals its index in SMOKE, which the results panel relies on, so the smoke group
// must stay first.
interface Playable {
  group: string;
  name: string;
  blurb: string;
  scenario: unknown;
}
const PLAYABLES: Playable[] = [
  ...SMOKE.map((t) => ({
    group: "Smoke tests",
    name: t.name,
    blurb: t.blurb,
    scenario: t.scenario,
  })),
  ...PRESETS.map((p) => ({
    group: "Splitter scenarios",
    name: p.name,
    blurb: p.blurb,
    scenario: p.scenario,
  })),
  ...SCORED_PORTIONS.map((p) => ({
    group: "Scored scenarios (portions)",
    name: p.name,
    blurb: p.blurb,
    scenario: p.scenario,
  })),
];

// Populate the selector, grouping playables under their group heading.
{
  let group: string | null = null;
  let target: HTMLElement = presetSel;
  PLAYABLES.forEach((p, i) => {
    if (p.group !== group) {
      group = p.group;
      const og = document.createElement("optgroup");
      og.label = group;
      presetSel.append(og);
      target = og;
    }
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = p.name;
    target.append(opt);
  });
}

let speed = 1;
const speedButtons = SPEEDS.map((s) => {
  const b = document.createElement("button");
  b.textContent = `${s}x`;
  b.className = s === speed ? "on" : "";
  b.onclick = () => {
    speed = s;
    speedButtons.forEach(
      (btn, i) => (btn.className = SPEEDS[i] === speed ? "on" : ""),
    );
  };
  speedsBar.append(b);
  return b;
});

// Playback state (mirrors PlaybackOverlay's refs).
let sheet: Sheet | null = null;
let wasmBytes: ArrayBuffer | null = null;
let engine: Engine | null = null;
let renderer: Renderer | null = null;
let board: Board | null = null;
let prev: Snapshot | null = null;
let next: Snapshot | null = null;
let pos = 0;
let playing = true;

function setPlaying(on: boolean) {
  playing = on;
  playBtn.textContent = on ? "Pause" : "Play";
}

// Load the wasm bytes + sprite sheet once, then reuse them.
async function ensureAssets(): Promise<void> {
  if (sheet && wasmBytes) return;
  const [wasm, sheetBlob] = await Promise.all([
    fetch(latticeCoreWasmUrl).then((r) => r.arrayBuffer()),
    fetch(sheetPngUrl).then((r) => r.blob()),
  ]);
  sheet = await loadSheet(sheetBlob, atlas as unknown as Atlas);
  wasmBytes = wasm;
}

// Advance the engine by `count` ticks, decoding only the tick about to be drawn.
function advance(count: number): boolean {
  if (!engine) return false;
  let skipped = false;
  for (let i = 0; i < count; i++) {
    if (i < count - 1) {
      if (!engine.stepSkip()) return false;
      skipped = true;
      continue;
    }
    const snap = engine.step();
    if (!snap) return false;
    prev = skipped ? null : next;
    next = snap;
  }
  return true;
}

async function load(index: number) {
  errEl.textContent = "";
  const playable = PLAYABLES[index]!;
  blurbEl.textContent = playable.blurb;
  presetSel.value = String(index);
  try {
    await ensureAssets();
    engine = await Engine.instantiate(wasmBytes!);
    if (!engine.load(playable.scenario))
      throw new Error("the engine rejected this scenario");
    board = engine.board();

    const ctx = canvas.getContext("2d")!;
    renderer = new Renderer(ctx, sheet!);
    const size = renderer.size(board);
    canvas.width = size.width;
    canvas.height = size.height;
    // Fit-to-width: full SCALE for small scenarios, scaled down for a wide factory.
    const displayScale = Math.min(SCALE, MAX_CSS_WIDTH / size.width);
    canvas.style.width = `${size.width * displayScale}px`;
    canvas.style.height = `${size.height * displayScale}px`;

    prev = null;
    next = engine.step();
    pos = 0;
    setPlaying(true);
  } catch (err) {
    errEl.textContent = `Could not play: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Run every smoke test headlessly to a pass/fail, render the results + gating verdict,
// and let each row be clicked to play that scenario. This is the same gate a real test
// case would apply: all green → run the stress scenarios; any red → skip them.
async function runSmokeChecks() {
  await ensureAssets();
  let passed = 0;
  SMOKE.forEach((t) => {
    const li = document.createElement("li");
    const badge = document.createElement("span");
    badge.className = "badge pending";
    badge.textContent = "…";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = t.name;
    li.append(badge, nm);
    smokeListEl.append(li);
  });

  const rows = Array.from(smokeListEl.children) as HTMLLIElement[];
  for (let i = 0; i < SMOKE.length; i++) {
    const t = SMOKE[i]!;
    const eng = await Engine.instantiate(wasmBytes!);
    let result = { pass: false, detail: "engine rejected the scenario" };
    if (eng.load(t.scenario)) {
      const b = eng.board();
      let last: Snapshot | null = null;
      for (let step = 0; step < t.ticks; step++) {
        const snap = eng.step();
        if (!snap) break;
        last = snap;
      }
      const check = SMOKE_CHECKS[t.id];
      if (last && check) result = check(b, last);
      else if (!check) result = { pass: false, detail: "no check defined" };
      else result = { pass: false, detail: "engine produced no snapshot" };
    }
    if (result.pass) passed++;

    const li = rows[i]!;
    li.className = "selectable";
    li.onclick = () => void load(i); // smoke test i sits at flat index i
    const badge = li.querySelector(".badge")!;
    badge.className = `badge ${result.pass ? "pass" : "fail"}`;
    badge.textContent = result.pass ? "PASS" : "FAIL";
    const dt = document.createElement("span");
    dt.className = "dt";
    dt.textContent = `— ${result.detail}`;
    li.append(dt);
  }

  const allPass = passed === SMOKE.length;
  verdictEl.className = `verdict ${allPass ? "pass" : "fail"}`;
  verdictEl.textContent = allPass
    ? `${passed}/${SMOKE.length} passed — stress scenarios would run.`
    : `${passed}/${SMOKE.length} passed — stress scenarios would be SKIPPED to save time.`;
}

// The animation clock.
let last = performance.now();
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (playing && engine && renderer && board) {
    pos += dt * BASE_TICKS_PER_SECOND * speed;
    const whole = Math.floor(pos);
    if (whole >= 1) {
      pos -= whole;
      if (!advance(whole)) setPlaying(false);
    }
    if (next) {
      const alpha = speed >= DRAW_EVERY_TICK_BELOW ? 1 : pos;
      renderer.draw(board, prev, next, alpha, now / 1000);
      tickEl.textContent = `tick ${next.tick.toLocaleString()} / ${board.ticks.toLocaleString()}`;
    }
  }
  requestAnimationFrame(frame);
}

playBtn.onclick = () => setPlaying(!playing);
restartBtn.onclick = () => {
  if (!engine) return;
  engine.reset();
  prev = null;
  next = engine.step();
  pos = 0;
  setPlaying(true);
};
presetSel.onchange = () => void load(Number(presetSel.value));

// Boot: run the smoke gate, then start the first scenario playing.
void (async () => {
  await runSmokeChecks();
  await load(0);
})();
requestAnimationFrame(frame);

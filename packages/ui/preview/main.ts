// A tiny standalone player for the Lattice renderer — no backend, no run record.
// It instantiates the SAME vendored engine (lattice-core.wasm) and sprite sheet the
// app bundles, loads a crafted scenario, and steps + draws it exactly the way
// LatticePlaybackSection's PlaybackOverlay does. Purely a local dev preview for
// eyeballing renderer/engine changes.

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

// Mirror the app's playback constants.
const BASE_TICKS_PER_SECOND = 20;
const DRAW_EVERY_TICK_BELOW = 4;
const SPEEDS = [0.5, 1, 2, 4] as const;
const SCALE = 3; // upscale the small factory so it's easy to watch (pixel-crisp)

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("c");
const presetSel = $<HTMLSelectElement>("preset");
const playBtn = $<HTMLButtonElement>("play");
const restartBtn = $<HTMLButtonElement>("restart");
const speedsBar = $<HTMLDivElement>("speeds");
const tickEl = $<HTMLSpanElement>("tick");
const blurbEl = $<HTMLParagraphElement>("blurb");
const errEl = $<HTMLDivElement>("err");

// Populate the preset selector and speed buttons.
PRESETS.forEach((p, i) => {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = p.name;
  presetSel.append(opt);
});

let speed = 1;
const speedButtons = SPEEDS.map((s) => {
  const b = document.createElement("button");
  b.textContent = `${s}x`;
  b.className = s === speed ? "on" : "";
  b.onclick = () => {
    speed = s;
    speedButtons.forEach((btn, i) => (btn.className = SPEEDS[i] === speed ? "on" : ""));
  };
  speedsBar.append(b);
  return b;
});

// Playback state (mirrors PlaybackOverlay's refs).
let sheet: Sheet | null = null;
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
  const preset = PRESETS[index]!;
  blurbEl.textContent = preset.blurb;
  try {
    if (!sheet) {
      const [wasm, sheetBlob] = await Promise.all([
        fetch(latticeCoreWasmUrl).then((r) => r.arrayBuffer()),
        fetch(sheetPngUrl).then((r) => r.blob()),
      ]);
      sheet = await loadSheet(sheetBlob, atlas as unknown as Atlas);
      // Stash the wasm bytes so re-selecting a preset re-instantiates cheaply.
      (globalThis as { __wasm?: ArrayBuffer }).__wasm = wasm;
    }
    const wasm = (globalThis as { __wasm?: ArrayBuffer }).__wasm!;
    engine = await Engine.instantiate(wasm);
    if (!engine.load(preset.scenario)) throw new Error("the engine rejected this scenario");
    board = engine.board();

    const ctx = canvas.getContext("2d")!;
    renderer = new Renderer(ctx, sheet);
    const size = renderer.size(board);
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.style.width = `${size.width * SCALE}px`;
    canvas.style.height = `${size.height * SCALE}px`;

    prev = null;
    next = engine.step();
    pos = 0;
    setPlaying(true);
  } catch (err) {
    errEl.textContent = `Could not play: ${err instanceof Error ? err.message : String(err)}`;
  }
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

void load(0);
requestAnimationFrame(frame);

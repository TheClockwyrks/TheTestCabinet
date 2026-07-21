// The Foray browser replay renderer.
//
// This module holds NO game rules. It loads `foray-core` compiled to wasm
// (the SAME authoritative engine the CLI ran), feeds it the replay's seed +
// per-tick log via the hand-rolled C ABI (alloc / replay_load / replay_board /
// replay_step / replay_reset — no wasm-bindgen), steps the engine forward exactly
// as the CLI did, and draws the reconstructed match to a <canvas> using the
// committed sprite sheet.
//
// It does NOT draw one tick per displayed frame: ticks are the simulation's
// discrete steps, but agents are drawn at INTERPOLATED positions between the two
// nearest reconstructed ticks, with a walk-cycle animation, so motion reads
// smoothly instead of teleporting cell to cell. The board (walls, border seam,
// nests) is pac-man-style AUTOTILED from the static wall set. See:
//   architecture.md  -> "Browser playback"
//   assets.md        -> sheet/atlas/palette format & required frames
//
// The wasm exports return an i64 packed as (ptr << 32) | len pointing into the
// guest's linear memory; we read the JSON back out of that memory.

// --- ABI helpers -----------------------------------------------------------

// Unpack the i64 return into { ptr, len }. The high 32 bits are the pointer, the
// low 32 the length. BigInt because a JS number cannot hold the full i64.
function unpack(packed) {
  const v = BigInt.asUintN(64, packed);
  return { ptr: Number(v >> 32n), len: Number(v & 0xffffffffn) };
}

function readJson(memory, ptr, len) {
  if (len === 0) return null;
  const bytes = new Uint8Array(memory.buffer, ptr, len);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Wrap an instantiated foray-core for replay playback.
export class Engine {
  constructor(instance) {
    this.x = instance.exports;
    this.memory = this.x.memory;
  }

  static async instantiate(wasmUrl) {
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new Engine(instance);
  }

  // Load a replay (a JS object) into the guest. Returns true on success.
  load(replay) {
    const json = new TextEncoder().encode(JSON.stringify(replay));
    const ptr = this.x.alloc(json.length);
    new Uint8Array(this.memory.buffer, ptr, json.length).set(json);
    return this.x.replay_load(ptr, json.length) === 1;
  }

  // The static board (walls, dims, border, nests, jelly nodes), drawn once.
  board() {
    const { ptr, len } = unpack(this.x.replay_board());
    return readJson(this.memory, ptr, len);
  }

  // Advance one frame; returns the snapshot JSON, or null when the match is over.
  step() {
    const { ptr, len } = unpack(this.x.replay_step());
    if (len === 0) return null;
    return readJson(this.memory, ptr, len);
  }

  reset() {
    this.x.replay_reset();
  }
}

// --- Sprite sheet & per-team recolour --------------------------------------

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

// Load the sheet PNG into a canvas, plus its atlas + palette. We bake one tinted
// copy per team by remapping the agent ramp's neutral greys (body_dark/mid/light/
// accent) to that team's ramp from palette.json — the "palette swap" assets.md
// describes, done once at load instead of per draw. The sheet is plain RGBA; the
// swap matches by colour value, so it does not depend on an indexed palette.
export async function loadSheet(sheetUrl, atlas, palette) {
  const img = await fetch(sheetUrl)
    .then((r) => r.blob())
    .then((b) => createImageBitmap(b));

  const base = document.createElement("canvas");
  base.width = img.width;
  base.height = img.height;
  const bctx = base.getContext("2d");
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(img, 0, 0);
  const baseData = bctx.getImageData(0, 0, img.width, img.height);

  // The neutral base ramp the packer bakes into the sheet (see gen-sheet.mjs:
  // body_dark #3a3a3a, body_mid #6a6a6a, body_light #9a9a9a, accent #cccccc).
  const NEUTRAL = {
    body_dark: hex("#3a3a3a"),
    body_mid: hex("#6a6a6a"),
    body_light: hex("#9a9a9a"),
    accent: hex("#cccccc"),
  };

  const tint = (teamName) => {
    const ramp = palette.teams[teamName];
    const map = new Map();
    for (const slot of ["body_dark", "body_mid", "body_light", "accent"]) {
      map.set(NEUTRAL[slot].join(","), hex(ramp[slot]));
    }
    const out = new ImageData(
      new Uint8ClampedArray(baseData.data),
      img.width,
      img.height,
    );
    const d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const key = `${d[i]},${d[i + 1]},${d[i + 2]}`;
      const repl = map.get(key);
      if (repl) {
        d[i] = repl[0];
        d[i + 1] = repl[1];
        d[i + 2] = repl[2];
      }
    }
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d").putImageData(out, 0, 0);
    return c;
  };

  return { atlas, palette, neutral: base, red: tint("red"), blue: tint("blue") };
}

// --- Drawing ---------------------------------------------------------------

const CELL = 16;

// The immune (royal-jelly) aura: a breathing additive glow in the shared jelly
// colour (palette.json `shared.jelly`, #7be0a0), drawn procedurally over any
// agent with `immune_ticks > 0`. It is NOT a sheet frame — drawing it in code
// lets it pulse over the continuous tick clock, so it reads as "alive" and is
// identical on playback and on a paused scrub (the clock is tick+frac, not wall
// time). IMMUNE_PULSE_RATE is radians per tick (~7-tick breath at 8 ticks/s).
const IMMUNE_RGB = "123, 224, 160";
const IMMUNE_PULSE_RATE = 0.9;

// Pick a facing for an agent from its (dx,dy). Decorative only (rules are
// direction-agnostic); falls back to the caller's previous facing when stationary.
function facing(dx, dy, prev) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "e" : "w";
  if (dy !== 0) return dy > 0 ? "s" : "n";
  return prev || "s";
}

const lerp = (a, b, t) => a + (b - a) * t;

export class Renderer {
  constructor(canvas, sheet, board, scale = 2) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.sheet = sheet;
    this.atlas = sheet.atlas;
    this.board = board;
    this.scale = scale;
    this.cellPx = CELL * scale;
    this.prev = new Map(); // agent "team:id" -> last facing, for stationary frames
    canvas.width = board.width * this.cellPx;
    canvas.height = board.height * this.cellPx;

    this.wallSet = new Set(board.walls.map(([x, y]) => `${x},${y}`));
    this.jellyNodes = board.jelly_nodes || [];

    // The board (floor, autotiled walls, border seam, team nests) is static for
    // the whole match, so render it once to an offscreen canvas and blit it each
    // frame; only seeds, jelly and agents are redrawn per frame.
    this.boardCanvas = this.#renderBoard();
  }

  #isWall(x, y) {
    // Out-of-bounds reads as wall so the perimeter ring connects to itself
    // instead of growing a cap that faces off the board.
    if (x < 0 || y < 0 || x >= this.board.width || y >= this.board.height) return true;
    return this.wallSet.has(`${x},${y}`);
  }

  // The 4-neighbor autotile bitmask for a wall cell: N=1, E=2, S=4, W=8.
  #wallMask(x, y) {
    return (
      (this.#isWall(x, y - 1) ? 1 : 0) |
      (this.#isWall(x + 1, y) ? 2 : 0) |
      (this.#isWall(x, y + 1) ? 4 : 0) |
      (this.#isWall(x - 1, y) ? 8 : 0)
    );
  }

  #isBorderFloor(x, y) {
    const b = this.board;
    if (x !== b.border_x - 1 && x !== b.border_x) return false;
    if (y < 0 || y >= b.height) return false;
    return !this.wallSet.has(`${x},${y}`);
  }

  #renderBoard() {
    const b = this.board;
    const c = document.createElement("canvas");
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const prevCtx = this.ctx;
    this.ctx = c.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < b.height; y++) {
      for (let x = 0; x < b.width; x++) {
        if (this.wallSet.has(`${x},${y}`)) {
          this.#blitCell(this.sheet.neutral, this.atlas.wall_tiles[this.#wallMask(x, y)], x, y);
        } else if (this.#isBorderFloor(x, y)) {
          const top = this.#isBorderFloor(x, y - 1);
          const bot = this.#isBorderFloor(x, y + 1);
          const tiles = this.atlas.border_tiles;
          const name = !top ? tiles.cap_top : !bot ? tiles.cap_bottom : tiles.mid;
          this.#blitCell(this.sheet.neutral, name, x, y);
        } else {
          this.#blitCell(this.sheet.neutral, "floor", x, y);
        }
      }
    }
    // Team nests, tinted, are part of the static board.
    this.#blitCell(this.sheet.red, "nest", b.red_nest[0], b.red_nest[1]);
    this.#blitCell(this.sheet.blue, "nest", b.blue_nest[0], b.blue_nest[1]);

    this.ctx = prevCtx;
    return c;
  }

  // Blit a named frame at a pixel position (already scaled).
  #blitPx(sheetCanvas, frameName, px, py) {
    const f = this.atlas.frames[frameName];
    if (!f) return;
    const s = this.cellPx;
    this.ctx.drawImage(sheetCanvas, f.x, f.y, f.w, f.h, px, py, s, s);
  }

  // Blit a named frame at a cell coordinate.
  #blitCell(sheetCanvas, frameName, cx, cy) {
    this.#blitPx(sheetCanvas, frameName, cx * this.cellPx, cy * this.cellPx);
  }

  // Resolve the frame for a walking/standing agent. `phase` 0..1 is the progress
  // across the current cell; a moving agent cycles its walk anim by phase, a
  // stationary one shows the rest pose (frame 0).
  #agentFrame(role, laden, face, moving, phase) {
    const key = role === "soldier" ? `soldier_walk_${face}` : laden ? `raider_laden_walk_${face}` : `raider_walk_${face}`;
    const anim = this.atlas.anims && this.atlas.anims[key];
    if (!anim || !anim.frames.length) {
      // Fallback if walk anims are absent: a single static frame name.
      return role === "soldier" ? `soldier_${face}_0` : laden ? `raider_laden_${face}_0` : `raider_${face}_0`;
    }
    const idx = moving ? Math.floor(phase * anim.frames.length) % anim.frames.length : 0;
    return anim.frames[idx];
  }

  // Draw one displayed frame: the static board, then the dynamic fixtures and the
  // agents interpolated between snapshot `a` (tick i) and `b` (tick i+1) by `frac`.
  // `b` may equal `a` at the final tick (frac is then 0).
  draw(a, b, frac = 0) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.boardCanvas, 0, 0);

    // Spent jelly: a static node no longer in the active list. Active jelly and
    // seeds come straight from the current tick (they pop in/out, not move).
    const activeJelly = new Set(a.jelly.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of this.jellyNodes) {
      if (!activeJelly.has(`${x},${y}`)) this.#blitCell(this.sheet.neutral, "jelly_spent", x, y);
    }
    for (const [x, y] of a.jelly) this.#blitCell(this.sheet.neutral, "jelly_active", x, y);
    for (const [x, y] of a.seeds) this.#blitCell(this.sheet.neutral, "seed", x, y);
    // Large seeds last, so they sit on top of an ordinary seed if one is ever laid on
    // the same tile by a scattered load. They MOVE (drifting a tile at a time toward
    // the border) but they are not interpolated: a drift step is a discrete hop every
    // few hundred ticks, not a walk, so sliding it would read as a bug rather than
    // motion. They simply pop to the new tile, like a seed appearing.
    for (const [x, y] of a.large_seeds ?? []) {
      this.#blitCell(this.sheet.neutral, "large_seed", x, y);
    }

    // Agents, interpolated and tinted by team. Match this tick's agent to the
    // next tick's by team:id; lerp the position, animate the walk by cell
    // progress. A respawn after a tag teleports across the board — detected as a
    // manhattan jump > 1 — so snap to the current cell instead of sliding.
    const nextById = new Map();
    if (b && b !== a) for (const n of b.agents) nextById.set(`${n.team}:${n.id}`, n);

    for (const ag of a.agents) {
      const id = `${ag.team}:${ag.id}`;
      const nxt = nextById.get(id);
      const teleport = nxt && Math.abs(nxt.x - ag.x) + Math.abs(nxt.y - ag.y) > 1;
      const moving = !!nxt && !teleport && (nxt.x !== ag.x || nxt.y !== ag.y);

      const px = (teleport || !nxt ? ag.x : lerp(ag.x, nxt.x, frac)) * this.cellPx;
      const py = (teleport || !nxt ? ag.y : lerp(ag.y, nxt.y, frac)) * this.cellPx;

      const face = moving ? facing(nxt.x - ag.x, nxt.y - ag.y, this.prev.get(id)) : this.prev.get(id) || "s";
      if (moving) this.prev.set(id, face);

      const laden = ag.carrying > 0;
      const frame = this.#agentFrame(ag.role, laden, face, moving, frac);
      const tinted = ag.team === "red" ? this.sheet.red : this.sheet.blue;
      this.#blitPx(tinted, frame, px, py);

      // Immune (royal jelly active) — a breathing additive aura, drawn after the
      // agent so it haloes it. Pulsed by the continuous tick clock.
      if (ag.immune_ticks > 0) this.#drawImmuneAura(px, py, a.tick + frac);
    }
  }

  // A soft additive cyan halo over an immune agent, breathing by `clock`
  // (tick+frac). Biased to a ring so it haloes the sprite rather than washing it.
  #drawImmuneAura(px, py, clock) {
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(clock * IMMUNE_PULSE_RATE); // 0..1
    const mx = px + this.cellPx / 2;
    const my = py + this.cellPx / 2;
    const r = this.cellPx * (0.5 + 0.18 * pulse);
    const a = 0.15 + 0.3 * pulse;
    const grad = ctx.createRadialGradient(mx, my, this.cellPx * 0.18, mx, my, r);
    grad.addColorStop(0, `rgba(${IMMUNE_RGB}, ${a * 0.5})`);
    grad.addColorStop(0.55, `rgba(${IMMUNE_RGB}, ${a})`);
    grad.addColorStop(1, `rgba(${IMMUNE_RGB}, 0)`);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = grad;
    ctx.fillRect(px - this.cellPx * 0.25, py - this.cellPx * 0.25, this.cellPx * 1.5, this.cellPx * 1.5);
    ctx.restore();
  }

  // Clear remembered facings when playback jumps (a scrub) so a discontinuity
  // doesn't carry a stale direction across it.
  resetFacing() {
    this.prev.clear();
  }
}

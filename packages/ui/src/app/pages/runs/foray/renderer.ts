// The Foray browser replay renderer, vendored into the UI library from the
// case's replay bundle (`test-cases/adversarial-pacman/v1.0.0/replay/renderer.mjs`).
//
// This module holds NO game rules. It loads `foray-core` compiled to wasm (the
// SAME authoritative engine the CLI ran) through the hand-rolled C ABI
// (alloc / replay_load / replay_board / replay_step / replay_reset — no
// wasm-bindgen), steps the engine forward exactly as the CLI did, and draws each
// reconstructed tick to a <canvas> using the committed sprite sheet. See:
//   testing/adversarial/adversarial-pacman/architecture.md -> "Browser playback"
//   testing/adversarial/adversarial-pacman/assets.md        -> sheet/atlas/palette format
//
// The renderer + sprite assets ship with the UI/site bundle (one set, not per
// run); only the run-specific `replay.json` is fetched per run. Kept as a 1:1 TS
// port of the bundle's `renderer.mjs` so the UI and the public site draw a match
// identically — when the case's renderer changes, re-vendor it here.

// --- ABI helpers -----------------------------------------------------------

/** A point on the board (a `[x, y]` tile coordinate). */
export type Point = [number, number];

/** A single named sprite-sheet frame's pixel rectangle. */
export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The atlas (`sheet.json`): the cell size and named frame rectangles. */
export interface Atlas {
  cell: number;
  frames: Record<string, AtlasFrame>;
}

/** A per-team colour ramp (slot name -> `#rrggbb`). */
export type TeamRamp = Record<string, string>;

/** The palette (`palette.json`): named slots, shared ramp, and per-team ramps. */
export interface Palette {
  slots: string[];
  shared: Record<string, string>;
  teams: Record<string, TeamRamp>;
}

/** The static board the engine reports once via `replay_board`. */
export interface Board {
  width: number;
  height: number;
  border_x: number;
  walls: Point[];
  jelly_nodes?: Point[];
  red_nest: Point;
  blue_nest: Point;
}

/** A single reconstructed agent in a per-tick snapshot. */
export interface SnapshotAgent {
  team: "red" | "blue";
  id: number;
  x: number;
  y: number;
  role: "soldier" | "raider";
  carrying: number;
  immune_ticks: number;
}

/** The decided result, present on the final snapshot. */
export interface SnapshotResult {
  winner: "red" | "blue" | null;
  ended: string;
  score: { red: number; blue: number };
  ticks: number;
}

/** A single reconstructed tick the renderer draws. */
export interface Snapshot {
  tick: number;
  score: { red: number; blue: number };
  agents: SnapshotAgent[];
  seeds: Point[];
  jelly: Point[];
  result?: SnapshotResult;
}

// The foray-core wasm exports (the hand-rolled C ABI; no wasm-bindgen).
interface ForayExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  replay_load(ptr: number, len: number): number;
  replay_board(): bigint;
  replay_step(): bigint;
  replay_reset(): void;
}

// Unpack the i64 return into { ptr, len }. The high 32 bits are the pointer, the
// low 32 the length. BigInt because a JS number cannot hold the full i64.
function unpack(packed: bigint): { ptr: number; len: number } {
  const v = BigInt.asUintN(64, packed);
  return { ptr: Number(v >> 32n), len: Number(v & 0xffffffffn) };
}

function readJson(memory: WebAssembly.Memory, ptr: number, len: number): unknown {
  if (len === 0) return null;
  const bytes = new Uint8Array(memory.buffer, ptr, len);
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Wrap an instantiated foray-core for replay playback. */
export class Engine {
  private readonly x: ForayExports;
  private readonly memory: WebAssembly.Memory;

  private constructor(instance: WebAssembly.Instance) {
    this.x = instance.exports as unknown as ForayExports;
    this.memory = this.x.memory;
  }

  /** Instantiate foray-core from its wasm bytes (already fetched). */
  static async instantiate(wasm: BufferSource): Promise<Engine> {
    const { instance } = await WebAssembly.instantiate(wasm, {});
    return new Engine(instance);
  }

  /** Load a replay (a parsed JSON object) into the guest. True on success. */
  load(replay: unknown): boolean {
    const json = new TextEncoder().encode(JSON.stringify(replay));
    const ptr = this.x.alloc(json.length);
    new Uint8Array(this.memory.buffer, ptr, json.length).set(json);
    return this.x.replay_load(ptr, json.length) === 1;
  }

  /** The static board (walls, dims, border, nests, jelly nodes), drawn once. */
  board(): Board {
    const { ptr, len } = unpack(this.x.replay_board());
    return readJson(this.memory, ptr, len) as Board;
  }

  /** Advance one frame; the snapshot JSON, or null when the match is over. */
  step(): Snapshot | null {
    const { ptr, len } = unpack(this.x.replay_step());
    if (len === 0) return null;
    return readJson(this.memory, ptr, len) as Snapshot;
  }

  reset(): void {
    this.x.replay_reset();
  }
}

// --- Sprite sheet & per-team recolour --------------------------------------

const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/** A loaded, per-team pre-tinted sprite sheet ready to blit from. */
export interface Sheet {
  atlas: Atlas;
  palette: Palette;
  neutral: HTMLCanvasElement;
  red: HTMLCanvasElement;
  blue: HTMLCanvasElement;
}

// Load the sheet PNG into a canvas, plus its atlas + palette. We bake one tinted
// copy per team by remapping the agent ramp's neutral greys (the indices the
// generator reserved: body_dark/mid/light/accent) to that team's ramp from
// palette.json — exactly the "palette swap" assets.md describes, done once at
// load instead of per draw. `sheetBlob` is the already-fetched PNG bytes.
export async function loadSheet(
  sheetBlob: Blob,
  atlas: Atlas,
  palette: Palette,
): Promise<Sheet> {
  const img = await createImageBitmap(sheetBlob);

  const base = document.createElement("canvas");
  base.width = img.width;
  base.height = img.height;
  const bctx = base.getContext("2d")!;
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(img, 0, 0);
  const baseData = bctx.getImageData(0, 0, img.width, img.height);

  // The neutral base ramp the generator baked into the PNG (see the bundle's
  // gen-sheet.mjs: body_dark #3a3a3a, body_mid #6a6a6a, body_light #9a9a9a,
  // accent #cccccc).
  const NEUTRAL: Record<string, [number, number, number]> = {
    body_dark: hex("#3a3a3a"),
    body_mid: hex("#6a6a6a"),
    body_light: hex("#9a9a9a"),
    accent: hex("#cccccc"),
  };

  const tint = (teamName: string): HTMLCanvasElement => {
    const ramp = palette.teams[teamName]!;
    const map = new Map<string, [number, number, number]>();
    for (const slot of ["body_dark", "body_mid", "body_light", "accent"]) {
      map.set(NEUTRAL[slot]!.join(","), hex(ramp[slot]!));
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
    c.getContext("2d")!.putImageData(out, 0, 0);
    return c;
  };

  return { atlas, palette, neutral: base, red: tint("red"), blue: tint("blue") };
}

// --- Drawing ---------------------------------------------------------------

const CELL = 16;

// Pick a facing for an agent from its (dx,dy) since the last frame. Decorative
// only (rules are direction-agnostic); defaults to "s" when stationary.
function facing(dx: number, dy: number): "n" | "s" | "e" | "w" {
  if (dx > 0) return "e";
  if (dx < 0) return "w";
  if (dy > 0) return "s";
  if (dy < 0) return "n";
  return "s";
}

/** Draws reconstructed snapshots to a canvas using the sprite sheet. */
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sheet: Sheet;
  private readonly board: Board;
  private readonly scale: number;
  private readonly prev = new Map<string, { x: number; y: number }>();
  private readonly wallSet: Set<string>;
  private readonly jellyNodes: Point[];

  constructor(canvas: HTMLCanvasElement, sheet: Sheet, board: Board, scale = 2) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.sheet = sheet;
    this.board = board;
    this.scale = scale;
    canvas.width = board.width * CELL * scale;
    canvas.height = board.height * CELL * scale;

    // Precompute fast lookups for the static board.
    this.wallSet = new Set(board.walls.map(([x, y]) => `${x},${y}`));
    this.jellyNodes = board.jelly_nodes || [];
  }

  private blit(
    sheetCanvas: HTMLCanvasElement,
    frameName: string,
    tx: number,
    ty: number,
  ): void {
    const f = this.sheet.atlas.frames[frameName];
    if (!f) return;
    const s = CELL * this.scale;
    this.ctx.drawImage(sheetCanvas, f.x, f.y, f.w, f.h, tx * s, ty * s, s, s);
  }

  /** Draw a full frame: tiles, fixtures, then agents. */
  draw(snapshot: Snapshot): void {
    const b = this.board;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Tiles: floor / wall / border. Border is the single column at border_x; the
    // contested strip is the two adjacent columns (border_x-1 .. border_x), but a
    // single no-man's-land seam reads fine for the dummy.
    for (let y = 0; y < b.height; y++) {
      for (let x = 0; x < b.width; x++) {
        if (this.wallSet.has(`${x},${y}`)) this.blit(this.sheet.neutral, "wall", x, y);
        else if (x === b.border_x - 1 || x === b.border_x)
          this.blit(this.sheet.neutral, "border", x, y);
        else this.blit(this.sheet.neutral, "floor", x, y);
      }
    }

    // Nests (tinted per team).
    this.blit(this.sheet.red, "nest", b.red_nest[0], b.red_nest[1]);
    this.blit(this.sheet.blue, "nest", b.blue_nest[0], b.blue_nest[1]);

    // Spent jelly: a node from the static set that is no longer in the active list.
    const activeJelly = new Set(snapshot.jelly.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of this.jellyNodes) {
      if (!activeJelly.has(`${x},${y}`)) this.blit(this.sheet.neutral, "jelly_spent", x, y);
    }
    // Active jelly (shared, not tinted).
    for (const [x, y] of snapshot.jelly) this.blit(this.sheet.neutral, "jelly_active", x, y);

    // Seeds (shared gold, not tinted).
    for (const [x, y] of snapshot.seeds) this.blit(this.sheet.neutral, "seed", x, y);

    // Agents on top, tinted by team. role is "soldier" | "raider"; a laden raider
    // (carrying > 0) uses the heavy frame — the carry-weight tell.
    for (const a of snapshot.agents) {
      const key = `${a.team}:${a.id}`;
      const prev = this.prev.get(key) || { x: a.x, y: a.y };
      const face = facing(a.x - prev.x, a.y - prev.y);
      this.prev.set(key, { x: a.x, y: a.y });

      let frame: string;
      if (a.role === "soldier") frame = `soldier_${face}`;
      else if (a.carrying > 0) frame = `raider_laden_${face}`;
      else frame = `raider_${face}`;

      const tinted = a.team === "red" ? this.sheet.red : this.sheet.blue;
      this.blit(tinted, frame, a.x, a.y);

      // Immune overlay (jelly active) — additive glint over the agent.
      if (a.immune_ticks > 0) {
        ctx.globalCompositeOperation = "lighter";
        this.blit(this.sheet.neutral, "immune_glint", a.x, a.y);
        ctx.globalCompositeOperation = "source-over";
      }
    }
  }

  resetFacing(): void {
    this.prev.clear();
  }
}

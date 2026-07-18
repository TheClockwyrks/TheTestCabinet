// The Lattice browser playback renderer.
//
// This module holds NO simulation rules. It loads `lattice-core` compiled to wasm
// — the SAME authoritative engine the CLI and the validator ran — through the
// hand-rolled C ABI (alloc / playback_load / playback_board / playback_step /
// playback_reset; no wasm-bindgen), steps it a tick at a time, and draws the
// reconstructed factory to a <canvas> using the committed sprite sheet. See:
//   testing/performance/lattice/architecture.md -> "Browser visualization"
//
// Because a submission is correct only when it reproduced the engine's snapshot
// checksums bit for bit, re-stepping the engine reconstructs exactly the factory
// the graded run computed — and every step carries its checksum, so playback can
// prove it at a scheduled snapshot tick rather than asking to be believed.
//
// It does NOT draw one tick per displayed frame. Ticks are the simulation's
// discrete steps; items are drawn at INTERPOLATED positions between the two
// nearest reconstructed ticks (see `interpolate.ts`, which is where the subtlety
// lives and is unit-tested). Machine animations run on their own sprite clock.
//
// The renderer and sprite assets ship with the UI bundle (one set, not per run);
// only the run-specific scenario is fetched per run. `renderer.vendor.test.ts`
// byte-checks the vendored engine + atlas against the case bundle so a stale copy
// fails CI instead of silently drawing a factory that never happened.

import {
  type Board,
  type BoardEntity,
  type Dir,
  type DrawItem,
  type Snapshot,
  itemFrame,
  matchItems,
  placeItems,
  tweenItems,
} from "./interpolate";

export type { Board, Snapshot } from "./interpolate";

// --- Atlas -----------------------------------------------------------------

/** One sprite-sheet frame's pixel rectangle. */
export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A placed entity's sprite: its frames, rate, footprint, and facing rules. */
export interface AtlasEntity {
  frames: AtlasFrame[];
  fps: number;
  loop: boolean;
  /** Cells covered in the canonical (east) orientation. */
  cells: [number, number];
  /** Pixel offset from the anchor cell — negative when the art overhangs. */
  offset: [number, number];
  rotatable: boolean;
}

/** The atlas (`sheet.json`). */
export interface Atlas {
  cellSize: number;
  sheet: { width: number; height: number };
  entities: Record<string, AtlasEntity>;
  /** Item icons, indexed by the engine's canonical item order. */
  items: { frames: AtlasFrame[]; ids: string[] };
}

/** A loaded sheet ready to blit from. */
export interface Sheet {
  atlas: Atlas;
  image: CanvasImageSource;
}

/** Decode the already-fetched sheet PNG and pair it with its atlas. */
export async function loadSheet(sheetBlob: Blob, atlas: Atlas): Promise<Sheet> {
  return { atlas, image: await createImageBitmap(sheetBlob) };
}

// --- ABI -------------------------------------------------------------------

// The lattice-core wasm exports (the hand-rolled C ABI; no wasm-bindgen).
interface LatticeExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  playback_load(ptr: number, len: number): number;
  playback_board(): bigint;
  playback_step(): bigint;
  playback_reset(): void;
}

// Unpack the i64 return into { ptr, len }. The high 32 bits are the pointer, the
// low 32 the length. BigInt because a JS number cannot hold the full i64.
function unpack(packed: bigint): { ptr: number; len: number } {
  const v = BigInt.asUintN(64, packed);
  return { ptr: Number(v >> 32n), len: Number(v & 0xffffffffn) };
}

function readJson(memory: WebAssembly.Memory, ptr: number, len: number): unknown {
  if (len === 0) return null;
  // A fresh view each read: the guest can grow its memory, which detaches any
  // buffer we cached.
  const bytes = new Uint8Array(memory.buffer, ptr, len);
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Wrap an instantiated lattice-core for playback. */
export class Engine {
  private readonly x: LatticeExports;
  private readonly memory: WebAssembly.Memory;

  private constructor(instance: WebAssembly.Instance) {
    this.x = instance.exports as unknown as LatticeExports;
    this.memory = this.x.memory;
  }

  /** Instantiate lattice-core from its wasm bytes (already fetched). */
  static async instantiate(wasm: BufferSource): Promise<Engine> {
    const { instance } = await WebAssembly.instantiate(wasm, {});
    return new Engine(instance);
  }

  /** Load a scenario. False if it does not parse or does not validate. */
  load(scenario: unknown): boolean {
    const json = new TextEncoder().encode(JSON.stringify(scenario));
    const ptr = this.x.alloc(json.length);
    new Uint8Array(this.memory.buffer, ptr, json.length).set(json);
    return this.x.playback_load(ptr, json.length) === 1;
  }

  /** The static layout — grid, run length, snapshot schedule, entities. */
  board(): Board {
    const { ptr, len } = unpack(this.x.playback_board());
    return readJson(this.memory, ptr, len) as Board;
  }

  /** Advance one tick; that tick's state, or null once the run is exhausted. */
  step(): Snapshot | null {
    const { ptr, len } = unpack(this.x.playback_step());
    if (len === 0) return null;
    return readJson(this.memory, ptr, len) as Snapshot;
  }

  /** Rewind to tick 0 so playback can loop or re-seek. */
  reset(): void {
    this.x.playback_reset();
  }
}

// --- Drawing ---------------------------------------------------------------

// Sprites are authored in one canonical orientation — flow running east — and the
// renderer turns them for the other three facings.
const TURN: Record<Dir, number> = {
  E: 0,
  S: Math.PI / 2,
  W: Math.PI,
  N: -Math.PI / 2,
};

/** The pixel bounding box of an entity's resolved footprint. */
function footprintBox(entity: BoardEntity, cell: number) {
  const xs = entity.tiles.map((t) => t[0]);
  const ys = entity.tiles.map((t) => t[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    cx: (minX + (maxX - minX) / 2 + 0.5) * cell,
    cy: (minY + (maxY - minY) / 2 + 0.5) * cell,
  };
}

/** Draws a reconstructed factory. Holds no rules; every value comes from state. */
export class Renderer {
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly sheet: Sheet,
  ) {
    ctx.imageSmoothingEnabled = false;
  }

  /** The pixel size of a board, so a caller can size its canvas. */
  size(board: Board): { width: number; height: number } {
    const cell = this.sheet.atlas.cellSize;
    return {
      width: board.grid.width * cell,
      height: board.grid.height * cell,
    };
  }

  /**
   * Draw one displayed frame: the factory `alpha` of the way from `prev` to
   * `next`, with machine sprites at `elapsed` seconds of their own cycle.
   *
   * `prev` may be null for the very first frame, in which case `next` is drawn as
   *-is rather than tweened from nothing.
   */
  draw(
    board: Board,
    prev: Snapshot | null,
    next: Snapshot,
    alpha: number,
    elapsed: number,
  ): void {
    const cell = this.sheet.atlas.cellSize;
    const { width, height } = this.size(board);
    this.ctx.clearRect(0, 0, width, height);
    this.drawGrid(width, height, cell);

    // Entities first, then items, so an item riding a belt sits on top of it.
    for (const entity of board.entities) {
      this.drawEntity(entity, elapsed, cell);
    }
    this.drawItems(board, prev, next, alpha, cell);
    this.drawHeldItems(board, next, cell);
  }

  private drawGrid(width: number, height: number, cell: number): void {
    // A faint ground grid so an empty factory still reads as a place.
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(255,255,255,0.05)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    for (let x = 0; x <= width; x += cell) {
      this.ctx.moveTo(x + 0.5, 0);
      this.ctx.lineTo(x + 0.5, height);
    }
    for (let y = 0; y <= height; y += cell) {
      this.ctx.moveTo(0, y + 0.5);
      this.ctx.lineTo(width, y + 0.5);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawEntity(entity: BoardEntity, elapsed: number, cell: number): void {
    const sprite = this.sheet.atlas.entities[entity.type];
    if (!sprite || sprite.frames.length === 0) return;

    // Each machine runs its own sprite cycle; this is presentation, independent of
    // the simulation's tick rate.
    const index =
      sprite.loop && sprite.fps > 0
        ? Math.floor(elapsed * sprite.fps) % sprite.frames.length
        : 0;
    const frame = sprite.frames[index]!;
    const { cx, cy } = footprintBox(entity, cell);

    // Drawing the sprite CENTRED on its footprint reproduces the atlas's declared
    // offset without applying it twice: a 64x64 inserter centred on its single
    // 32x32 cell overhangs by exactly the -16,-16 the atlas records, and a 96x96
    // assembler centred on its 3x3 lands flush.
    this.ctx.save();
    this.ctx.translate(cx, cy);
    if (sprite.rotatable) this.ctx.rotate(TURN[entity.dir ?? "E"]);
    this.ctx.drawImage(
      this.sheet.image,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      -frame.w / 2,
      -frame.h / 2,
      frame.w,
      frame.h,
    );
    this.ctx.restore();
  }

  private drawItems(
    board: Board,
    prev: Snapshot | null,
    next: Snapshot,
    alpha: number,
    cell: number,
  ): void {
    const to = placeItems(board, next, cell);
    const drawable: DrawItem[] = prev
      ? tweenItems(matchItems(placeItems(board, prev, cell), to), alpha)
      : to.map((p) => ({ x: p.x, y: p.y, item: p.item }));
    for (const item of drawable) this.drawItem(item.item, item.x, item.y);
  }

  /** An item in an inserter's grip, drawn at the arm's tile. */
  private drawHeldItems(board: Board, snapshot: Snapshot, cell: number): void {
    board.entities.forEach((entity, index) => {
      const state = snapshot.entities[index];
      if (!state || !("inserter" in state)) return;
      const held = state.inserter.held;
      if (!held) return;
      const { cx, cy } = footprintBox(entity, cell);
      this.drawItem(held, cx, cy);
    });
  }

  private drawItem(id: string, x: number, y: number): void {
    const { items } = this.sheet.atlas;
    const index = itemFrame(items.ids, id);
    // An item the sheet has no icon for is skipped rather than drawn as some other
    // item — a wrong icon is worse than a missing one.
    if (index < 0) return;
    const frame = items.frames[index];
    if (!frame) return;
    this.ctx.drawImage(
      this.sheet.image,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      Math.round(x - frame.w / 2),
      Math.round(y - frame.h / 2),
      frame.w,
      frame.h,
    );
  }
}

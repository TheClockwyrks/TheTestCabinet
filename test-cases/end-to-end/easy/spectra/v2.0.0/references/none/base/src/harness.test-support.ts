/// <reference types="vite/client" />
// Spectra — the rig this build's own tests drive the whole game through.
//
// The game is written against the runtime's three small interfaces, so a test
// needs no browser to run it: this module supplies a keyboard whose actions a
// test holds and releases, an audio bus that records what it was asked to play, a
// clock the debug surface can be handed, and a real 2D context from
// `@napi-rs/canvas` for the renderer to draw through.
//
// The SEEDED ART IS REAL here rather than stubbed. It is read off `assets/` with
// `@napi-rs/canvas` and put through the build's own derivation, so a test can
// check the silhouette that reaches `drawImage` and the two band-states derived
// from it — the two things `specs/assets.md` actually fixes.
//
// Scaffolding for `src/**/*.test.ts` alone; nothing the game ships reaches it.

import {
  createCanvas,
  loadImage,
  ImageData as NodeImageData,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";

import { deriveArt, type ArtRasters, type Raster } from "./art";
import {
  BURST_SYSTEM,
  SPRITES,
  SPRITE_SIZE,
  STAGE_H,
  STAGE_W,
  type ActionName,
  type CueName,
} from "./constants";
import type { DebugClock } from "./debug";
import { createSpectra } from "./game";
import type { Game, InitApi, UpdateApi } from "./runtime";
import type { Art, SpectraState, Sprite } from "./types";

/**
 * The four seeded PNGs as data URIs, and the seeded system as a parsed object.
 *
 * Gathered through the bundler's own glob rather than read off the filesystem, so
 * this rig needs no `node:fs` and the same import works wherever the test runner
 * puts it. `@napi-rs/canvas` decodes a `data:` URI directly.
 */
const SPRITE_DATA = import.meta.glob("../assets/*.png", {
  eager: true,
  query: "?inline",
  import: "default",
}) as Record<string, string>;

const SYSTEM_DATA = import.meta.glob("../assets/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

/** One seeded file's contents, by the name `assets/` gives it. */
function spriteData(file: string): string {
  const data = SPRITE_DATA[`../assets/${file}`];
  if (data === undefined) {
    throw new Error(`Spectra: no seeded sprite named ${file}`);
  }
  return data;
}

/** A blank canvas of `size` square, with smoothing off. */
function scratch(size: number): { canvas: Canvas; ctx: SKRSContext2D } {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

/** The four seeded PNGs, decoded onto the seeded sprite square. */
export async function loadSeededRasters(): Promise<Record<string, Raster>> {
  const out: Record<string, Raster> = {};
  for (const [name, file] of Object.entries(SPRITES)) {
    const image = await loadImage(spriteData(file));
    const { ctx } = scratch(SPRITE_SIZE);
    ctx.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    ctx.drawImage(image, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
    out[name] = ctx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE) as Raster;
  }
  return out;
}

/** The seeded burst system, as authored. */
export function seededBurstSystem(): ParticleSystem {
  const system = SYSTEM_DATA[`../assets/${BURST_SYSTEM}`];
  if (system === undefined) {
    throw new Error(`Spectra: the seeded ${BURST_SYSTEM} is missing`);
  }
  return system as ParticleSystem;
}

/** One derived raster as something `drawImage` accepts. */
export function rasterToSprite(raster: Raster): Sprite {
  const { canvas, ctx } = scratch(Math.max(raster.width, raster.height));
  canvas.width = raster.width;
  canvas.height = raster.height;
  ctx.putImageData(
    new NodeImageData(
      new Uint8ClampedArray(raster.data),
      raster.width,
      raster.height,
    ),
    0,
    0,
  );
  return canvas as unknown as Sprite;
}

/** The real seeded art, derived exactly as the build derives it. */
export async function seededArt(): Promise<{ art: Art; rasters: ArtRasters }> {
  const sources = await loadSeededRasters();
  const rasters = deriveArt({
    fighter: sources.fighter as Raster,
    shard: sources.shard as Raster,
    flux: sources.flux as Raster,
    prism: sources.prism as Raster,
  });
  const art: Art = {
    fighter: {
      cyan: rasterToSprite(rasters.fighter.cyan),
      magenta: rasterToSprite(rasters.fighter.magenta),
    },
    shard: {
      cyan: rasterToSprite(rasters.shard.cyan),
      magenta: rasterToSprite(rasters.shard.magenta),
    },
    fluxHeld: {
      cyan: rasterToSprite(rasters.fluxHeld.cyan),
      magenta: rasterToSprite(rasters.fluxHeld.magenta),
    },
    fluxShimmer: rasterToSprite(rasters.fluxShimmer),
    prismFull: {
      cyan: rasterToSprite(rasters.prismFull.cyan),
      magenta: rasterToSprite(rasters.prismFull.magenta),
    },
    prismCore: {
      cyan: rasterToSprite(rasters.prismCore.cyan),
      magenta: rasterToSprite(rasters.prismCore.magenta),
    },
    burst: seededBurstSystem(),
  };
  return { art, rasters };
}

/**
 * Blank sprites over the real seeded burst system.
 *
 * Every draw the renderer makes is exercised by a blank canvas, and building one
 * is far cheaper than decoding four PNGs — so a test that is not about the art
 * itself starts from these.
 */
export function stubArt(): Art {
  const blank = (): Sprite =>
    createCanvas(SPRITE_SIZE, SPRITE_SIZE) as unknown as Sprite;
  const pair = (): Record<"cyan" | "magenta", Sprite> => ({
    cyan: blank(),
    magenta: blank(),
  });
  return {
    fighter: pair(),
    shard: pair(),
    fluxHeld: pair(),
    fluxShimmer: blank(),
    prismFull: pair(),
    prismCore: pair(),
    burst: seededBurstSystem(),
  };
}

/** The whole game, driveable frame by frame with no browser under it. */
export interface Harness {
  readonly state: SpectraState;
  readonly game: Game<SpectraState>;
  /** The clock the debug surface is handed. */
  readonly clock: DebugClock;
  /** Every cue the game asked to play, in order, across the whole run. */
  readonly cues: CueName[];
  /** Every cue the game DECLARED, by name. */
  readonly declared: Set<string>;
  /** Every action the game registered, with the codes bound to it. */
  readonly bound: Map<string, readonly string[]>;
  /** Every diagnostic source the game registered, by name. */
  readonly diagnostics: Map<string, () => unknown>;
  /** Hold an action down, as a key held. */
  hold(action: ActionName): void;
  /** Let an action up. */
  release(action: ActionName): void;
  /** Press and release an action, arming one edge. */
  press(action: ActionName): void;
  /** Run `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;
  /** Draw one frame through a real 2D context. */
  draw(): void;
  /** Whether the bus is muted. */
  muted(): boolean;
  /** The context the renderer draws through. */
  readonly ctx: CanvasRenderingContext2D;
  /** One pixel of the last drawn frame, as `[r, g, b, a]`. */
  read(x: number, y: number): [number, number, number, number];
  /** Every `drawImage` source the last frame handed the context, in order. */
  readonly drawn: DrawnImage[];
  /** Forget the recorded `drawImage` calls. */
  clearDrawn(): void;
  /** Whether the clock the debug surface was handed is still stepping. */
  autoStep(): boolean;
}

/** One recorded `drawImage`: the source, and the destination rectangle. */
export interface DrawnImage {
  source: unknown;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** The whole game over a real context, with the real seeded art. */
export async function harness(): Promise<Harness> {
  const { art } = await seededArt();
  return harnessWith(art);
}

/** The whole game over a real context, with art the caller supplies. */
export function harnessWith(art: Art): Harness {
  const held = new Set<string>();
  const edges = new Set<string>();
  const bound = new Map<string, readonly string[]>();
  const declared = new Set<string>();
  const diagnostics = new Map<string, () => unknown>();
  const cues: CueName[] = [];
  const drawn: DrawnImage[] = [];
  let muted = false;
  let stepping = true;

  const canvas = createCanvas(STAGE_W, STAGE_H);
  const raw = canvas.getContext("2d");
  const ctx = raw as unknown as CanvasRenderingContext2D;
  // The whole frame is read once and cached: a per-pixel `getImageData` over a
  // 1280x720 stage costs more than the drawing it inspects.
  let pixels: Uint8ClampedArray | null = null;

  // Recorded rather than wrapped in a proxy: the renderer is typed against the
  // DOM context, and one patched method is the whole of what a test reads back.
  const realDrawImage = raw.drawImage.bind(raw) as (...args: unknown[]) => void;
  (ctx as unknown as Record<string, unknown>).drawImage = (
    ...args: unknown[]
  ): void => {
    if (args.length >= 5) {
      drawn.push({
        source: args[0],
        dx: args[1] as number,
        dy: args[2] as number,
        dw: args[3] as number,
        dh: args[4] as number,
      });
    }
    realDrawImage(...args);
  };

  const initApi: InitApi = {
    input: { register: (name, keys) => void bound.set(name, keys) },
    audio: { define: (cue) => void declared.add(cue) },
    diagnostics: {
      register: (name, source) => void diagnostics.set(name, source),
    },
  };

  const updateApi: UpdateApi = {
    input: {
      value: (name) => (held.has(name) ? 1 : 0),
      pressed: (name) => {
        if (!edges.has(name)) return false;
        edges.delete(name);
        return true;
      },
    },
    audio: {
      play: (cue) => void cues.push(cue as CueName),
      toggleMuted: () => {
        muted = !muted;
      },
      muted: () => muted,
    },
  };

  const game = createSpectra(art);
  const state = game.initialize(initApi);

  function advance(seconds: number, frames = 1): void {
    const step = seconds / frames;
    for (let i = 0; i < frames; i += 1) {
      game.update(state, updateApi, step);
      // Edges are news for exactly one frame, as they are under the runtime.
      edges.clear();
    }
  }

  return {
    state,
    game,
    cues,
    declared,
    bound,
    diagnostics,
    ctx,
    drawn,
    clock: {
      setAutoStep: (enabled) => {
        stepping = enabled;
      },
      advance,
    },
    hold(action) {
      if (!held.has(action)) edges.add(action);
      held.add(action);
    },
    release(action) {
      held.delete(action);
    },
    press(action) {
      edges.add(action);
    },
    advance,
    draw() {
      pixels = null;
      game.render(state, { ctx });
    },
    muted: () => muted,
    read(x, y) {
      pixels ??= raw.getImageData(0, 0, STAGE_W, STAGE_H).data;
      const column = Math.min(STAGE_W - 1, Math.max(0, Math.round(x)));
      const row = Math.min(STAGE_H - 1, Math.max(0, Math.round(y)));
      const at = (row * STAGE_W + column) * 4;
      return [
        pixels[at] as number,
        pixels[at + 1] as number,
        pixels[at + 2] as number,
        pixels[at + 3] as number,
      ];
    },
    clearDrawn() {
      drawn.length = 0;
    },
    autoStep: () => stepping,
  };
}

/** How far apart two colours read, out of the 441 the RGB cube spans. */
export function rgbDistance(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The alpha silhouette of a raster, as a flat array of booleans. */
export function silhouette(raster: Raster): boolean[] {
  const out: boolean[] = [];
  for (let i = 3; i < raster.data.length; i += 4) {
    out.push((raster.data[i] ?? 0) > 0);
  }
  return out;
}

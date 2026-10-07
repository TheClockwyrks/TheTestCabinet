// Floe — the seven folders of sprite art the project ships.
//
// `specs/assets.md` fixes what each folder holds, how many frames it has, and
// which frame is drawn for which state. The engine's loader resolves every path
// under one root, `assets/`, relative to the page the build is served from, so
// the build asks for `bear/0.png` and never writes a URL of its own
// (engine/assets.md). The level's `load` awaits all of it, and the engine awaits
// `load` before any actor of that level exists, so an actor reads its frame as a
// plain value.
//
// A frame that did not arrive is held as `null` rather than failing the build. A
// host with no image decoding is reported by the engine as a failed load, and a
// game that let that rejection escape would run no frame at all; a body whose
// frame is missing is drawn as a flat block instead (`src/bodies.ts`), so the
// game still plays.
//
// The frame LAYOUTS below — which index is which facing, and which range is
// which set — are facts about the supplied art rather than figures over the
// simulation, which is why they are here and not in `src/constants.ts`.

import type { InitApi } from "@clockwyrks/structured-2d";
import {
  BEAR_FRAMES,
  CAR_FRAMES,
  CROSSER_FRAMES,
  DOGSLED_FRAMES,
  PAN_FRAMES,
  PLOW_FRAMES,
  RAFT_FRAMES,
  PAN_W,
  RAFT_W,
  SPRITE_TILE,
} from "./constants";
import type { Facing, FloeKind, VehicleKind } from "./game";

/** One frame of a folder, or `null` where it did not arrive. */
export type Frame = ImageBitmap | null;

/** One folder's frames, indexed by frame number. */
export type Frames = readonly Frame[];

/** The decoded art, one field per folder. */
export interface Art {
  /** The critter: a crouch-and-leap pair per facing. */
  readonly crosser: Frames;
  /** The bear: four run pairs, four swim pairs, and the lunge. */
  readonly bear: Frames;
  /** The snow plow, three tiles wide. */
  readonly plow: Frames;
  /** The dogsled, two tiles wide. */
  readonly dogsled: Frames;
  /** The car, two tiles wide. */
  readonly car: Frames;
  /** The one-tile floe. */
  readonly pan: Frames;
  /** The long floes: frame `0` the three-tile raft, frame `1` the four-tile one. */
  readonly raft: Frames;
}

/** Each folder under the asset root, and how many frames it holds. */
const FOLDERS = {
  crosser: CROSSER_FRAMES,
  bear: BEAR_FRAMES,
  plow: PLOW_FRAMES,
  dogsled: DOGSLED_FRAMES,
  car: CAR_FRAMES,
  pan: PAN_FRAMES,
  raft: RAFT_FRAMES,
} as const satisfies Record<keyof Art, number>;

/** Where the bear's submerged swim set begins. */
export const BEAR_SWIM_BASE = 8;

/** Where the bear's lunge pair begins. */
export const BEAR_LUNGE_BASE = 16;

/**
 * The first frame of the two-frame pair a per-facing set is drawn from.
 * `assets/crosser/` and the bear's run and swim sets all lay their facings out
 * in the same order: down, up, left, right (specs/assets.md).
 */
export function facingPair(facing: Facing): number {
  switch (facing) {
    case "down":
      return 0;
    case "up":
      return 2;
    case "left":
      return 4;
    case "right":
      return 6;
  }
}

function blank(count: number): Frames {
  return new Array<Frame>(count).fill(null);
}

function empty(): Art {
  return {
    crosser: blank(FOLDERS.crosser),
    bear: blank(FOLDERS.bear),
    plow: blank(FOLDERS.plow),
    dogsled: blank(FOLDERS.dogsled),
    car: blank(FOLDERS.car),
    pan: blank(FOLDERS.pan),
    raft: blank(FOLDERS.raft),
  };
}

let held: Art = empty();

/** The frames the load produced, ready to draw. */
export function art(): Art {
  return held;
}

/** The folder a vehicle kind is drawn from. */
export function vehicleFrames(kind: VehicleKind): Frames {
  const sheets = art();
  return kind === "plow"
    ? sheets.plow
    : kind === "dogsled"
      ? sheets.dogsled
      : sheets.car;
}

/**
 * The frame a floe kind is drawn from, and the width of the sub-rect that is
 * drawn.
 *
 * The three-tile raft is the LEFT `96 x 32` of `assets/raft/0.png` and the
 * four-tile raft is the whole of `assets/raft/1.png` (specs/assets.md), so a
 * long floe reads as one continuous slab rather than as small floes butted
 * together.
 */
export function floeArt(kind: FloeKind): { frame: Frame; sourceW: number } {
  const sheets = art();
  if (kind === "pan") return { frame: sheets.pan[0], sourceW: PAN_W };
  if (kind === "raft3") {
    return { frame: sheets.raft[0], sourceW: 3 * SPRITE_TILE };
  }
  return { frame: sheets.raft[1], sourceW: RAFT_W };
}

async function loadFolder(
  assets: InitApi["assets"],
  folder: string,
  frames: number,
): Promise<Frames> {
  return Promise.all(
    Array.from({ length: frames }, (_unused, index) =>
      assets.loadImage(`${folder}/${index}.png`).catch(() => null),
    ),
  );
}

/**
 * Load every frame of every folder, writing each path relative to the asset
 * root. A frame the host cannot fetch or decode is held as `null`.
 */
export async function loadArt(assets: InitApi["assets"]): Promise<void> {
  const names = Object.keys(FOLDERS) as (keyof Art)[];
  const loaded = await Promise.all(
    names.map((name) => loadFolder(assets, name, FOLDERS[name])),
  );
  const next = { ...empty() } as Record<keyof Art, Frames>;
  names.forEach((name, index) => {
    next[name] = loaded[index];
  });
  held = next as Art;
}

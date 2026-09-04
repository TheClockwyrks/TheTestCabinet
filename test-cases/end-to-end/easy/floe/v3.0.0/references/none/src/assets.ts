// Floe — the seven folders of sprite art the project ships.
//
// `specs/assets.md` fixes what each folder holds, how many frames it has, and
// which frame is drawn for which state. This module names the folders once, loads
// them through the runtime's image loader (`src/images.ts`), and states the frame
// LAYOUTS — which index is which facing, and which range is which set — because
// those are facts about the supplied art rather than figures over the simulation.

import {
  BEAR_FRAMES,
  CAR_FRAMES,
  CROSSER_FRAMES,
  DOGSLED_FRAMES,
  PAN_FRAMES,
  PAN_W,
  PLOW_FRAMES,
  PLOW_W,
  RAFT_FRAMES,
  RAFT_W,
} from "./constants";
import { loadFrames, type Frames } from "./images";
import type { Facing, FloeKind, VehicleKind } from "./types";

/** Each folder, and how many frames it must carry. */
const FOLDERS = {
  crosser: CROSSER_FRAMES,
  bear: BEAR_FRAMES,
  plow: PLOW_FRAMES,
  dogsled: DOGSLED_FRAMES,
  car: CAR_FRAMES,
  pan: PAN_FRAMES,
  raft: RAFT_FRAMES,
} as const;

/** The decoded art, one field per folder. */
export interface Art {
  /** The critter: a crouch-and-leap pair per facing. */
  crosser: Frames;
  /** The bear: four run pairs, four swim pairs, and the lunge. */
  bear: Frames;
  /** The snow plow, three tiles wide. */
  plow: Frames;
  /** The dogsled, two tiles wide. */
  dogsled: Frames;
  /** The car, two tiles wide. */
  car: Frames;
  /** The one-tile floe. */
  pan: Frames;
  /** The long floes: frame `0` the three-tile raft, frame `1` the four-tile one. */
  raft: Frames;
}

/**
 * The first frame of the two-frame pair a per-facing set is drawn from.
 * `assets/crosser/` and the bear's run and swim sets all lay their facings out in
 * the same order: down, up, left, right (specs/assets.md).
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

/** Where the bear's submerged swim set begins. */
export const BEAR_SWIM_BASE = 8;
/** Where the bear's lunge pair begins. */
export const BEAR_LUNGE_BASE = 16;

/** The folder a vehicle kind is drawn from. */
export function vehicleArt(art: Art, kind: VehicleKind): Frames {
  return kind === "plow"
    ? art.plow
    : kind === "dogsled"
      ? art.dogsled
      : art.car;
}

/**
 * The frame a floe kind is drawn from, and the sub-rect of it that is drawn.
 *
 * The three-tile raft is the LEFT `96 x 32` of `assets/raft/0.png` and the
 * four-tile raft is the whole of `assets/raft/1.png` (specs/assets.md), so a long
 * floe reads as one continuous slab rather than as small floes butted together.
 */
export function floeArt(
  art: Art,
  kind: FloeKind,
): { image: CanvasImageSource; sourceW: number } {
  if (kind === "pan") return { image: art.pan[0], sourceW: PAN_W };
  // The three-tile raft is the LEFT `PLOW_W` (96) of `assets/raft/0.png`; the
  // four-tile raft is the whole `RAFT_W` (128) of `assets/raft/1.png`.
  if (kind === "raft3") return { image: art.raft[0], sourceW: PLOW_W };
  return { image: art.raft[1], sourceW: RAFT_W };
}

/**
 * Decode every folder, in parallel.
 *
 * Loaded before the runtime is built (`src/main.ts`), so `initialize` stays the
 * one synchronous call that produces the whole state.
 */
export async function loadArt(): Promise<Art> {
  const names = Object.keys(FOLDERS) as (keyof typeof FOLDERS)[];
  const loaded = await Promise.all(names.map((name) => loadFrames(name)));
  const art: Record<string, Frames> = {};
  names.forEach((name, index) => {
    const frames = loaded[index];
    if (frames.length !== FOLDERS[name]) {
      throw new Error(
        `Floe: assets/${name}/ carries ${frames.length} frames, expected ${FOLDERS[name]}`,
      );
    }
    art[name] = frames;
  });
  return art as unknown as Art;
}

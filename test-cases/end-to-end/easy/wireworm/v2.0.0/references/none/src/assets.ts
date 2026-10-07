// Wireworm — the six folders of seeded sprite art, and what each holds.
//
// `specs/assets.md` fixes the folders, their frame counts, and which frame is
// drawn for which state. This module names them once, loads them through the
// runtime's image loader (`src/images.ts`), and hands the renderer one object
// with a field per element.
//
// The FRAME LAYOUTS live here too — which pair of the worm sheet is the head,
// the body, and the tail — because they are facts about the supplied art rather
// than figures the specification fixes over the simulation.

import {
  CORRUPTOR_FRAMES,
  CURSOR_FRAMES,
  DROPPER_FRAMES,
  GLITCH_FRAMES,
  NODE_FRAMES,
  WORM_FRAMES,
} from "./constants";
import { loadFrames, type Frames } from "./images";

/** Every folder under `assets/`, with the number of frames it carries. */
export const FOLDERS = {
  node: NODE_FRAMES,
  worm: WORM_FRAMES,
  cursor: CURSOR_FRAMES,
  glitch: GLITCH_FRAMES,
  dropper: DROPPER_FRAMES,
  corruptor: CORRUPTOR_FRAMES,
} as const;

/** The decoded art, one field per folder. */
export interface Sprites {
  /** One frame per charge state, plus the alternate critical frame at index 4. */
  node: Frames;
  /** Two frames each for the head, the body, and the tail, in that order. */
  worm: Frames;
  /** The player's cutter: one frame, drawn upright. */
  cursor: Frames;
  /** The glitch's four-frame instability loop. */
  glitch: Frames;
  /** The dropper: one frame. */
  dropper: Frames;
  /** The corruptor's four-frame crawl loop. */
  corruptor: Frames;
}

/** The first frame of the two-frame pair each part of the worm is drawn with. */
export const WORM_PAIR = { head: 0, body: 2, tail: 4 } as const;

/** The frame of `assets/node/` a node at `charge` holds while it is not pulsing. */
export function nodeFrame(charge: number): number {
  return Math.max(0, Math.min(NODE_FRAMES - 2, Math.round(charge)));
}

/** Load every folder, in parallel. */
export async function loadSprites(): Promise<Sprites> {
  const [node, worm, cursor, glitch, dropper, corruptor] = await Promise.all([
    loadFrames("node", FOLDERS.node),
    loadFrames("worm", FOLDERS.worm),
    loadFrames("cursor", FOLDERS.cursor),
    loadFrames("glitch", FOLDERS.glitch),
    loadFrames("dropper", FOLDERS.dropper),
    loadFrames("corruptor", FOLDERS.corruptor),
  ]);
  return { node, worm, cursor, glitch, dropper, corruptor };
}

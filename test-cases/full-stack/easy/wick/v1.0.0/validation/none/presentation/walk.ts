// presentation/walk — the lamplighter's produced files, and which one a frame
// drew.
//
// `specs/assets.md` — "The sprites": the idle lamplighter is
// `assets/sprites/lamplighter/idle.png` and the walk cycle is
// `assets/sprites/lamplighter/walk/0.png` to `5.png`, six frames on a `24 x 32`
// canvas each. "The lamplighter draws the walk sheet on a tick with a non-zero
// movement direction and the idle sprite on every other tick", so a frame draws
// exactly one of the seven and which one is the whole of what these points read.

import {
  LAMPLIGHTER_IDLE,
  LAMPLIGHTER_WALK_FRAMES,
  lamplighterWalkFrame,
} from "../constants";
import { fail } from "../assert";
import { type DrawCall, type Harness } from "../harness";
import { frameIndexOf, oneSpriteDraw } from "./readouts";
import { fileClasses } from "./sources";

/** The six walk frames, in the order `specs/assets.md` numbers their files. */
export const WALK_FILES: readonly string[] = Array.from(
  { length: LAMPLIGHTER_WALK_FRAMES },
  (_unused, frame) => lamplighterWalkFrame(frame),
);

/** The idle sprite first, then the six walk frames. */
export const LAMPLIGHTER_FILES: readonly string[] = [
  LAMPLIGHTER_IDLE,
  ...WALK_FILES,
];

/** Which of the seven a frame drew: `"idle"`, or the walk frame's own index. */
export type Posture = { idle: true } | { idle: false; frame: number };

/** How a posture reads in a failure. */
export function postureName(posture: Posture): string {
  return posture.idle ? "the idle sprite" : `walk frame ${posture.frame}`;
}

/** The lamplighter's posture on the frame `calls` describes. */
export async function postureOf(
  h: Harness,
  calls: readonly DrawCall[],
): Promise<Posture> {
  const draw = await oneSpriteDraw(
    h,
    calls,
    LAMPLIGHTER_FILES,
    "the produced lamplighter sprite",
  );
  const index = await frameIndexOf(h, draw, LAMPLIGHTER_FILES);
  if (index < 0) {
    return fail(
      "the lamplighter drawn from one of its produced files, the idle sprite " +
        "or one of the six walk frames (specs/assets.md)",
      "a 24 x 32 sprite that is none of the seven produced files",
    );
  }
  return index === 0 ? { idle: true } : { idle: false, frame: index - 1 };
}

/**
 * The six walk frames' identity classes, so a frame index is compared up to a
 * sheet that repeats a picture.
 *
 * See {@link fileClasses}: `specs/assets.md` fixes six files and never requires
 * six different pictures, and two identical frames cannot be told apart by
 * anything that looks at the canvas.
 */
export function walkClasses(h: Harness): Promise<number[]> {
  return fileClasses(h, WALK_FILES);
}

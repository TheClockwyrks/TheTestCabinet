// visibility/separation — the shared reading behind the three "the ball
// separates from what is behind it" points.
//
// `specs/assets.md`'s art bar: "the ball separates from the field at any
// position on the stage." The palette and the ball's own look are the build's;
// what is read is separation alone, against the category's figure for clearly
// apart (`DISTINCT_MIN`, see `visibility/distinct.ts`).
//
// WHERE IT SAMPLES. Five points inside the ball's 8-unit disc, against the
// ground beside it: the same radius at nearby angles, which is what lies behind
// the ball at that position.
//
// The ball is spawned AT REST — motion is another category's business — and one
// tick renders it. A resting ball between a ring's contact radii crosses
// nothing, so no contact resolves.

import {
  captureStill,
  polarToXy,
  spawnBallPolar,
  type Harness,
} from "../harness";
import {
  ballGrid,
  polarGrid,
  polarPoints,
  samplePoints,
  separation,
} from "./distinct";

/** Spawn a resting ball at `(r, theta)`, render a tick, and read separation. */
export async function separationAt(
  h: Harness,
  r: number,
  theta: number,
  besideThetas: readonly number[],
  still: string,
): Promise<number> {
  spawnBallPolar(h, r, theta, 0);
  await h.tick(1);
  captureStill(h, still);

  const ball = samplePoints(h, ballGrid(polarToXy(r, theta)));
  const beside = samplePoints(h, polarPoints(polarGrid([r], besideThetas)));
  return separation(ball, beside);
}

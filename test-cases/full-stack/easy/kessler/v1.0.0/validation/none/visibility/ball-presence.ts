// visibility/ball-presence — the shared reading behind the three "the ball
// shows over what is behind it" points.
//
// `specs/assets.md`'s art bar: "the ball separates from the field at any
// position on the stage." The palette and the ball's own look are the build's,
// so what is read is presence alone: the disc the ball occupies is rendered
// twice, once with the ball posed there and once with the balls cleared, and
// the points that moved between the two frames are the points the ball was
// drawn on.
//
// WHERE IT SAMPLES. Five points inside the ball's 8-unit disc — its center and
// four points 3 units out — all of them well inside the 24-pixel sprite the
// ball is drawn from, so a ball drawn at all moves them.
//
// The ball is spawned AT REST — motion is another category's business — and one
// tick renders it. A resting ball between a ring's contact radii crosses
// nothing, so no contact resolves.

import { pointAt } from "../constants";
import {
  captureStill,
  samplePoints,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { ballGrid, movedCount } from "./sampling";

/**
 * Spawn a resting ball at `(r, theta)`, render it, keep the picture, and
 * report how many of its five disc points the ball was drawn on.
 */
export async function ballShowsAt(
  h: Harness,
  r: number,
  theta: number,
  still: string,
): Promise<number> {
  await spawnBallPolar(h, r, theta, 0);
  await h.tick(1);
  await captureStill(h, still);

  const disc = ballGrid(pointAt(r, theta));
  const drawn = await samplePoints(h, disc);

  await h.debug.clearBalls();
  await h.tick(1);
  const bare = await samplePoints(h, disc);

  return movedCount(drawn, bare);
}

// presentation/played — the shared reading behind every "the system played at
// this event" point in this category.
//
// specs/assets.md fires each produced particle system on a named event, and
// `discs.ts` says how a playing system is recognized: the case's particle player
// composites each particle as a soft radial-gradient disc, so a system that
// played raises the frame's gradient-disc count. What is read here is that RISE
// against the frame before the event — never a disc's position, which the
// recorded arguments cannot recover (see `discs.ts`) — and each suite shows the
// placement in the media it captures.
//
// THE EVENT IS FOUND BY ITS OWN SIGNATURE IN THE SNAPSHOT rather than by a tick
// count, so a build whose contact resolves a tick either side of the posed one
// is still read at its own event.
//
// THE EVENT FRAME AND THE TWO AFTER IT ARE ACCEPTED, because when within a frame
// a spawned effect first becomes visible is the build's own choice.

import { assertGreaterThan, assertTrue } from "../assert";
import { STAGE_CX, STAGE_CY } from "../constants";
import { type Harness } from "../harness";
import { type KesslerSnapshot } from "../surface";
import { gradientDiscs } from "./discs";

/** How many frames after the event may show the effect's first compositing. */
export const VISIBLE_WITHIN = 3;

/** A frame-by-frame reading of a sweep, and where in it the event landed. */
export interface Swept {
  counts: number[];
  eventFrame: number;
}

/**
 * Drive up to `maxFrames` frames until `event` first holds, reading each frame's
 * gradient-disc count, and hand back the counts with the event's frame index.
 */
export async function sweepFor(
  h: Harness,
  maxFrames: number,
  event: (snapshot: KesslerSnapshot) => boolean,
): Promise<Swept> {
  const counts: number[] = [];
  let eventFrame = -1;
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const { calls } = await h.frameDraw();
    counts.push(gradientDiscs(calls));
    if (eventFrame < 0 && event(h.snapshot())) eventFrame = frame;
    if (eventFrame >= 0 && frame >= eventFrame + VISIBLE_WITHIN - 1) break;
  }
  return { counts, eventFrame };
}

/** The discs rise the event's frames must show over the frame before it. */
export function assertPlayed(swept: Swept, what: string): void {
  assertTrue(swept.eventFrame > 0, `${what} within the sweep`);
  const baseline = swept.counts[swept.eventFrame - 1];
  const played = Math.max(
    ...swept.counts.slice(swept.eventFrame, swept.eventFrame + VISIBLE_WITHIN),
  );
  assertGreaterThan(
    played,
    baseline,
    `gradient discs composited on the frames of ${what}, against the frame before it`,
  );
}

/** The ball's outward radial speed, `v . n` at its center. */
export function radialSpeed(snapshot: KesslerSnapshot): number {
  const ball = snapshot.balls[0];
  if (ball === undefined) return 0;
  const dx = ball.x - STAGE_CX;
  const dy = ball.y - STAGE_CY;
  const r = Math.hypot(dx, dy);
  if (r === 0) return 0;
  return (ball.vx * dx + ball.vy * dy) / r;
}

// presentation/spark-at-reflections — a deflector bounce, a containment
// reflection, and a shield reflection each play the impact spark particle
// system.
//
// specs/deflector-and-ball.md: "The bounce plays the `paddle-bounce` cue and
// spawns the impact spark particle system at the contact." specs/field.md, on
// the containment: the reflection "spawns the impact spark particle system at
// the contact". specs/pods.md, on the shield: "The reflection plays the
// `shield-reflect` cue and the impact spark particle system at the contact."
// specs/assets.md fires `assets/particles/spark.json` at all three, played
// live through the case's particle player. Each reflection is posed alone and
// THAT the system plays is read as the player's compositing — radial-gradient
// discs — rising on the reflection's render against the frame before it (see
// discs.ts; the captured replays show the placement). The event frame and the
// two after it are accepted, because when within a frame a spawned effect
// first becomes visible is the build's own choice.
//
// Each scenario's world is one ball and the one surface it reflects off; the
// reflection itself is found by its own signature in the snapshot — the
// radial velocity turning, or the shield consuming itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { ballSpeed, PADDLE_START_ANGLE, polarOf } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
  type KesslerSnapshot,
} from "../harness";
import { gradientDiscs } from "./discs";

/** A few frames of margin past each posed crossing. */
const SWEEP_FRAMES = 15;

/** How many frames after the event may show the effect's first compositing. */
const VISIBLE_WITHIN = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The ball's outward radial speed, `v . n` at its center. */
function radialSpeed(snapshot: KesslerSnapshot): number {
  const ball = snapshot.balls[0];
  if (ball === undefined) return 0;
  const { r } = polarOf(ball.x, ball.y);
  if (r === 0) return 0;
  const nx = (ball.x - 500) / r;
  const ny = (ball.y - 500) / r;
  return ball.vx * nx + ball.vy * ny;
}

/**
 * Drive frames until `event` first holds, reading each frame's gradient-disc
 * count, and hand back the counts with the event's frame index.
 */
async function sweep(
  event: (snapshot: KesslerSnapshot) => boolean,
): Promise<{ counts: number[]; eventFrame: number }> {
  const counts: number[] = [];
  let eventFrame = -1;
  for (let frame = 0; frame < SWEEP_FRAMES; frame += 1) {
    const { calls } = await h.frameDraw();
    counts.push(gradientDiscs(calls));
    if (eventFrame < 0 && event(await h.snapshot())) eventFrame = frame;
    if (eventFrame >= 0 && frame >= eventFrame + VISIBLE_WITHIN - 1) break;
  }
  return { counts, eventFrame };
}

/** The discs rise the event's frames must show over the frame before it. */
function assertPlayed(
  swept: { counts: number[]; eventFrame: number },
  what: string,
): void {
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

it("composites the spark on a deflector bounce", async () => {
  await isolate(h);
  // Dead-center on the span, straight inward: crossing 194 on the third tick.
  await spawnBallPolar(h, 205, PADDLE_START_ANGLE, ballSpeed(1), 180);

  const swept = await captureReplay(h, "spark-paddle", () =>
    sweep((s) => radialSpeed(s) > 0),
  );
  assertPlayed(swept, "the bounce's outward turn");
});

it("composites the spark on a containment reflection", async () => {
  await isolate(h);
  // Straight outward from 440: crossing 472 on the eighth tick.
  await spawnBallPolar(h, 440, 0, ballSpeed(1));

  const swept = await captureReplay(h, "spark-field", () =>
    sweep((s) => radialSpeed(s) < 0),
  );
  assertPlayed(swept, "the containment's inward turn");
});

it("composites the spark on a shield reflection", async () => {
  await isolate(h);
  await h.debug.setShield(true);
  // Straight inward from 130: crossing the shield's 100 on the eighth tick.
  await spawnBallPolar(h, 130, 45, ballSpeed(1), 180);

  const swept = await captureReplay(h, "spark-shield", () =>
    sweep((s) => !s.effects.shieldActive),
  );
  assertPlayed(swept, "the shield's consuming reflection");
});

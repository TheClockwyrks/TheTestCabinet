// presentation/burnup-at-burn-up — a ball, and a pod, burning up against the
// planet plays the burn-up particle system.
//
// specs/field.md: "In a tick where a ball's center radius reaches `78` or
// less, the ball burns up: it is removed, the burn-up particle system spawns
// at it" — and "A pod whose center radius reaches `78` or less burns up the
// same way, as specs/pods.md states." specs/assets.md fires
// `assets/particles/burnup.json` at "a ball or pod reaching the planet",
// played live through the case's particle player. Each burn-up is posed alone
// and THAT the system plays is read as the player's compositing — radial-
// gradient discs — rising on the burn-up's render against the frame before it
// (see discs.ts; the captured replays show the placement). The event frame
// and the two after it are accepted, because when within a frame a spawned
// effect first becomes visible is the build's own choice.
//
// The ball scenario's world is the one falling ball, so its burn-up is the
// last live ball's and reads as the tick's life loss; the pod scenario's is
// the one falling pod, read as `pods` emptying. Each event is found by that
// signature, never by a tick count.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { ballSpeed, START_LIVES } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  spawnPodPolar,
  type Harness,
  type KesslerSnapshot,
} from "../harness";
import { gradientDiscs } from "./discs";

/** The pod falls from 130 to 78 at 2 units a tick: 26 ticks, plus margin. */
const SWEEP_FRAMES = 35;

/** How many frames after the event may show the effect's first compositing. */
const VISIBLE_WITHIN = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

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

it("composites the burn-up on a ball reaching the planet", async () => {
  await isolate(h);
  // Straight inward from 130: reaching 78 on the thirteenth tick. It is the
  // last live ball, so the burn-up reads as the tick's life loss.
  await spawnBallPolar(h, 130, 45, ballSpeed(1), 180);

  const swept = await captureReplay(h, "burnup-ball", () =>
    sweep((s) => s.lives < START_LIVES),
  );
  assertPlayed(swept, "the ball's burn-up");
});

it("composites the burn-up on a pod reaching the planet", async () => {
  await isolate(h);
  // Falling inward from 130 at the pod fall speed: reaching 78 in 26 ticks.
  await spawnPodPolar(h, "widen", 130, 200);

  const swept = await captureReplay(h, "burnup-pod", () =>
    sweep((s) => s.pods.length === 0),
  );
  assertPlayed(swept, "the pod's burn-up");
});

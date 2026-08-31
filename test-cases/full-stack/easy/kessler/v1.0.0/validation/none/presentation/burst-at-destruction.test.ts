// presentation/burst-at-destruction — destroying a target plays the
// destruction burst particle system.
//
// specs/rings.md: "A hit that brings them to zero destroys the target: the
// target is removed, the destruction burst particle system spawns at the
// target's arc center as posed that tick", and specs/assets.md fires
// `assets/particles/burst.json` at "the arc center of a destroyed target",
// played live through the case's particle player. THAT the system plays on the
// destruction is read as the player's own compositing — radial-gradient discs
// — rising on the destruction's render against the frame before it (see
// discs.ts, which also says why a disc's stage position is not recoverable
// from the recorded operations; the captured replay shows the placement). The
// event frame and the two after it are all accepted, because when within a
// frame a spawned effect first becomes visible is the build's own choice.
//
// The world is one one-hit-point target on the stationary ring 1 and the one
// ball that destroys it; both driver switches are off, so no clearing and no
// pod draw follows the destruction into the read frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { ballSpeed, slotArcCenterDeg } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { gradientDiscs } from "./discs";

/** The posed target: ring 1, slot 0, one hit point. */
const RING = 1;
const SLOT = 0;

/** The ball starts 8 ticks below ring 1's inner contact gate (282). */
const START_RADIUS = 250;

/** The destruction lands on tick 8; a few frames of margin either way. */
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

it("composites the burst on the destruction", async () => {
  await isolate(h);
  await h.debug.spawnTarget(RING, SLOT, 1);
  await spawnBallPolar(
    h,
    START_RADIUS,
    slotArcCenterDeg(RING, SLOT),
    ballSpeed(1),
  );

  const swept = await captureReplay(h, "burst", async () => {
    let before = 1;
    const counts: number[] = [];
    let eventFrame = -1;
    for (let frame = 0; frame < SWEEP_FRAMES; frame += 1) {
      const { calls } = await h.frameDraw();
      counts.push(gradientDiscs(calls));
      const left = (await h.snapshot()).rings[RING - 1].targets.length;
      if (eventFrame < 0 && left < before) eventFrame = frame;
      before = left;
      if (eventFrame >= 0 && frame >= eventFrame + VISIBLE_WITHIN - 1) break;
    }
    return { counts, eventFrame };
  });

  assertTrue(swept.eventFrame > 0, "a destruction within the sweep");
  const baseline = swept.counts[swept.eventFrame - 1];
  const played = Math.max(
    ...swept.counts.slice(swept.eventFrame, swept.eventFrame + VISIBLE_WITHIN),
  );
  assertGreaterThan(
    played,
    baseline,
    "gradient discs composited on the destruction's frames, against the " +
      "frame before the destruction",
  );
});

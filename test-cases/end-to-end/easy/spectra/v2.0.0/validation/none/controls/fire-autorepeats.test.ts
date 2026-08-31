// Spectra — controls/fire-autorepeats: fire held for a second fires more than
// once.
//
// THE RULE. `specs/controls.md` reads `a` as a HOLD rather than a press edge: "a
// held `a` fires every `FIRE_INTERVAL` for as long as the cooldown, the cap, and
// the lockout allow a shot". `specs/ship.md` says the same from the cannon's side.
// This point decides the qualitative half of that — that holding the key repeats
// the shot at all, rather than firing once on the edge and going quiet until the
// key is lifted and pressed again.
//
// THE CADENCE ITSELF IS NOT ASSERTED HERE. `FIRE_INTERVAL` is graded once, by
// `ship/fire-cadence`, and `MAX_PLAYER_BULLETS` by `ship/fire-cap`; a check that
// demanded the whole `1 / FIRE_INTERVAL` count over the second would be grading
// both of those a second time, and would fail a build whose repeat is real but
// whose spacing is wrong. What is required here is exactly what the point claims:
// MORE THAN ONE shot over the held second.
//
// HOW THE SHOTS ARE COUNTED, AND WHY NOT BY IDENTITY. The roster does not simply
// grow: `specs/ship.md` caps the player's bullets in flight at
// `MAX_PLAYER_BULLETS` (3) and a bullet leaving the top of the field leaves the
// roster, so the count over a second rises and falls. What is counted instead is
// every FRAME-TO-FRAME INCREASE in the number of the player's bullets, summed —
// each increase is a shot that was taken, whatever left the roster before it.
// Identity is deliberately not used: `specs/instrumentation.md` promises only that
// an id is unique among the entities ALIVE at a moment and kept for an entity's
// whole life, so a build that hands a dead bullet's id to a new one is conformant
// and would defeat a count of distinct ids. Sampling every frame is what makes the
// sum right: `FIRE_INTERVAL` (0.16 s) is sixteen frames of this harness's 100 Hz
// clock, so no two shots can hide inside one sample. A shot that lands on the same
// frame as an expiry nets zero and is undercounted, which can only make this check
// more forgiving, never falsely passing.
//
// THE KEY IS A REAL ONE, AND IT IS REALLY HELD. `hold` and `release` press through
// Chromium's own input pipeline, and the frames between them run with the key
// genuinely down — which is the whole scenario, since a build that fires on the
// press edge alone passes `controls/fire-space` and must fail this.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters, shuts the wave's three
// gates and leaves no cooldown and no lockout standing, so every bullet counted
// over the second is one this key fired.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import { FIRE_INTERVAL } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  playerBullets,
  startPosed,
  type Harness,
} from "../harness";

/** The key held. `controls/fire-space` decides that it is bound to `a` at all. */
const FIRE_KEY = "Space";

/** How long it is held: the second the point's own wording names. */
const HOLD_SECONDS = 1.0;
const HOLD_FRAMES = framesFor(HOLD_SECONDS);

/**
 * How many shots the held second must produce.
 *
 * TWO — "more than one", the point's own claim, and nothing beyond it. What
 * `specs/ship.md` states would give a conformant build far more (`FIRE_INTERVAL`
 * is 0.16 s, so six or seven presses' worth of cadence inside the second, throttled
 * by the three-bullet cap), and this bound sits well under that on purpose: the
 * figure is `ship/fire-cadence`'s point, and a build whose repeat is slower than
 * stated should lose that point rather than this one.
 */
const MIN_SHOTS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires more than once over a second of held fire", async () => {
  await startPosed(h);
  const before = await h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is held in is live");
  assertLength(
    playerBullets(before),
    0,
    "the field holds none of the player's bullets before the hold",
  );

  let shots = 0;
  let inFlight = 0;
  await h.hold(FIRE_KEY);
  try {
    for (let frame = 0; frame < HOLD_FRAMES; frame += 1) {
      await h.advance(1);
      const now = playerBullets(await h.snapshot()).length;
      if (now > inFlight) shots += now - inFlight;
      inFlight = now;
    }
  } finally {
    await h.release(FIRE_KEY);
  }
  await captureStill(h, "repeat");

  assertGreaterThanOrEqual(
    shots,
    MIN_SHOTS,
    `a ${HOLD_SECONDS}s hold repeated the shot (specs/controls.md reads \`a\` as a hold, firing every ${FIRE_INTERVAL}s)`,
  );
});

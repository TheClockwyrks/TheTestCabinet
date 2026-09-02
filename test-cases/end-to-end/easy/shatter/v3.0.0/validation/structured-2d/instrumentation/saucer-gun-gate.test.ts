// instrumentation/saucer-gun-gate — with `setSaucerGun(false)` the saucer fires
// nothing; with it on it fires several times over the same stretch.
//
// THE RULE. `specs/instrumentation.md`, The saucer: "`setSaucerGun(enabled)`
// Gates the saucer's firing alone: the aimed shot it takes every
// `SAUCER_FIRE_INTERVAL`. Off, it fires nothing; it still steers and still
// travels." The cadence is `specs/saucer.md`: "Every `SAUCER_FIRE_INTERVAL`
// (`1.6` seconds) on the field, the saucer fires one saucer bullet aimed at the
// ship's current position", and `addSaucer` brings it in with "its fire clock at
// `SAUCER_FIRE_INTERVAL`", so the first shot of a visit falls one whole interval
// in.
//
// THE COUNT IS OF ROUNDS FIRED, NOT ROUNDS IN FLIGHT. A saucer bullet is removed
// `SAUCER_BULLET_LIFE` (`1.4` seconds) after it is fired, and it can be absorbed
// by the core before that (`specs/collision.md`), so a roster read at the end of
// the stretch would under-report a build that fired correctly. Every distinct id
// seen over the stretch is collected instead, sampled often enough that no round
// can be born and die between two samples.
//
// FOUR INTERVALS, THREE SHOTS. With the fire clock starting at a full interval,
// four intervals of game time contain shots at one, two and three intervals in,
// and a fourth on the closing boundary. Three is therefore what the
// specification guarantees inside the window, and it is what is asked for; the
// leg runs a fraction past four intervals so a build that fires on the boundary
// is not read as one that fired early.
//
// THE MIND IS HELD. The gun is the requirement, and a steering saucer draws from
// the game's generator and moves the shot's own origin; holding the mind leaves
// the crossing straight and the reading about the gun alone. Travel is left
// running, because the shot belongs to a crossing (`specs/saucer.md`), and the
// crossing is posed low and to the left so the saucer stays clear of the star's
// core throughout.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_FIRE_INTERVAL } from "../constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  sampleEvery,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the crossing is posed: low and to the left, far from the star. */
const ENTRY = { x: 60, y: 660 };

/** How many fire intervals each leg runs for. */
const INTERVALS = 4;

/** The fraction of an interval run past the last boundary. */
const OVERRUN = 0.1;

/**
 * The shots the specification guarantees inside the window.
 *
 * The fire clock starts at a full interval, so shots fall at one, two and three
 * intervals in, with a fourth on the closing boundary.
 */
const SHOTS_EXPECTED = INTERVALS - 1;

/**
 * How often the enemy-bullet roster is read, in frames.
 *
 * A saucer bullet lives `SAUCER_BULLET_LIFE` (`1.4` s, `168` ticks), so a
 * sixteen-frame stride reads every round at least ten times over its life and no
 * shot can be born and gone between two samples.
 */
const SAMPLE_STRIDE = 16;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** A crossing posed with the mind held and the gun as the leg wants it. */
function poseCrossing(gun: boolean): void {
  startPlaying(h);
  poseSaucer(h, ENTRY.x, ENTRY.y);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(gun);
}

/** Every distinct saucer-bullet id seen over the stretch. */
async function fireOver(intervals: number): Promise<Set<number>> {
  const frames = ticksFor(intervals * SAUCER_FIRE_INTERVAL);
  const seen = new Set<number>();
  await sampleEvery(h, frames, SAMPLE_STRIDE, (snapshot) => {
    for (const bullet of snapshot.enemyBullets) seen.add(bullet.id);
    return snapshot.enemyBullets.length;
  });
  return seen;
}

it("off, the saucer adds no enemy bullet over four fire intervals", async () => {
  poseCrossing(false);
  assertLength(h.snapshot().enemyBullets, 0, "the field starts with no fire");

  const fired = await fireOver(INTERVALS + OVERRUN);

  // The saucer with no fire of its own in flight.
  captureStill(h, "silent");

  assertEqual(
    fired.size,
    0,
    `with the gun off, ${INTERVALS} fire intervals produce no saucer bullet`,
  );
  assertEqual(h.snapshot().saucer?.gun, false, "the gate is still off");
});

it("on, it fires several times over the same stretch", async () => {
  poseCrossing(true);

  const fired = await fireOver(INTERVALS + OVERRUN);
  assertGreaterThanOrEqual(
    fired.size,
    SHOTS_EXPECTED,
    `with the gun on, ${INTERVALS} fire intervals contain at least ` +
      `${SHOTS_EXPECTED} aimed shots (specs/saucer.md)`,
  );
});

// controls/ink-key — Shift releases an ink cloud.
//
// specs/movement.md binds the `b` action to `ShiftLeft` and `ShiftRight` and gives
// it one job in live play: "Releases an ink cloud". specs/sensing.md fixes what
// appears — "A cloud is released when ink's cooldown is `0`", and "A dark cloud of
// radius `INK_RADIUS` (`80` logical units, 2.5 tiles) appears centered on the
// forager and stands for `INK_LIFE` (`3 s`) before it dissipates. It stays fixed
// at the point it was released" — and specs/state.md fixes what the snapshot
// carries for it: an `inkClouds` entry at the center `x`, `y` it was released at,
// with its `radius` and `remaining`, "the seconds of life it has left".
//
// THE COOLDOWN IS POSED, NOT WAITED OUT. `setInkCooldown(0)` leaves ink ready
// (specs/instrumentation.md), which is the premise this point's own description
// states. How the cooldown runs down from there is `ink/cooldown`'s verdict, and
// what the cloud does to a hunter is `ink/cloud`'s and the per-predator points';
// none of that is read here.
//
// THE FORAGER IS A BYSTANDER, parked facing rock, because the cloud is "centered
// on the forager" and a forager that drifted between the press and the read would
// make that center unreadable without saying anything about the key.
//
// THE READ IS A BEAT AFTER THE PRESS. A build may release the cloud in the input
// step or at the top of the following one, and both conform, so the cloud is read
// a tick later and the tolerance below is stated against the ticks that have run.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertGreaterThan,
  assertNotEqual,
  assertNull,
} from "../assert";
import {
  FORAGER_SPEED,
  INK_LIFE,
  INK_RADIUS,
  TICK_DT,
} from "../../src/constants";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  clearUnderfoot,
  denAll,
  graded,
  parkForager,
  sceneGuard,
  sceneHeld,
} from "../scene";

/** The first key specs/movement.md binds the `b` action to. */
const KEY = "ShiftLeft";

/** A corridor wide enough to hold the whole `INK_RADIUS` cloud in the clip. */
const RUN_TILES = 12;

/** Ticks at rest before the key goes down, so the clip opens on a quiet maze. */
const REST_TICKS = 24;

/**
 * Ticks between the press and the reading.
 *
 * A beat, not a measurement: `tap` runs the one frame that delivers the key, and
 * this one follows it, so a build that releases the cloud on the input step and
 * one that releases it at the top of the next both read the same.
 */
const BEAT_TICKS = 1;

/** Ticks held after the reading, so the clip shows the cloud standing. */
const TAIL_TICKS = 90;

/**
 * How far off center the cloud may be reported, in logical units.
 *
 * One tick of `FORAGER_SPEED` (`128`) travel. The forager is parked facing rock
 * and does not move at all, so this is not tolerance for a wandering center: it is
 * room for the one tick between the key and the read, in case a build fixes the
 * cloud on the position the forager reached rather than the one it left.
 */
const CENTER_EPS = FORAGER_SPEED * TICK_DT;

/**
 * How far the reported radius may sit from `INK_RADIUS`, in logical units.
 *
 * The radius is a constant specs/sensing.md fixes rather than anything
 * integrated, and the cloud "stays fixed" — so this is rounding, not tolerance.
 */
const RADIUS_EPS = 0.5;

/**
 * How much of `INK_LIFE` may already have been spent when the cloud is read, in
 * seconds.
 *
 * Three ticks: the one `tap` runs, the `BEAT_TICKS` after it, and one more for a
 * build that counts the release tick against the life. This is the "within a
 * tick's tolerance" the point's own description states.
 */
const LIFE_SPENT_MAX = 3 * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("releases an ink cloud on Shift", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    await poseStraightRun(h, RUN_TILES);
    const quiet = await denAll(h);
    await parkForager(h);
    await clearUnderfoot(h);
    h.debug.setInkCooldown(0);
    const watch = await sceneGuard(h, quiet);

    const read = await captureReplay(h, "ink", async () => {
      await h.advance(REST_TICKS);
      const armed = h.snapshot();
      await h.tap(KEY);
      await h.advance(BEAT_TICKS);
      const released = h.snapshot();
      await h.advance(TAIL_TICKS);
      return { armed, released };
    });

    assertNull(sceneHeld(h.snapshot(), watch), "the scenario held to the end");

    // The premise this point's own description states, posed through
    // `setInkCooldown(0)`: "At `0` ink is ready and the snapshot reports
    // `ink.ready` as `true`" (specs/instrumentation.md).
    assertEqual(
      read.armed.ink.ready,
      true,
      "ink is ready when the key is pressed, the cooldown having been posed to 0",
    );

    assertGreaterThan(
      read.released.inkClouds.length,
      read.armed.inkClouds.length,
      `ink clouds standing ${BEAT_TICKS + 1} ticks after ShiftLeft (was ` +
        `${read.armed.inkClouds.length})`,
    );
    assertNotEqual(read.released.inkClouds.length, 0, "a cloud to read");

    const cloud = read.released.inkClouds[0];
    assertBetween(
      cloud.x,
      read.armed.forager.x - CENTER_EPS,
      read.armed.forager.x + CENTER_EPS,
      "the cloud's center x against the forager's own",
    );
    assertBetween(
      cloud.y,
      read.armed.forager.y - CENTER_EPS,
      read.armed.forager.y + CENTER_EPS,
      "the cloud's center y against the forager's own",
    );
    assertBetween(
      cloud.radius,
      INK_RADIUS - RADIUS_EPS,
      INK_RADIUS + RADIUS_EPS,
      `the cloud's radius against INK_RADIUS (${INK_RADIUS})`,
    );
    assertBetween(
      cloud.remaining,
      INK_LIFE - LIFE_SPENT_MAX,
      INK_LIFE,
      `the cloud's remaining life against INK_LIFE (${INK_LIFE}), ` +
        `${BEAT_TICKS + 1} ticks after the press`,
    );
  });
});

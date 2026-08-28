// ink/cooldown — ink recharges over INK_COOLDOWN, and nothing gets through while
// it does.
//
// specs/sensing.md: "Cooldown. A cloud is released when ink's cooldown is `0`,
// and releasing one sets the cooldown to `INK_COOLDOWN` (`8 s`), which then runs
// down. Ink is unlimited, and the cooldown is the only limit on it."
// specs/state.md: "`ink.cooldown` is the seconds left until ink is ready and
// `ink.ready` is `true` exactly when that is `0`."
//
// FOUR CLAIMS, AND A BUILD CAN HOLD ANY THREE. The cooldown is armed at the full
// figure; it runs down against simulated time; a press inside it is refused; and
// readiness is exactly the cooldown having reached zero. So this reads the meter
// the moment it is armed, presses again half way down and looks at what appeared,
// then walks the last of the recharge a tick at a time and takes the exact moment
// `ready` turned over.
//
// "NOTHING WAS RELEASED" IS READ AS A COUNT ACROSS THE PRESS, not as an empty
// `inkClouds`. A build whose clouds outstay their `INK_LIFE` has a fault, and it
// is `ink/cloud`'s: read as an empty list, that one fault would fail this point
// too. What this asks instead is that the press ADDED nothing, which is exactly
// what the claim says and is decidable whatever the list already held. The press
// is taken half way down the cooldown, and it also catches the other way a build
// can fail this: a refused press that re-arms the cooldown anyway would push
// readiness out, and the meter is read across the press.
//
// WHAT THIS DOES NOT DECIDE. Whether the key releases a cloud at all, which is
// `controls/ink-key`'s and which this stands down on; what the cloud is, which is
// `ink/cloud`'s; and what ink does to a hunter, which belongs to each hunter.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNull,
} from "../assert";
import { BINDINGS, INK_COOLDOWN, TICK_DT, TICK_HZ } from "../../src/constants";
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
  unmetPrecondition,
} from "../scene";

/** The key specs/movement.md binds the `b` action — "Releases an ink cloud" — to. */
const INK_KEY = BINDINGS.b[0];

/** A corridor for the forager to stand in as a bystander, in tiles. */
const RUN_TILES = 6;

/**
 * How far the armed cooldown may sit from `INK_COOLDOWN`, in seconds.
 *
 * Two ticks. The meter is read one tick after the key went down, and
 * specs/sensing.md leaves the order of arming the cooldown and running it down
 * inside that tick to the build, so a conforming build reports `8` or
 * `8 - TICK_DT` there.
 */
const ARM_TOLERANCE = 2 * TICK_DT;

/**
 * When the refused second press is taken, in ticks after the first.
 *
 * Four seconds, half way down the cooldown and a second past the `INK_LIFE` the
 * first cloud stands for. See the header.
 */
const SECOND_PRESS_TICKS = 4 * TICK_HZ;

/**
 * How far the moment `ready` turns over may sit from `INK_COOLDOWN`, in seconds,
 * measured from the tick the first press ran on.
 *
 * Two ticks, for the same reason as {@link ARM_TOLERANCE}. "Exactly when the
 * cooldown reaches `0`" is asserted separately and exactly, as the value of the
 * meter on the tick readiness returned.
 */
const READY_TOLERANCE = 2 * TICK_DT;

/**
 * Where the tick-by-tick sweep for readiness opens, in ticks after the press.
 *
 * A quarter of a second short of the figure. Everything before it is covered in
 * whole seconds, which is all the run-down claim needs; the last stretch is
 * walked a tick at a time so the moment readiness returns is read to the tick.
 */
const SWEEP_FROM_TICKS = INK_COOLDOWN * TICK_HZ - 30;

/**
 * How long that sweep runs, in ticks from the press.
 *
 * A hard ceiling a fifth of a second past the figure, so a build whose cooldown
 * merely runs slow FAILS on the bound rather than leaving the point undecided.
 */
const READY_MAX_TICKS = Math.round((INK_COOLDOWN + 0.2) * TICK_HZ);

/** One reading of the meter as it ran down. */
interface Sample {
  elapsed: number;
  ready: boolean;
  cooldown: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("arms INK_COOLDOWN on a cloud, refuses a press inside it, and is ready again exactly when it reaches 0", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    const run = await poseStraightRun(h, RUN_TILES);
    await parkForager(h, { tx: run.tx, ty: run.ty });
    await clearUnderfoot(h);
    const quiet = await denAll(h);
    const watch = await sceneGuard(h, quiet);

    const recharge = await captureReplay(h, "cooldown", async () => {
      h.debug.setInkCooldown(0);
      const before = h.snapshot();
      await h.tap(INK_KEY);
      const armed = h.snapshot();
      if (armed.inkClouds.length === 0) {
        unmetPrecondition(
          `pressing ${INK_KEY} with ink.ready ${String(before.ink.ready)} released ` +
            "no cloud, so there is no cooldown for this scenario to read; whether " +
            "the key releases one at all is controls/ink-key's verdict, not this " +
            "one's",
        );
      }

      // Down to the refused press, then the press itself and the tick that
      // delivers it.
      await h.advance(SECOND_PRESS_TICKS - 1);
      const beforeSecond = h.snapshot();
      await h.tap(INK_KEY);
      const afterSecond = h.snapshot();

      // Down to the last stretch, and then a tick at a time through it.
      await h.advance(SWEEP_FROM_TICKS - SECOND_PRESS_TICKS - 1);
      const samples: Sample[] = [];
      let ready: Sample | null = null;
      while (
        ready === null &&
        (h.snapshot().simTime - before.simTime) * TICK_HZ < READY_MAX_TICKS
      ) {
        await h.advance(1);
        const snapshot = h.snapshot();
        const sample: Sample = {
          elapsed: snapshot.simTime - before.simTime,
          ready: snapshot.ink.ready,
          cooldown: snapshot.ink.cooldown,
        };
        samples.push(sample);
        if (sample.ready) ready = sample;
      }

      return { before, armed, beforeSecond, afterSecond, samples, ready };
    });

    assertNull(sceneHeld(h.snapshot(), watch), "the scenario held to the end");

    // Armed, at the full figure.
    assertEqual(
      recharge.before.ink.ready,
      true,
      "ink.ready with the cooldown posed to 0, before the cloud",
    );
    assertEqual(
      recharge.armed.ink.ready,
      false,
      "ink.ready one tick after the cloud was released",
    );
    assertLessThanOrEqual(
      Math.abs(recharge.armed.ink.cooldown - INK_COOLDOWN),
      ARM_TOLERANCE,
      `|ink.cooldown - INK_COOLDOWN| one tick after the cloud, of the ` +
        `${INK_COOLDOWN} s specs/sensing.md arms`,
    );

    // Running down against simulated time.
    assertGreaterThan(
      recharge.armed.ink.cooldown - recharge.beforeSecond.ink.cooldown,
      0,
      `how much of the cooldown ran off over the ${SECOND_PRESS_TICKS} ticks ` +
        "before the second press",
    );

    // The second press, inside the cooldown: nothing released, and no re-arm.
    assertEqual(
      recharge.beforeSecond.ink.ready,
      false,
      `ink.ready ${SECOND_PRESS_TICKS} ticks in, with the cooldown still running`,
    );
    assertLessThanOrEqual(
      recharge.afterSecond.inkClouds.length,
      recharge.beforeSecond.inkClouds.length,
      `the ink clouds standing one tick after a second ${INK_KEY} press taken ` +
        "while the cooldown was still running, against how many stood the tick " +
        "before it",
    );
    assertLessThanOrEqual(
      recharge.afterSecond.ink.cooldown,
      recharge.beforeSecond.ink.cooldown,
      "ink.cooldown across the refused press, which must keep running down " +
        "rather than being armed again",
    );

    // Ready exactly when the meter reaches zero, and not before.
    for (const sample of recharge.samples) {
      assertEqual(
        sample.ready,
        sample.cooldown === 0,
        `ink.ready ${sample.elapsed.toFixed(4)} s after the cloud, where ` +
          `ink.cooldown is ${sample.cooldown.toFixed(4)} — specs/state.md has ` +
          "ready true exactly when the cooldown is 0",
      );
    }
    assertEqual(
      recharge.ready !== null,
      true,
      `ink.ready returned within ${READY_MAX_TICKS} ticks of the cloud, of the ` +
        `${INK_COOLDOWN} s INK_COOLDOWN runs`,
    );
    if (recharge.ready !== null) {
      assertLessThanOrEqual(
        Math.abs(recharge.ready.elapsed - INK_COOLDOWN),
        READY_TOLERANCE,
        `|elapsed - INK_COOLDOWN| at the tick ink.ready returned, measured from ` +
          "the tick the cloud was released on",
      );
      assertEqual(
        recharge.ready.cooldown,
        0,
        "ink.cooldown on the tick ink.ready returned",
      );
    }
  });
});

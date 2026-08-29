// ink/cloud — the cloud is a fixed thing with a size and a life.
//
// specs/sensing.md: "The cloud. A dark cloud of radius `INK_RADIUS` (`80`
// logical units, 2.5 tiles) appears centered on the forager and stands for
// `INK_LIFE` (`3 s`) before it dissipates. It stays fixed at the point it was
// released, and everything swims through it at its ordinary speed."
// specs/state.md: "`inkClouds` lists every ink cloud still standing, each fixed
// at the center `x`, `y` it was released at, with its `radius` in logical units
// and `remaining`, the seconds of life it has left. A cloud leaves the list when
// `remaining` reaches `0`."
//
// FOUR CLAIMS ON ONE CLOUD. Its size, its life, that it does not follow the
// forager, and that it goes when its life is spent. The third is the one a
// scenario has to work for: a cloud released and left alone is indistinguishable
// from one stuck to a forager that never moved, so the forager swims a full
// second down the corridor — past the cloud's own radius — and the centre is read
// again from where it started.
//
// THE LIFE IS READ ACROSS THE WHOLE OF IT, not at its ends. `remaining` is
// sampled a second and two seconds in against what the clock says is left, and
// then the sweep walks the last stretch a tick at a time to take the moment the
// cloud leaves the list. A build that arms the right life and never runs it down
// fails the samples; one that runs it down and forgets to drop the cloud fails
// the sweep; one that drops it early fails it the other way.
//
// WHAT THIS DOES NOT DECIDE. Whether the key releases a cloud at all, and that a
// cloud opens on the forager, both of which are `controls/ink-key`'s; how long
// the recharge takes, which is `ink/cooldown`'s; and what a cloud does to a
// hunter, which belongs to each hunter.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import {
  BINDINGS,
  INK_LIFE,
  INK_RADIUS,
  TICK_DT,
  TICK_HZ,
} from "../../src/constants";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";

/** The key specs/movement.md binds the `b` action — "Releases an ink cloud" — to. */
const INK_KEY = BINDINGS.b[0];

/**
 * The corridor, in tiles.
 *
 * Twelve, so eleven tiles run ahead of the forager: more than three times the
 * ground the cloud would have to cover to follow it.
 */
const RUN_TILES = 12;

/**
 * How far the released radius may sit from `INK_RADIUS`, in logical units.
 *
 * The item's bound: one unit, of the `80` the figure is.
 */
const RADIUS_TOLERANCE = 1;

/**
 * How far the released life may sit from `INK_LIFE`, in seconds.
 *
 * The item's bound: a tick, plus a hair for the arithmetic. The reading is taken
 * one tick after the key went down and specs/sensing.md does not fix whether the
 * cloud ages on the tick it was made, so a conforming build reports `3` or
 * `3 - TICK_DT`.
 */
const LIFE_TOLERANCE = TICK_DT + 1e-9;

/**
 * How far the centre may drift from where it was released, in logical units.
 *
 * A hundredth of a unit: "it stays fixed at the point it was released" with room
 * for a build that keeps the point in single precision and none for a cloud that
 * follows anything.
 */
const CENTRE_TOLERANCE = 0.01;

/**
 * How long the forager stands away from its own cloud, in ticks.
 *
 * A second, which is long enough for a cloud that meant to follow the forager to
 * have covered the ground.
 */
const SWIM_TICKS = TICK_HZ;

/**
 * How far along the run the forager is carried, in tiles.
 *
 * Four, which is `128` logical units — past the `INK_RADIUS` (`80`) the cloud
 * reaches, so a cloud that had followed the forager would be somewhere else
 * entirely rather than a rounding away.
 */
const AWAY_TILES = 4;

/** Where `remaining` is read against the clock, in ticks after the release. */
const LIFE_SAMPLE_TICKS = [TICK_HZ, 2 * TICK_HZ] as const;

/**
 * How far `remaining` may sit from the seconds the clock says are left, in
 * seconds.
 *
 * Two ticks: one for where inside the release tick the cloud was made, and one
 * for a build that runs the life down before rather than after the rest of its
 * step.
 */
const RUNDOWN_TOLERANCE = 2 * TICK_DT;

/** Where the tick-by-tick sweep for the cloud's end opens, in ticks. */
const SWEEP_FROM_TICKS = Math.round((INK_LIFE - 0.2) * TICK_HZ);

/**
 * How long that sweep runs, in ticks after the release.
 *
 * A hard ceiling a fifth of a second past `INK_LIFE`, so a cloud that outstays
 * its life FAILS here rather than leaving the point undecided.
 */
const SWEEP_MAX_TICKS = Math.round((INK_LIFE + 0.2) * TICK_HZ);

/**
 * How far the moment the cloud leaves the list may sit from `INK_LIFE`, in
 * seconds.
 *
 * Three ticks: the two of {@link RUNDOWN_TOLERANCE}, and one for the resolution
 * of a sweep that samples every tick.
 */
const GONE_TOLERANCE = 3 * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("releases a cloud of INK_RADIUS that stands where it was left for INK_LIFE and then goes", async () => {
  startPlaying(h);
  const run = await poseStraightRun(h, RUN_TILES);
  await parkForager(h, run.start);
  // The forager is moved away from its own cloud, so it is not held to where it
  // was parked. What the guard still catches is a life lost or the dive leaving
  // live play, either of which clears every cloud on the board.
  const watch = await sceneGuard(h, { foragerParked: false });

  const cloud = await captureReplay(h, "cloud", async () => {
    h.debug.setInkCooldown(0);
    const before = h.snapshot();
    await h.tap(INK_KEY);
    const released = h.snapshot();
    const opened = released.inkClouds[0];
    if (opened === undefined) {
      fail(
        `pressing ${INK_KEY} in live play to release a cloud; ` +
          "specs/movement.md binds the `b` action to it and specs/sensing.md " +
          "has a cloud appear when ink's cooldown is 0",
        `no cloud, with ink.ready ${String(before.ink.ready)} at the press`,
      );
    }

    // Away down the corridor, past the cloud's own radius. The forager is
    // CARRIED there rather than driven: this point is about a cloud staying
    // where it was left, and whether a held action moves the forager is the
    // movement points' subject rather than this one's.
    h.debug.setForagerTile(run.start.tx + AWAY_TILES, run.start.ty);
    await h.advance(SWIM_TICKS);
    const swum = h.snapshot();

    // The life, read against the clock.
    const life: { elapsed: number; remaining: number | null }[] = [];
    let stood = 1 + SWIM_TICKS;
    for (const at of LIFE_SAMPLE_TICKS) {
      if (at > stood) {
        await h.advance(at - stood);
        stood = at;
      }
      const snapshot = h.snapshot();
      life.push({
        elapsed: snapshot.simTime - before.simTime,
        remaining: snapshot.inkClouds[0]?.remaining ?? null,
      });
    }

    // And the end of it, to the tick.
    await h.advance(SWEEP_FROM_TICKS - stood);
    let gone: number | null = null;
    for (let tick = SWEEP_FROM_TICKS; tick <= SWEEP_MAX_TICKS; tick += 1) {
      const snapshot = h.snapshot();
      if (snapshot.inkClouds.length === 0) {
        gone = snapshot.simTime - before.simTime;
        break;
      }
      await h.advance(1);
    }

    return { before, released, opened, swum, life, gone };
  });

  requireSceneHeld(h.snapshot(), watch);

  // Its size and its life, as released.
  assertLessThanOrEqual(
    Math.abs(cloud.opened.radius - INK_RADIUS),
    RADIUS_TOLERANCE,
    `|radius - INK_RADIUS| on the cloud one tick after it was released`,
  );
  assertLessThanOrEqual(
    Math.abs(cloud.opened.remaining - INK_LIFE),
    LIFE_TOLERANCE,
    `|remaining - INK_LIFE| on the cloud one tick after it was released`,
  );

  // It stays where it was left while the forager stands off.
  const standing = cloud.swum.inkClouds[0];
  assertEqual(
    standing !== undefined,
    true,
    `the cloud still standing ${SWIM_TICKS} ticks after it was released, of ` +
      `the ${INK_LIFE} s INK_LIFE gives it`,
  );
  if (standing !== undefined) {
    assertGreaterThan(
      Math.hypot(
        cloud.swum.forager.x - standing.x,
        cloud.swum.forager.y - standing.y,
      ),
      standing.radius,
      "how far the forager had swum from its own cloud's centre by the time " +
        "the centre was read again, against the cloud's own radius",
    );
    assertLessThanOrEqual(
      Math.hypot(standing.x - cloud.opened.x, standing.y - cloud.opened.y),
      CENTRE_TOLERANCE,
      `how far the cloud's centre moved over the ${SWIM_TICKS} ticks the ` +
        "forager spent standing away from it, in logical units",
    );
  }

  // Its life runs down against simulated time.
  for (const sample of cloud.life) {
    const expected = INK_LIFE - sample.elapsed;
    assertEqual(
      sample.remaining !== null,
      true,
      `the cloud still standing ${sample.elapsed.toFixed(3)} s in, with ` +
        `${expected.toFixed(3)} s of INK_LIFE left`,
    );
    if (sample.remaining === null) continue;
    assertLessThanOrEqual(
      Math.abs(sample.remaining - expected),
      RUNDOWN_TOLERANCE,
      `|remaining - ${expected.toFixed(3)}| at ${sample.elapsed.toFixed(3)} s ` +
        "after the release",
    );
  }

  // And it leaves the list when the life is spent.
  assertEqual(
    cloud.gone !== null,
    true,
    `the cloud left inkClouds within ${SWEEP_MAX_TICKS} ticks of the release, ` +
      `of the ${INK_LIFE} s INK_LIFE gives it`,
  );
  if (cloud.gone !== null) {
    assertLessThanOrEqual(
      Math.abs(cloud.gone - INK_LIFE),
      GONE_TOLERANCE,
      "|elapsed - INK_LIFE| at the tick the cloud left inkClouds, measured " +
        "from the tick it was released on",
    );
  }
});

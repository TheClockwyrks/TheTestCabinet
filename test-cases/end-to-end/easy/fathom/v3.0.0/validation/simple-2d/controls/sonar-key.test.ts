// controls/sonar-key — Space puts a sonar pulse in flight.
//
// specs/movement.md binds the `a` action to `Space` and gives it one job in live
// play: "Emits a sonar pulse". specs/sensing.md fixes what goes out — "A pulse is
// emitted when its cooldown is `0`" — and specs/state.md fixes what the snapshot
// then carries for it: a `pulses` entry whose `source` is `"forager"`, whose
// `tint` is `"cyan"` ("`"cyan"` for the forager's pulse"), whose `ox`, `oy` are
// "the tile it originated from", and whose `range` is "the furthest it will
// travel". specs/progression.md closes the loop on that last one: "`E` is
// reported as `sonar.range`, and it is the range every pulse the forager emits
// carries, reported as that pulse's `range`."
//
// THE COOLDOWN IS POSED, NOT WAITED OUT. `setSonarCooldown(0)` leaves the pulse
// ready (specs/instrumentation.md), which is the premise this point's own
// description states. How the cooldown runs down from there is `sonar/cooldown`'s
// verdict, and how the wavefront then travels is `sonar/wavefront`'s; neither is
// read here.
//
// THE FORAGER IS A BYSTANDER, parked facing rock. It has to be: the pulse's origin
// tile is the tile the forager was standing on when the key landed, so a forager
// that drifted between the press and the read would make the origin unreadable
// without saying anything about the key.
//
// WHY THE PULSE IS READ A BEAT AFTER THE PRESS rather than on the frame the key
// arrives. A build may raise the pulse in the input step or at the top of the
// following one, and both conform, so the read is taken a few ticks later while
// the front is still far inside its range.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotEqual,
  assertNull,
} from "../assert";
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

/** The key specs/movement.md binds the `a` action to. */
const KEY = "Space";

/**
 * The corridor the pulse floods, in tiles.
 *
 * Twelve, so the wavefront has more corridor ahead of it than the `9` tiles of
 * path range depth 1 gives it and the clip shows a flood rather than a wall.
 */
const RUN_TILES = 12;

/** Ticks at rest before the key goes down, so the clip opens on a quiet maze. */
const REST_TICKS = 24;

/**
 * Ticks between the press and the reading.
 *
 * A beat, not a measurement: `tap` runs the one frame that delivers the key, and
 * these follow it, so a build that raises the pulse on the input step and one
 * that raises it at the top of the next both read the same. At
 * `SONAR_WAVE_SPEED` (`14` steps a second) five more ticks carry the front under
 * half a tile, which is nowhere near the `9` it ends at.
 */
const BEAT_TICKS = 5;

/**
 * Ticks held after the reading, so the clip carries the whole flood.
 *
 * `9` tiles of range at `14` steps a second is `0.64 s`, or 78 ticks; ninety
 * covers it with room to spare. Nothing measured moves — the readings above are
 * already taken.
 */
const TAIL_TICKS = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits a forager sonar pulse on Space", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    await poseStraightRun(h, RUN_TILES);
    const quiet = await denAll(h);
    await parkForager(h);
    await clearUnderfoot(h);
    h.debug.setSonarCooldown(0);
    const watch = await sceneGuard(h, quiet);

    const read = await captureReplay(h, "ping", async () => {
      await h.advance(REST_TICKS);
      const armed = h.snapshot();
      await h.tap(KEY);
      await h.advance(BEAT_TICKS);
      const flying = h.snapshot();
      await h.advance(TAIL_TICKS);
      return { armed, flying };
    });

    assertNull(sceneHeld(h.snapshot(), watch), "the scenario held to the end");

    // The premise this point's own description states, posed through
    // `setSonarCooldown(0)`: "At `0` the pulse is ready and the snapshot reports
    // `sonar.ready` as `true`" (specs/instrumentation.md).
    assertEqual(
      read.armed.sonar.ready,
      true,
      "the pulse is ready when the key is pressed, the cooldown having been posed to 0",
    );

    const before = read.armed.pulses.filter(
      (pulse) => pulse.source === "forager",
    );
    const after = read.flying.pulses.filter(
      (pulse) => pulse.source === "forager",
    );
    assertGreaterThan(
      after.length,
      before.length,
      `forager pulses in flight ${BEAT_TICKS + 1} ticks after Space (was ` +
        `${before.length})`,
    );
    // Nothing below can read a pulse that is not there, and a wrong count above
    // is the whole finding.
    assertNotEqual(after.length, 0, "a pulse to read");

    const pulse = after[0];
    assertEqual(pulse.tint, "cyan", "the forager's pulse is tinted cyan");
    assertEqual(
      pulse.ox,
      read.armed.forager.tx,
      "the pulse originates from the forager's own column",
    );
    assertEqual(
      pulse.oy,
      read.armed.forager.ty,
      "the pulse originates from the forager's own row",
    );
    assertEqual(
      pulse.range,
      read.armed.sonar.range,
      `the pulse carries the depth ${read.armed.depth} path range the snapshot ` +
        `reports as sonar.range`,
    );
  });
});

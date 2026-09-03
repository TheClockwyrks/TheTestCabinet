// lamplighter/world-unbounded — far from the origin the lamplighter still moves
// MOVE_STEP a tick, because no edge stops it.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The plane"): "The world is
// an unbounded plane measured in units ... nothing bounds how far from it the
// lamplighter may walk", and ("Movement") "The world is unbounded, so no edge
// stops the lamplighter." The step it takes is the one "Movement" fixes for
// every tick anywhere: the direction times `moveSpeed` times `TICK_DT`, so a
// held ArrowRight with no Bellows moves it `MOVE_STEP` (`180 / 60 = 3`) along
// `+x` on each tick, at `(5000, -5000)` exactly as at the origin. A build
// whose world is a bounded field clamps at its edge, and a lamplighter posed
// well past any stage-sized or several-stages-sized bound either stops or is
// pulled back, which misses the step on every tick.
//
// THE NIGHT. An isolated run (`isolate`): the lamplighter alone, every driver
// switch off, nothing alive, and the level out of reach, then posed to
// `(5000, -5000)` through `setPlayerPosition` (specs/instrumentation.md: "Sets
// the lamplighter's center to `(x, y)`. Nothing else moves"). The key is a real
// key event held for `HOLD_TICKS` frames.
//
// TOLERANCE. `POSITION_TOL` (`1e-6`) on each per-tick step, the case's
// allowance for a position integrated over ticks; at a magnitude of `5000` a
// double still resolves to `1e-12`, far inside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOVE_STEP, POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  holdKeysWatching,
  isolate,
  player,
  tickSteps,
  type Harness,
} from "../harness";

/** Where the lamplighter is posed: several stages from the origin on both axes. */
const FAR_X = 5000;
const FAR_Y = -5000;

/** Half a second of the hold, read one tick at a time. */
const HOLD_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the lamplighter MOVE_STEP a tick under a held ArrowRight at (5000, -5000)", async () => {
  await isolate(h);
  await h.debug.setPlayerPosition(FAR_X, FAR_Y);
  const posed = await h.snapshot();
  assertEqual(player(posed).x, FAR_X, "player.x as posed");
  assertEqual(player(posed).y, FAR_Y, "player.y as posed");

  const ticks = await captureReplay(h, "far", () =>
    holdKeysWatching(h, ["ArrowRight"], HOLD_TICKS),
  );

  assertEqual(ticks.length, HOLD_TICKS, "the frames the hold ran");
  const steps = tickSteps(posed, ticks);
  steps.forEach((step, i) => {
    assertEqual(
      ticks[i]!.screen,
      "playing",
      `the screen on tick ${i + 1} of the hold`,
    );
    assertNear(
      step.x,
      MOVE_STEP,
      POSITION_TOL,
      `the lamplighter's step along x on tick ${i + 1} of the hold far from the origin, in units`,
    );
    assertNear(
      step.y,
      0,
      POSITION_TOL,
      `the lamplighter's step along y on tick ${i + 1} of the hold far from the origin, in units`,
    );
  });
});

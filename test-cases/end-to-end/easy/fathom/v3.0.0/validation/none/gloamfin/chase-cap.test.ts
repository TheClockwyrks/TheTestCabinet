// gloamfin/chase-cap — it chases at GLOAMFIN_CHASE_SPEED.
//
// THE CLAIM. `specs/predators/gloamfin.md` gives a chasing Gloamfin "its chase
// speed, at most `GLOAMFIN_CHASE_SPEED` (`134`)", and says "a fresh acquisition
// opens the chase at `GLOAMFIN_CHASE_SPEED`, above the forager's own speed". So on
// a run with no turn in it the chase speed is the cap from the first step, it
// stays there, and it stands above `FORAGER_SPEED` (`128`,
// `specs/movement.md`) — which is the whole reason a Gloamfin is dangerous once it
// has heard you.
//
// READ TWICE OVER. `specs/state.md` reports `speed` as "its current speed, in
// logical units per second", and this reads that AND the ground actually covered
// over the same window. A build that reports the cap and travels at its patrol
// speed passes one of those and fails the other, and so does the reverse.
//
// THE RUN IS POSED, AND IT IS STRAIGHT. The same file costs the Gloamfin its edge
// at every corner — "the chase speed drops to `GLOAMFIN_CORNER_SPEED` (`115`)" —
// so a chase measured across a bend measures the ramp back out of that corner
// rather than the cap. A single corridor posed as the whole board
// (`specs/instrumentation.md` exempts a fixture from `specs/maze.md`) leaves no
// bend to turn, and the Gloamfin is faced along it so that the pose does not put a
// turn into the first step either.
//
// AND IT IS LONG. The window plus its tail is under three tiles' worth of the
// eleven tiles between them, so a conforming Gloamfin is still four tiles short of
// the forager's tile when the clip ends — the distance `specs/gameplay.md` makes
// contact at — and the evidence for a chase-speed point is a chase rather than a
// catch and a countdown.
//
// WHAT THIS DOES NOT DECIDE. What a corner costs (`gloamfin/corners-slow`), what a
// patrol travels at (`gloamfin/wander-speed`), or how the fix was taken
// (`gloamfin/fix-and-alert`).

import { afterEach, beforeEach } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { FORAGER_SPEED, GLOAMFIN_CHASE_SPEED, TICK_HZ } from "../constants";
import { placePredator, poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  type Harness,
  startPlaying,
} from "../harness";
import {
  check,
  denAll,
  quietBoard,
  requireKind,
  requirePredatorMotion,
  requireSceneHeld,
  sceneGuard,
} from "../scene";
import { gloamfinOf, groundBetween } from "./pings";

/**
 * The fixture: one straight corridor with the forager on `F` and the Gloamfin
 * eleven tiles along it on `P`.
 */
const RUN = ["F" + ".".repeat(10) + "P"];

/**
 * The window the speed is measured over, and the ticks of settling before it.
 *
 * A whole second, which a conforming build covers `GLOAMFIN_CHASE_SPEED` (`134`)
 * logical units of — four tiles, far more ground than any rounding. The settle is
 * there because `setPredatorTile` leaves a predator with no heading
 * (`specs/instrumentation.md`), so the first steps after a pose are a hunter
 * getting under way rather than one running.
 */
const MEASURE_TICKS = TICK_HZ;
const SETTLE_TICKS = 12;

/** Ticks held past the reading, purely so the clip shows a run rather than a step. */
const TAIL_TICKS = 60;

/**
 * How far either reading may sit from `GLOAMFIN_CHASE_SPEED`, as a fraction.
 *
 * Two percent, the review item's own bound, which is `2.68` logical units a second
 * here. Every other speed this specification gives the Gloamfin is far outside it:
 * `PREDATOR_SPEED` (`116`) is thirteen percent away and `GLOAMFIN_CORNER_SPEED`
 * (`115`) fourteen, so nothing inside the band is a speed a wrong build would
 * plausibly be reporting instead.
 */
const SPEED_TOLERANCE = 0.02;
const SPEED_SLACK = GLOAMFIN_CHASE_SPEED * SPEED_TOLERANCE;

/**
 * How far above the cap a reading may sit and still count as at it.
 *
 * A hundredth of a unit a second, which is arithmetic noise rather than speed. The
 * cap is a ceiling in the specification's own words — "at most
 * `GLOAMFIN_CHASE_SPEED`" — so this bound is deliberately not the two percent
 * above.
 */
const CAP_SLACK = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

check("It chases at GLOAMFIN_CHASE_SPEED", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, RUN);
  const index = requireKind(await h.snapshot(), "gloamfin");
  const quiet = await denAll(h, [index]);
  // The forager first, and parked: `setPredatorState(index, "chase")` fixes on
  // "the forager's current tile" (specs/instrumentation.md), so it has to be
  // standing at the far end of the run by the time the Gloamfin is posed.
  await quietBoard(h, board.mark("F"));
  await placePredator(h, index, board.mark("P"), {
    // Faced down the corridor at the forager. A heading pointing anywhere else
    // would put a turn into the opening steps, and this point measures the run
    // rather than the turn.
    dir: "left",
    state: "chase",
  });
  const guard = await sceneGuard(h, quiet);

  const opening = await h.snapshot();

  const run = await captureReplay(h, "cap", async () => {
    await h.advance(SETTLE_TICKS);
    let previous = gloamfinOf(await h.snapshot(), index);
    const from = previous;
    let ground = 0;
    let reported = 0;
    let fastest = Number.NEGATIVE_INFINITY;
    const states = new Set<string>();
    for (let tick = 0; tick < MEASURE_TICKS; tick += 1) {
      await h.advance(1);
      const now = gloamfinOf(await h.snapshot(), index);
      ground += groundBetween(previous, now);
      reported += now.speed;
      fastest = Math.max(fastest, now.speed);
      states.add(now.state);
      previous = now;
    }
    const settled = await h.snapshot();
    // Past the readings, so the clip carries a run a reviewer can watch. Nothing
    // after this line reaches an assertion.
    await h.advance(TAIL_TICKS);
    return {
      from,
      to: previous,
      covered: (ground * TICK_HZ) / MEASURE_TICKS,
      reported: reported / MEASURE_TICKS,
      fastest,
      states,
      settled,
    };
  });

  requireSceneHeld(await h.snapshot(), guard);
  requirePredatorMotion(
    opening,
    run.settled,
    index,
    "chase down the straight corridor this scenario posed for it",
  );

  assertEqual(
    [...run.states].join(","),
    "chase",
    "the Gloamfin's state across the window — this point measures a CHASE, and " +
      "specs/predators/gloamfin.md gives a wander and a search speeds of their own",
  );
  assertLessThanOrEqual(
    Math.abs(run.reported - GLOAMFIN_CHASE_SPEED),
    SPEED_SLACK,
    `how far the reported speed sat from GLOAMFIN_CHASE_SPEED ` +
      `(${GLOAMFIN_CHASE_SPEED}) over ${MEASURE_TICKS} ticks of a straight ` +
      `chase — specs/predators/gloamfin.md opens a fresh acquisition at that cap`,
  );
  assertLessThanOrEqual(
    Math.abs(run.covered - GLOAMFIN_CHASE_SPEED),
    SPEED_SLACK,
    `how far the ground it actually covered sat from GLOAMFIN_CHASE_SPEED ` +
      `(${GLOAMFIN_CHASE_SPEED}) logical units a second, over ` +
      `${MEASURE_TICKS} ticks`,
  );
  assertLessThanOrEqual(
    run.fastest,
    GLOAMFIN_CHASE_SPEED + CAP_SLACK,
    `the fastest speed reported anywhere in the window — ` +
      `specs/predators/gloamfin.md makes GLOAMFIN_CHASE_SPEED ` +
      `(${GLOAMFIN_CHASE_SPEED}) a ceiling the chase speed is "at most"`,
  );
  assertGreaterThan(
    run.covered,
    FORAGER_SPEED,
    `the ground it covered, in logical units a second, against the forager's ` +
      `own FORAGER_SPEED (${FORAGER_SPEED}) — specs/predators/gloamfin.md opens ` +
      `the chase "above the forager's own speed"`,
  );
});

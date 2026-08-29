// gloamfin/corners-slow — every corner costs it its edge.
//
// THE CLAIM, in `specs/predators/gloamfin.md`'s own words: "on any step where the
// chase turns onto a perpendicular direction, the chase speed drops to
// `GLOAMFIN_CORNER_SPEED` (`115`), below the forager's speed. A straight run and a
// reversal are not turns and leave it alone. From there the chase speed climbs
// steadily back to `GLOAMFIN_CHASE_SPEED`, reaching it `GLOAMFIN_RAMP_TIME` (`2 s`)
// after the turn, and holds at that cap." That is four readings — the floor, that
// it is under `FORAGER_SPEED` (`128`, `specs/movement.md`), when the climb
// finishes, and that a run with no perpendicular turn in it pays nothing — and this
// point takes all four.
//
// THE CORNER IS POSED. Which junctions a maze offers, how much corridor leads into
// one and how much runs out of it are the build's own invention (`specs/maze.md`
// fixes rules, never a layout), and all three decide what a sweep across a turn can
// see. The fixture gives the chase two tiles of straight approach — enough to read
// the run before the turn — and SEVENTEEN tiles beyond the junction, because the
// ramp is two whole seconds and a conforming Gloamfin covers eleven tiles in that
// time. On a shorter arm it reaches the forager mid-ramp and what the clip shows is
// a catch.
//
// THE HEADING IS POSED TOO. `setPredatorTile` leaves a predator with no heading
// (`specs/instrumentation.md`), so the pose puts no turn into the opening step and
// the only perpendicular turn in the whole run is the one at the junction.
//
// THE REVERSAL IS A SECOND SCENARIO, because a reversal and a corner cannot happen
// in the same corridor. A Gloamfin is set chasing one way, then handed a fix on the
// other side of it, which `specs/predators.md` says it "may reverse the instant it
// acquires" — and the speed across that turnaround must not show the corner floor.
//
// WHAT THIS DOES NOT DECIDE. What the cap is on a straight run
// (`gloamfin/chase-cap`), or whether a hunter rounds rock at all
// (`maze-movement/predators-keep-to-corridors`).

import { afterEach, beforeEach } from "vitest";
import {
  assertEqual,
  assertLessThan,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import {
  FORAGER_SPEED,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_CORNER_SPEED,
  GLOAMFIN_RAMP_TIME,
  TICK_HZ,
} from "../../src/constants";
import { poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  check,
  denAll,
  parkForager,
  quietBoard,
  requireKind,
  requirePredatorMotion,
  requireSceneHeld,
  sceneGuard,
  standDown,
} from "../scene";
import { gloamfinOf, placePredator } from "./pings";

/**
 * The corner: the Gloamfin drops two tiles from `P` onto the junction `J` and
 * turns right along seventeen tiles of corridor toward the forager on `F`.
 */
const CORNER = ["P", ".", "J" + ".".repeat(16) + "F"];

/**
 * The reversal: the forager starts on `R`, the Gloamfin on `M` between them, and
 * the fix is moved to `L` once the chase is running the other way.
 */
const REVERSAL = ["L" + ".".repeat(6) + "M" + ".".repeat(6) + "R"];

/** Ticks of the corner run that are sampled, one sample per tick. */
const CORNER_TICKS = 380;

/** Ticks the corner clip runs on for past the last sample. */
const TAIL_TICKS = 60;

/**
 * Ticks skipped at the start of a run before its speeds are read.
 *
 * A predator posed onto a tile carries no heading, so its first steps are a hunter
 * getting under way. Six ticks is a twentieth of a second, far short of the
 * fifty-odd ticks of straight approach the fixture lays out.
 */
const SETTLE_TICKS = 6;

/**
 * How far a speed may sit from the figure the specification gives it, in logical
 * units a second.
 *
 * One, which is the review item's own bound on the corner floor, and the bound
 * used for the straight run and the reversal too. `GLOAMFIN_CHASE_SPEED` (`134`)
 * and `GLOAMFIN_CORNER_SPEED` (`115`) are nineteen apart, so a build that confused
 * the two misses this by eighteen.
 */
const SPEED_SLACK = 1;

/**
 * Ticks either side of the turn that the floor is looked for in.
 *
 * The drop belongs to "any step where the chase turns", and a build may report it
 * on the step its heading changes or on the step after — `specs/predators.md`
 * fixes neither, and the climb back adds under a tenth of a unit a tick, so a
 * three-tick window costs the reading nothing and settles the tie.
 */
const TURN_WINDOW = 3;

/**
 * How close to the cap counts as having reached it, in logical units a second.
 *
 * A twentieth of a unit. The climb is a steady one over `GLOAMFIN_RAMP_TIME`,
 * covering nineteen units in two seconds, so this is reached six thousandths of a
 * second before the cap itself — inside the tolerance below by a wide margin, and
 * far enough off the cap that a build's own arithmetic cannot sit just under it
 * forever.
 */
const CAP_EPSILON = 0.05;

/**
 * How far the climb may finish from `GLOAMFIN_RAMP_TIME`, in seconds.
 *
 * A tenth of a second, which is the review item's own bound. The run is sampled
 * every tick, so what this turns on is the build's ramp rather than the sweep's
 * grain.
 */
const RAMP_TOLERANCE = 0.1;

/** Ticks the reversal is watched for, once the fix has moved behind the hunter. */
const REVERSAL_TICKS = 90;

/** Ticks the chase runs one way before the fix is moved to the other side. */
const OUTBOUND_TICKS = 40;

/** One tick of a run, as the sweeps below read it. */
interface Step {
  tick: number;
  dir: string;
  state: string;
  speed: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Sample the Gloamfin once a tick for `ticks` ticks. */
async function sampleRun(index: number, ticks: number): Promise<Step[]> {
  const steps: Step[] = [];
  for (let tick = 1; tick <= ticks; tick += 1) {
    await h.advance(1);
    const now = gloamfinOf(h.snapshot(), index);
    steps.push({ tick, dir: now.dir, state: now.state, speed: now.speed });
  }
  return steps;
}

/** The index of the first sample whose heading differs from the one before it. */
function turnAt(steps: readonly Step[]): number {
  return steps.findIndex(
    (step, order) => order > 0 && step.dir !== steps[order - 1].dir,
  );
}

check("Every corner costs it its edge", async () => {
  startPlaying(h);
  const board = await poseMaze(h, CORNER);
  const index = requireKind(h.snapshot(), "gloamfin");
  const quiet = await denAll(h, [index]);
  // The forager first, and parked: a posed chase fixes on "the forager's current
  // tile" (specs/instrumentation.md), and the corner this point is about is the
  // one between the Gloamfin and that tile.
  await quietBoard(h, board.mark("F"));
  await placePredator(h, index, board.mark("P"), {
    dir: "down",
    state: "chase",
  });
  const guard = await sceneGuard(h, quiet);

  const opening = h.snapshot();
  const corner = await captureReplay(h, "corner", async () => {
    const steps = await sampleRun(index, CORNER_TICKS);
    // Past the last sample, so the clip carries a readable moment after the ramp.
    await h.advance(TAIL_TICKS);
    return steps;
  });

  requireSceneHeld(h.snapshot(), guard);
  requirePredatorMotion(
    opening,
    h.snapshot(),
    index,
    "chase down the approach and round the corner this scenario posed",
  );
  assertEqual(
    [...new Set(corner.map((step) => step.state))].join(","),
    "chase",
    "the Gloamfin's state across the corner run — a posed chase is fixed on the " +
      "forager's tile and pursuing it (specs/instrumentation.md), and the forager " +
      "stood on that tile the whole way, so a conforming hunter has nothing to " +
      "have lost",
  );

  const turn = turnAt(corner);
  if (turn < 0) {
    standDown(
      "the Gloamfin never turned onto the perpendicular arm of the posed corner, " +
        "so there was no corner for this point to measure the cost of — " +
        "specs/predators.md has a hunter holding a fix take the first step of a " +
        "shortest corridor route to it, which here is down and then right, and " +
        "whether it rounds rock at all is " +
        "maze-movement/predators-keep-to-corridors's verdict, not this one's",
    );
  }

  // A straight run costs it nothing: everything from the settle to the step
  // before the turn is the approach, and it is all at the cap.
  for (const step of corner.slice(SETTLE_TICKS, turn)) {
    assertLessThanOrEqual(
      Math.abs(step.speed - GLOAMFIN_CHASE_SPEED),
      SPEED_SLACK,
      `how far the speed at tick ${step.tick} of the STRAIGHT approach sat from ` +
        `GLOAMFIN_CHASE_SPEED (${GLOAMFIN_CHASE_SPEED}) — ` +
        `specs/predators/gloamfin.md: a straight run is not a turn and leaves ` +
        `the chase speed alone`,
    );
  }

  const around = corner.slice(
    Math.max(0, turn - 1),
    Math.min(corner.length, turn + TURN_WINDOW),
  );
  const floor = Math.min(...around.map((step) => step.speed));
  assertLessThanOrEqual(
    Math.abs(floor - GLOAMFIN_CORNER_SPEED),
    SPEED_SLACK,
    `how far the lowest speed across the turn (tick ${corner[turn].tick}, where ` +
      `the heading went ${corner[turn - 1].dir} to ${corner[turn].dir}) sat from ` +
      `GLOAMFIN_CORNER_SPEED (${GLOAMFIN_CORNER_SPEED})`,
  );
  assertLessThan(
    floor,
    FORAGER_SPEED,
    `the corner floor, against the forager's own FORAGER_SPEED ` +
      `(${FORAGER_SPEED}) — specs/predators/gloamfin.md puts the drop "below the ` +
      `forager's speed", which is what makes a corner an escape`,
  );

  // THE CLIMB IS MEASURED PAST THE DROP, NOT PAST THE HEADING CHANGE. A build may
  // report the corner floor on the step its heading turns or on the step after —
  // `specs/predators.md` fixes neither — and on the second of those the step the
  // heading turned on still reports the cap. Searching for the cap from the first
  // step that is CLEARLY off it reads the same climb under both conventions, and
  // it is still timed from the turn itself, which is what the specification dates
  // `GLOAMFIN_RAMP_TIME` from.
  const dropped = corner.findIndex(
    (step, order) =>
      order >= turn - 1 && step.speed < GLOAMFIN_CHASE_SPEED - SPEED_SLACK,
  );
  const regained = corner.findIndex(
    (step, order) =>
      order > dropped && step.speed >= GLOAMFIN_CHASE_SPEED - CAP_EPSILON,
  );
  assertTrue(
    dropped >= 0 && regained > dropped,
    `the Gloamfin climbed back to GLOAMFIN_CHASE_SPEED ` +
      `(${GLOAMFIN_CHASE_SPEED}) within the ${CORNER_TICKS - turn} ticks watched ` +
      `after the turn — specs/predators/gloamfin.md has the chase speed climb ` +
      `steadily back to the cap and hold there`,
  );
  assertLessThanOrEqual(
    Math.abs((regained - turn) / TICK_HZ - GLOAMFIN_RAMP_TIME),
    RAMP_TOLERANCE,
    `how far the climb back to the cap sat from GLOAMFIN_RAMP_TIME ` +
      `(${GLOAMFIN_RAMP_TIME} s) after the turn; it took ` +
      `${((regained - turn) / TICK_HZ).toFixed(3)} s`,
  );

  // ---- And a reversal costs it nothing --------------------------------------
  //
  // A fresh board, so the chase speed this reads is not the one the corner above
  // left behind.
  startPlaying(h);
  const back = await poseMaze(h, REVERSAL);
  const backIndex = requireKind(h.snapshot(), "gloamfin");
  const backQuiet = await denAll(h, [backIndex]);
  await quietBoard(h, back.mark("R"));
  await placePredator(h, backIndex, back.mark("M"), {
    dir: "right",
    state: "chase",
  });
  const backGuard = await sceneGuard(h, backQuiet, { foragerParked: false });
  // Long enough for the chase to be genuinely running one way.
  await h.advance(OUTBOUND_TICKS);
  const outbound = gloamfinOf(h.snapshot(), backIndex).dir;
  // The forager goes to the other side of it and the fix follows, which is the
  // one arrangement that asks a running chase to turn around.
  await parkForager(h, back.mark("L"));
  await h.debug.setPredatorState(backIndex, "chase");
  const reversal = await sampleRun(backIndex, REVERSAL_TICKS);

  requireSceneHeld(h.snapshot(), backGuard, { what: "the reversal scenario" });
  const turned = reversal.findIndex((step) => step.dir !== outbound);
  if (turned < 0) {
    standDown(
      `the Gloamfin never turned around after the fix moved behind it — it kept ` +
        `heading ${outbound} — so there was no reversal for this point to price; ` +
        `specs/predators.md has a hunter take the first step of a shortest ` +
        `corridor route to its fix, and whether it does is ` +
        `maze-movement/predators-keep-to-corridors's verdict, not this one's`,
    );
  }
  const slowest = Math.min(...reversal.slice(turned).map((step) => step.speed));
  assertLessThanOrEqual(
    Math.abs(slowest - GLOAMFIN_CHASE_SPEED),
    SPEED_SLACK,
    `how far the lowest speed across the reversal sat from ` +
      `GLOAMFIN_CHASE_SPEED (${GLOAMFIN_CHASE_SPEED}) — ` +
      `specs/predators/gloamfin.md: a reversal is not a turn and leaves the ` +
      `chase speed alone, so nothing here may show the ` +
      `GLOAMFIN_CORNER_SPEED (${GLOAMFIN_CORNER_SPEED}) floor`,
  );
});

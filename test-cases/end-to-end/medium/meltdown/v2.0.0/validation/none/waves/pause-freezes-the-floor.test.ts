// waves/pause-freezes-the-floor — while the game is paused, the floor does not
// advance.
//
// `specs/waves.md`, Pause and speed: "While the game is paused the simulation does
// not advance: nothing moves, no heat changes, no clock counts down, no unit is
// released, and `simTime` holds where it was."
//
// THE READING IS A CONTRAST OVER TWO WINDOWS OF THE SAME LENGTH, because a frozen
// floor and a floor that never moved look identical in one window:
//
//   - THE RUNNING LEG. Before the press, the Mote must travel more than
//     PAUSE_MIN_TRAVEL. This is what stops a dead build passing vacuously, and it
//     is not a second requirement smuggled in: without it the item would be
//     satisfied by a game that never advances at all.
//   - THE PAUSED LEG. After the press, its drift must stay under PAUSE_MAX_DRIFT
//     and `simTime` must gain less than PAUSE_MAX_CLOCK_DRIFT. Two readings of the
//     one claim, since a build could hold a position while its clock ran on, or
//     hold its clock while the floor slid.
//
// EACH LEG IS A STATED NUMBER OF FRAMES DRIVEN THROUGH `advance`, never a stretch
// of real time. `specs/instrumentation.md` makes each of those frames "a real
// frame, the same update the loop runs followed by a render", so the frames a
// paused build is handed are the frames its player's loop would hand it, and what
// the floor does across them is the floor's. The same frames land on any machine,
// so nothing here measures how busy the host was.
//
// THE PAUSE IS PRESSED, NOT POSED. It goes through the key `specs/controls.md`
// binds the action to, delivered through Chromium and held across one frame, and
// never through `setScreen`, which "runs no screen entry effect"
// (`specs/instrumentation.md`) and would announce the answer.
//
// BOTH READINGS OF THE PAUSED LEG COME FROM THE ONE SNAPSHOT TAKEN ON THE PRESS,
// so the pair spans the paused window and nothing else.
//
// THE TOLERANCES ARE NON-ZERO ON PURPOSE. A build is free to resolve an injected
// key on its next frame rather than inside the event, so a conformant build may
// run one more frame after the key goes down. Each bound below says how many.
//
// THE FLOOR HOLDS ONE MOTE AND NOTHING ELSE. `poseRunningFloor` empties both
// rosters through `startRun`, leaves the world gate shut so no unit arrives beside
// it, and adds one walker with its motion on — so what a window measures is the
// game's own locomotion rather than a position this check wrote.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { SURGE_DEFS } from "../constants";
import {
  captureReplay,
  createHarness,
  distance,
  framesFor,
  requireUnit,
  startRun,
  tapAction,
  type Harness,
} from "../harness";
import { poseRunningFloor } from "./run";

/**
 * The game time each leg covers: a second and a half, in frames of the suite's
 * `120` Hz clock.
 *
 * Geometry rather than a tolerance — it says how long the leg is, not how far a
 * build may miss by. A Mote's specified `60` logical units per second
 * (`specs/surge.md`) carries it `90` units, four and a half tiles, in that much
 * game time: far more than any bound below.
 */
const LEG_SECONDS = 1.5;
const LEG_FRAMES = framesFor(LEG_SECONDS);

/**
 * How far the Mote must travel in the running leg: `20` logical units.
 *
 * Derived from the `90` a specified Mote covers in {@link LEG_SECONDS} of game
 * time: a build that walks at a third of its specified pace still clears it. It
 * is also five times PAUSE_MAX_DRIFT, so a build whose floor is frozen in BOTH
 * legs cannot reach it and pass.
 */
const PAUSE_MIN_TRAVEL = 20;

/**
 * How far the Mote may drift in the paused leg: `4` logical units.
 *
 * A build that latches the key in its event handler is frozen before the
 * reading; a build that compares held state at the top of its next frame runs
 * one more frame first, which at `60` units per second and a hundred-and-
 * twentieth of a second is half a unit. Four units is eight such frames, and it
 * is a twenty-second of the `90` a running window covers — so a floor that keeps
 * running cannot hide inside it.
 */
const PAUSE_MAX_DRIFT = 4;

/**
 * How much `simTime` may gain in the paused leg: a tenth of a second.
 *
 * The same argument on the clock rather than on the position. One late frame of
 * the suite's clock is a hundred-and-twentieth of a second, so a tenth is twelve
 * of them, and it is a fifteenth of the `1.5` seconds the running leg gains.
 */
const PAUSE_MAX_CLOCK_DRIFT = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds the floor still across a paused window it walked across unpaused", async () => {
  await startRun(h);
  const mote = await poseRunningFloor(h);

  const legs = await captureReplay(h, "frozen", async () => {
    const opened = await h.snapshot();
    await h.advance(LEG_FRAMES);
    await tapAction(h, "pause");
    // The ONE snapshot on the press. Both readings of the paused leg are taken
    // from it, so the pair spans the paused window and nothing else.
    const pressed = await h.snapshot();
    await h.advance(LEG_FRAMES);
    return { opened, pressed, settled: await h.snapshot() };
  });

  const at = (snapshot: typeof legs.opened) =>
    requireUnit(snapshot, mote, "the two windows");

  assertGreaterThan(
    distance(at(legs.opened), at(legs.pressed)),
    PAUSE_MIN_TRAVEL,
    `the units a Mote at its specified ${SURGE_DEFS.mote.speed} a second travelled across the ${LEG_SECONDS} seconds of the running leg`,
  );
  assertEqual(
    legs.pressed.screen,
    "paused",
    "precondition: the pause key reached the game and paused it",
  );
  assertLessThan(
    distance(at(legs.pressed), at(legs.settled)),
    PAUSE_MAX_DRIFT,
    `the units the Mote drifted across a paused window of the same length`,
  );
  assertLessThan(
    legs.settled.simTime - legs.pressed.simTime,
    PAUSE_MAX_CLOCK_DRIFT,
    "the seconds simTime gained across the paused window",
  );
});

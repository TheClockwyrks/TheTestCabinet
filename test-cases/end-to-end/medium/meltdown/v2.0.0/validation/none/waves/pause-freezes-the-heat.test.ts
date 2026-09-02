// waves/pause-freezes-the-heat — while the game is paused, no heat changes.
//
// `specs/waves.md`, Pause and speed: "While the game is paused the simulation does
// not advance: nothing moves, NO HEAT CHANGES, no clock counts down, no unit is
// released, and `simTime` holds where it was".
//
// THE SAME MEASUREMENT AS `waves/pause-freezes-the-floor`, TURNED ON THE
// SIGNATURE SYSTEM, and its own item because a build can freeze one and not the
// other. Heat is resolved on its own pass of the frame (`specs/heat.md`), so a
// pause implemented as "stop advancing the surge" leaves every emitter heating
// and cooling behind the pause menu, and a pause implemented as "stop drawing the
// frame" freezes neither. The floor item cannot see either defect, and this one
// cannot see a frozen clock over a sliding floor.
//
// ================================ THE CLOCK RULE ============================
//
// ANY CHECK ABOUT WHETHER TIME PASSES IS MEASURED ON THE CLOCK THE PLAYER'S GAME
// ACTUALLY RUNS ON, NEVER THROUGH A STEPPING OPERATION, BECAUSE THE STEPPING
// OPERATION IS INSTRUMENTATION AND THE QUESTION IS ABOUT THE GAME. `advance` is
// an operation of a surface a build may gate separately from its own frame loop,
// so a check driven through it measures where the pause gate sits rather than
// whether the heat moved. So nothing steps the game here: `withOwnClock` hands
// the clock back and the build's own loop schedules its own frames, the pause is
// a real key pressed through Chromium, and nothing inside the scope calls
// `advance` or anything built on it. TWO LEGS OF THE SAME LENGTH ON THE SAME
// TOWER, a running one its heat must move across and a paused one it must not;
// and BOTH PAUSED READINGS FROM THE ONE SNAPSHOT ON THE PRESS, so the pair spans
// the paused window and nothing else.
//
// ============================================================================
//
// THE RUNNING LEG IS NOT DECORATION: a tower whose heat never moves at all would
// satisfy a frozen paused window trivially, so the heat is required to have MOVED
// across the window before the press.
//
// THE TOWER IS A STUTTER, and the choice is what makes the two bounds far apart.
// `specs/towers.md` gives it `7.0` shots per second at `4.2` heat a shot into a
// thermal mass of `0.5`, so one shot moves its heat by `8.4` and a second and a
// half of firing is ten of them. The running leg therefore moves the heat by tens
// of points while the most a single stray frame could add is one shot's worth —
// and the drift ceiling HAS to clear one shot's worth, because a build may legally
// resolve the injected key on the frame after it arrived and that frame may be the
// one a shot lands on. An Arc, at `2.0` shots per second and `10.3` heat a shot,
// would put a legal one-frame overrun ABOVE any drift ceiling worth having: the
// check would fail a conformant build whenever a shot happened to fall in that
// frame. This is the same tower, on the same tile, against the same figures the
// other two engines' copies of this point hold, so the three read one scenario.
//
// BOTH ITS FACULTIES RUN. The tower is posed by `poseTower` alone, so its firing
// and its thermal model are both on (`specs/instrumentation.md`): the heat this
// reads is the shot gain and the air loss together, which is the heat a player
// watches. It is a firing tower rather than a posed hot one because a posed heat
// would hold still on a build with no thermal model at all, and this point is
// about a quantity that was moving until the pause stopped it.
//
// THE HEAT STARTS AT `0`, where a placed tower starts
// (`specs/instrumentation.md`), and that is asserted rather than assumed.
// `specs/heat.md` makes air cooling proportional to heat, so a tower that opened
// the window hot would shed as fast as it gained and the running leg would read a
// plateau rather than a climb. The climb also stays clear of the `100` trip, which
// would take the guns offline and end the running leg early.
//
// THE MARK CANNOT INTERFERE. `poseTarget` holds its motion and gives it hp far
// past anything the window can remove, so it cannot walk out of range, cannot die
// and cannot leak — the tower simply has a target for the whole of both legs.
//
// WHAT EVERY WRONG MODEL READS. A build whose pause leaves the heat pass running
// climbs through the paused leg exactly as it did through the running one; a build
// that stops the surge but not the emitters does the same; a build with no heat
// model fails the running leg.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertTrue,
} from "../assert";
import { BINDINGS, isEmitter, TOWER_DEFS, TRIP_HEAT } from "../constants";
import {
  captureReplay,
  createHarness,
  poseTarget,
  poseTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { GUN, MARK, poseWavePhase } from "./run";

/**
 * The game time the RUNNING leg covers, on the build's own clock: a second and a
 * half.
 *
 * Geometry rather than a tolerance. At the Stutter's specified `7.0` shots a
 * second the leg holds ten of them, so the heat it produces is several times the
 * bound below however the shots fall inside it.
 *
 * IT IS A LENGTH ON THE BUILD'S CLOCK RATHER THAN ON THE HOST'S. Nothing steps the
 * game across it — the item rests on that — but a leg that spends a fixed stretch
 * of WALL clock and then asks how much heat was made is asking how many frames a
 * busy machine handed the page. A page starved by everything else on a loaded
 * runner fires a fraction of the shots, and a build that clamps a long frame's
 * delta covers a fraction of the game time the window really took, so a correct
 * build loses the point for the load on the machine that scored it. Closed on
 * `simTime`, the leg covers the same stretch of the game however long the host
 * takes to deliver it, and `PAUSE_MIN_HEAT_GAIN` below follows from the
 * specification's fire rate rather than from the runner.
 */
const RUNNING_LEG_SECONDS = 1.5;

/**
 * The real time the running leg is given to gain {@link RUNNING_LEG_SECONDS}: a
 * minute. A ceiling on the HOST, not a bound on the build; failing to close the
 * leg at all is `waves/game-runs-on-its-own-clock`'s verdict rather than this
 * item's, so it is reported here as a precondition.
 */
const RUNNING_LEG_DEADLINE_MS = 60_000;

/**
 * The real time the PAUSED leg is spent over: as long as the running leg took, and
 * never less than a second and a half nor more than ten.
 *
 * A paused leg cannot be closed on the build's own clock, because the whole claim
 * is that the clock does not move; so it is spent in real time, and giving it the
 * real time the running leg beside it needed keeps the two comparable on a machine
 * of any speed — a heat pass that kept running gets exactly as many frames to be
 * caught in as the running leg got to prove itself with. Neither bound can fail a
 * correct build: a longer paused window only gives a broken pause more room to
 * show itself.
 */
const PAUSE_WINDOW_FLOOR_MS = 1500;
const PAUSE_WINDOW_CAP_MS = 10_000;

/**
 * How much heat must be gained across the running leg: `30`.
 *
 * `specs/towers.md` fires the Stutter at `7.0` shots a second for `4.2` heat a
 * shot into a mass of `0.5`, which is `8.4` a shot, so this leg is ten shots
 * and `84` points of gain against an air loss proportional to the heat reached — a
 * conformant build ends the leg somewhere in the sixties. The floor is under half
 * of that, so a build whose fire clock or thermal mass differs is not troubled by
 * it, and it sits well clear of the drift ceiling below. How much heat a shot adds
 * is `heat.*`'s requirement, not this item's.
 */
const PAUSE_MIN_HEAT_GAIN = 30;

/**
 * How much the heat may move across the paused leg: `9`.
 *
 * Not zero, and the figure is one shot's worth. The press and the reading are a
 * round trip apart, a build may legally resolve an injected key on the frame after
 * it arrived, and that frame may be the one on which a shot lands: one Stutter
 * shot is `4.2` heat into a mass of `0.5`, which is `8.4`. Nine clears it, and it
 * is under a third of what a leg that kept firing moves, so a heat model that goes
 * on running through the paused window, in either direction, cannot hide inside
 * it.
 */
const PAUSE_MAX_HEAT_DRIFT = 9;

/** The emitter whose heat is watched, and the mark it fires on. */
const GUN_TYPE = "stutter";
const MARK_TYPE = "mote";

/** What one of this emitter's shots adds to its heat (`specs/towers.md`). */
const GUN_DEF = TOWER_DEFS[GUN_TYPE];
const HEAT_PER_SHOT = isEmitter(GUN_DEF) ? GUN_DEF.heatPerShot : 0;

/** The paused leg's real length, from the real time the running leg took. */
function pausedWindowMs(runningElapsedMs: number): number {
  return Math.min(
    Math.max(runningElapsedMs, PAUSE_WINDOW_FLOOR_MS),
    PAUSE_WINDOW_CAP_MS,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds a firing tower's heat across a paused window it climbed across unpaused", async () => {
  await startRun(h);
  await poseWavePhase(h);
  const gun = await poseTower(h, GUN_TYPE, GUN.col, GUN.row);
  await poseTarget(h, MARK_TYPE, MARK.col, MARK.row);

  const legs = await captureReplay(h, "frozen", () =>
    h.withOwnClock(async (clock) => {
      const opened = await clock.read();
      const ran = await clock.gain(
        RUNNING_LEG_SECONDS,
        RUNNING_LEG_DEADLINE_MS,
      );
      await clock.press(BINDINGS.pause);
      // The ONE snapshot on the press: both readings of the paused leg come from
      // it, so the pair spans the paused window and nothing else.
      const pressed = await clock.read();
      await clock.settle(pausedWindowMs(ran.elapsedMs));
      return { opened, ran, pressed, settled: await clock.read() };
    }),
  );

  const heatOf = (snapshot: typeof legs.opened) =>
    requireTower(snapshot, gun, "the two windows on the build's own clock")
      .heat;

  assertEqual(
    heatOf(legs.opened),
    0,
    `precondition: the ${GUN_TYPE} opened at the heat a placed tower starts at`,
  );
  assertTrue(
    legs.ran.reached,
    `precondition: the build's own clock gained ${RUNNING_LEG_SECONDS} seconds ` +
      `with nothing stepping it, within ${RUNNING_LEG_DEADLINE_MS / 1000}s of ` +
      `real time — it gained ${(legs.pressed.simTime - legs.opened.simTime).toFixed(3)}`,
  );
  assertGreaterThan(
    heatOf(legs.pressed) - heatOf(legs.opened),
    PAUSE_MIN_HEAT_GAIN,
    `the heat a firing ${GUN_TYPE} gained across the ${RUNNING_LEG_SECONDS} ` +
      `seconds the build's own clock gained, against the ${HEAT_PER_SHOT} a shot adds`,
  );
  assertEqual(
    legs.pressed.screen,
    "paused",
    "precondition: the pause key reached the game and paused it",
  );
  assertLessThan(
    Math.abs(heatOf(legs.settled) - heatOf(legs.pressed)),
    PAUSE_MAX_HEAT_DRIFT,
    `the heat the ${GUN_TYPE} moved across the paused window of the same length, on a scale that runs to ${TRIP_HEAT}`,
  );
});

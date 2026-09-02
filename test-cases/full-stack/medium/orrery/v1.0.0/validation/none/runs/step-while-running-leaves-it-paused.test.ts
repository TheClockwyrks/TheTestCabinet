// runs/step-while-running-leaves-it-paused — `step` on a run that is going finishes
// the cycle it is in and leaves it PAUSED, so the game time that follows moves
// nothing.
//
// THE RULE. "`step` acts immediately and always leaves the run paused: a run
// mid-cycle, running or paused, completes its current cycle to the boundary"
// (`specs/editor.md`, Running the machine). What "paused" then means for the clock is
// `specs/simulation.md`: "The fraction advances only while the status is `running`, so
// pausing holds it where it is."
//
// THE CONFIGURATION. One `arm` at `(0, 0)`, rotation `0`, length `ARM_MIN_LEN` (`1`),
// on the one-cell tape `rotate-cw`, holding one mote on `(1, 0)`, the hex
// `specs/parts.md` puts its gripper on. The hold is posed with `setGrip`, "which takes
// hold with no `grab` ever running" (`specs/instrumentation.md`). Nothing else is on
// the field, so no second mote can collide. The run is left RUNNING and driven `0.5`
// of a cycle, and that fraction is read back: the press this point makes is a press on
// a run that was going, part way through a cycle.
//
// THE MOTE IS THE READING THAT MAKES THE PAUSE MEAN SOMETHING. Every cycle of
// `rotate-cw` carries the held mote one clockwise step round — `(1, 0)` to `(0, 1)` to
// `(-1, 1)` and on — so a run that went on ticking after the step would show it, and
// so would `sim.cycle`. A machine that never moved at all would show it too, in the
// reading taken right after the step.
//
// THE VERDICT. The step leaves `sim.status` `paused`, `sim.cycle` at `1`,
// `sim.fraction` at `0` and the mote on `(0, 1)`. Then four cycles' worth of game time
// is driven, and all four readings stand exactly where the step left them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { ARM_MIN_LEN, FRACTION_TOLERANCE } from "../constants";
import { at, rotateAbout } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  advanceFraction,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  stepAction,
  takeGrip,
  type Harness,
} from "../harness";

/** The arm's one spoke at rotation `0`, and the hex its gripper stands on. */
const SPOKE = 0;
const GRIPPED = at(1, 0);

/** Where the one cycle the step finishes lands the held mote. */
const LANDING = rotateAbout(GRIPPED, ORIGIN, 1);

/** How far into cycle `0` the running run is driven before the press. */
const PART_WAY = 0.5;

/** How much game time is handed to the run after the step. */
const AFTERWARDS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the run paused at the boundary, and later game time moves nothing", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, ["rotate-cw"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const carried = await spawnMote(h, GRIPPED, "dust");
  await takeGrip(h, arm, SPOKE, carried);

  await advanceFraction(h, PART_WAY, 6);

  const running = await h.snapshot();
  assertNotNull(
    running.sim,
    "the run is live and going, part way through cycle 0",
  );
  assertEqual(
    running.sim?.status,
    "running",
    "the run is running, which is the status this point presses step in",
  );
  assertNear(
    running.sim?.fraction ?? -1,
    PART_WAY,
    FRACTION_TOLERANCE,
    `the run stands at fraction ${PART_WAY}, so the step has half of cycle 0 to finish`,
  );

  const [stepped, later] = await captureReplay(h, "paused", async () => {
    await stepAction(h);
    const first = await h.snapshot();
    await advanceCycles(h, AFTERWARDS);
    return [first, await h.snapshot()] as const;
  });

  assertEqual(
    stepped.sim?.status,
    "paused",
    "step on a running run leaves sim.status paused",
  );
  assertEqual(
    stepped.sim?.cycle,
    1,
    "the step completed the current cycle to its boundary, so the counter reads 1",
  );
  assertNear(
    stepped.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "the step stopped on the boundary, with nothing of cycle 1 accumulated",
  );
  assertEqual(
    moteById(stepped, carried)?.q,
    LANDING.q,
    `the cycle the step finished carried the held mote to (${LANDING.q}, ${LANDING.r}): q`,
  );
  assertEqual(
    moteById(stepped, carried)?.r,
    LANDING.r,
    `the cycle the step finished carried the held mote to (${LANDING.q}, ${LANDING.r}): r`,
  );

  assertEqual(
    later.sim?.status,
    "paused",
    `${AFTERWARDS} cycles of game time do not resume the run the step paused`,
  );
  assertEqual(
    later.sim?.cycle,
    1,
    `${AFTERWARDS} cycles of game time complete no cycle once the step has paused the run`,
  );
  assertNear(
    later.sim?.fraction ?? -1,
    stepped.sim?.fraction ?? -1,
    FRACTION_TOLERANCE,
    "the fraction advances only while the status is running, so it stands where the step left it",
  );
  assertEqual(
    moteById(later, carried)?.q,
    LANDING.q,
    "no further cycle ran, so the held mote is where the stepped cycle left it: q",
  );
  assertEqual(
    moteById(later, carried)?.r,
    LANDING.r,
    "no further cycle ran, so the held mote is where the stepped cycle left it: r",
  );
});

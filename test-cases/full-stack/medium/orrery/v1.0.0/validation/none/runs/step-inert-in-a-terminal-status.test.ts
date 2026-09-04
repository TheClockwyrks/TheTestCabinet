// runs/step-inert-in-a-terminal-status — once a run has stopped, `step` is a key
// the editor does not read.
//
// THE RULE. "While the status is `running` or `paused`, `play` toggles between
// the two and `speed-up` and `speed-down` move the speed step; while it is
// `faulted` or `complete`, `play`, `STEP`, and the speed actions do nothing"
// (`specs/editor.md`, Running the machine). `specs/controls.md` says it as a
// routing rule: on the `editor` screen at `faulted` or `complete` the live
// actions are "`back` and `mute`, and `up`, `down`, and `confirm` while the
// solved panel of `specs/ui.md` is up", and "an action a row omits does nothing
// on that screen". The simulation says it from underneath as well: "A fault
// freezes the run where it stood ... and nothing advances further"
// (`specs/simulation.md`, Faults).
//
// THE CONFIGURATION is both terminal statuses, because the rule names both, and
// each is posed so that a cycle running WOULD SHOW — a machine that has nothing
// left to do makes "no cycle runs" unfalsifiable:
//
//   * `complete` — a `set` at the origin whose tally is posed at
//     `CONSTELLATION_TARGET - 1` with one `sol` on its footprint, and beside it an
//     arm on `(0, 3)` holding a `sol` on a tape of `rotate-cw`. The delivery
//     completes the run at the boundary of cycle `0`, with the arm mid-tape: one
//     further cycle would turn it again and carry its mote off the hex it landed
//     on.
//   * `faulted` — the collision `specs/simulation.md` works through as example A:
//     "An arm at `(0, 0)`, length 1, carries a mote from `(1, 0)` toward `(0, 1)`
//     with `rotate-cw`. A mote rests on `(1, 1)`", which is "`36.10` at
//     `t = 3/8`" and faults. The freeze is therefore MID-MOTION, at a fraction
//     that is neither `0` nor `1`, so any further time at all moves the fraction
//     and the drawn positions derived from it.
//
// THE VERDICT. Three presses of `step` leave the status, the cycle counter, the
// fraction, the fault, the tallies, every mote's hex and drawn position, every
// live pose and every grip exactly where the terminal boundary left them. Three
// rather than one because `step` "runs one full cycle" whenever it is read at
// all, so a build that read it could not be mistaken for one that rounded.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { CONSTELLATION_TARGET, FRACTION_TOLERANCE } from "../constants";
import { at } from "../field";
import { armPart, setPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  openBareRun,
  openRun,
  partIds,
  spawnMote,
  stepAction,
  takeGrip,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The turning arm's anchor in the completing scenario, well clear of the set. */
const TURNER = at(0, 3);

/** Its gripper hex at rest: length 1 along spoke 0, which is east. */
const TURNER_GRIP = at(1, 3);

/** One set at the origin, and one arm that turns clockwise every cycle. */
const COMPLETING = solution([
  setPart(0, ORIGIN.q, ORIGIN.r),
  armPart("arm", TURNER.q, TURNER.r, 0, 1, ["rotate-cw"]),
]);

/** Example A of `specs/simulation.md`'s collision table: one arm, one sweep. */
const COLLIDING = solution([
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-cw"]),
]);

/** Where example A's carried mote starts, and where its resting mote sits. */
const CARRIED_FROM = at(1, 0);
const RESTING_ON = at(1, 1);

/** Everything of a stopped run that a press of `step` must leave alone. */
function stopped(snapshot: OrrerySnapshot): unknown {
  const sim = snapshot.sim;
  return {
    status: sim?.status,
    cycle: sim?.cycle,
    fault: sim?.fault,
    tallies: sim?.tallies,
    motes: sim?.motes.map((mote) => ({
      id: mote.id,
      q: mote.q,
      r: mote.r,
      x: mote.x,
      y: mote.y,
    })),
    poses: sim?.poses,
    grips: sim?.grips,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs no cycle and holds the status when step is pressed in either terminal status", async () => {
  /* -- complete ---------------------------------------------------------- */

  await openRun(h, { challenge: BARE, machine: COMPLETING });
  const completingIds = await partIds(h);
  const turner = completingIds[1] as number;

  const carried = await spawnMote(h, TURNER_GRIP, "sol");
  await takeGrip(h, turner, 0, carried);
  await spawnMote(h, ORIGIN, "sol");
  await h.debug.setTally(0, CONSTELLATION_TARGET - 1);

  await advanceCycles(h, 1);

  const completed = await h.snapshot();
  assertNotNull(
    completed.sim,
    "the run is still reported once it has completed",
  );
  assertEqual(
    completed.sim?.status,
    "complete",
    "the delivery reached the target, so the run is in a terminal status",
  );
  assertLength(
    gripsOf(completed, turner),
    1,
    "the arm is still holding, so a further cycle would carry its mote somewhere",
  );

  await stepAction(h);
  await stepAction(h);
  await stepAction(h);
  await captureStill(h, "inert");

  const afterComplete = await h.snapshot();
  assertDeepEqual(
    stopped(afterComplete),
    stopped(completed),
    "three presses of step run no cycle and leave a completed run as it stood",
  );
  assertNear(
    afterComplete.sim?.fraction ?? -1,
    completed.sim?.fraction ?? -2,
    FRACTION_TOLERANCE,
    "step advances no fraction of a completed run",
  );

  /* -- faulted ----------------------------------------------------------- */

  await openBareRun(h, { challenge: BARE, machine: COLLIDING });
  const collidingIds = await partIds(h);
  const sweeper = collidingIds[0] as number;

  const swept = await spawnMote(h, CARRIED_FROM, "sol");
  await takeGrip(h, sweeper, 0, swept);
  await spawnMote(h, RESTING_ON, "sol");

  await advanceCycles(h, 1);

  const faulted = await h.snapshot();
  assertNotNull(faulted.sim, "the run is still reported once it has faulted");
  assertEqual(
    faulted.sim?.status,
    "faulted",
    "example A comes within 38 part way through its sweep, so the run is terminal",
  );
  assertEqual(
    faulted.sim?.fault?.kind,
    "collision",
    "the fault is the collision the configuration raises",
  );
  const frozenAt = faulted.sim?.fraction ?? -1;

  await stepAction(h);
  await stepAction(h);
  await stepAction(h);

  const afterFault = await h.snapshot();
  assertDeepEqual(
    stopped(afterFault),
    stopped(faulted),
    "three presses of step run no cycle and leave a faulted run as it stood",
  );
  assertNear(
    afterFault.sim?.fraction ?? -1,
    frozenAt,
    FRACTION_TOLERANCE,
    "step advances no fraction of a faulted run, frozen mid-sweep",
  );
});

// controls/undo-does-nothing-on-the-run-screen — the `undo` action does not reach
// the structure from the run screen.
//
// `specs/controls.md` § The run screen: "The run screen takes the camera actions,
// a pointer drag on the camera, `speed`, `mute`, and `back` alone: the player
// turns the camera and watches rather than steering." § The actions binds `undo`
// to `KeyZ` and gives it "undo the most recent structure edit, on the build
// screen" — the build screen and no other — and closes with "Every action applies
// where the table says and does nothing elsewhere."
//
// SO THE READING IS THE STRUCTURE'S MEMBER COUNT. The crane is posed as the
// sequence of edits that builds it, so the undo history is deep and the most
// recent edit is a member that stands: a build that answers `KeyZ` wherever it is
// pressed takes that member out from under a run in progress, and the count says
// so. `specs/program.md` says the run is entitled to the structure it started
// with — "the structure, the tape, and the loads' starting poses are untouched:
// every run begins from the same authored state."
//
// A REAL RUN, AND ONE THAT CANNOT END UNDER THE PRESS. `startRun` "poses the
// `run` action: the same refusals, the same `run-start`, and the same move to the
// run screen". The tape is one long grip turn — `grip` is the hook's yaw, so it
// asks nothing of the structure, and `360` degrees at `GRIP_MAX_RATE` (`45`) is
// eight seconds of run clock against the handful of ticks this press rides on.
// The world is emptied first, so no load and no obstacle can end the run instead,
// and no member can break: the minimal crane stands under its own weight alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BINDINGS, GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The `undo` action's binding, as `specs/controls.md` fixes it. */
const UNDO = BINDINGS.undo[0]!;

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Ticks driven first, so the press lands on a run under way. */
const TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the structure standing when the undo action is pressed on the run screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  const running = await runTicks(h, TICKS);
  assertEqual(running.screen, "run", "the screen the press lands on");
  assertEqual(running.run.phase, "running", "the run the press lands during");
  assertGreaterThan(
    running.historyDepth,
    0,
    "the edits the undo history holds, so there is one for `undo` to reverse",
  );
  const members = running.structure.members.length;

  await h.press(UNDO);
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).structure.members.length,
    members,
    `the members standing after ${UNDO} on the run screen: \`undo\` reverses ` +
      "the most recent structure edit on the build screen, and the run screen " +
      "takes the camera actions, a pointer drag, `speed`, `mute` and `back` " +
      "alone (specs/controls.md § The run screen)",
  );

  await h.capture("state", "the structure the undo action left standing");
});

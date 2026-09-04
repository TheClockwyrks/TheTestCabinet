// controls/check-does-nothing-on-the-run-screen — the `check` action does nothing
// on the run screen.
//
// `specs/controls.md` § The run screen: "The run screen takes the camera actions,
// a pointer drag on the camera, `speed`, `mute`, and `back` alone: the player
// turns the camera and watches rather than steering." § The actions binds `check`
// to `KeyC` and gives it "the static check, on the build screen
// (`specs/structure.md`)" — the build screen and no other — and closes with
// "Every action applies where the table says and does nothing elsewhere."
//
// SO THE READING IS `checkResult`, which `specs/instrumentation.md` defines as
// "the result the build screen is currently showing" and which reads `null`
// "while the build screen is showing no check result". `openSite` clears it, so
// it stands at `null` when the run starts, and a build that answers `KeyC`
// wherever it is pressed puts a result there.
//
// A REAL RUN, AND ONE THAT CANNOT END UNDER THE PRESS. `startRun` "poses the
// `run` action: the same refusals, the same `run-start`, and the same move to the
// run screen", so the screen the press lands on is the one a player reaches. The
// tape is one long grip turn — `grip` is the hook's yaw, so it asks nothing of
// the structure, and `360` degrees at `GRIP_MAX_RATE` (`45`) is eight seconds of
// run clock against the handful of ticks this press rides on. The world is
// emptied first, so no load and no obstacle can end the run instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
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

/** The `check` action's binding, as `specs/controls.md` fixes it. */
const CHECK = BINDINGS.check[0]!;

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

it("shows no check result when the check action is pressed on the run screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  const running = await runTicks(h, TICKS);
  assertEqual(running.screen, "run", "the screen the press lands on");
  assertEqual(running.run.phase, "running", "the run the press lands during");
  assertNull(
    running.checkResult,
    "the check result standing when the press is made: opening a site clears " +
      "it (specs/instrumentation.md)",
  );

  await h.press(CHECK);
  await h.advance(1);

  const after = await h.snapshot();

  await h.capture("state", "the run screen the check action left standing");

  assertNull(
    after.checkResult,
    `checkResult after ${CHECK} on the run screen: the \`check\` action runs ` +
      "on the build screen, and the run screen takes the camera actions, a " +
      "pointer drag, `speed`, `mute` and `back` alone " +
      "(specs/controls.md § The run screen)",
  );
});

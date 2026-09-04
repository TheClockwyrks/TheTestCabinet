// controls/a-tape-edit-does-nothing-off-the-program-screen — a tape edit posed
// while the build screen is showing adds no step.
//
// `specs/controls.md` § Editing the tape opens "The program screen edits the tape
// with the pointer and the menu actions", and `specs/instrumentation.md` carries
// that into the poses this check makes: the tape operations "pose tape edits on
// the program screen, which is where the tape editor lives (`specs/controls.md`)",
// under the rule it states for every pose — "Each pose applies on the screens its
// section names and does nothing on any other, exactly as the control it stands
// for does."
//
// SO THE SCREEN IS THE BUILD SCREEN AND NOTHING ELSE IS WRONG WITH THE EDITS.
// Both would be accepted on the program screen: `slew` to `90` at `20` is a rate
// greater than `0` and inside `SLEW_MAX_RATE` (`30`) on a move step that carries
// one command, and `attach` is one of the two actions `specs/program.md` gives.
// A build that took either here would be editing the tape from a screen that does
// not edit it, which is what this check reads.
//
// THE TAPE IS EMPTIED FIRST, on the program screen where emptying it applies, and
// the build screen is showing again before either edit is posed — `openSite`
// "shows the `build` screen" and `clearAll` puts the screen back where it found
// it. So the tape is empty going in and any step standing afterwards came from an
// edit posed off the program screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds no step to the tape while the build screen is showing", async () => {
  await openSite(h, 0);
  await clearAll(h);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "build", "the screen the edits are posed on");
  assertLength(posed.program, 0, "the tape the edits are posed against");

  await h.debug.addMoveStep("slew", 90, 20);
  await h.debug.addActionStep("attach");
  await h.advance(1);

  const s = await h.snapshot();
  await h.capture("state", "The build screen with the tape still empty");

  assertLength(
    s.program,
    0,
    "the steps the tape carries after two edits posed on the build screen: " +
      "the tape is edited on the program screen (specs/controls.md)",
  );
  assertEqual(
    s.screen,
    "build",
    "the screen after those edits, which change nothing",
  );
});

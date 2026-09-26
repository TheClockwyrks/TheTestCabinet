// controls/a-tape-edit-does-nothing-off-the-program-screen — a tape edit posed
// while the build screen is showing appends its step and moves no screen.
//
// `specs/controls.md` § Editing the tape opens "The program screen edits the tape
// with the pointer and the menu actions", and that is the PLAYER'S route to the
// editor. `specs/instrumentation.md` says a route is not an operation's
// condition: the tape operations "pose tape edits on the open site's tape,
// wherever the game stands — the program screen is how a player reaches the tape
// editor (`specs/controls.md`) and is not a condition on these", under the rule
// it states for every operation — "No operation asks which screen is showing …
// Those are how a player reaches a control and are not an operation's
// conditions."
//
// WHAT THIS DECIDES IS THE OTHER HALF OF THAT SENTENCE: an edit posed from the
// build screen edits the TAPE and nothing else. It does not carry the caller to
// the program screen, and it does not reach the structure the build screen is
// showing. A build that routed its tape operations through the tape editor's own
// screen handling would arrive at the program screen with the step, and one that
// swallowed the call on the strength of the screen would leave the tape empty:
// both fail here, and they fail differently.
//
// NOTHING ELSE IS WRONG WITH THE EDITS. Both would be accepted on the program
// screen too: `slew` to `90` at `20` is a rate greater than `0` and inside
// `SLEW_MAX_RATE` (`30`) on a move step that carries one command, and `attach` is
// one of the two actions `specs/program.md` gives. The editor's own rules are the
// edit rather than a gate on reaching it, and they are unchanged.
//
// THE TAPE IS EMPTIED FIRST, and the build screen is showing again before either
// edit is posed — `openSite` "shows the `build` screen" and `clearAll` puts the
// screen back where it found it. So the tape is empty going in and any step
// standing afterwards came from an edit posed off the program screen.

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

it("appends its step from the build screen and moves no screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "build", "the screen the edits are posed on");
  assertLength(posed.program, 0, "the tape the edits are posed against");

  await h.debug.addMoveStep("slew", 90, 20);
  await h.debug.addActionStep("attach");
  await h.debug.reconcile();
  await h.advance(1);

  const s = await h.snapshot();
  await h.capture("state", "The build screen with the tape the poses appended");

  assertLength(
    s.program,
    2,
    "the steps the tape carries after two edits posed on the build screen: " +
      "the screen is a player's route to the tape editor and not the " +
      "operation's condition (specs/instrumentation.md)",
  );
  assertEqual(
    s.screen,
    "build",
    "the screen after those edits: a tape pose edits the tape and sets " +
      "nothing else (specs/instrumentation.md)",
  );
  assertLength(
    s.structure.members,
    0,
    "the members the structure carries after two TAPE edits, which reach the " +
      "tape alone (specs/instrumentation.md)",
  );
});

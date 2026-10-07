// screens/opens-on-title — a freshly loaded game is on the title screen.
//
// THE RULE. `specs/ui.md`, Screens: "`state.screen` names the screen the game is
// in: `title`, `howto`, `select`, or `editor`", and of `title` itself: "The main
// menu, and where the game opens."
//
// THE CONFIGURATION is a game nothing has touched. A harness is opened on the
// build and the screen is read before any scenario poses anything: no challenge
// is loaded, no machine is placed, no run is started and no key is pressed,
// because the point is about the screen the build stands the game up in rather
// than about any transition into it.
//
// WHAT THE ENGINELESS PROJECT READS. Its harness takes the page off the wall
// clock and calls `reset()` as it opens, so the reading there is of the state a
// reset left rather than of the state the build's own initialization left.
// `specs/instrumentation.md` fixes the two as the same state — `reset` "restores
// every declared field of the game's state to its title-screen value: the title
// screen with its first menu item highlighted" — so the sentence being decided is
// the same sentence, read one call later. Under either engine project the harness
// stands the game up and resets nothing, so the reading there is the build's own
// opening state.
//
// THE VERDICT. `screen` is `title`, and it is none of `howto`, `select`, or
// `editor`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands the game up on the title screen", async () => {
  const opened = await h.snapshot();

  // The evidence: one frame of whatever the game opened on, drawn before the
  // reading below is judged, so a build that opened somewhere else leaves a
  // picture of where it opened.
  await h.advance(1);
  await captureStill(h, "title-boot");

  assertNotEqual(
    opened.screen,
    "editor",
    "a freshly loaded game is not in the editor: no challenge has been opened",
  );
  assertNotEqual(
    opened.screen,
    "select",
    "a freshly loaded game is not on a select screen: no mode has been chosen",
  );
  assertNotEqual(
    opened.screen,
    "howto",
    "a freshly loaded game is not on the how-to",
  );
  assertEqual(
    opened.screen,
    "title",
    "the title screen is where the game opens",
  );
});

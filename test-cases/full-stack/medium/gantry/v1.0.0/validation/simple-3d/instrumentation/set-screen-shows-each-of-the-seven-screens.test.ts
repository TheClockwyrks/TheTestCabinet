// instrumentation/set-screen-shows-each-of-the-seven-screens — every screen
// identifier the surface takes is a screen the snapshot reports back.
//
// `specs/instrumentation.md` § The run and the screens: "`setScreen(screen)` |
// Shows a named screen and sets nothing else; … `screen` is one of the seven
// identifiers of `specs/ui.md`." `specs/ui.md` names those seven in its screen
// table: `title`, `howto`, `select`, `build`, `program`, `run`, and `results`.
//
// THE SEVEN ARE ONE EDGE CASE EXERCISED SEVEN TIMES, the same way each time — a
// screen posed, and the same screen read straight back — so they share one
// validator rather than seven. A build that shows six of them and drops the
// seventh fails here, and the failure names the identifier it dropped.
//
// Nothing else is posed and nothing is advanced between the calls: `setScreen`
// "sets nothing else", so the reading after each call is the screen that call
// asked for and not the effect of anything on the way to it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness, type Screen } from "../harness";

/** The seven identifiers, in the order `specs/ui.md` tables them. */
const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "select",
  "build",
  "program",
  "run",
  "results",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows each of the seven screens it is given", async () => {
  const shown: string[] = [];
  for (const screen of SCREENS) {
    await h.debug.setScreen(screen);
    shown.push((await h.snapshot()).screen);
  }

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  for (const [index, screen] of SCREENS.entries()) {
    assertEqual(
      shown[index],
      screen,
      `the screen setScreen("${screen}") shows (specs/instrumentation.md)`,
    );
  }
});

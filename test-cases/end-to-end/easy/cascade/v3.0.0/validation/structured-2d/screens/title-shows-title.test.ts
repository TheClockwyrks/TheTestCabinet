// screens/title-shows-title — the title screen draws the game's title.
//
// specs/screens.md fixes the copy of the title screen as literals, each under the
// name the specification gives it: the title is `TITLE_TEXT` (`CASCADE`), and
// "the literal text it names is the text that is drawn". The constant is read
// from this project's own `constants.ts`, which transcribes it from
// specs/screens.md, so what is asserted is the specification's own string rather
// than whatever string the build called `TITLE_TEXT`.
//
// WHAT IS READ IS THE FRAME'S OWN DRAW CALLS. `drawFrame` clears the call log,
// runs one frame and hands back exactly what that frame put on the canvas, so a
// build that carries the title in a variable it never draws fails here. Matching
// is by substring and ignores case: which case a build sets its type in, and
// whether it draws the title with padding or a marker around it, is the build's
// own typography.
//
// ONE LITERAL, ONE POINT. The tagline and the two menu items are
// `screens/title-shows-tagline` and `screens/title-shows-new-game`, so a build that
// draws a title and no tagline grades apart from one that draws neither. That the
// title READS against what it sits on is `presentation/text-legible`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  resetTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws TITLE_TEXT on the title screen", async () => {
  resetTo(h);
  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: reset restores the title screen, which is the screen this point " +
      "reads (specs/instrumentation.md)",
  );

  const calls = await h.drawFrame();
  captureStill(h, "title");

  assertEqual(
    drewText(calls, TITLE_TEXT),
    true,
    `the title screen's frame to draw TITLE_TEXT (${JSON.stringify(
      TITLE_TEXT,
    )}) (specs/screens.md)`,
  );
});

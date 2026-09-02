// screens/title-shows-tagline — the title screen draws its tagline.
//
// specs/screens.md fixes the tagline as `TAGLINE_TEXT` (`KLONDIKE SOLITAIRE`),
// and says of every piece of screen copy that "the literal text it names is the
// text that is drawn". It is what tells a player which patience game this is
// before a single card is dealt.
//
// The literal is read from this project's own `constants.ts`, which transcribes
// it from specs/screens.md, so the string asserted is the specification's own and
// not a tagline a build named after itself. What is read is the frame's own draw
// calls, so a build that carries the tagline and never draws it fails; matching
// is by substring and ignores case, because the type and any decoration around
// the run are the build's.
//
// The title and the menu items are `screens/title-shows-title` and
// `screens/title-shows-items`, so each literal is graded on its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TAGLINE_TEXT } from "../constants";
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

it("draws TAGLINE_TEXT on the title screen", async () => {
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
    drewText(calls, TAGLINE_TEXT),
    true,
    `the title screen's frame to draw TAGLINE_TEXT (${JSON.stringify(
      TAGLINE_TEXT,
    )}) (specs/screens.md)`,
  );
});

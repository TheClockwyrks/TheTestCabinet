// screens/title-draws-tagline — the title screen draws its tagline.
//
// THE RULE, from the title screen's own table in `specs/ui.md`, Screens:
//
//   | Element | Constant | Content |
//   | Tagline | `TAGLINE_TEXT` | `SET THE HEAVENS TURNING` |
//
// and, from Presentation in the same file: "every piece of text a screen shows is
// legible against whatever sits behind it at the logical stage size
// `STAGE_W x STAGE_H`". The words are the case's; how they are set is the
// build's, since `specs/ui.md` "fixes no palette, no font, and no background".
//
// THE CONFIGURATION is the title screen and nothing else: a `reset` puts the game
// back where it opens, and one frame draws it. No challenge is open, no run is
// live, and no key has been pressed, so the only thing the frame can be drawing
// is the title screen.
//
// HOW THE TEXT IS READ. `specs/assets.md` puts every word on the stage on the
// frame as drawn text and fixes no more — "Which typeface carries them is
// yours" — and letter spacing is not portable, so a build is free to draw one
// run of copy as one call, as a call per word, or as a call per glyph. What
// all of those share is the baseline: one line of copy is drawn at one `y`. So
// the copy is read with the shared harness's `drewText` — the frame's logical
// runs gathered onto the baselines they share, matched by substring rather than
// by equality, ignoring case and whitespace — which reads a line the same way
// whichever way it was drawn, and leaves a build free to set the tagline inside
// wider copy.
//
// THE VERDICT. Some line of the title frame carries `TAGLINE_TEXT`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { drewText } from "../case-harness/text";
import { TAGLINE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws TAGLINE_TEXT on the title screen", async () => {
  await openTitle(h);

  const calls = await h.lastCalls();
  await captureStill(h, "tagline");

  const shown = await h.snapshot();
  assertEqual(
    shown.screen,
    "title",
    "the frame this point reads is the title screen's",
  );
  assertTrue(
    drewText(calls, TAGLINE_TEXT),
    `the title frame draws TAGLINE_TEXT (${TAGLINE_TEXT})`,
  );
});

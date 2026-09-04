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
// the frame's text runs are gathered by the `y` their anchor maps to and
// joined in `x` order, which reads a line the same way whichever way it was
// drawn, and the match is by substring rather than by equality so a build is
// free to set the tagline inside wider copy.
//
// THE VERDICT. Some line of the title frame carries `TAGLINE_TEXT`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { TAGLINE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  textDraws,
  type Harness,
  type TextDraw,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One baseline the frame drew text on, and the runs on it read left to right. */
interface Line {
  y: number;
  text: string;
}

/** The frame's text runs, gathered into the baselines they were drawn on. */
function linesOf(draws: readonly TextDraw[]): Line[] {
  const baselines = new Map<number, TextDraw[]>();
  for (const draw of draws) {
    baselines.set(draw.y, [...(baselines.get(draw.y) ?? []), draw]);
  }
  return [...baselines.entries()]
    .map(([y, on]) => ({
      y,
      text: [...on]
        .sort((a, b) => a.x - b.x)
        .map((draw) => draw.text)
        .join(""),
    }))
    .sort((a, b) => a.y - b.y);
}

/** The line the frame drew `text` on, or `null` when it drew it on none. */
function lineWith(lines: readonly Line[], text: string): Line | null {
  const wanted = text.trim().toLowerCase();
  return lines.find((line) => line.text.toLowerCase().includes(wanted)) ?? null;
}

it("draws TAGLINE_TEXT on the title screen", async () => {
  await openTitle(h);

  const lines = linesOf(textDraws(await h.lastCalls()));
  await captureStill(h, "tagline");

  const shown = await h.snapshot();
  assertEqual(
    shown.screen,
    "title",
    "the frame this point reads is the title screen's",
  );
  assertNotNull(
    lineWith(lines, TAGLINE_TEXT),
    `the title frame draws TAGLINE_TEXT (${TAGLINE_TEXT})`,
  );
});

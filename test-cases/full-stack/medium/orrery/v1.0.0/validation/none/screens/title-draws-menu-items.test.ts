// screens/title-draws-menu-items — the title screen draws all three menu items.
//
// THE RULE, from the title screen's own table in `specs/ui.md`, Screens:
//
//   | Element | Constant | Content |
//   | Menu | `TITLE_ITEMS` | `CAMPAIGN`, `EXTRAS`, `HOW TO PLAY`, in that order |
//
// This point decides that every entry is SHOWN. Where they sit relative to one
// another is `title-items-stacked-in-order`'s, which item is highlighted is
// `title-highlight-distinct`'s, and what each one does is the four `confirm`
// points'.
//
// THE CONFIGURATION is the title screen and nothing else: a `reset` puts the game
// back where it opens, and one frame draws it. Nothing is posed beyond that, so a
// build that drew an item only once the highlight reached it is read at the
// arrival state `specs/ui.md` fixes — `menuIndex` `0` — where two of the three
// are unhighlighted.
//
// HOW THE TEXT IS READ. Nothing in `specs/` says how a string reaches the canvas,
// and letter spacing is not portable, so a build is free to draw one run of copy
// as one call, as a call per word, or as a call per glyph. What all of those
// share is the baseline: one line of copy is drawn at one `y`. So the frame's
// text runs are gathered by the `y` their anchor maps to and joined in `x` order,
// and the match is by substring, so a build is free to draw a marker or padding
// around an item's words.
//
// THE VERDICT. Every entry of `TITLE_ITEMS` is on some line of the title frame,
// and the failure names the first entry that is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { TITLE_ITEMS } from "../constants";
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

it("draws every entry of TITLE_ITEMS on the title screen", async () => {
  await openTitle(h);

  const lines = linesOf(textDraws(await h.lastCalls()));
  await captureStill(h, "menu");

  const shown = await h.snapshot();
  assertEqual(
    shown.screen,
    "title",
    "the frame this point reads is the title screen's",
  );
  for (const item of TITLE_ITEMS) {
    assertNotNull(
      lineWith(lines, item),
      `the title frame draws the TITLE_ITEMS entry ${item}`,
    );
  }
});

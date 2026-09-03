// screens/title-items-stacked-in-order — the title menu runs down the screen in
// TITLE_ITEMS order, beneath the title and the tagline.
//
// THE RULE is one sentence of `specs/ui.md`, Screens, `title`: "The menu's items
// are stacked one above the next under the title and tagline." What the items ARE
// is the table above it — `TITLE_ITEMS`: "`CAMPAIGN`, `EXTRAS`, `HOW TO PLAY`, in
// that order" — so the stack is read in that order, top to bottom, with the title
// (`TITLE_TEXT`) and the tagline (`TAGLINE_TEXT`) above all three.
//
// THE CONFIGURATION is the title screen and nothing else: a `reset` puts the game
// back where it opens, and one frame draws it. Nothing is posed, because the
// stacking is a fact about the screen rather than about any state it can be
// posed into.
//
// HOW THE TEXT IS READ. `specs/assets.md` puts every word on the stage on the
// frame as drawn text and fixes no more — "Which typeface carries them is
// yours" — and letter spacing is not portable, so a build is free to draw one
// run of copy as one call, as a call per word, or as a call per glyph. What
// all of those share is the baseline: one line of copy is drawn at one `y`,
// and stacked lines are drawn at different ones. So the frame's text runs are
// gathered by the `y` their anchor maps to and joined in `x` order, and each
// piece of copy is found by the line it lies on. Nothing here reads a
// coordinate, a size or a colour `specs/` does not fix — only which line is
// further down the stage than which, and the stage's `y` grows downward.
//
// THE VERDICT. `EXTRAS` is drawn below `CAMPAIGN`, `HOW TO PLAY` below `EXTRAS`,
// and all three below both the title and the tagline. A build that listed the
// menu in some other order, or set it above the title, fails at the first pair
// that is out of order.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
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

it("stacks CAMPAIGN, EXTRAS and HOW TO PLAY down the screen under the title", async () => {
  await openTitle(h);

  const lines = linesOf(textDraws(await h.lastCalls()));
  await captureStill(h, "stack");

  const shown = await h.snapshot();
  assertEqual(
    shown.screen,
    "title",
    "the frame this point reads is the title screen's",
  );

  const title = lineWith(lines, TITLE_TEXT);
  const tagline = lineWith(lines, TAGLINE_TEXT);
  assertNotNull(title, `the title frame draws TITLE_TEXT (${TITLE_TEXT})`);
  assertNotNull(
    tagline,
    `the title frame draws TAGLINE_TEXT (${TAGLINE_TEXT})`,
  );

  const rows: Line[] = [];
  for (const item of TITLE_ITEMS) {
    const row = lineWith(lines, item);
    assertNotNull(row, `the title frame draws the TITLE_ITEMS entry ${item}`);
    if (row !== null) rows.push(row);
  }
  assertEqual(
    rows.length,
    TITLE_ITEMS.length,
    "every entry of TITLE_ITEMS has a line of its own to place",
  );

  for (let index = 1; index < rows.length; index += 1) {
    assertGreaterThan(
      rows[index]?.y ?? Number.NEGATIVE_INFINITY,
      rows[index - 1]?.y ?? Number.POSITIVE_INFINITY,
      `${TITLE_ITEMS[index]} is stacked under ${TITLE_ITEMS[index - 1]}, the ` +
        "entry before it in TITLE_ITEMS",
    );
  }

  const head = Math.max(title?.y ?? 0, tagline?.y ?? 0);
  assertGreaterThan(
    rows[0]?.y ?? Number.NEGATIVE_INFINITY,
    head,
    `the menu is stacked under the title and the tagline, so ${TITLE_ITEMS[0]} ` +
      "is drawn below both",
  );
});

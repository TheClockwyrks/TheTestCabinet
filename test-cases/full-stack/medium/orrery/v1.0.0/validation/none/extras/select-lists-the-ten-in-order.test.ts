// extras/select-lists-the-ten-in-order — the Extras select screen lists the shelf
// in shelf order.
//
// THE RULE. "Choosing `EXTRAS` on the title menu goes to the select screen in
// extras mode. It lists the ten challenges IN ORDER, each row showing its number,
// its name, and whether it is solved" (`specs/modes/extras.md`, The select
// screen). The order is the shelf's own: the Extras "hold exactly `EXTRA_COUNT`
// (`10`) challenges, numbered `1` through `10`. `specs/challenges.md` is
// authoritative for every one of them: build each exactly as written there, IN
// THAT ORDER" (The shelf). So the order this point holds the screen against is
// `specs/challenges.md`'s, transcribed into `challenges.ts`, and not the
// campaign's course — which is the build's own invention and is listed on its own
// select screen.
//
// A ROW IS FOUND BY ITS CHALLENGE'S NAME, which is the one thing on it
// `specs/challenges.md` fixes. Nothing here reads a colour, a coordinate or a
// layout figure, because `specs/` fixes none for this screen; what it reads is the
// baseline each name was drawn on, and that the baselines run down the screen in
// shelf order.
//
// AND ALL TEN ARE ON ONE FRAME. `specs/modes/extras.md` hands it over with the
// rest — "That every row is on the screen at once, the highlight, its movement,
// its resting position on arrival ... are as `specs/modes/campaign.md` states
// them" — and that file states it: "every row is drawn on the same frame, and the
// list never scrolls". So the chain below is read off a SINGLE captured still, and
// a build that scrolled the shelf through a window would draw some of the ten on
// no frame this point ever sees.
//
// THE SHELF IS LISTED FRESH. Nothing is solved and no record is set, so a row
// carries the least text it ever carries — "An unsolved row shows none of the three"
// (`specs/modes/campaign.md`) of its three records — and all ten are still listed,
// because the Extras lock nothing and "Every row can be entered".
//
// THE VERDICT. For each of the ten Extras, in `specs/challenges.md` order, there
// is a row bearing its name strictly below the row of the challenge before it. A
// build that omitted one, listed the shelf in another order, or listed the
// campaign's course here instead has no such chain.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertLength } from "../assert";
import { EXTRA_NAMES } from "../challenges";
import { EXTRA_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  openSelect,
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

/**
 * The frame's text runs gathered into the baselines they were drawn on.
 *
 * A build is free to draw a row as one run of text or as a run per word or per
 * glyph — `specs/ui.md` "fixes no palette, no font", and `specs/assets.md`,
 * which puts every word on the stage on the frame as drawn text, fixes no more
 * than that. What every one of those does share is the baseline: the runs of
 * one row are drawn at one `y`, and the rows are drawn at different ones. So
 * the runs are grouped by the `y` their anchor maps to and joined in `x`
 * order, which reads a row the same way whichever way it was drawn.
 */
function linesOf(draws: readonly TextDraw[]): Line[] {
  const baselines = new Map<number, TextDraw[]>();
  for (const draw of draws) {
    const on = baselines.get(draw.y) ?? [];
    on.push(draw);
    baselines.set(draw.y, on);
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

/**
 * The baseline each Extra's row was drawn on, taken in shelf order.
 *
 * The screen "lists the ten challenges IN ORDER" down the screen, so the rows are
 * matched in shelf order and each one is looked for BELOW the row before it. A
 * build that listed the shelf in some other order has no such chain and is
 * reported at the first challenge whose row is not under its predecessor's.
 */
function rowBaselines(
  lines: readonly Line[],
  names: readonly string[],
): number[] {
  const rows: number[] = [];
  let below = -Infinity;
  for (const name of names) {
    const wanted = name.trim().toLowerCase();
    const row = lines.find(
      (line) => line.y > below && line.text.toLowerCase().includes(wanted),
    );
    assertDefined(
      row,
      `the Extras select screen draws a row for ${JSON.stringify(name)} below ` +
        "the row of the challenge before it, so the shelf is listed in the " +
        "order specs/challenges.md gives it",
    );
    below = row?.y ?? below;
    rows.push(below);
  }
  return rows;
}

it("draws one row per Extra, in the order specs/challenges.md gives them", async () => {
  await h.debug.reset();

  await openSelect(h, "extras");
  const drawn = textDraws(await h.lastCalls());
  await captureStill(h, "list");

  const shown = await h.snapshot();
  assertEqual(
    shown.mode,
    "extras",
    "the shelf's own select screen is the screen this point reads, rather than " +
      "the campaign's",
  );
  assertEqual(
    shown.screen,
    "select",
    "the Extras select screen is the screen this point reads",
  );

  const rows = rowBaselines(linesOf(drawn), EXTRA_NAMES);
  assertLength(
    rows,
    EXTRA_COUNT,
    "the screen lists the ten challenges of the shelf, so it draws " +
      `EXTRA_COUNT (${EXTRA_COUNT}) rows`,
  );
});

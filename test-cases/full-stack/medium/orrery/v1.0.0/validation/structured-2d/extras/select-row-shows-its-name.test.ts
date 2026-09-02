// extras/select-row-shows-its-name — every row of the shelf carries its
// challenge's name.
//
// THE RULE. The Extras select screen "lists the ten challenges in order, each row
// showing its number, its name, and whether it is solved"
// (`specs/modes/extras.md`, The select screen). WHICH ten names those are is
// fixed data rather than the build's invention: "`specs/challenges.md` is
// authoritative for every one of them: build each exactly as written there, in
// that order" (The shelf), and that file names them First Light, Twin Moons,
// Waning Crescent, Mirrorwright, Ascendant, Great Conjunction, Syzygy,
// Aetherfall, Trine and Procession. `challenges.ts` is that file transcribed, so
// the names this check looks for are the specification's own rather than the
// build's.
//
// THIS POINT DECIDES THE NAME ALONE. That the screen lists ten rows in shelf
// order is `select-lists-the-ten-in-order`'s, the number on a row is its own
// item's, and the solved state and the records are theirs. What is decided here
// is that each of the ten names is drawn, and that no two of them share a row.
//
// HOW A NAME IS READ. `specs/ui.md` "fixes no palette, no font", and no sentence
// of `specs/` says how a string reaches the canvas: a build may draw a row as one
// run of text, as a run per word, or as a run per glyph — this reference draws its
// state word letter by letter. What every one of those shares is the baseline, so
// the frame's text runs are gathered into the baselines they were drawn on,
// joined in `x` order, and matched with the whitespace dropped. A row counts as a
// challenge's when its line carries that challenge's name.
//
// THE SHELF IS READ FRESH: nothing is solved and no record is set, so a row
// carries the least text it ever carries ("An unsolved row shows none" of the
// three records, `specs/modes/campaign.md`) and nothing on it can be mistaken for
// a name.
//
// THE VERDICT. Every one of the ten names of `specs/challenges.md` is drawn on
// the Extras select screen, each on a row of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
import { EXTRA_NAMES } from "../challenges";
import {
  captureStill,
  createHarness,
  openSelect,
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

/**
 * The frame's text runs gathered into the baselines they were drawn on.
 *
 * The runs of one row are drawn at one `y` and the rows are drawn at different
 * ones, whichever way a build breaks a row into runs, so grouping by the `y` an
 * anchor maps to reads a row the same way under all of them.
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
 * Text with its case and its whitespace dropped.
 *
 * A run per word and a run per glyph join to `First Light` and to `FirstLight`,
 * and a build is free to letter-space or pad a name; none of that is a different
 * name, and no sentence of `specs/` fixes any of it.
 */
function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, "");
}

it("draws each of the ten Extras' names, each on its own row", async () => {
  await openTitle(h);
  await openSelect(h, "extras");
  const drawn = textDraws(await h.lastCalls());
  await captureStill(h, "names");

  const shown = await h.snapshot();
  assertEqual(
    shown.screen,
    "select",
    "the Extras select screen is the screen this point reads",
  );
  assertEqual(
    shown.mode,
    "extras",
    "and it is showing the Extras, whose ten names specs/challenges.md fixes",
  );

  const lines = linesOf(drawn);
  const claimed = new Set<number>();
  for (const name of EXTRA_NAMES) {
    const row = lines.find(
      (line) =>
        !claimed.has(line.y) && squash(line.text).includes(squash(name)),
    );
    assertDefined(
      row,
      `the Extras select screen draws a row carrying ${JSON.stringify(name)}, ` +
        "the name specs/challenges.md gives that challenge, on a row no other " +
        "name has already been read off; the lines the frame drew are " +
        JSON.stringify(lines.map((line) => line.text)),
    );
    claimed.add(row?.y ?? 0);
  }

  assertEqual(
    claimed.size,
    EXTRA_NAMES.length,
    "each of the ten names is drawn on a row of its own, so no two challenges " +
      "share one row",
  );
});

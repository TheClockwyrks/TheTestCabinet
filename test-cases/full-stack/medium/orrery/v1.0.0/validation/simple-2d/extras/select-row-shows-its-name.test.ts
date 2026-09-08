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
// HOW A NAME IS READ. `specs/ui.md` "fixes no palette, no font", and
// `specs/assets.md`, which puts every word on the stage on the frame as drawn
// text, fixes no more than that: a build may draw a row as one run of text, as
// a run per word, or as a run per glyph — this reference draws its state word
// letter by letter. What every one of those shares is the baseline, which is
// the line the shared harness's `drewText` reads copy along — substring,
// ignoring case, the whitespace folded out of both sides — so that is what
// reads each name. WHICH row carries it is then `drawing.ts`'s `textLines`,
// the same runs gathered onto their baselines: a row counts as a challenge's
// when its line carries that challenge's name.
//
// THE SHELF IS READ FRESH: nothing is solved and no record is set, so a row
// carries the least text it ever carries ("An unsolved row shows none of the
// three" records, `specs/modes/campaign.md`) and nothing on it can be mistaken for
// a name.
//
// THE VERDICT. Every one of the ten names of `specs/challenges.md` is drawn on
// the Extras select screen, each on a row of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertTrue } from "../assert";
import { drewText } from "../case-harness/text";
import { EXTRA_NAMES } from "../challenges";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  spells,
  textLines,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each of the ten Extras' names, each on its own row", async () => {
  await openTitle(h);
  await openSelect(h, "extras");
  const calls = await h.lastCalls();
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

  // Each name is read with the shared harness's `drewText`, and the row it sits
  // on as `drawing.ts`'s `textLines`: the same logical runs gathered onto the
  // baselines they share, a line found by the rule `drewText` matched it by. A
  // run per word and a run per glyph join to `First Light` and to `FirstLight`,
  // and a build is free to letter-space or pad a name; none of that is a
  // different name, and no sentence of `specs/` fixes any of it.
  const lines = textLines(calls);
  const claimed = new Set<number>();
  for (const name of EXTRA_NAMES) {
    assertTrue(
      drewText(calls, name),
      `the Extras select screen draws ${JSON.stringify(name)}, the name ` +
        "specs/challenges.md gives that challenge; the lines the frame drew " +
        `are ${JSON.stringify(lines.map((line) => line.text))}`,
    );
    const row = lines.find(
      (line) => !claimed.has(line.y) && spells(line, name),
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

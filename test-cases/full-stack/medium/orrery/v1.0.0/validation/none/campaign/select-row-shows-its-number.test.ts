// campaign/select-row-shows-its-number — every row of the list carries its
// challenge's number.
//
// THE RULE. The select screen lists the course "each row showing its number, its
// name, and its state" (`specs/modes/campaign.md`, The select screen), and the
// numbering is fixed by the course: the challenges are "numbered from `1`" (The
// course), so the first row shows `1` and the numbers run up from there down the
// list. This point decides the NUMBER alone; the row's name and the ordering of the
// rows are `select-lists-every-challenge`'s, and the state is its own item.
//
// HOW A ROW'S NUMBER IS READ. Each row is located by its challenge's name, as the
// listing point locates it, and the row's own band is then read: every text run the
// frame drew within half a row's pitch of that baseline, which is what "on this row"
// can mean when `specs/` fixes no geometry for this screen. A run counts as the
// number when its digits — all of them — read that challenge's number, so `" 1"`,
// `"1."` and `"CHALLENGE 1"` all count and a run carrying two numbers does not.
// The runs are the LOGICAL ones the frame spells (`drawnTextRuns`), not the
// `fillText` calls: letter spacing is not portable, so a build that tracks its
// rows draws one glyph per call, and a row drawn `1 2` that way is still the one
// figure `12` — read off the calls it would be the two figures `1` and `2`.
//
// WHY THE COURSE IS READ FRESH. Nothing is solved and no record is set, because "A
// solved row also shows its three records, `cost`, `cycles`, and `area`, each
// figure drawn beside a label naming its metric. An unsolved row shows none of the
// three, and apart from its records the only figure a row carries is its own
// challenge number" (`specs/modes/campaign.md`) — and those record figures are
// digits on the row that are not the row's number. On a fresh course the only
// number a row has any business drawing is the one this point is about.
//
// THE VERDICT. Every row draws its own number, `1` through `campaign.count` down
// the list.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertGreaterThan,
  assertNotNull,
  assertTrue,
} from "../assert";
import { drewText } from "../case-harness/text";
import {
  captureStill,
  createHarness,
  drawnTextRuns,
  openChallenge,
  openSelect,
  spells,
  textLines,
  type DrawCall,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The baseline each challenge's row was drawn on, taken in course order.
 *
 * Each name is read with the shared harness's `drewText`, and the row it sits
 * on as `drawing.ts`'s `textLines`: the same logical runs gathered onto the
 * baselines they share, so a row drawn as one run, as a run per word or as a
 * run per glyph reads the same way. The list "lists every challenge of the
 * course, IN ORDER" down the screen, so the rows are matched in course order
 * and each one is looked for BELOW the row before it. A build that listed the
 * course in some other order has no such chain and is reported at the first
 * challenge whose row is not under its predecessor's.
 */
function rowBaselines(
  calls: readonly DrawCall[],
  names: readonly string[],
): number[] {
  const lines = textLines(calls);
  const rows: number[] = [];
  let below = -Infinity;
  for (const name of names) {
    assertTrue(
      drewText(calls, name),
      `the select screen draws a row for ${JSON.stringify(name)}; the lines ` +
        `the frame drew are ${JSON.stringify(lines.map((line) => line.text))}`,
    );
    const row = lines.find((line) => line.y > below && spells(line, name));
    assertDefined(
      row,
      `the select screen draws a row for ${JSON.stringify(name)} below the row ` +
        "of the challenge before it, so the course is listed in course order",
    );
    below = row?.y ?? below;
    rows.push(below);
  }
  return rows;
}

/** Every challenge of the course, by name, in course order. */
async function courseNames(count: number): Promise<string[]> {
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    const open = (await h.snapshot()).challenge;
    assertNotNull(
      open,
      `opening campaign challenge ${index + 1} puts it in the editor, so its ` +
        "name is readable from the snapshot rather than guessed at",
    );
    names.push(open?.name ?? "");
  }
  return names;
}

/**
 * The separators a build may draw between a figure's digit triples.
 *
 * A row's number is the case's and how the row draws it is the build's, and
 * grouping is what `Number.prototype.toLocaleString` does by default, so a row
 * that drew `1,234` drew the one figure 1234 and reads as that. ASCII space is
 * deliberately absent from the set: a row is read as its runs of text joined
 * together, so accepting it would read the two figures in `40 130` as the single
 * figure `40130`. The decimal point is absent for the same kind of reason — a
 * build drawing `1.5` means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One whole number as a build may draw it: grouped into triples, or plain. */
const WHOLE = new RegExp(`\\d{1,3}(?:${GROUP}\\d{3})+|\\d+`, "g");

/** The whole number a run of text carries, when it carries exactly one. */
function soleNumber(text: string): number | null {
  const digits = text.match(WHOLE);
  return digits?.length === 1
    ? Number(digits[0].replace(new RegExp(GROUP, "g"), ""))
    : null;
}

it("draws each row's challenge number, running 1 upward down the list", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(
    count,
    1,
    "the course holds more than one challenge, so the rows have a pitch and a " +
      "row's own band can be told from its neighbours'",
  );
  const names = await courseNames(count);

  await openSelect(h, "campaign");
  const calls = await h.lastCalls();
  const drawn = drawnTextRuns(calls);
  await captureStill(h, "numbers");

  const rows = rowBaselines(calls, names);

  // A row's band is half the closest two rows ever come, so no band can reach a
  // neighbour's baseline whatever pitch the build laid the list out on.
  let pitch = Infinity;
  for (let index = 1; index < rows.length; index += 1) {
    pitch = Math.min(pitch, (rows[index] ?? 0) - (rows[index - 1] ?? 0));
  }
  assertGreaterThan(
    pitch,
    0,
    "the rows are drawn on distinct baselines down the screen",
  );

  for (let index = 0; index < count; index += 1) {
    const baseline = rows[index] ?? 0;
    const onRow = drawn.filter(
      (draw) => Math.abs(draw.y - baseline) < pitch / 2,
    );
    assertDefined(
      onRow.find((draw) => soleNumber(draw.text) === index + 1),
      `the row for ${JSON.stringify(names[index] ?? "")} shows its challenge's ` +
        `number, ${index + 1}, and the runs of text on it are ` +
        JSON.stringify(onRow.map((draw) => draw.text)),
    );
  }
});

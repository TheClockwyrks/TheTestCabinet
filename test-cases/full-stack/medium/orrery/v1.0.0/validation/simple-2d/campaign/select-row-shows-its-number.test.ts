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
import { assertDefined, assertGreaterThan, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  openChallenge,
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
 * The baseline each challenge's row was drawn on, taken in course order.
 *
 * The list "lists every challenge of the course, IN ORDER" down the screen, so the
 * rows are matched in course order and each one is looked for BELOW the row before
 * it. A build that listed the course in some other order has no such chain and is
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

/** The whole number a run of text carries, when it carries exactly one. */
function soleNumber(text: string): number | null {
  const digits = text.match(/\d+/g);
  return digits?.length === 1 ? Number(digits[0]) : null;
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
  const drawn = textDraws(await h.lastCalls());
  await captureStill(h, "numbers");

  const rows = rowBaselines(linesOf(drawn), names);

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

// campaign/select-lists-every-challenge — the select screen shows the whole
// course, in course order.
//
// THE RULE. "Choosing `CAMPAIGN` on the title menu goes to the select screen in
// campaign mode. It lists every challenge of the course, in order, each row showing
// its number, its name, and its state" (`specs/modes/campaign.md`, The select
// screen). This point decides the LIST: one row per challenge, `campaign.count` of
// them, running down the screen in course order. What each row shows is its own
// item, and the highlight and the keys are theirs.
//
// A ROW IS FOUND BY ITS CHALLENGE'S NAME, which is the one thing on it the
// specification fixes and the snapshot reports: `challenge.name`
// (`specs/instrumentation.md`, Snapshot shape), read by opening each challenge in
// turn — an operation that "touches no progress". Nothing here reads a colour, a
// coordinate or a layout figure, because `specs/` fixes none for this screen.
//
// THE COURSE IS LISTED FRESH. Nothing is solved and no record is set, so a row
// carries the least text it ever carries: "An unsolved row shows none"
// (`specs/modes/campaign.md`) of its three records. Every row is still listed —
// locked rows included, since the screen "lists every challenge of the course".
//
// THE VERDICT. For every challenge of the course, in order, there is a row bearing
// its name strictly below the row of the challenge before it. A build that omitted
// a challenge, or listed the course in another order, has no such chain.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNotNull } from "../assert";
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
 * glyph — `specs/ui.md` "fixes no palette, no font", and nothing in `specs/` says
 * how a string reaches the canvas. What every one of those does share is the
 * baseline: the runs of one row are drawn at one `y`, and the rows are drawn at
 * different ones. So the runs are grouped by the `y` their anchor maps to and
 * joined in `x` order, which reads a row the same way whichever way it was drawn.
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

it("draws one row per challenge of the course, in course order down the screen", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;
  const names = await courseNames(count);

  await openSelect(h, "campaign");
  const drawn = textDraws(await h.lastCalls());
  await captureStill(h, "list");

  const shown = (await h.snapshot()).screen;
  assertEqual(
    shown,
    "select",
    "the campaign select screen is the screen this point reads",
  );

  const rows = rowBaselines(linesOf(drawn), names);
  assertEqual(
    rows.length,
    count,
    "the screen lists every challenge of the course, so it draws campaign.count " +
      "rows",
  );
  for (let index = 1; index < rows.length; index += 1) {
    assertDefined(
      rows[index],
      `challenge ${index + 1} has a row of its own on the select screen`,
    );
  }
});

// campaign/select-row-shows-its-name — every row of the list carries its own
// challenge's name, the whole of it.
//
// THE RULE. The select screen "lists every challenge of the course, in order, each
// row showing its number, its name, and its state"
// (`specs/modes/campaign.md`, The select screen). The name is the challenge
// document's own: every course challenge "carries a name of its own, distinct from
// every other challenge's in the course" (The course), and a challenge document's
// `name` is a field of the format `specs/formats.md` fixes. This point decides the
// NAME: that the string on the row is the string that challenge carries. The row's
// number and its state are their own items, and so is the listing itself.
//
// THE NAME IS READ OFF THE CHALLENGE, NEVER OFF A LIST THIS CHECK HOLDS. The
// course is the build's own — "designing that course is part of this build" — so
// each challenge is opened through `openChallenge`, whose challenge the snapshot
// reports as `challenge.name` (`specs/instrumentation.md`, Snapshot shape), and
// that string is what is looked for on the screen. An operation that "touches no
// progress", so the course is still the fresh one when the screen is drawn.
//
// THE WHOLE STRING, ON ONE ROW. A build that draws a shortened name — the first
// word, or a name clipped to a column with an ellipsis — is not showing the name
// the challenge carries, and the substring match below is what refuses it. Case
// and whitespace are dropped before matching, because `specs/ui.md` "fixes no
// palette, no font" and a build is free to set a row in capitals or to letterspace
// it; nothing else about the string is.
//
// EVERY ROW, LOCKED ONES INCLUDED. The course is read fresh, where "Challenge `1`
// is unlocked from the start. Every other challenge begins locked"
// (Progression) — so all but one of the rows read here are locked, and the screen
// "lists every challenge of the course" whatever its state. Nothing is solved, so
// no row carries the three record figures a solved row adds, which are their own
// item's.
//
// THE VERDICT. For every challenge of the course, in order, some row of the screen
// carries its name whole, each on a baseline of its own below the row before it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
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

/** Text with its case and its whitespace dropped. */
function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, "");
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

it("draws each challenge's own name, whole, on a row of its own", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(
    count,
    1,
    "the course holds more than one challenge, so a row's name has to be that " +
      "row's own rather than the only one on the screen",
  );
  const names = await courseNames(count);
  for (let index = 0; index < count; index += 1) {
    assertGreaterThan(
      squash(names[index] ?? "").length,
      0,
      `campaign challenge ${index + 1} carries a name of its own, which is the ` +
        "string its row has to draw",
    );
  }

  await openSelect(h, "campaign");
  const lines = linesOf(textDraws(await h.lastCalls()));
  await captureStill(h, "names");

  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "the campaign select screen is the screen this point reads",
  );

  let below = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const name = names[index] ?? "";
    const wanted = squash(name);
    const row = lines.find(
      (line) => line.y > below && squash(line.text).includes(wanted),
    );
    assertDefined(
      row,
      `the select screen draws ${JSON.stringify(name)}, the name campaign ` +
        `challenge ${index + 1} carries, whole and on a row of its own below ` +
        `the row of the challenge before it; the lines the frame drew are ` +
        JSON.stringify(lines.map((line) => line.text)),
    );
    below = row?.y ?? below;
  }
});

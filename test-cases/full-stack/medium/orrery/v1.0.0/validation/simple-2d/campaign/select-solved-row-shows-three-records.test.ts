// campaign/select-solved-row-shows-three-records — a solved row carries its three
// records, each beside its own label.
//
// THE RULE. "A solved row also shows its three records, `cost`, `cycles`, and
// `area`, each figure drawn beside a label naming its metric"
// (`specs/modes/campaign.md`, The select screen), and what
// those figures are is Progression's: "Each challenge keeps its records: the lowest
// `cost`, the lowest `cycles`, and the lowest `area` over the session's completed
// runs of it, each metric independently." The snapshot carries them as that
// challenge's `records` entry, "one entry per challenge"
// (`specs/instrumentation.md`, Snapshot shape). This point decides that all THREE
// figures are on the row and that each one is labelled; that an UNSOLVED row shows
// none is its own item, and how a record moves as runs complete is the records
// items'.
//
// THE FIGURES ARE READ BACK FROM THE SNAPSHOT, not from the numbers this check
// posed, so what is compared is the row against "that challenge's records entry"
// as the build itself reports it.
//
// THE WORLD IS POSED THROUGH THE OPERATIONS WRITTEN FOR IT: `setSolved(mode, index,
// solved)` "Adds `index` to that mode's solved set", and `setRecord(mode, index,
// metric, value)` "Sets one record of one challenge" (`specs/instrumentation.md`).
// The three figures are distinct from each other and from every challenge number a
// course of at most `CAMPAIGN_MAX` (`16`) rows can carry, so a figure read on the
// row is the metric it was posed for rather than another one. Challenge 1 is the
// row read: "unlocked from the start", so a solved row there is a state a session
// reaches. Nothing else is solved, so no other row can be the one the figures were
// read off.
//
// THE LABEL IS THE SPECIFICATION'S OWN WORD. `specs/modes/campaign.md` opens by
// saying "Every figure and every piece of screen copy below carries the name this
// specification gives it", and the names it gives these three are `cost`, `cycles`
// and `area`. What is required is the word beside its figure — before it or after
// it, in either case, with punctuation and spacing between if the build likes —
// because `specs/ui.md` "fixes no palette, no font" and fixes no layout for a row.
//
// THE HIGHLIGHT IS PINNED OFF THE ROW READ, because a solved row shows its records
// whether or not it is the row the keys are on.
//
// THE VERDICT. The band of challenge 1's row carries all three of the records the
// snapshot reports for it, each next to its own label.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertTrue,
} from "../assert";
import { METRICS } from "../constants";
import {
  captureStill,
  createHarness,
  openChallenge,
  openSelect,
  textDraws,
  type Harness,
  type TextDraw,
} from "../harness";

/** The row read: challenge 1, "unlocked from the start" and solved by the pose. */
const READ_ROW = 0;

/** The row the highlight is pinned to, which is not the row read. */
const PINNED_ROW = 1;

/**
 * The records posed on that challenge, one distinct figure per metric.
 *
 * None of them is a challenge number of a course of at most `CAMPAIGN_MAX` (`16`)
 * challenges, and no two are equal, so each figure found on the row belongs to one
 * metric and to no other.
 */
const RECORDS: Record<string, number> = { cost: 41, cycles: 52, area: 63 };

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

/** The frame's text runs gathered into the baselines they were drawn on. */
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

/** The baseline a challenge's row was drawn on, found by its name. */
function baselineOf(lines: readonly Line[], name: string): number {
  const row = lines.find((line) => squash(line.text).includes(squash(name)));
  assertDefined(
    row,
    `the campaign select screen draws a row carrying ${JSON.stringify(name)}, ` +
      "which is how the row this point reads is found; the lines the frame drew " +
      `are ${JSON.stringify(lines.map((line) => line.text))}`,
  );
  return row?.y ?? 0;
}

/** The closest two of the course's row baselines come, which bounds a row's band. */
function pitchOf(lines: readonly Line[], names: readonly string[]): number {
  const rows = names
    .map((name) => baselineOf(lines, name))
    .sort((a, b) => a - b);
  let pitch = Infinity;
  for (let index = 1; index < rows.length; index += 1) {
    pitch = Math.min(pitch, (rows[index] ?? 0) - (rows[index - 1] ?? 0));
  }
  return pitch;
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
 * Whether `text` carries `figure` beside `label`, in either order.
 *
 * "Each figure drawn beside a label naming its metric" fixes that the word and its
 * figure belong together; it fixes neither which side the word goes nor what may
 * sit between them, so a run of up
 * to six characters that are neither letters nor digits — a space, a colon, a
 * bullet, nothing at all — is allowed between the two, and the figure is required
 * to stand alone rather than inside a longer number.
 */
function labelled(text: string, label: string, figure: number): boolean {
  const between = "[^0-9A-Za-z]{0,6}";
  const value = `(?<![0-9])${figure}(?![0-9])`;
  return new RegExp(
    `(?:${label}${between}${value})|(?:${value}${between}${label})`,
    "iu",
  ).test(text);
}

it("draws a solved row's cost, cycles and area, each beside its own label", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(
    count,
    PINNED_ROW,
    `the course holds a challenge ${PINNED_ROW + 1}, so the highlight can be ` +
      "pinned off the row this point reads",
  );
  const names = await courseNames(count);

  await h.debug.setSolved("campaign", READ_ROW, true);
  for (const metric of METRICS) {
    await h.debug.setRecord(
      "campaign",
      READ_ROW,
      metric,
      RECORDS[metric] as number,
    );
  }

  await openSelect(h, "campaign");
  await h.debug.setSelectIndex(PINNED_ROW);
  await h.advance(1);
  const lines = linesOf(textDraws(await h.lastCalls()));
  await captureStill(h, "records");

  const posed = await h.snapshot();
  assertDeepEqual(
    posed.campaign.solved,
    [READ_ROW],
    "challenge 1 is the solved row, and it is the only one, so the figures read " +
      "below are its own",
  );
  const record = posed.campaign.records[READ_ROW] ?? null;
  assertNotNull(
    record,
    "the challenge has a records entry, which is the entry its row has to show",
  );

  const pitch = pitchOf(lines, names);
  assertGreaterThan(
    pitch,
    0,
    "the course's rows are drawn on distinct baselines, so a row has a band of " +
      "its own",
  );
  const baseline = baselineOf(lines, names[READ_ROW] as string);
  const onRow = textDraws(await h.lastCalls())
    .filter((draw) => Math.abs(draw.y - baseline) < pitch / 2)
    .sort((a, b) => a.x - b.x)
    .map((draw) => draw.text)
    .join("");

  for (const metric of METRICS) {
    assertEqual(
      record?.[metric],
      RECORDS[metric],
      `the challenge's ${metric} record is the figure that was posed, so what ` +
        "the row is read against is the entry the build itself reports",
    );
    assertTrue(
      labelled(onRow, metric, record?.[metric] ?? -1),
      `the solved row shows its ${metric} record, ${record?.[metric]}, beside ` +
        `the label ${JSON.stringify(metric)}; the row reads ` +
        JSON.stringify(onRow),
    );
  }
});

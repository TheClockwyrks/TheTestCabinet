// extras/select-shows-three-records-on-a-solved-row — a solved row draws the three
// records the challenge holds, each labelled.
//
// THE RULE. The Extras select screen shows "the records a solved row shows ... as
// `specs/modes/campaign.md` states them" (`specs/modes/extras.md`, The select
// screen), and that file states them: "A solved row also shows its three records,
// `cost`, `cycles`, and `area`, each figure drawn beside a label naming its
// metric. An unsolved row shows none of the three."
// The records themselves are what the challenge keeps: "Each challenge keeps its
// records: the lowest `cost`, the lowest `cycles`, and the lowest `area` over the
// session's completed runs of it, each metric independently" (Progression), and
// the snapshot reports them as `extras.records`, "one entry per challenge"
// (`specs/instrumentation.md`).
//
// SO THE FIGURES ARE READ OFF THE SNAPSHOT, not off the numbers this check posed:
// what the row must draw is "the records the challenge holds", and the snapshot is
// where the game reports what it holds.
//
// WHAT A LABEL IS. `specs/modes/campaign.md` opens by fixing the naming of its own
// screen copy — "Every figure and every piece of screen copy below carries the name
// this specification gives it" — and the names it gives the three records are
// `cost`, `cycles`, and `area`. So a labelled figure is one drawn on the row beside
// its metric's name. Nothing else about the label is read: not its case, not its
// order, not its punctuation, not where on the row it sits, because `specs/` fixes
// none of that.
//
// THE CONFIGURATION. A fresh session in which ONE challenge — 3 — is given a full
// set of three records through `setRecord` and marked solved through `setSolved`,
// which is the state a completed run leaves and the state a row shows records in.
// The three figures are three-, two- and two-digit numbers that share no digits
// with each other or with any row's number, so no run of text can satisfy two of
// them at once. No other challenge holds a record, so nothing on a neighbouring row
// can be mistaken for this row's.
//
// The row is found by its challenge's name and read across its own band, because
// `specs/` fixes no geometry for this screen and a build may break a row into runs
// however it likes.
//
// THE VERDICT. The solved row carries all three of `cost`, `cycles` and `area` as
// labels, and beside them the three figures the snapshot says the challenge holds.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import { EXTRA_NAMES } from "../challenges";
import { METRICS } from "../constants";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  textDraws,
  type Harness,
  type TextDraw,
} from "../harness";

/** The challenge given records, and the three figures posed for it. */
const SOLVED_INDEX = 2;
const POSED: Readonly<Record<string, number>> = {
  cost: 137,
  cycles: 42,
  area: 58,
};

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
    `the Extras select screen draws a row carrying ${JSON.stringify(name)}, ` +
      "which is how the row this point reads is found; the lines the frame drew " +
      `are ${JSON.stringify(lines.map((line) => line.text))}`,
  );
  return row?.y ?? 0;
}

/**
 * The closest two of the shelf's row baselines come, which bounds a row's band.
 *
 * Measured over the named rows the frame actually drew rather than over all ten,
 * because whether every name is on the screen is `select-row-shows-its-name`'s
 * point and not this one's: a build that lost one of them is reported there, and
 * still has a row pitch here.
 */
function pitchOf(lines: readonly Line[]): number {
  const rows = EXTRA_NAMES.flatMap((name) => {
    const row = lines.find((line) => squash(line.text).includes(squash(name)));
    return row === undefined ? [] : [row.y];
  }).sort((a, b) => a - b);
  assertGreaterThanOrEqual(
    rows.length,
    2,
    "the shelf draws at least two of its ten named rows, so a row's band can be " +
      "measured against the pitch between them",
  );
  let pitch = Infinity;
  for (let index = 1; index < rows.length; index += 1) {
    pitch = Math.min(pitch, (rows[index] ?? 0) - (rows[index - 1] ?? 0));
  }
  return pitch;
}

/**
 * Every run of text the frame drew on one row's band, read down and then across.
 *
 * A row's band is half the closest two rows ever come, so no band reaches a
 * neighbour's baseline whatever pitch the build laid the list out on — which is
 * what "on this row" can mean when `specs/` fixes no geometry for this screen.
 */
function runsOnRow(
  draws: readonly TextDraw[],
  baseline: number,
  pitch: number,
): TextDraw[] {
  return draws
    .filter((draw) => Math.abs(draw.y - baseline) < pitch / 2)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** A string as a literal the regexes below can carry. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Every conventional rendering of a whole figure: plain, and grouped by triples.
 *
 * The specification fixes the figure and leaves its presentation to the build, and
 * grouping the digits is what `Number.prototype.toLocaleString` does by default,
 * so `1234` and `1,234` are the one figure written two ways and a row drawing
 * either has drawn it. ASCII space is not among the separators: a row's runs are
 * read joined by one, so accepting it would read the two figures in `40 130` as
 * the single figure `40130`. A figure of three digits or fewer has nothing to
 * group and so has exactly one rendering.
 */
function renderings(figure: number): string[] {
  const plain = String(figure);
  const grouped = [",", "'", "\u00A0", "\u202F", "\u2009"].map((separator) =>
    plain.replace(/\B(?=(?:\d{3})+$)/gu, separator),
  );
  return [plain, ...grouped.filter((rendering) => rendering !== plain)];
}

/**
 * Whether a row's runs carry `value` as a whole number.
 *
 * Read twice over, because a build may break a row into runs however it likes:
 * once with the runs butted together, which is how a row drawn glyph by glyph
 * reads, and once with a space between them, which is how two numbers drawn as
 * neighbouring runs read. A figure counts only with no digit either side of it,
 * so `137` is not found inside `1370`, and it counts under any of its renderings,
 * so a row grouping it into digit triples has carried it.
 */
function carriesNumber(runs: readonly TextDraw[], value: number): boolean {
  const texts = runs.map((run) => run.text);
  const butted = texts.join("");
  const spaced = texts.join(" ");
  return renderings(value).some((rendering) => {
    const digits = new RegExp(`(?<!\\d)${escapeRegExp(rendering)}(?!\\d)`, "u");
    return digits.test(butted) || digits.test(spaced);
  });
}

it("draws a solved row's three records, each labelled, as the challenge holds them", async () => {
  await openTitle(h);
  for (const metric of METRICS) {
    await h.debug.setRecord("extras", SOLVED_INDEX, metric, POSED[metric] ?? 0);
  }
  await h.debug.setSolved("extras", SOLVED_INDEX, true);

  await openSelect(h, "extras");
  const drawn = textDraws(await h.lastCalls());
  await captureStill(h, "records");

  const held = (await h.snapshot()).extras.records[SOLVED_INDEX] ?? null;
  assertNotNull(
    held,
    `Extras challenge ${SOLVED_INDEX + 1} holds a record for each of the three ` +
      "metrics, which is the world this point reads its row in",
  );

  const lines = linesOf(drawn);
  const pitch = pitchOf(lines);
  assertGreaterThan(
    pitch,
    0,
    "the ten rows are drawn on distinct baselines, so a row has a band of its own",
  );
  const runs = runsOnRow(
    drawn,
    baselineOf(lines, EXTRA_NAMES[SOLVED_INDEX] as string),
    pitch,
  );
  const shown = JSON.stringify(runs.map((run) => run.text));

  for (const metric of METRICS) {
    assertEqual(
      held?.[metric],
      POSED[metric],
      `the challenge holds the ${metric} this point posed, so the figure the row ` +
        "must draw is that one",
    );
    assertTrue(
      squash(runs.map((run) => run.text).join("")).includes(metric),
      `the solved row labels its ${metric} record with the name ` +
        `specs/modes/campaign.md gives it; the runs of text on the row are ${shown}`,
    );
    assertTrue(
      carriesNumber(runs, held?.[metric] ?? -1),
      `the solved row draws its ${metric} record, ${held?.[metric]}, which is ` +
        `what the challenge holds; the runs of text on the row are ${shown}`,
    );
  }
});

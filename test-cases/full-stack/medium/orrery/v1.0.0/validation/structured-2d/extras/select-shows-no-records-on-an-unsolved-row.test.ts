// extras/select-shows-no-records-on-an-unsolved-row — an unsolved row draws none of
// the three records.
//
// THE RULE. The Extras select screen shows "the records a solved row shows ... as
// `specs/modes/campaign.md` states them" (`specs/modes/extras.md`, The select
// screen), and that file states both halves of it: "A solved row also shows its
// three records, `cost`, `cycles`, and `area`, each figure drawn beside a label
// naming its metric. AN UNSOLVED ROW SHOWS NONE OF THE THREE." This point decides
// the second sentence, and only in that direction: what a
// SOLVED row draws is `select-shows-three-records-on-a-solved-row`'s.
//
// WHAT MAKES A ROW UNSOLVED is the mode's solved set — "solved — Completed at least
// once" (`specs/modes/campaign.md`), reported as `extras.solved`
// (`specs/instrumentation.md`) — and nothing else. The records are a separate
// field, `extras.records`, and a separate pose: "`setRecord(mode, index, metric,
// value)` — Sets one record of one challenge. ... A challenge with no record yet
// gains one whose other two metrics are `0`."
//
// SO THE WORLD IS POSED WITH BOTH: challenge 3 HOLDS a full set of three records
// and is NOT in the solved set. That is the configuration the sentence is about,
// and the only one that decides it. A build that draws a row's records whenever it
// has any draws them here; a build that draws them on a solved row alone draws
// none. A world with no record at all would be decided by a build that draws
// nothing because it has nothing, which decides nothing.
//
// The three figures are three-, two- and two-digit numbers that share no digits
// with each other or with any row's number, so no run of text the row legitimately
// carries — its number, its name, its state — can be mistaken for one of them.
//
// THE VERDICT. The row for challenge 3 carries none of the three figures the
// challenge holds, while the snapshot confirms it holds all three and is unsolved.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
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
  drawnTextRuns,
  lineWith,
  openSelect,
  openTitle,
  textLines,
  type Harness,
  type TextDraw,
  type TextLine,
} from "../harness";

/** The challenge given records and left unsolved, and the three figures posed. */
const UNSOLVED_INDEX = 2;
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

/** The baseline a challenge's row was drawn on, found by its name. */
function baselineOf(lines: readonly TextLine[], name: string): number {
  const row = lineWith(lines, name);
  assertNotNull(
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
function pitchOf(lines: readonly TextLine[]): number {
  const rows = EXTRA_NAMES.flatMap((name) => {
    const row = lineWith(lines, name);
    return row === null ? [] : [row.y];
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
 * what "on this row" can mean when `specs/` fixes no geometry for this screen. A
 * build that drew a row's records on a second line under its name has them read
 * here too, because that line is inside the row's own band.
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

it("draws none of the three records on a row whose challenge is unsolved", async () => {
  await openTitle(h);
  for (const metric of METRICS) {
    await h.debug.setRecord(
      "extras",
      UNSOLVED_INDEX,
      metric,
      POSED[metric] ?? 0,
    );
  }

  await openSelect(h, "extras");
  const calls = await h.lastCalls();
  const drawn = drawnTextRuns(calls);
  await captureStill(h, "bare-row");

  const shelf = (await h.snapshot()).extras;
  assertDeepEqual(
    shelf.solved,
    [],
    `Extras challenge ${UNSOLVED_INDEX + 1} has not been completed, which is the ` +
      "row this point reads",
  );
  const held = shelf.records[UNSOLVED_INDEX] ?? null;
  assertNotNull(
    held,
    "the challenge holds a record for each of the three metrics, so a build that " +
      "draws a row's records whenever it has any has three figures to draw here",
  );

  // The rows are read as `drawing.ts`'s `textLines`: the shared harness's
  // logical runs gathered onto the baselines they share, so a row drawn as one
  // run, as a run per word or as a run per glyph reads the same way.
  const lines = textLines(calls);
  const pitch = pitchOf(lines);
  assertGreaterThan(
    pitch,
    0,
    "the ten rows are drawn on distinct baselines, so a row has a band of its own",
  );
  const runs = runsOnRow(
    drawn,
    baselineOf(lines, EXTRA_NAMES[UNSOLVED_INDEX] as string),
    pitch,
  );
  const shown = JSON.stringify(runs.map((run) => run.text));

  for (const metric of METRICS) {
    assertEqual(
      held?.[metric],
      POSED[metric],
      `the challenge holds the ${metric} this point posed, so that figure is the ` +
        "one an unsolved row must not draw",
    );
    assertTrue(
      !carriesNumber(runs, held?.[metric] ?? -1),
      `the unsolved row draws none of its three records, so its ${metric}, ` +
        `${held?.[metric]}, is not on it; the runs of text on the row are ${shown}`,
    );
  }
});

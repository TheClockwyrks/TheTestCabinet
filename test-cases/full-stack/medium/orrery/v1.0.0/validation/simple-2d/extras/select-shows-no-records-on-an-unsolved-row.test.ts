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

/**
 * Whether a row's runs carry `value` as a whole number.
 *
 * Read twice over, because a build may break a row into runs however it likes:
 * once with the runs butted together, which is how a row drawn glyph by glyph
 * reads, and once with a space between them, which is how two numbers drawn as
 * neighbouring runs read. A figure counts only with no digit either side of it,
 * so `137` is not found inside `1370`.
 */
function carriesNumber(runs: readonly TextDraw[], value: number): boolean {
  const digits = new RegExp(`(?<!\\d)${value}(?!\\d)`, "u");
  const texts = runs.map((run) => run.text);
  return digits.test(texts.join("")) || digits.test(texts.join(" "));
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
  const drawn = textDraws(await h.lastCalls());
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

  const lines = linesOf(drawn);
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

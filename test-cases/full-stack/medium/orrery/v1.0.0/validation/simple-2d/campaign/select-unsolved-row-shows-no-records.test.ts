// campaign/select-unsolved-row-shows-no-records — a row with no records entry
// carries no record figures at all.
//
// THE RULE. "A solved row also shows its three records, `cost`, `cycles`, and
// `area`, each labelled. An unsolved row shows none"
// (`specs/modes/campaign.md`, The select screen). This point decides the SECOND
// sentence, in the one direction it states: a challenge the session has no records
// entry for draws no record figures on its row. What a solved row shows is its own
// item.
//
// LOCKED OR UNLOCKED ALIKE. The three states the screen draws are locked, unlocked
// and solved, and both of the unsolved ones are read here: challenge 1, which is
// open, and challenge 4, which "begins locked" (Progression). Neither has a
// records entry — "`campaignRecords` … `null` until a challenge's first
// completion" (`specs/state.md`) — and a fresh `reset` session is exactly that.
//
// AND THE SCREEN IS ONE THAT IS DRAWING RECORDS. Challenge 3 is posed solved with
// all three of its records set, so the frame the two unsolved rows are read off is
// a frame where a records entry does reach the screen. Without that, a build that
// never drew a record anywhere would pass this point by drawing nothing, and the
// point would decide nothing. Its own row's figures are not read here — that is
// `select-solved-row-shows-three-records` — only that they are on the screen.
//
// WHAT COUNTS AS A RECORD FIGURE. `specs/` fixes no layout, no wording and no
// palette for a row, so a figure cannot be told from the pixels it is drawn in.
// What a row with no records shows is its number, its name and its state, so the
// reading is: the row carries none of the three record LABELS the specification
// names (`cost`, `cycles`, `area`), and the only number on it is its own challenge
// number. The name is taken out of the row's text first, so a challenge whose name
// carries a word or a digit of its own is read the same as any other.
//
// THE VERDICT. Neither unsolved row carries a record label or a figure that is not
// its own number, while the solved row's records are on the screen.

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

/** The two rows read: challenge 1, unlocked and unsolved, and challenge 4, locked. */
const UNLOCKED_ROW = 0;
const LOCKED_ROW = 3;

/** The row posed solved, which is what puts records on the screen at all. */
const SOLVED_ROW = 2;

/** The records posed on the solved row, one distinct figure per metric. */
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

it("draws no record figures on an unsolved row, locked or unlocked", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(
    count,
    LOCKED_ROW,
    `the course holds a challenge ${LOCKED_ROW + 1}, which is the locked row ` +
      "this point reads",
  );
  const names = await courseNames(count);

  await h.debug.setUnlockedCount(SOLVED_ROW + 1);
  await h.debug.setSolved("campaign", SOLVED_ROW, true);
  for (const metric of METRICS) {
    await h.debug.setRecord(
      "campaign",
      SOLVED_ROW,
      metric,
      RECORDS[metric] as number,
    );
  }

  await openSelect(h, "campaign");
  await h.debug.setSelectIndex(SOLVED_ROW);
  await h.advance(1);
  const drawn = textDraws(await h.lastCalls());
  const lines = linesOf(drawn);
  await captureStill(h, "unsolved");

  const posed = await h.snapshot();
  assertDeepEqual(
    posed.campaign.solved,
    [SOLVED_ROW],
    `challenge ${SOLVED_ROW + 1} is the only solved challenge, so the two rows ` +
      "read below are unsolved",
  );
  for (const row of [UNLOCKED_ROW, LOCKED_ROW]) {
    assertEqual(
      posed.campaign.records[row] ?? null,
      null,
      `campaign challenge ${row + 1} has no records entry, which is the world ` +
        "this point decides in",
    );
  }
  assertEqual(
    posed.campaign.unlockedCount,
    SOLVED_ROW + 1,
    `challenge ${UNLOCKED_ROW + 1} is open and challenge ${LOCKED_ROW + 1} is ` +
      "locked, so the two rows read are one of each",
  );

  const screen = squash(lines.map((line) => line.text).join(" "));
  for (const metric of METRICS) {
    assertTrue(
      screen.includes(String(RECORDS[metric])),
      `the frame draws the solved challenge's ${metric} record, so this is a ` +
        "screen on which a records entry reaches the rows at all",
    );
  }

  const pitch = pitchOf(lines, names);
  assertGreaterThan(
    pitch,
    0,
    "the course's rows are drawn on distinct baselines, so a row has a band of " +
      "its own",
  );

  for (const row of [UNLOCKED_ROW, LOCKED_ROW]) {
    const baseline = baselineOf(lines, names[row] as string);
    const text = drawn
      .filter((draw) => Math.abs(draw.y - baseline) < pitch / 2)
      .sort((a, b) => a.x - b.x)
      .map((draw) => draw.text)
      .join("");
    const withoutName = squash(text).replace(squash(names[row] ?? ""), "");
    for (const metric of METRICS) {
      assertTrue(
        !withoutName.includes(metric),
        `campaign challenge ${row + 1} has no records entry, so its row carries ` +
          `no ${metric} record; the row reads ${JSON.stringify(text)}`,
      );
    }
    const figures = (withoutName.match(/\d+/gu) ?? []).map(Number);
    for (const figure of figures) {
      assertEqual(
        figure,
        row + 1,
        `campaign challenge ${row + 1} has no records entry, so the only figure ` +
          `on its row is its own challenge number; the row reads ` +
          JSON.stringify(text),
      );
    }
  }
});

// campaign/select-highlight-drawn-distinctly — the highlighted row is drawn
// differently from the rest, and moving the highlight changes those two rows and
// nothing else.
//
// THE RULE. "One row is highlighted, drawn distinctly from the rest"
// (`specs/modes/campaign.md`, The select screen), and it is the row the keys act
// on: "`confirm` on an unlocked or solved challenge opens it in the editor". So
// the highlight is what tells a player which challenge `confirm` would open, and
// the point of this check is that it can be seen.
//
// HOW IT IS DRAWN IS THE BUILD'S. `specs/ui.md` "fixes no palette, no font, and no
// background", and `specs/` fixes no mark, no geometry and no wording for the
// highlight — so what is read is that the highlighted row is drawn OTHERWISE than
// the same row unhighlighted, never what makes it so.
//
// THE TWO POSES. `setSelectIndex(n)` "Sets the highlighted row of the current
// mode's select screen" (`specs/instrumentation.md`), and the screen is drawn at
// `0` and then at `1`. Between the two frames one row gained the highlight and one
// lost it, and NOTHING ELSE MOVED: nothing is solved, nothing is recorded, the
// unlocked count is the one a fresh session opens with, and "Nothing" advances on
// the `select` screen (`specs/ui.md`, What advances on each screen).
//
// SO BOTH ROWS MUST CHANGE, AND ONLY THEY MAY. Challenge 1's row was distinct from
// the rest in the first frame and is one of the rest in the second, and challenge
// 2's row the other way about, so each of the two bands is drawn differently
// between the frames. The confinement is the rule's own second half: "One row is
// highlighted, drawn distinctly from the rest, and NOTHING ELSE ON THE SCREEN
// READS OFF THE HIGHLIGHT: moving it changes how the row it left and the row it
// reached are drawn, and leaves the rest of the screen as it was"
// (`specs/modes/campaign.md`). So outside the two rows and a full row's pitch of
// margin either side, the frame is the frame it was: a build that redrew the
// whole screen, or that answered the highlight somewhere other than on the row,
// leaves the rest of the screen as it was in neither case.
//
// WHAT IS READ is the whole stage, once per pose, with the rows' bands found by
// their challenges' names rather than by a layout figure `specs/` does not fix.
//
// THE VERDICT. Each of the two rows' bands is drawn differently, and at most
// `OUTSIDE_BUDGET` pixels differ anywhere else on the stage.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  openChallenge,
  openSelect,
  pixelsDiffering,
  textDraws,
  type Harness,
  type PixelRect,
  type TextDraw,
} from "../harness";

/** The row the highlight starts on: challenge 1. */
const FIRST_ROW = 0;

/** The row it moves to: challenge 2. */
const SECOND_ROW = 1;

/**
 * How many pixels may differ away from the two rows the highlight moved between.
 *
 * Room for the anti-aliased edges of the two bands and nothing beyond them: far
 * less than any mark a player would see, so a build whose highlight really is
 * confined to the row passes it whatever it draws on the row's own edges, and a
 * build that answered the highlight somewhere else on the screen does not.
 */
const OUTSIDE_BUDGET = 16;

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
 * How many pixels of each row of two equally shaped rectangles differ.
 *
 * One row at a time through the case's own comparison (`color.ts`'s
 * `pixelsDiffering`, which counts a pixel whose alpha moved, or which carries
 * paint in both and moved a colour channel by more than `CHANNEL_EPSILON`), so
 * WHERE the frame changed is read by exactly the rule that decides WHETHER it
 * changed anywhere else in this case.
 */
function differingByRow(a: PixelRect, b: PixelRect): number[] {
  const stride = a.width * 4;
  const rows: number[] = [];
  for (let y = 0; y < a.height; y += 1) {
    rows.push(
      pixelsDiffering(
        {
          width: a.width,
          height: 1,
          data: a.data.subarray(y * stride, (y + 1) * stride),
        },
        {
          width: b.width,
          height: 1,
          data: b.data.subarray(y * stride, (y + 1) * stride),
        },
      ),
    );
  }
  return rows;
}

it("draws the highlighted row distinctly, and changes only the two rows the highlight moved between", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(
    count,
    SECOND_ROW,
    `the course holds a challenge ${SECOND_ROW + 1}, so the highlight has a ` +
      "second row to move to",
  );
  const names = await courseNames(count);

  await openSelect(h, "campaign");
  await h.debug.setSelectIndex(FIRST_ROW);
  await h.advance(1);
  const posed = await h.snapshot();
  assertEqual(
    posed.selectIndex,
    FIRST_ROW,
    "the first frame is the screen with the highlight on challenge 1",
  );
  assertDeepEqual(
    posed.campaign.solved,
    [],
    "nothing is solved either side, so no row's state is what the two frames " +
      "differ by",
  );

  const lines = linesOf(textDraws(await h.lastCalls()));
  const pitch = pitchOf(lines, names);
  assertGreaterThan(
    pitch,
    0,
    "the course's rows are drawn on distinct baselines, so a row has a band of " +
      "its own",
  );
  const baselines = [FIRST_ROW, SECOND_ROW].map((row) =>
    baselineOf(lines, names[row] as string),
  );
  // A third of the pitch either side of a baseline is that row's own band; a
  // whole pitch either side of the pair is as far as what the two poses changed
  // can reach. Both are wide across the whole stage, because `specs/` fixes no
  // column for this screen.
  const confined = (y: number): boolean =>
    y >= Math.min(...baselines) - pitch && y <= Math.max(...baselines) + pitch;

  const before = await h.pixelRect(0, 0, STAGE_W, STAGE_H);

  await h.debug.setSelectIndex(SECOND_ROW);
  await h.advance(1);
  await captureStill(h, "highlight");
  const after = await h.pixelRect(0, 0, STAGE_W, STAGE_H);

  assertEqual(
    (await h.snapshot()).selectIndex,
    SECOND_ROW,
    "the second frame is the same screen with the highlight on challenge 2",
  );
  assertEqual(
    after.height,
    before.height,
    "both frames are read off the same stage, so the two pictures compare row " +
      "for row",
  );

  // Where the two frames differ, row of pixels by row of pixels, and where each
  // of those rows falls on the stage the check addressed its bands in.
  const rows = differingByRow(before, after);
  const stageY = (row: number): number =>
    ((row + 0.5) * STAGE_H) / Math.max(1, rows.length);

  let outside = 0;
  const withinBand = [0, 0];
  for (let row = 0; row < rows.length; row += 1) {
    const y = stageY(row);
    const changed = rows[row] as number;
    if (!confined(y)) {
      outside += changed;
      continue;
    }
    baselines.forEach((baseline, which) => {
      if (Math.abs(y - baseline) <= pitch / 3) {
        withinBand[which] = (withinBand[which] as number) + changed;
      }
    });
  }

  assertGreaterThan(
    withinBand[FIRST_ROW] as number,
    0,
    `the row for ${JSON.stringify(names[FIRST_ROW] ?? "")} is drawn visibly ` +
      "differently once the highlight has left it, so the highlighted row is " +
      "drawn distinctly from the rest",
  );
  assertGreaterThan(
    withinBand[SECOND_ROW] as number,
    0,
    `the row for ${JSON.stringify(names[SECOND_ROW] ?? "")} is drawn visibly ` +
      "differently once the highlight has arrived on it, so the row confirm " +
      "would open is the one that is marked",
  );
  assertLessThanOrEqual(
    outside,
    OUTSIDE_BUDGET,
    "moving the highlight changes the two rows it moved between and leaves the " +
      "rest of the stage as it was, so what is drawn distinctly is the row",
  );
});

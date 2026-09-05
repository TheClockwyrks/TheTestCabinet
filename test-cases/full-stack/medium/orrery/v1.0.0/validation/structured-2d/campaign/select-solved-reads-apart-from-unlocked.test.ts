// campaign/select-solved-reads-apart-from-unlocked — a solved row is drawn
// differently from an unlocked one.
//
// THE RULE. The select screen lists the course, "each row showing its number, its
// name, and its state, with the state readable without relying on hue alone"
// (`specs/modes/campaign.md`, The select screen), over the three states that
// section tabulates — unlocked, "Reached and not yet solved. Can be entered", and
// solved, "Completed at least once. Can be entered again." This point decides ONE
// pair of them: solved against unlocked. Locked against unlocked, and locked
// against solved, are their own items.
//
// HOW THE DIFFERENCE IS DRAWN IS THE BUILD'S. `specs/ui.md` "fixes no palette, no
// font, and no background", and `specs/` fixes no geometry, no wording and no mark
// for this screen — so what is read is that the row CHANGED, never what changed in
// it. Whether what changed reads without relying on hue alone is the reviewer's,
// like the rest of the build's presentation.
//
// THE POSE IS THE SURFACE'S OWN MARK. `setSolved(mode, index, solved)` "Adds
// `index` to that mode's solved set when `solved` is `true`"
// (`specs/instrumentation.md`), and challenge 1 is the row read, "unlocked from
// the start" (`specs/modes/campaign.md`, Progression) and so unlocked in the first
// frame and solved in the second. NO RECORD IS POSED: "A solved row also shows its
// three records" only where there is a records entry, and this point is about the
// STATE the row reads as, not the figures a records entry adds — which are their
// own items. So the two frames differ by the solved mark and nothing else.
//
// THE HIGHLIGHT IS PINNED OFF THAT ROW, on challenge 2, in both frames: "One row
// is highlighted, drawn distinctly from the rest", so a highlight that moved would
// be a second difference. Pinned, it cannot be what the frames differ by.
//
// WHAT IS READ is the band of the stage the row's baseline sits in, found by the
// row's own name rather than by a layout figure `specs/` does not fix.
//
// THE VERDICT. Challenge 1's band is drawn differently between the two
// poses.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import { STAGE_W } from "../constants";
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

/** The row read: challenge 1, "unlocked from the start" and solved by the pose. */
const READ_ROW = 0;

/** The row the highlight is pinned to, which is not the row read. */
const PINNED_ROW = 1;

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

it("draws a solved row differently from an unlocked one", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(
    count,
    PINNED_ROW,
    `the course holds a challenge ${PINNED_ROW + 1}, so the highlight can be ` +
      "pinned off the row this point reads",
  );
  const names = await courseNames(count);

  await openSelect(h, "campaign");
  await h.debug.setSelectIndex(PINNED_ROW);
  await h.advance(1);
  const posed = await h.snapshot();
  assertDeepEqual(
    posed.campaign.solved,
    [],
    "nothing is solved, so challenge 1's row is drawn unlocked in the first frame",
  );
  assertEqual(
    posed.campaign.records[READ_ROW] ?? null,
    null,
    "the challenge has no records entry either side, so the figures a solved " +
      "row's records add are not what the two frames differ by",
  );

  const lines = linesOf(textDraws(await h.lastCalls()));
  const pitch = pitchOf(lines, names);
  assertGreaterThan(
    pitch,
    0,
    "the course's rows are drawn on distinct baselines, so a row has a band of " +
      "its own",
  );
  // A third of the pitch either side of the baseline: a band of the row's own,
  // wide across the whole stage because `specs/` fixes no column for this screen.
  const band = {
    x: 0,
    y: baselineOf(lines, names[READ_ROW] as string) - pitch / 3,
    w: STAGE_W,
    h: (2 * pitch) / 3,
  };
  const readBand = (): Promise<PixelRect> =>
    h.pixelRect(band.x, band.y, band.w, band.h);

  const unlocked = await readBand();

  await h.debug.setSolved("campaign", READ_ROW, true);
  await h.advance(1);
  await captureStill(h, "states");
  const solved = await readBand();

  const after = await h.snapshot();
  assertDeepEqual(
    after.campaign.solved,
    [READ_ROW],
    "challenge 1 is marked solved in the second frame, and it is the only one",
  );
  assertEqual(
    after.selectIndex,
    PINNED_ROW,
    "the highlight is on the same row in both frames, so it is not what they " +
      "differ by",
  );
  assertGreaterThan(
    pixelsDiffering(unlocked, solved),
    0,
    `the row for ${JSON.stringify(names[READ_ROW] ?? "")} is drawn visibly ` +
      "differently once its challenge is solved, so a solved row reads apart " +
      "from an unlocked one",
  );
});

// campaign/select-locked-reads-apart-from-unlocked — a locked row is drawn
// differently from an unlocked one.
//
// THE RULE. The select screen lists the course, "each row showing its number, its
// name, and its state, with the state readable without relying on hue alone"
// (`specs/modes/campaign.md`, The select screen), over the three states that
// section tabulates — locked, "Not yet reached. Cannot be entered", and unlocked,
// "Reached and not yet solved. Can be entered." This point decides ONE pair of
// them: locked against unlocked. Solved against unlocked, and locked against
// solved, are their own items.
//
// HOW THE DIFFERENCE IS DRAWN IS THE BUILD'S. `specs/ui.md` "fixes no palette, no
// font, and no background", and `specs/` fixes no geometry, no wording and no mark
// for this screen — so what is read is that the row CHANGED, never what changed in
// it. Whether what changed reads without relying on hue alone is the reviewer's,
// like the rest of the build's presentation.
//
// THE POSE IS THE PROGRESSION'S OWN FIGURE. "Challenge `1` is unlocked from the
// start. Every other challenge begins locked" (Progression), and
// `setUnlockedCount(n)` "Sets how many campaign challenges are open"
// (`specs/instrumentation.md`). So challenge 2's row is read at `1`, where it is
// locked, and again at `2`, where it is unlocked, and nothing else about the world
// moves: nothing is solved either side, so no record and no solved mark is what
// the two frames differ by.
//
// THE HIGHLIGHT IS PINNED OFF THAT ROW, on challenge 1, in both frames: "One row
// is highlighted, drawn distinctly from the rest", so a highlight that moved would
// be a second difference. Pinned, it cannot be what the frames differ by.
//
// WHAT IS READ is the band of the stage the row's baseline sits in, found by the
// row's own name rather than by a layout figure `specs/` does not fix.
//
// THE VERDICT. Challenge 2's band is drawn differently between the two
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

/** The row read: challenge 2, the first one "Every other challenge begins locked". */
const READ_ROW = 1;

/** The row the highlight is pinned to, which is not the row read. */
const PINNED_ROW = 0;

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

it("draws a locked row differently from an unlocked one", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(
    count,
    READ_ROW,
    `the course holds a challenge ${READ_ROW + 1}, which is the row read locked ` +
      "and then unlocked",
  );
  const names = await courseNames(count);

  await openSelect(h, "campaign");
  await h.debug.setSelectIndex(PINNED_ROW);
  await h.advance(1);
  const posed = await h.snapshot();
  assertEqual(
    posed.campaign.unlockedCount,
    1,
    "only challenge 1 is open, so challenge 2's row is drawn locked in the " +
      "first frame",
  );
  assertDeepEqual(
    posed.campaign.solved,
    [],
    "nothing is solved either side, so the solved state is not what the two " +
      "frames differ by",
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

  const locked = await readBand();

  await h.debug.setUnlockedCount(READ_ROW + 1);
  await h.advance(1);
  await captureStill(h, "states");
  const unlocked = await readBand();

  const after = await h.snapshot();
  assertEqual(
    after.campaign.unlockedCount,
    READ_ROW + 1,
    `challenge ${READ_ROW + 1} is open in the second frame, so its row is drawn ` +
      "unlocked there",
  );
  assertEqual(
    after.selectIndex,
    PINNED_ROW,
    "the highlight is on the same row in both frames, so it is not what they " +
      "differ by",
  );
  assertGreaterThan(
    pixelsDiffering(locked, unlocked),
    0,
    `the row for ${JSON.stringify(names[READ_ROW] ?? "")} is drawn visibly ` +
      "differently once it is unlocked, so a locked row reads apart from an " +
      "unlocked one",
  );
});

// extras/select-marks-solved-rows — completing an Extras challenge changes what
// its row on the select screen is drawn as.
//
// THE RULE. The Extras select screen lists the ten challenges, "each row showing
// its number, its name, and whether it is solved" (`specs/modes/extras.md`, The
// select screen), and what makes a challenge solved is a run that finishes it: "A
// challenge is solved by a run that completes" (the same file), and "Completing a
// challenge marks it solved for the session" (Progression). `specs/modes/campaign.md`
// names the state the row then shows: "solved — Completed at least once. Can be
// entered again."
//
// SO THE ROW IS DRAWN DIFFERENTLY, and that is all this point decides. HOW the
// difference is drawn is the build's: `specs/ui.md` "fixes no palette, no font,
// and no background", and `specs/` fixes no geometry, no wording and no mark for
// this screen; whether it reads without relying on hue alone is the reviewer's.
// The three records a solved row adds are their own items'.
//
// THE CONFIGURATION. A fresh session, arriving at the Extras select screen, with
// the row for challenge 3 read off the frame twice: once with nothing solved, and
// once after challenge 3 has been completed on the build's own reference solution
// — which `specs/modes/extras.md` requires to exist and to complete ("Every
// Extras challenge ships a reference solution under the requirement
// `specs/modes/campaign.md` states for a course challenge", which is one "whose
// run completes without faulting within `CAMPAIGN_REFERENCE_CYCLES` (`600`)
// cycles"). Completion is the posing step here rather than the verdict.
//
// THE HIGHLIGHT IS PINNED TO ROW 1 IN BOTH FRAMES, through `setSelectIndex`,
// because "One row is highlighted, drawn distinctly from the rest"
// (`specs/modes/campaign.md`) and a completion moves where the highlight lands.
// Pinned off row 3, the highlight cannot be what the two frames differ by, so the
// difference read is the row's own state.
//
// WHAT IS READ is the band of the stage the row's baseline sits in, found by the
// row's name rather than by a layout figure `specs/` does not fix.
//
// THE VERDICT. Row 3's band is drawn differently once its challenge is solved,
// and the run really did complete and really did mark it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { EXTRA_NAMES } from "../challenges";
import { CAMPAIGN_REFERENCE_CYCLES, SPEEDS, STAGE_W } from "../constants";
import {
  advanceCycles,
  allowCompletion,
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  openSelect,
  openTitle,
  pixelsDiffering,
  referenceSolution,
  setSpeed,
  textDraws,
  type Harness,
  type OrrerySnapshot,
  type PixelRect,
  type TextDraw,
} from "../harness";

/** The challenge this point completes, and the row the highlight is pinned to. */
const SOLVED_INDEX = 2;
const PINNED_ROW = 0;

/** The fastest speed step, which is how few frames the reference's budget costs. */
const FAST_SPEED = SPEEDS.length - 1;

/** How many cycles one call to the clock covers while the reference is run out. */
const CYCLES_PER_STEP = 25;

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

/** Run the live machine until it stops running, or the reference budget runs out. */
async function settle(): Promise<OrrerySnapshot> {
  let snapshot = await h.snapshot();
  for (
    let covered = 0;
    covered < CAMPAIGN_REFERENCE_CYCLES && snapshot.sim?.status === "running";
    covered += CYCLES_PER_STEP
  ) {
    await advanceCycles(h, CYCLES_PER_STEP, CYCLES_PER_STEP);
    snapshot = await h.snapshot();
  }
  return snapshot;
}

it("draws a solved row differently from the way it drew it unsolved", async () => {
  await openTitle(h);
  await openSelect(h, "extras");
  await h.debug.setSelectIndex(PINNED_ROW);
  await h.advance(1);

  const lines = linesOf(textDraws(await h.lastCalls()));
  const pitch = pitchOf(lines);
  assertGreaterThan(
    pitch,
    0,
    "the ten rows are drawn on distinct baselines, so a row has a band of its own",
  );
  // A third of the pitch either side of the baseline: a band of the row's own,
  // wide across the whole stage because `specs/` fixes no column for this screen.
  const band = {
    x: 0,
    y: baselineOf(lines, EXTRA_NAMES[SOLVED_INDEX] as string) - pitch / 3,
    w: STAGE_W,
    h: (2 * pitch) / 3,
  };
  const readBand = (): Promise<PixelRect> =>
    h.pixelRect(band.x, band.y, band.w, band.h);

  const unsolved = await readBand();
  assertDeepEqual(
    (await h.snapshot()).extras.solved,
    [],
    "the first frame is the row drawn with nothing on the shelf solved",
  );

  await openChallenge(h, "extras", SOLVED_INDEX);
  await loadMachine(h, await referenceSolution(h, "extras", SOLVED_INDEX));
  await allowCompletion(h);
  await h.debug.startRun();
  await setSpeed(h, FAST_SPEED);
  const finished = await settle();
  assertEqual(
    finished.sim?.status,
    "complete",
    `Extras challenge ${SOLVED_INDEX + 1} completes within ` +
      "CAMPAIGN_REFERENCE_CYCLES (600) cycles on the reference solution the " +
      "build ships for it, which is how this point's world is posed",
  );

  await openSelect(h, "extras");
  await h.debug.setSelectIndex(PINNED_ROW);
  await h.advance(1);
  await captureStill(h, "states");
  const solved = await readBand();

  const after = await h.snapshot();
  assertDeepEqual(
    after.extras.solved,
    [SOLVED_INDEX],
    "the completed challenge is the one marked solved, and it is the only one",
  );
  assertEqual(
    after.selectIndex,
    PINNED_ROW,
    "the highlight is on the same row in both frames, so it is not what they " +
      "differ by",
  );
  assertGreaterThan(
    pixelsDiffering(unsolved, solved),
    0,
    `the row for ${JSON.stringify(EXTRA_NAMES[SOLVED_INDEX] ?? "")} is drawn ` +
      "visibly differently once its challenge is solved, so a solved row reads " +
      "apart from an unsolved one",
  );
});

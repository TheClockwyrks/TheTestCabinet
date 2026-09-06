// presentation/solved-panel-text-legible — every line the solved panel carries is
// drawn over the finished machine behind it.
//
// THE RULE, from Presentation in `specs/ui.md`: "every piece of text a screen
// shows is legible against whatever sits behind it at the logical stage size
// `STAGE_W x STAGE_H` (`1280 x 720`)". What this screen shows, and what stands
// behind it, are the same file's: "While `sim.status` is `complete`, a panel is
// drawn over the run showing `SOLVED_TITLE_TEXT` (`CHALLENGE COMPLETE`), the
// finished run's three metrics, the challenge's records with any new best marked,
// and a vertical menu built from `SOLVED_ITEMS` (`NEXT CHALLENGE`, `KEEP
// TINKERING`, `BACK TO SELECT`, in that order)", and "the finished machine stays
// visible behind the panel".
//
// WHICH LINES ARE THE PANEL'S. The panel is drawn OVER the run, so its own copy
// is the copy drawn once the panel is up: the frame's text runs are read in the
// order the frame issued them, and every line from `SOLVED_TITLE_TEXT`'s own
// onward is panel copy — the heading, the metrics, the records and the menu. The
// menu's lines are taken by name as well, since `SOLVED_ITEMS` is the case's own
// copy and is identifiable wherever the build sets it. What is deliberately NOT
// read is the editor's own text from earlier in the frame: a line the panel
// covers is not shown to a player at all, and reading one would be reading
// something no requirement is about.
//
// THE CONFIGURATION. Campaign challenge `1` opened through the surface — so it is
// the course's own challenge and its panel offers the whole of `SOLVED_ITEMS`,
// "`NEXT CHALLENGE` is offered only when the mode has a challenge after this one"
// — loaded with the build's own reference solution and run to completion with the
// completion switch on. `specs/modes/campaign.md` requires that solution's "run
// completes without faulting within `CAMPAIGN_REFERENCE_CYCLES` (`600`) cycles",
// so a build whose reference never completes leaves this point's world unposed,
// which fails it. The whole of it is read at the stage's own size, which is what
// `createHarness()` opens: `cssWidth` and `cssHeight` "default to the logical
// stage" and `dpr` to `1`, so a logical unit is a device pixel.
//
// THE VERDICT. `SOLVED_TITLE_TEXT` is on the screen, every one of the three
// `SOLVED_ITEMS` is on the screen, and every line the panel drew carries paint
// standing off the ground behind it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertTrue,
} from "../assert";
import { drewText, RUN_BASELINE_SLACK } from "../case-harness/text";
import {
  CAMPAIGN_REFERENCE_CYCLES,
  SOLVED_ITEMS,
  SOLVED_TITLE_TEXT,
  SPEEDS,
  STAGE_H,
  STAGE_W,
} from "../constants";
import type { Region } from "../field";
import {
  advanceCycles,
  allowCompletion,
  captureStill,
  createHarness,
  lineWith,
  loadMachine,
  CHANNEL_EPSILON,
  meanRect,
  shareAwayFrom,
  openChallenge,
  referenceSolution,
  setSpeed,
  spells,
  textDraws,
  textLines,
  type DrawCall,
  type Harness,
  type OrrerySnapshot,
  type TextDraw,
  type TextLine,
} from "../harness";

/** The whole stage, which is what a band on a full-screen panel is clipped to. */
const STAGE: Region = { x: 0, y: 0, w: STAGE_W, h: STAGE_H };

/**
 * The fastest speed step. A run's outcome does not turn on it — "`advance(1, 1)`
 * and `advance(1, 60)` cover the same cycles and reach the same outcome"
 * (`specs/instrumentation.md`) — so the fastest step is chosen for one reason
 * only: it is how few frames the reference's cycle budget costs.
 */
const FAST_SPEED = SPEEDS.length - 1;

/** How many cycles one call to the clock covers while the run is walked out. */
const CYCLES_PER_STEP = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/* -------------------------------------------------------------------------- */
/* Reading that a line of type was drawn                                      */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` fixes no palette, no font and no background, so nothing about
// HOW a line is set can be read, and how well it reads is the reviewer's. What a
// check decides is that the line reached the frame: the build submitted the run,
// and the band of the stage it anchored that run in carries paint standing off
// the flat ground behind it — the band is not one colour, so something was drawn
// into it.

/** How far past the outermost anchors of a line its band reaches. */
const BAND_PAD = 80;

/** How far over the baseline the band reaches, and how far under it. */
const BAND_ABOVE = 18;
const BAND_BELOW = 6;

/**
 * The frame's lines of text, one per baseline, with the blank ones dropped.
 *
 * `specs/assets.md` puts every word on the stage on the frame as drawn text
 * and fixes no more — "Which typeface carries them is yours" — and letter
 * spacing is not portable, so a build is free to draw one line of copy as one
 * call, as a call per word, or as a call per glyph. What all of those share is
 * the baseline, so the lines are `drawing.ts`'s `textLines` — the shared
 * harness's logical runs gathered onto the baselines they share, the reading
 * the shared `drewText` matches screen copy along. A line that spells nothing
 * but whitespace put no ink on the stage and is not read.
 */
function linesOf(calls: readonly DrawCall[], region: Region): TextLine[] {
  return textLines(calls, region).filter((line) => line.text.trim() !== "");
}

/**
 * Where a line sits in the frame's own drawing order: the index, among the
 * frame's text calls, of the first one anchored on its baseline.
 *
 * The panel is drawn over the finished machine, so every line the frame drew
 * from the heading on is the panel's, whatever the editor's chrome under it
 * still carries.
 */
function orderOf(draws: readonly TextDraw[], line: TextLine): number {
  return draws.findIndex(
    (draw) => Math.abs(draw.y - line.y) <= RUN_BASELINE_SLACK,
  );
}

/**
 * The band of the stage a line is read inside, clipped to `bounds`.
 *
 * A line's extent is what the recorder measured of its runs, and on a frame it
 * never measured only the anchors; where the glyphs sit around an anchor
 * depends on the alignment and the font, neither of which `specs/` fixes — so
 * the band is taken ABOUT that extent, wide enough that a run set to any
 * alignment puts glyphs inside it and shallow enough not to swallow the line
 * above.
 */
function bandOf(line: TextLine, bounds: Region): Region {
  const x = Math.max(bounds.x, line.left - BAND_PAD);
  const y = Math.max(bounds.y, line.y - BAND_ABOVE);
  return {
    x,
    y,
    w: Math.max(1, Math.min(bounds.x + bounds.w, line.right + BAND_PAD) - x),
    h: Math.max(1, Math.min(bounds.y + bounds.h, line.y + BAND_BELOW) - y),
  };
}

/** Decide whether one line was drawn into the band the frame anchored it in. */
async function assertDrawn(
  line: TextLine,
  bounds: Region,
  what: string,
): Promise<void> {
  const band = bandOf(line, bounds);
  const rect = await h.pixelRect(band.x, band.y, band.w, band.h);
  assertGreaterThan(
    shareAwayFrom(rect, meanRect(rect), CHANNEL_EPSILON),
    0,
    `${what} is drawn at the logical stage size ${STAGE_W} x ${STAGE_H}: the ` +
      `line reads ${JSON.stringify(line.text)}, and the band the frame ` +
      `anchored it in carries paint standing off the ground behind it`,
  );
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

it("draws the solved panel's heading, figures and menu over the finished machine", async () => {
  await h.debug.reset();
  assertGreaterThan(
    (await h.snapshot()).campaign.count,
    1,
    "the course holds a challenge after the first, so the panel offers the " +
      "whole of SOLVED_ITEMS",
  );

  await openChallenge(h, "campaign", 0);
  await loadMachine(h, await referenceSolution(h, "campaign", 0));
  await allowCompletion(h);
  await h.debug.startRun();
  await setSpeed(h, FAST_SPEED);

  const finished = await settle();
  assertEqual(
    finished.sim?.status,
    "complete",
    "campaign challenge 1 completes within CAMPAIGN_REFERENCE_CYCLES (600) " +
      "cycles on its own reference solution, which is the world this point " +
      "decides in",
  );
  assertNotNull(
    finished.sim?.metrics,
    "a completed run has its metrics recorded, which is what the panel shows " +
      "three of",
  );

  await h.advance(1);
  await captureStill(h, "solved");

  const calls = await h.lastCalls();
  const lines = linesOf(calls, STAGE);
  assertTrue(
    drewText(calls, SOLVED_TITLE_TEXT),
    `the panel draws SOLVED_TITLE_TEXT (${SOLVED_TITLE_TEXT}); the lines the ` +
      `frame drew are ${JSON.stringify(lines.map((line) => line.text))}`,
  );
  for (const item of SOLVED_ITEMS) {
    assertTrue(
      drewText(calls, item),
      `the panel's menu is built from SOLVED_ITEMS, and the mode has a ` +
        `challenge after this one, so ${item} is on the screen`,
    );
  }
  const title = lineWith(lines, SOLVED_TITLE_TEXT);
  assertNotNull(title, "the heading lies on a line of its own to read");

  const draws = textDraws(calls);
  const from = title === null ? 0 : orderOf(draws, title);
  const panel = lines.filter(
    (line) =>
      orderOf(draws, line) >= from ||
      SOLVED_ITEMS.some((item) => spells(line, item)),
  );
  for (const line of panel) {
    await assertDrawn(line, STAGE, "the solved panel's line");
  }
});

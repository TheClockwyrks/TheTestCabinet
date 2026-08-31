// Facet — audio/cue-land: a chain step whose gems fell far enough sounds the
// `land` cue as they land, on the frame the step timer crosses LAND_AT.
//
// THE ROW THIS IS ABOUT. specs/ui.md's CUES table: "`land` — `CUES.land` — A
// chain step's gems land, and the step's longest fall was more than
// `LAND_MIN_ROWS` (`2`) rows", under the sentence that fixes the timing — "Each
// is played on the frame its event happens ... and at most once on that frame".
// specs/assets.md gives the sound its character: "land is a low settling knock
// for a column of stone arriving at the bottom of a long fall".
//
// WHICH FRAME THAT IS. specs/rules.md's own table of a step's three spans:
// `stepTimer` counts from `0` at the moment a step resolves, the clear set
// shatters until `SHATTER_END = lastWaves * WAVE_SECONDS`, the gems fall until
// `LAND_AT = SHATTER_END + lastFall * FALL_SECONDS_PER_ROW`, and the board rests
// from there. So the landing is `LAND_AT` into the step, and the two figures it
// is built from are the step's OWN — `lastWaves` and `lastFall`, both of which
// the snapshot reports. The check reads them off the step it drove and works out
// the moment from them, rather than writing a figure down: specs/rules.md hands
// each refilled gem's own `fell` to the build above a floor, so `lastFall` is
// partly the build's and a `LAND_AT` reckoned here would be reckoned for some
// other build.
//
// THE STEP THAT IS DRIVEN. A vertical run of five low in one column — rows 3
// through 7 of column 5 — which is as far as a single column's clear can throw
// the stones above it. R8 turns the run of five into a `prism` in the column, and
// R9 drops what survived above the clear four rows down and refills the top of
// the column from above the board. The step's `lastFall` is therefore well past
// `LAND_MIN_ROWS`, and the check asserts that off the build's own reading before
// it looks for the cue: a step that moved the board less is
// `audio/cue-land-only-for-a-long-fall`'s, not this one's.
//
// HOW THE CROSSING FRAME IS FOUND, AND WHY ONE FRAME OF SLACK IS ALLOWED. The
// step is walked ONE FRAME AT A TIME and the first frame whose `stepTimer` stands
// at or past `LAND_AT` is the crossing. Whether a build fires its own comparison
// with `>=` or `>` is its own business, and the two differ by at most the one
// frame that carries the timer over an exact boundary — so the cue is looked for
// on the crossing frame or the one after it, and never earlier. A build that
// sounded it early is a build that sounded it before its gems had landed, and
// that is what the silence below rules out.
//
// AND THE SILENCE IS WHAT ATTRIBUTES THE SOUND. The step already sounded `clear`
// on the frame it resolved on. What makes a sound at `LAND_AT` the landing rather
// than the tail of that is the run of frames between the two: no `land` cue may
// sound on any of them. Under this engine the reading is by NAME, so a `clear`
// sounding on the resolving frame is outside this point entirely.
//
// WHY THE SWAP IS POSED. The event is raised by a FRAME rather than by an input
// edge — the step's own timer crossing a threshold — so how the move was asked
// for cannot move it, and `requestSwap` goes "through the same acceptance path a
// player's release takes" (specs/instrumentation.md) without putting the
// pointer's own surface between this point and the thing it decides.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertGreaterThan,
  assertLength,
  assertTrue,
  fail,
} from "../assert";
import {
  landAt,
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import { CUES, LAND_MIN_ROWS } from "../constants";
import {
  captureReplay,
  createHarness,
  cueNames,
  cuesOnFrame,
  loadBoard,
  requestSwap,
  stepDriveFrames,
  watchCues,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/**
 * Four rubies down the bottom of column 5, one cell short of a line, and the
 * fifth waiting beside the gap.
 *
 * The exchange fills `(5,5)` and makes rows 3 through 7 of that column a maximal
 * run of five — the deepest clear one column can take, and so the longest fall
 * one step can leave.
 */
const CELLS: readonly PlacedToken[] = [
  { col: 5, row: 3, token: "R0" },
  { col: 5, row: 4, token: "R0" },
  { col: 5, row: 6, token: "R0" },
  { col: 5, row: 7, token: "R0" },
  { col: 6, row: 5, token: "R0" },
];

/** The cell the waiting ruby sits on, and the cell the swap carries it into. */
const FROM: CellRef = { col: 6, row: 5 };
const TO: CellRef = { col: 5, row: 5 };

/** The cells the exchange makes a run of, and how many of them there are. */
const RUN_LENGTH = 5;

/**
 * Frames allowed beyond the drive a boundary needs.
 *
 * NOT a specification figure. `stepDriveFrames` is the harness's own count of the
 * frames that carry the game past the boundary it stands before, sized so a build
 * comparing `>=` and one comparing `>` both read alike; two frames beyond it is
 * room for a build that acts on the next frame.
 */
const SEARCH_MARGIN = 2;

let h: Harness;

/** Walk the swap one frame at a time to the frame step 1 resolves on. */
async function stepOneFrame(): Promise<{
  frame: number;
  snapshot: FacetSnapshot;
}> {
  const cap = stepDriveFrames(h.snapshot()) + SEARCH_MARGIN;
  for (let driven = 0; driven < cap; driven += 1) {
    await h.advance(1);
    const snapshot = h.snapshot();
    if (snapshot.chainStep >= 1) return { frame: h.frame(), snapshot };
  }
  return fail(
    `step 1 to resolve within ${cap} frames of the accepted swap`,
    `phase ${h.snapshot().phase} at chain step ${h.snapshot().chainStep}`,
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays the land cue on the frame a long fall's step timer crosses LAND_AT", async () => {
  // specs/assets.md decodes the produced `.wav`s asynchronously and specs/ui.md
  // opens audio only after an interaction, so a build's first frames are
  // legitimately silent. Warming waits that out.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");

  // The fixture's own guarantees, read off the written board: nothing on it
  // matches, the move rules accept the exchange, and the exchange makes exactly
  // one maximal run, five cells deep in one column.
  const rows = quietRowsWithEscape(CELLS);
  assertLength(maximalRuns(rows), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(rows, FROM, TO), "R1 and R3 accept the swap");
  const produced = maximalRuns(swapped(rows, FROM, TO));
  assertLength(produced, 1, "maximal runs the exchange produces");
  assertLength(produced[0].cells, RUN_LENGTH, "cells in the run it produces");

  loadBoard(h, rows);
  const cues = watchCues(h);

  const landing = await captureReplay(h, "land", async () => {
    requestSwap(h, FROM, TO);
    const step = await stepOneFrame();

    // The step's own figures, read off the build: the moment its gems land is
    // built from the waves R6 gave its clear set and the fall R9 left behind.
    const moment = landAt(step.snapshot.lastWaves, step.snapshot.lastFall);

    // Walk to the frame the step timer crosses it on.
    const cap = stepDriveFrames(h.snapshot()) + SEARCH_MARGIN;
    for (let driven = 0; driven < cap; driven += 1) {
      await h.advance(1);
      if (h.snapshot().stepTimer >= moment) {
        const crossing = h.frame();
        // One more, so a build that compares its own timer with `>` rather than
        // `>=` has fired by the time the cues are read.
        await h.advance(1);
        return { step, moment, crossing };
      }
    }
    return fail(
      `the step timer to reach LAND_AT (${moment} s) within ${cap} frames`,
      `${h.snapshot().stepTimer} s at phase ${h.snapshot().phase}`,
    );
  });

  // The premise, off the build's own reading: this step really is one whose
  // gems fall far enough to knock.
  assertGreaterThan(
    landing.step.snapshot.lastFall,
    LAND_MIN_ROWS,
    "the rows the step reports its longest fall as",
  );
  assertGreaterThan(
    landing.crossing,
    landing.step.frame + 1,
    "the frame the step timer crossed LAND_AT on, against the frame after the " +
      "step resolved",
  );

  // The silent run in between, read by NAME: the landing had not happened yet on
  // any of those frames, so none of them may have knocked.
  assertLength(
    cues.filter(
      (cue) =>
        cue.frame >= landing.step.frame &&
        cue.frame < landing.crossing &&
        cue.cue === CUES.land,
    ),
    0,
    `land cues on the frames from the step resolving to LAND_AT ` +
      `(${landing.moment} s into the step)`,
  );

  // And the landing sounded, on the crossing frame or the one that carried the
  // timer past it. Containment, not exclusivity: specs/ui.md lets one frame
  // raise more than one cue.
  const sounded = cueNames([
    ...cuesOnFrame(cues, landing.crossing),
    ...cuesOnFrame(cues, landing.crossing + 1),
  ]);
  assertContains(
    sounded,
    CUES.land,
    `cues on the frame the step timer crossed LAND_AT and the frame after it`,
  );
});

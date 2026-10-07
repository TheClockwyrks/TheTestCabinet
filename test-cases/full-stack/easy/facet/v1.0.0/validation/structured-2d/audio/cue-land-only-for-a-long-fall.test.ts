// Facet — audio/cue-land-only-for-a-long-fall: the `land` cue answers to the
// step's own longest fall rather than sounding on every step.
//
// THE ROW THIS IS ABOUT, AND THE HALF OF IT THIS DECIDES. specs/ui.md's CUES
// table gives `land` a condition no other cue carries: "A chain step's gems land,
// AND the step's longest fall was more than `LAND_MIN_ROWS` (`2`) rows." The
// first half is `audio/cue-land`. This is the threshold: a build that plays the
// knock on every step is wrong in a way its own point cannot see, because every
// step that step drives does clear something and does land something.
//
// THE STEP THAT MOVES THE BOARD LEAST. A horizontal run of three along the TOP
// row. R9 settles each column from the bottom up, so a clear at row `0` leaves no
// survivor with anywhere to fall — every gem below the cleared cells is already
// as low as its column allows — and the three emptied cells are refilled at row
// `0`, where specs/rules.md's floor for a refilled gem is `r + 1`, one row. No
// arrangement on this board moves less.
//
// WHY THE READING IS CONDITIONAL ON THE BUILD'S OWN FIGURE. `lastFall` cannot be
// held down from the outside. specs/rules.md fixes only a floor — "A gem the
// refill dealt into row `r`: at least `r + 1` ... Which figure at or above that
// each refilled gem carries is the build's, and it is what decides the shape a
// column fills in" — so a build that deals its refill from high above the board
// reports a `lastFall` past `LAND_MIN_ROWS` even here, and is entitled to the
// knock. So the step's own reported `lastFall` is read first and the cue is
// asserted against it either way:
//
//   at or under LAND_MIN_ROWS — no `land` cue anywhere from the frame the step
//                               resolved to the end of its hold;
//   past LAND_MIN_ROWS        — a `land` cue at that step's own LAND_AT, read
//                               exactly as `audio/cue-land` reads one.
//
// Both branches decide the same requirement: the cue answers to the fall the step
// left. A build that plays it unconditionally fails the first branch, and a build
// that never plays it fails the second.
//
// WHY THE WINDOW STOPS SHORT OF THE HOLD'S END. specs/rules.md reads the board
// again when `stepTimer` reaches `STEP_HOLD`, and what R9's refill dropped in
// could seed a step of its own — whose landing would be a second step's cue
// arriving in this one's window. The quiet branch therefore drives the frames
// that fit STRICTLY INSIDE the hold and reads those, which is the whole of the
// span this step owns.
//
// WHY THE SWAP IS POSED. The event is raised by a FRAME rather than by an input
// edge, so how the move was asked for cannot move it, and `requestSwap` goes
// "through the same acceptance path a player's release takes"
// (specs/instrumentation.md) without putting the pointer's own surface between
// this point and the thing it decides.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
  fail,
} from "../assert";
import {
  landAt,
  maximalRuns,
  quietRowsWithEscape,
  stepHold,
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
  framesShortOf,
  loadBoard,
  requestSwap,
  stepDriveFrames,
  watchCues,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/**
 * Two rubies along the top row with a gap between them and the third, and the
 * fourth waiting one row below the gap.
 *
 * The exchange fills `(4,0)` and makes columns 2, 3 and 4 of row `0` a maximal
 * run of three — a clear at the very top of the board, which leaves every gem
 * under it exactly where it stands.
 */
const CELLS: readonly PlacedToken[] = [
  { col: 2, row: 0, token: "R0" },
  { col: 3, row: 0, token: "R0" },
  { col: 4, row: 1, token: "R0" },
];

/** The cell the waiting ruby sits on, and the cell the swap carries it into. */
const FROM: CellRef = { col: 4, row: 1 };
const TO: CellRef = { col: 4, row: 0 };

/** The cells the exchange makes a run of. */
const RUN_LENGTH = 3;

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

/** Walk one frame at a time to the frame `stepTimer` reaches `moment`. */
async function crossingFrame(moment: number): Promise<number> {
  const cap = stepDriveFrames(h.snapshot()) + SEARCH_MARGIN;
  for (let driven = 0; driven < cap; driven += 1) {
    await h.advance(1);
    if (h.snapshot().stepTimer >= moment) return h.frame();
  }
  return fail(
    `the step timer to reach ${moment} s within ${cap} frames`,
    `${h.snapshot().stepTimer} s at phase ${h.snapshot().phase}`,
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays the land cue on the board's quietest step exactly when that step's fall was long", async () => {
  // specs/assets.md decodes the produced `.wav`s asynchronously and specs/ui.md
  // opens audio only after an interaction, so a build's first frames are
  // legitimately silent. Warming waits that out.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");

  // The fixture's own guarantees, read off the written board: nothing on it
  // matches, the move rules accept the exchange, and the exchange makes exactly
  // one maximal run, of three, along the top row.
  const rows = quietRowsWithEscape(CELLS);
  assertLength(maximalRuns(rows), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(rows, FROM, TO), "R1 and R3 accept the swap");
  const produced = maximalRuns(swapped(rows, FROM, TO));
  assertLength(produced, 1, "maximal runs the exchange produces");
  assertLength(produced[0].cells, RUN_LENGTH, "cells in the run it produces");
  assertTrue(
    produced[0].cells.every((cell) => cell.row === TO.row),
    "the run the exchange produces lies along the top row",
  );

  loadBoard(h, rows);
  const cues = watchCues(h);

  const quiet = await captureReplay(h, "quiet", async () => {
    requestSwap(h, FROM, TO);
    const step = await stepOneFrame();

    // The step's own figures, read off the build: whether it knocks at all, and
    // where in its hold it would.
    const fall = step.snapshot.lastFall;
    const moment = landAt(step.snapshot.lastWaves, fall);
    const hold = stepHold(step.snapshot.lastWaves, fall);

    if (fall > LAND_MIN_ROWS) {
      const crossing = await crossingFrame(moment);
      // One more, so a build that compares its own timer with `>` rather than
      // `>=` has fired by the time the cues are read.
      await h.advance(1);
      return { step, fall, moment, crossing };
    }

    // The frames that fit strictly inside this step's hold, so the window is the
    // span this step owns and no board is read again inside it.
    await h.advance(framesShortOf(hold - step.snapshot.stepTimer));
    return { step, fall, moment, crossing: null };
  });

  // The step really is the one this point is about: it cleared its three cells
  // at the top of the board.
  assertEqual(
    quiet.step.snapshot.lastCleared,
    RUN_LENGTH,
    "cells the step cleared",
  );

  if (quiet.crossing === null) {
    // The build's own refill fell no further than `LAND_MIN_ROWS`, so this step
    // is one specs/ui.md gives no knock, and its whole hold must carry none.
    assertLength(
      cues.filter(
        (cue) => cue.frame >= quiet.step.frame && cue.cue === CUES.land,
      ),
      0,
      `land cues on a step whose longest fall was ${quiet.fall} rows, at or ` +
        `under LAND_MIN_ROWS (${LAND_MIN_ROWS})`,
    );
    return;
  }

  // The build's own refill fell further than that, which specs/rules.md entitles
  // it to, so the same step owes the knock — read exactly as `audio/cue-land`
  // reads it, at this step's own LAND_AT.
  assertGreaterThan(
    quiet.crossing,
    quiet.step.frame,
    "the frame the step timer crossed LAND_AT on, against the resolving frame",
  );
  assertLength(
    cues.filter(
      (cue) =>
        cue.frame >= quiet.step.frame &&
        cue.frame < quiet.crossing &&
        cue.cue === CUES.land,
    ),
    0,
    `land cues on the frames from the step resolving to LAND_AT ` +
      `(${quiet.moment} s into the step)`,
  );
  assertContains(
    cueNames([
      ...cuesOnFrame(cues, quiet.crossing),
      ...cuesOnFrame(cues, quiet.crossing + 1),
    ]),
    CUES.land,
    `cues on the frame the step timer crossed LAND_AT and the frame after it, ` +
      `on a step whose longest fall was ${quiet.fall} rows`,
  );
});

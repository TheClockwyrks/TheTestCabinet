// audio/cue-refuse — the `refuse` cue sounds on the frame a swap is refused.
//
// THE ROW THIS IS ABOUT. specs/ui.md's CUES table: "`refuse` | `CUES.refuse` | A
// swap is refused", under a sentence that fixes the timing — "Each is played on
// the frame its event happens ... and at most once on that frame."
// specs/rules.md says what a refusal is: "A swap that breaks one is refused and
// the board is unchanged", and "A refused swap changes nothing on the board. It
// sets `refusal` to the two cells it named." So the refusing frame is the one
// that leaves a standing refusal and the board where it was, and the cue belongs
// to it.
//
// WHY THE KEYBOARD IS THE ROUTE. specs/ui.md says "A cue is played by a frame,
// never by a pose of the debug surface", so a swap posed through `requestSwap`
// is entitled to raise nothing, and a check that posed one would be reading that
// entitlement rather than the build's audio. specs/controls.md's third row —
// "A cell orthogonally adjacent to the selected cell | Requests that swap and
// clears the selection" — is read against the cursor's cell for `confirm`, and
// "Every requested swap goes through one acceptance path, whether a press, a
// drag, or the keyboard asked for it". So one `confirm` on a neighbor makes a
// request that really happens inside a frame, under all three engines.
//
// WHY THIS REQUEST IS REFUSED. R1 accepts the pair — they are orthogonally
// adjacent — and R3 does not: the run-free filler produces no maximal run under
// this exchange and neither cell holds a `prism`. The fixture asserts both
// halves off the WRITTEN board, so a build that refuses for the wrong reason
// still refuses for a reason the specification gives.
//
// THE REFUSING FRAME IS THE CLEANEST OF THE EIGHT. Nothing is exchanged and no
// chain opens, so `refuse` is the only cue specs/ui.md entitles that frame to.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  areAdjacent,
  isPrism,
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  type CellRef,
} from "../board";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  cueNames,
  cuesOnFrame,
  loadBoard,
  watchCues,
  type Harness,
} from "../harness";

/** The selected cell, in the middle of the run-free filler. */
const SELECTED: CellRef = { col: 3, row: 3 };

/** The cursor's cell: its neighbor, so R1 accepts and only R3 can refuse. */
const NEIGHBOR: CellRef = { col: 4, row: 3 };

/**
 * Frames driven between the arrangement and the press, over a settled board on
 * which nothing at all is happening.
 *
 * No specification figure fixes a count: any stretch of quiet frames reads the
 * same, and four is enough to tell a cue apart from a sound played every frame.
 */
const QUIET_FRAMES = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the refuse cue on the frame the swap is refused", async () => {
  // specs/assets.md decodes the produced `.wav`s asynchronously and specs/ui.md
  // opens audio only after an interaction, so a build's first frames are
  // legitimately silent. Warming waits that out.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");

  // The fixture's own guarantees, read off the written board: the pair is one R1
  // accepts, neither cell is a prism, and R3 refuses the exchange all the same.
  const rows = quietRowsWithEscape([]);
  assertLength(maximalRuns(rows), 0, "maximal runs on the posed board");
  assertTrue(areAdjacent(SELECTED, NEIGHBOR), "R1 accepts the pair");
  assertTrue(!isPrism(rows, SELECTED), "the selected cell holds no prism");
  assertTrue(!isPrism(rows, NEIGHBOR), "the cursor's cell holds no prism");
  assertTrue(
    !swapIsLegal(rows, SELECTED, NEIGHBOR),
    "R3 refuses the scenario's swap",
  );

  const posed = loadBoard(h, rows);
  assertEqual(posed.phase, "idle", "the phase a swap may be requested from");
  h.debug.setSelection(SELECTED.col, SELECTED.row);
  h.debug.setCursor(NEIGHBOR.col, NEIGHBOR.row);

  const cues = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const frame = await captureReplay(h, "refuse", async () => {
    await h.tapAction("confirm");
    return h.frame();
  });

  // The event the cue is about really happened: specs/rules.md's own evidence
  // for a refusal — the two cells stand named, and no chain opened.
  const after = h.snapshot();
  assertNotNull(after.refusal, "the refusal the request left standing");
  assertEqual(after.phase, "idle", "the phase after the refused swap");
  assertEqual(after.chainStep, 0, "the chain step after the refused swap");

  // "on no frame before it" — read by NAME, so this item is decided by its own
  // cue alone and another cue arriving early is another item's verdict.
  assertLength(
    cues.filter((cue) => cue.frame < frame && cue.cue === CUES.refuse),
    0,
    "refuse cues on the frames before the swap was refused",
  );

  // And the refusing frame played the cue.
  const played = cueNames(cuesOnFrame(cues, frame));
  assertGreaterThan(played.length, 0, "one-shot cues on the refusing frame");
  assertContains(played, CUES.refuse, "cues on the refusing frame");
});

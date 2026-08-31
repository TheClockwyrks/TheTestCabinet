// audio/cue-swap — the `swap` cue sounds on the frame a swap is accepted.
//
// THE ROW THIS IS ABOUT. specs/ui.md's CUES table: "`swap` | `CUES.swap` | A
// swap is accepted", under a sentence that fixes the timing — "Each is played on
// the frame its event happens ... and at most once on that frame." specs/rules.md
// says what acceptance is: R1, R2 and R3 decide a requested swap, and "An
// accepted swap exchanges the two cells at once, sets `chainStep` to `1`, sets
// `phase` to `resolving`, and resolves step `1` immediately." So the accepting
// frame is the one that leaves `chainStep` at 1, and the cue belongs to it.
//
// WHY THE KEYBOARD IS THE ROUTE. specs/ui.md says "A cue is played by a frame,
// never by a pose of the debug surface", so a swap posed through `requestSwap`
// is entitled to raise nothing, and a check that posed one would be reading that
// entitlement rather than the build's audio. specs/controls.md's third row —
// "A cell orthogonally adjacent to the selected cell | Requests that swap and
// clears the selection" — is read against the cursor's cell for `confirm`, whose
// keys the same file fixes for a build of every engine. So one `confirm` is a
// swap that really happens inside a frame, under all three engines.
//
// WHY THE SCENARIO IS BUILT THE WAY IT IS. R3 accepts a swap only when the board
// it produces carries a maximal run, so the fixture plants one and says so in
// its own terms: `swapIsLegal` is R1 and R3 read off the WRITTEN board. Whether
// the move rules decide a swap correctly is the move items' business; here they
// are the reason an acceptance happens at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  type CellRef,
  type PlacedToken,
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

/** The selected cell: the jade the swap carries down into row 3. */
const SELECTED: CellRef = { col: 3, row: 2 };

/** The cursor's cell, orthogonally adjacent to it and one row below. */
const NEIGHBOR: CellRef = { col: 3, row: 3 };

/**
 * Three jades over the run-free filler, so that exchanging {@link SELECTED} with
 * {@link NEIGHBOR} completes a horizontal run of jade across `(2,3)`, `(3,3)`,
 * `(4,3)` and R3 accepts the swap.
 */
const SCENARIO: readonly PlacedToken[] = [
  { col: 2, row: 3, token: "J0" },
  { col: 4, row: 3, token: "J0" },
  { col: 3, row: 2, token: "J0" },
];

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

it("plays the swap cue on the frame the swap is accepted", async () => {
  // specs/assets.md decodes the produced `.wav`s asynchronously and specs/ui.md
  // opens audio only after an interaction, so a build's first frames are
  // legitimately silent. Warming waits that out.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");

  // The fixture's own guarantees, read off the written board rather than off the
  // build: nothing on it matches, and the move rules accept the one swap planted.
  const rows = quietRowsWithEscape(SCENARIO);
  assertLength(maximalRuns(rows), 0, "maximal runs on the posed board");
  assertTrue(
    swapIsLegal(rows, SELECTED, NEIGHBOR),
    "R1 and R3 accept the swap",
  );

  const posed = loadBoard(h, rows);
  assertEqual(posed.phase, "idle", "the phase a swap may be requested from");
  h.debug.setSelection(SELECTED.col, SELECTED.row);
  h.debug.setCursor(NEIGHBOR.col, NEIGHBOR.row);

  const cues = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const frame = await captureReplay(h, "swap", async () => {
    await h.tapAction("confirm");
    return h.frame();
  });

  // The event the cue is about really happened: specs/rules.md's own evidence
  // for an accepted swap.
  const after = h.snapshot();
  assertEqual(after.phase, "resolving", "the phase after the swap");
  assertEqual(after.chainStep, 1, "the chain step the accepted swap opened");

  // "on no frame before it" — read by NAME, so this item is decided by its own
  // cue alone and another cue arriving early is another item's verdict.
  assertLength(
    cues.filter((cue) => cue.frame < frame && cue.cue === CUES.swap),
    0,
    "swap cues on the frames before the swap was accepted",
  );

  // And the accepting frame played the cue. Containment, not exclusivity: that
  // frame also clears step 1's set, so `clear` is entitled to sound beside it.
  const played = cueNames(cuesOnFrame(cues, frame));
  assertGreaterThan(played.length, 0, "one-shot cues on the accepting frame");
  assertContains(played, CUES.swap, "cues on the accepting frame");
});

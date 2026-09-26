// audio/cue-swap — the `swap` cue sounds on the frame a swap is accepted.
//
// THE ROW THIS IS ABOUT. specs/ui.md's CUES table: "`swap` | `CUES.swap` | A
// swap is accepted", under a sentence that fixes the timing — "Each is played on
// the frame its event happens ... and at most once on that frame."
// specs/rules.md says what acceptance is: R1, R2 and R3 decide a requested swap,
// and "An accepted swap exchanges the two cells at once, sets `phase` to
// `swapping`, sets `swapTimer` to `0`, and leaves `chainStep` at `0`." So the
// accepting frame is the one that leaves the board `swapping`, and the cue
// belongs to it.
//
// WHY THE RELEASE IS THE FRAME. specs/controls.md makes the whole gesture the
// move — "Nothing reaches the move rules until the pointer is released", and at
// the release "An offer stands | The swap of the selected cell with the offered
// cell is requested". So the frame that carries the release is the frame the swap
// is accepted on, and it is the one this reads. The press and the carry that come
// before it are the gesture that puts an offer on the board, not the move.
//
// WHY THE GESTURE IS MADE WITH A REAL POINTER. specs/ui.md says "A cue is played
// by a frame, never by a pose of the debug surface", so a swap posed through
// `requestSwap` is entitled to raise nothing, and a check that posed one would be
// reading that entitlement rather than the build's audio. The harness's `press`,
// `moveTo` and `lift` dispatch the pointer events the runtime listens for, so
// each edge reaches the game inside a frame's own update exactly as a player's
// does, and each of the three is given a frame of its own so the cue a frame
// raises belongs to one edge.
//
// WHAT THE ACCEPTING FRAME IS ENTITLED TO. `swap` alone. specs/rules.md has the
// exchange enter `swapping` with `chainStep` at `0` and "Nothing is cleared yet:
// the two gems are in motion between their cells for `SWAP_SECONDS` (`0.18`) of
// game time", so no set clears, no gem flaws and no cut is made on that frame.
// The cue is still asserted by NAME and by containment: specs/ui.md lets a frame
// raise more than one, and this point decides its own cue alone.
//
// WHY THE SCENARIO IS BUILT THE WAY IT IS. R3 accepts a swap only when the board
// it produces carries a maximal run, so the fixture plants one and says so in its
// own terms: `swapIsLegal` is R1 and R3 read off the WRITTEN board. Whether the
// move rules decide a swap correctly is the move items' business; here they are
// the reason an acceptance happens at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  cellCenter,
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

/** The cell the press takes hold of: the jade the move carries down into row 3. */
const HELD: CellRef = { col: 3, row: 2 };

/** The neighbor the carry offers it into, one row below. */
const OFFERED: CellRef = { col: 3, row: 3 };

/**
 * Three jades over the run-free filler, so that exchanging {@link HELD} with
 * {@link OFFERED} completes a horizontal run of jade across `(2,3)`, `(3,3)`,
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

it("plays the swap cue on the frame the release requests an accepted swap", async () => {
  // specs/assets.md decodes the produced `.wav`s asynchronously and specs/ui.md
  // opens audio only after an interaction, so a build's first frames are
  // legitimately silent. Warming waits that out.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");

  // The fixture's own guarantees, read off the written board rather than off the
  // build: nothing on it matches, and the move rules accept the one swap planted.
  const rows = quietRowsWithEscape(SCENARIO);
  assertLength(maximalRuns(rows), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(rows, HELD, OFFERED), "R1 and R3 accept the swap");

  const posed = loadBoard(h, rows);
  assertEqual(posed.phase, "idle", "the phase a swap may be requested from");

  const cues = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const played = await captureReplay(h, "swap", async () => {
    // The press takes hold of the gem, on a frame of its own.
    const from = cellCenter(HELD.col, HELD.row);
    h.press(from.x, from.y);
    await h.advance(1);
    const holding = h.snapshot();
    assertDeepEqual(holding.selection, HELD, "the cell the press took hold of");
    const selectFrame = h.frame();

    // The carry offers it into the neighbor, on a frame of its own.
    const onto = cellCenter(OFFERED.col, OFFERED.row);
    h.moveTo(onto.x, onto.y);
    await h.advance(1);
    assertDeepEqual(
      h.snapshot().offer,
      OFFERED,
      "the cell the carry offered the held gem into",
    );

    // And the release is what asks for the move.
    h.lift();
    await h.advance(1);
    return { selectFrame, releaseFrame: h.frame() };
  });

  // The event the cue is about really happened: specs/rules.md's own evidence
  // for an accepted swap, which clears nothing on the frame it is accepted on.
  const after = h.snapshot();
  assertEqual(after.phase, "swapping", "the phase after the release");
  assertEqual(after.chainStep, 0, "the chain step an accepted swap leaves");

  // "on no frame before it" — read by NAME, so this item is decided by its own
  // cue alone: the press's own `select` sat on an earlier frame, and this window
  // reaches back past it to the moment the board was posed.
  assertLength(
    cues.filter(
      (cue) => cue.frame < played.releaseFrame && cue.cue === CUES.swap,
    ),
    0,
    `swap cues on the frames before the release, from the selecting frame ` +
      `${played.selectFrame} back to the posed board`,
  );

  // And the accepting frame played the cue. Containment, not exclusivity:
  // specs/ui.md lets one frame raise more than one cue.
  const sounded = cueNames(cuesOnFrame(cues, played.releaseFrame));
  assertGreaterThan(sounded.length, 0, "one-shot cues on the accepting frame");
  assertContains(sounded, CUES.swap, "cues on the accepting frame");
});

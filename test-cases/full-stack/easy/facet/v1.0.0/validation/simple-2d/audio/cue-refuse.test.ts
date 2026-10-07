// audio/cue-refuse — the `refuse` cue sounds on the frame a swap is refused.
//
// THE ROW THIS IS ABOUT. specs/ui.md's CUES table: "`refuse` | `CUES.refuse` | A
// swap is refused", under a sentence that fixes the timing — "Each is played on
// the frame its event happens ... and at most once on that frame."
// specs/rules.md says what a refusal is: "A swap that breaks one is refused and
// the board is unchanged", and "A refused swap changes nothing on the board and
// leaves `phase` `idle`. It sets `refusal` to the two cells it named." So the
// refusing frame is the one that leaves a standing refusal and the board where it
// was, and the cue belongs to it.
//
// WHY THE RELEASE IS THE FRAME. specs/controls.md makes the release the edge that
// asks — "Nothing reaches the move rules until the pointer is released" — and
// "Every requested swap goes through one acceptance path". So the frame carrying
// the release is the frame R1, R2 and R3 decide the move on, whether they take it
// or refuse it.
//
// WHY THE GESTURE IS MADE WITH A REAL POINTER. specs/ui.md says "A cue is played
// by a frame, never by a pose of the debug surface", so a swap posed through
// `requestSwap` is entitled to raise nothing, and a check that posed one would be
// reading that entitlement rather than the build's audio. The harness's `press`,
// `moveTo` and `lift` dispatch the pointer events the runtime listens for, and
// each is given a frame of its own so the cue a frame raises belongs to one edge.
//
// WHY THIS REQUEST IS REFUSED. R1 accepts the pair — they are orthogonally
// adjacent — and R3 does not: the run-free filler produces no maximal run under
// this exchange and neither cell holds a `prism`. The fixture asserts both halves
// off the WRITTEN board, so a build that refuses for the wrong reason still
// refuses for a reason the specification gives.
//
// THE REFUSING FRAME IS THE CLEANEST OF THE NINE. Nothing is exchanged, no swap
// goes into motion and no chain opens, so `refuse` is the only cue specs/ui.md
// entitles that frame to. It is still asserted by NAME and by containment, since
// specs/ui.md lets a frame raise more than one cue.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  areAdjacent,
  cellCenter,
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

/** The cell the press takes hold of, in the middle of the run-free filler. */
const HELD: CellRef = { col: 3, row: 3 };

/** The neighbor the carry offers it into, so R1 accepts and only R3 can refuse. */
const OFFERED: CellRef = { col: 4, row: 3 };

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

it("plays the refuse cue on the frame the release is refused", async () => {
  // specs/assets.md decodes the produced `.wav`s asynchronously and specs/ui.md
  // opens audio only after an interaction, so a build's first frames are
  // legitimately silent. Warming waits that out.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");

  // The fixture's own guarantees, read off the written board: the pair is one R1
  // accepts, neither cell is a prism, and R3 refuses the exchange all the same.
  const rows = quietRowsWithEscape([]);
  assertLength(maximalRuns(rows), 0, "maximal runs on the posed board");
  assertTrue(areAdjacent(HELD, OFFERED), "R1 accepts the pair");
  assertTrue(!isPrism(rows, HELD), "the held cell carries no prism");
  assertTrue(!isPrism(rows, OFFERED), "the offered cell carries no prism");
  assertTrue(
    !swapIsLegal(rows, HELD, OFFERED),
    "R3 refuses the scenario's swap",
  );

  const posed = loadBoard(h, rows);
  assertEqual(posed.phase, "idle", "the phase a swap may be requested from");

  const cues = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const releaseFrame = await captureReplay(h, "refuse", async () => {
    // The press takes hold of the gem, on a frame of its own.
    const from = cellCenter(HELD.col, HELD.row);
    h.press(from.x, from.y);
    await h.advance(1);
    assertDeepEqual(
      h.snapshot().selection,
      HELD,
      "the cell the press took hold of",
    );

    // The carry offers it into the neighbor, on a frame of its own.
    const onto = cellCenter(OFFERED.col, OFFERED.row);
    h.moveTo(onto.x, onto.y);
    await h.advance(1);
    assertDeepEqual(
      h.snapshot().offer,
      OFFERED,
      "the cell the carry offered the held gem into",
    );

    // And the release is what asks for the move the rules turn down.
    h.lift();
    await h.advance(1);
    return h.frame();
  });

  // The event the cue is about really happened: specs/rules.md's own evidence
  // for a refusal — the two cells stand named, and nothing went into motion.
  const after = h.snapshot();
  assertNotNull(after.refusal, "the refusal the request left standing");
  assertEqual(after.phase, "idle", "the phase after the refused swap");
  assertEqual(after.chainStep, 0, "the chain step after the refused swap");

  // "on no frame before it" — read by NAME, so this item is decided by its own
  // cue alone and another cue arriving early is another item's verdict.
  assertLength(
    cues.filter((cue) => cue.frame < releaseFrame && cue.cue === CUES.refuse),
    0,
    "refuse cues on the frames before the swap was refused",
  );

  // And the refusing frame played the cue.
  const sounded = cueNames(cuesOnFrame(cues, releaseFrame));
  assertGreaterThan(sounded.length, 0, "one-shot cues on the refusing frame");
  assertContains(sounded, CUES.refuse, "cues on the refusing frame");
});

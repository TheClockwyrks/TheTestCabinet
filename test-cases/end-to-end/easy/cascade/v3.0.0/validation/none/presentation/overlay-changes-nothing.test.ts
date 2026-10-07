// presentation/overlay-changes-nothing — watching the overlay costs the game
// nothing.
//
// THE RULE. `specs/instrumentation.md`, "Diagnostics": "Keep each one short
// enough to read on a line, and keep every source a pure read, so watching the
// overlay leaves the game exactly as it is", and, of the engineless build's own
// panel, "it reads the game without changing it". A source that moved the game
// while reporting it would make the panel a thing a player cannot trust, and a
// scenario driven with it open a different scenario from the same one driven
// without it.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That the game is unchanged across
// the toggle. WHICH sources are registered is the four points beside this one
// (`overlay-shows-screen`, `overlay-shows-pile-counts`, `overlay-shows-drag`,
// `overlay-shows-cascade`), and the panel's own default-off state and its
// `Backquote` key are graded nowhere — under the two engines they are the
// engine's, so an item on them could not fail on all three.
//
// IT IS READ OFF THE SNAPSHOT, WHOLE. specs/instrumentation.md has `snapshot`
// report "Every field an operation can set", so comparing two snapshots compares
// the whole of the state the specification declares, rather than the handful of
// fields this point might have thought to name.
//
// `simTime` IS THE ONE FIELD THAT MOVES, and it must. specs/instrumentation.md
// accumulates it from every update's delta whatever the screen, and each frame
// this point drives costs one of those deltas, so it is held out of the
// comparison and then checked on its own: exactly the frames driven and nothing
// more. A build whose diagnostic sources ran the simulation would advance it
// further.
//
// THE BOARD IS POSED TO BE STILL AND FULL. Cascade has no autonomous entity, so
// an empty table in play does not move on its own; but an empty table would also
// leave most of the registered sources reading nothing, and a source that
// mutates what it reads is likeliest to do it over the piles and the run in
// hand. So the piles are given cards, a run is put in hand, and no card is in
// flight — a flyer would move under gravity every frame (specs/victory.md) and
// the comparison would be measuring the cascade rather than the panel.
//
// THE PANEL IS CHECKED TO HAVE COME UP, because a toggle that drew nothing would
// make every comparison below true for the wrong reason. That is establishing
// the scenario, not a second requirement: what the lines SAY is the four points
// beside this one.
//
// BOTH DIRECTIONS ARE READ, on and then off again, which is what the review item
// asks: "identical before and after the overlay is toggled on, and identical
// again after it is toggled off".

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertTrue } from "../assert";
import { CARD_W } from "../constants";
import {
  captureStill,
  card,
  cards,
  columnCardTopLeft,
  columnFaceUpOffset,
  createHarness,
  faceDown,
  facesOf,
  openTable,
  pileOf,
  poseColumn,
  poseFoundation,
  poseStock,
  poseWaste,
  runDown,
  seconds,
  toggleOverlay,
  type CascadeSnapshot,
  type Harness,
} from "../harness";
import { overlayLines } from "./overlay";

/** The board posed: every kind of pile holding cards, and a run in hand. */
const STOCK = faceDown("2C", "9H", "4S");
const WASTE = cards("7D", "JC");
const WASTE_SETS = [1, 1];
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_UP_TO = 2;
const HELD_COLUMN = 0;
const HELD = runDown(card("KS"), 2);
const OTHER_COLUMN = 1;
const OTHER = [...faceDown("5D"), ...cards("8H")];

/** How many frames run between one snapshot and the next: one per drive. */
const TOGGLE_FRAMES = 1;
const READING_FRAMES = 1;

/** The snapshot with the one field a frame is allowed to move taken out. */
function still(snapshot: CascadeSnapshot): CascadeSnapshot {
  return { ...snapshot, simTime: 0 };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves the game exactly as it is across both toggles", async () => {
  await openTable(h);
  await poseStock(h, STOCK);
  await poseWaste(h, WASTE, WASTE_SETS);
  await poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_UP_TO);
  await poseColumn(h, HELD_COLUMN, HELD);
  await poseColumn(h, OTHER_COLUMN, OTHER);

  // A run in hand, so the drag sources have something to read.
  const faces = facesOf(pileOf(await h.snapshot(), "tableau", HELD_COLUMN));
  const top = columnCardTopLeft(HELD_COLUMN, 0, faces);
  await h.debug.pointerDown(
    top.x + CARD_W / 2,
    top.y + columnFaceUpOffset(faces) / 2,
  );

  const steady = await h.frameCalls();
  const before = await h.snapshot();

  await toggleOverlay(h);
  await captureStill(h, "toggled");
  const on = await h.snapshot();

  assertTrue(
    overlayLines(steady, await h.frameCalls()).length > 0,
    "the overlay to draw the values the build registered once it is toggled " +
      "on, so that what follows reads a panel that is up (specs/controls.md: " +
      "the backtick key shows and hides it)",
  );
  const after = await h.snapshot();

  assertDeepEqual(
    still(on),
    still(before),
    "the game to stand exactly as it did before the overlay was toggled on " +
      "(specs/instrumentation.md: every source is a pure read, so watching " +
      "the overlay leaves the game exactly as it is)",
  );
  assertCloseTo(
    on.simTime - before.simTime,
    seconds(TOGGLE_FRAMES),
    6,
    "simTime to advance by exactly the toggle's one frame and nothing more " +
      "(specs/instrumentation.md)",
  );
  assertDeepEqual(
    still(after),
    still(before),
    "the game to stand as it did while the panel was drawn a second time, so " +
      "a source that mutates what it reads is caught however often it is " +
      "called (specs/instrumentation.md)",
  );

  await toggleOverlay(h);
  const off = await h.snapshot();

  assertDeepEqual(
    still(off),
    still(before),
    "the game to stand exactly as it did before either toggle once the " +
      "overlay is toggled off again (specs/instrumentation.md)",
  );
  assertCloseTo(
    off.simTime - before.simTime,
    seconds(TOGGLE_FRAMES * 2 + READING_FRAMES),
    6,
    "simTime to advance by exactly the two toggles' frames and the one the " +
      "reading between them drove, and nothing more (specs/instrumentation.md)",
  );
});

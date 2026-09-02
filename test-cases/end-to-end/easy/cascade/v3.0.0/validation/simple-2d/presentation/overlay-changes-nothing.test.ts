// presentation/overlay-changes-nothing — watching the overlay costs the game
// nothing.
//
// THE RULE. specs/instrumentation.md, "Diagnostics": "Keep each one short enough
// to read on a line, and keep every source a pure read, so watching the overlay
// leaves the game exactly as it is." A source that moved the game while reporting
// it would make the panel a thing a player cannot trust and a scenario driven
// with it open a different scenario from the same one driven without it.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That the game is unchanged across
// the toggle. WHICH sources are registered is the four points beside this one
// (`overlay-shows-screen`, `overlay-shows-pile-counts`, `overlay-shows-drag`,
// `overlay-shows-cascade`), and the panel itself — its `Backquote` key, its
// default-off state, its layout — is the engine's under this engine and is graded
// nowhere.
//
// IT IS READ OFF THE SNAPSHOT, whole. specs/instrumentation.md has `snapshot`
// report "Every field an operation can set", so comparing two snapshots compares
// the whole of the state the specification declares, rather than the handful of
// fields this point might have thought to name.
//
// `simTime` IS THE ONE FIELD THAT MOVES, and it must. specs/instrumentation.md
// accumulates it from every update's delta whatever the screen, and each toggle
// costs a frame, so it is held out of the comparison and then checked on its own:
// exactly one frame of game time per frame run, and nothing more. A build whose
// diagnostic sources ran the simulation would advance it further.
//
// THE BOARD IS POSED TO BE STILL AND FULL. Cascade has no autonomous entity, so
// an empty table in play does not move on its own; but an empty table would also
// leave most of the registered sources reading nothing, and a source that mutates
// what it reads is likeliest to do it over the piles and the run in hand. So the
// piles are given cards, a run is put in hand, and no card is in flight — a flyer
// would move under gravity every frame (specs/victory.md) and the comparison
// would be measuring the cascade rather than the panel.
//
// THE PANEL IS CHECKED TO HAVE COME UP, because a toggle that drew nothing would
// make every comparison below true for the wrong reason. That is establishing the
// scenario, not a second requirement: what the lines SAY is the four points
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
  columnCardTopLeft,
  createHarness,
  drawFrame,
  faceUpGap,
  facesOf,
  openTable,
  pileOf,
  poseColumn,
  posePile,
  poseWaste,
  seconds,
  toggleOverlay,
  type CascadeSnapshot,
  type Harness,
} from "../harness";
import { overlayLines } from "./overlay";

/** The board posed: every kind of pile holding cards, and a run in hand. */
const STOCK = ["#2C", "#9H", "#4S"];
const WASTE = ["7D", "JC"];
const WASTE_SETS = [1, 1];
const FOUNDATION = ["AS", "2S"];
const HELD = ["KS", "QH"];
const OTHER_COLUMN = ["#5D", "8H"];

/** The snapshot with the one field a frame is allowed to move taken out. */
function still(snapshot: CascadeSnapshot): CascadeSnapshot {
  return { ...snapshot, simTime: 0 };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the game exactly as it is across both toggles", async () => {
  openTable(h);
  posePile(h, "stock", 0, STOCK);
  poseWaste(h, WASTE, WASTE_SETS);
  posePile(h, "foundation", 0, FOUNDATION);
  poseColumn(h, 0, HELD);
  poseColumn(h, 1, OTHER_COLUMN);

  // A run in hand, so the drag sources have something to read.
  const faces = facesOf(pileOf(h.snapshot(), "tableau", 0));
  const top = columnCardTopLeft(0, 0, faces);
  h.debug.pointerDown(top.x + CARD_W / 2, top.y + faceUpGap(faces) / 2);

  const steady = await drawFrame(h);
  const before = h.snapshot();

  const shown = await toggleOverlay(h);
  captureStill(h, "toggled");
  const on = h.snapshot();

  assertTrue(
    overlayLines(steady, shown).length > 0,
    "the overlay to draw the values the build registered once it is toggled " +
      "on, so that what follows reads a panel that is up (engine docs, " +
      "diagnostics.md: the backtick key toggles it)",
  );

  assertDeepEqual(
    still(on),
    still(before),
    "the game to stand exactly as it did before the overlay was toggled on " +
      "(specs/instrumentation.md: every source is a pure read, so watching the " +
      "overlay leaves the game exactly as it is)",
  );
  assertCloseTo(
    on.simTime - before.simTime,
    seconds(1),
    6,
    "simTime to advance by exactly the toggle's one frame and nothing more " +
      "(specs/instrumentation.md)",
  );

  await toggleOverlay(h);
  const off = h.snapshot();

  assertDeepEqual(
    still(off),
    still(before),
    "the game to stand exactly as it did before either toggle once the " +
      "overlay is toggled off again (specs/instrumentation.md)",
  );
  assertCloseTo(
    off.simTime - before.simTime,
    seconds(2),
    6,
    "simTime to advance by exactly the two toggles' two frames and nothing " +
      "more (specs/instrumentation.md)",
  );
});

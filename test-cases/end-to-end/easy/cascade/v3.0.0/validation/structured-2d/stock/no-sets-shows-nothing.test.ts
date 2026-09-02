// stock/no-sets-shows-nothing — a waste whose set memory is empty shows none of
// the cards it still holds.
//
// THE RULE. specs/stock.md, The waste's set memory: "A waste whose set memory is
// empty shows no card and offers none to play, whatever cards it still holds, and
// a move naming a waste card is refused." specs/table.md states the drawn half of
// it: "A waste whose set memory is empty shows no card, so it draws the empty-slot
// mark at its anchor whatever cards it still holds."
//
// WHY THE STATE IS REACHABLE, AND WHY IT NEEDS A POINT. It is not an oddity of the
// debugging surface. Under Draw Three a player reaches it by turning three, playing
// one, turning three and playing all three: the newest set empties, the fallback
// set was already played off, and the waste owes cards it must not show.
// `clearWasteSets()` reaches the same state in one call (specs/instrumentation.md:
// it "empties the waste's set memory, leaving the cards on the waste standing"),
// which is how this point poses it under either deal mode. The old specification
// left the state under-determined, and the set memory is the rule that closes it;
// this is the reading that grades the end of that rule.
//
// HOW IT IS READ. The waste's own footprint is read off the canvas twice: once
// with cards on the waste and no sets in its memory, and once with the waste truly
// empty. The
// requirement is that the two read the SAME — the picture at the waste's anchor
// does not depend on the cards the waste holds when its memory is empty, which is
// exactly "shows no card ... whatever cards it still holds". A build that shows its
// top card anyway, or fans the last turn it remembers, paints a card over that
// footprint in the first reading and the felt-and-mark of an empty slot in the
// second, and the two part company over most of the footprint.
//
// The comparison is against the EMPTY WASTE rather than against a stated colour,
// because specs/ fixes no palette: what an empty slot looks like is the build's
// own, and what this point decides is that the no-set waste looks like one.
//
// WHAT IT DOES NOT DECIDE. That an empty pile draws a card-sized mark at all is
// `presentation/empty-slot-drawn`, and that the mark reads apart from the felt is
// `presentation/slot-distinct-from-table`; between them those two pin what the
// second reading here is compared against, so a build that draws nothing at any
// anchor is charged there rather than twice. Which cards a waste with a memory
// shows is `draw-one/waste-shows-one` and `draw-three/waste-fans-shown-set`, and
// that such a waste refuses a move is `stock/no-sets-refuses-move`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { CARD_H, CARD_W, TOP_ROW_Y, WASTE_X } from "../constants";
import {
  captureStill,
  card,
  colorDistance,
  createHarness,
  FOUR,
  openTable,
  poseWaste,
  regionPixels,
  THREE,
  TWO,
  type Harness,
  type Rect,
} from "../harness";

/**
 * The cards left on the waste with nothing remembering them.
 *
 * Three, and all face-up, which is what a turn leaves (specs/stock.md): a build
 * that shows its top card draws one of them, and a build that fans the newest set
 * it can find draws all three. One card would let a build that shows nothing and a
 * build whose waste is simply empty read alike for the wrong reason; three makes
 * the pose unmistakable in the failure message.
 */
const WASTE = [
  card("clubs", TWO),
  card("diamonds", THREE),
  card("spades", FOUR),
];

/** The waste's own footprint, which is where a shown card would be drawn. */
const FOOTPRINT: Rect = { x: WASTE_X, y: TOP_ROW_Y, w: CARD_W, h: CARD_H };

/**
 * How far apart the two readings of one point may sit, in RGB distance out of
 * `441`.
 *
 * Both readings are the same build drawing the same empty slot on the same frame
 * size, so the only distance between them is the rasterizer's own; `8` is that
 * noise floor with room to spare, and a card drawn over the footprint cannot hide
 * inside it — a card reads apart from the table it sits on at a glance
 * (specs/overview.md), which is tens of units away.
 */
const SAME_DISTANCE = 8;

/**
 * How much of the footprint may read differently before the waste is said to be
 * showing something, as a share of the points sampled.
 *
 * A floor rather than nothing at all, so one anti-aliased pixel at the mark's own
 * edge decides no verdict. `1%` of the footprint is about `140` square units,
 * which is far under the whole card a build that showed one would paint there.
 */
const DIFFER_SHARE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The colour of the pixel at `at` in a run of RGBA bytes. */
function pixelAt(bytes: Uint8ClampedArray, at: number) {
  return { r: bytes[at], g: bytes[at + 1], b: bytes[at + 2] };
}

it("draws the waste's anchor as an empty slot when its memory is empty", async () => {
  openTable(h);
  poseWaste(h, WASTE, []);
  await h.drawFrame();
  // The still is the state the point is about: a waste holding three cards and
  // showing none of them.
  captureStill(h, "hidden");

  const holding = regionPixels(h, FOOTPRINT);

  // The same board with the waste's cards gone, which is the picture a waste that
  // shows nothing must already have been drawing.
  h.debug.clearPile("waste", 0);
  await h.drawFrame();
  const empty = regionPixels(h, FOOTPRINT);

  const pixels = Math.min(holding.length, empty.length) / 4;
  let apart = 0;
  for (let i = 0; i < pixels; i += 1) {
    const at = i * 4;
    if (
      colorDistance(pixelAt(holding, at), pixelAt(empty, at)) > SAME_DISTANCE
    ) {
      apart += 1;
    }
  }

  assertLessThanOrEqual(
    apart / pixels,
    DIFFER_SHARE,
    `the share of the waste's footprint at (${WASTE_X}, ${TOP_ROW_Y}) drawn ` +
      `differently with the ${WASTE.length} cards on it than with the waste ` +
      `empty, at ${SAME_DISTANCE} of 441 or more (specs/table.md: a waste ` +
      "whose set memory is empty shows no card, so it draws the empty-slot " +
      "mark at its anchor whatever cards it still holds) — " +
      `${apart} of ${pixels} pixels differed`,
  );
});

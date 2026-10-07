// Cascade — draw-three/fan-shrinks: the fan counts down within its own set.
//
// specs/stock.md: "Playing the top card off the waste leaves its set one card
// smaller", and the waste shows "the cards it holds from the newest set that
// still holds any". specs/table.md fans exactly those cards, oldest first.
//
// So a set of three, played off one card at a time, shows three, then two, then
// one — and it NEVER reaches back for a card buried under it. That last clause is
// the whole reason this point is separate from `stock.set-shrinks-on-play`, which
// reads the reported count alone: a build that keeps its fan topped up at three
// by pulling the next card up from beneath reports a shrinking set and still
// draws three cards side by side, and only the drawn fan tells the two apart.
//
// The waste is posed with cards BURIED under an older set, which is what makes a
// refill visible: with nothing beneath the newest set there is nothing to pull up
// and every build looks correct. The three shown cards are Aces of distinct suits
// and the four foundations are empty, so each is played home by the game's own
// move rules — specs/foundations.md accepts an Ace on any empty foundation —
// rather than posed away, and the set shrinks because a card really left.
//
// WHAT IS COUNTED, AND WHY IT IS NOT COUNTED AT THE FAN'S CORNERS. This point
// decides HOW MANY cards the waste lays side by side, not where it lays them:
// where the fan's cards sit is `draw-three/waste-fans-shown-set`'s, and reading
// this one at those same corners would cost a build with one wrong pitch two
// items for one fault. So what is read from each frame is the number of DISTINCT
// positions the waste drew a card at, anywhere in the space between the stock and
// the first foundation — three, then two, then one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { CARD_H, CARD_W, FOUNDATION_X, TOP_ROW_Y, WASTE_X } from "../constants";
import {
  ACE,
  FIVE,
  NINE,
  captureReplay,
  card,
  createHarness,
  drawnShapes,
  openTable,
  poseWaste,
  type DrawnShape,
  type Harness,
} from "../harness";

/** How far a drawn card's top-left may sit from where it is read, in logical units. */
const ANCHOR_TOLERANCE = 2;

/** How far a drawn footprint may differ from `CARD_W x CARD_H` (specs/table.md). */
const SIZE_TOLERANCE = 2;

/**
 * How far apart two drawn cards must be to count as two positions rather than
 * one, in logical units.
 *
 * Twice the anchor tolerance: two cards squared at one anchor are one position
 * however each was placed inside its tolerance, and two cards a whole fan pitch
 * apart — `26` (specs/table.md) — are never merged by it.
 */
const SAME_POSITION = 2 * ANCHOR_TOLERANCE;

/**
 * The band the waste's cards are drawn in: a card's width left of the waste
 * anchor, and left of the first foundation (specs/table.md).
 *
 * The bounds are wide, not tight, because this reading COUNTS the waste's cards
 * rather than placing them — where each one lands is
 * `draw-three/waste-fans-shown-set`. Nothing else is on the table, so the only
 * other card-sized marks in the top row are the empty-slot marks the stock and
 * the four foundations draw at their own
 * anchors (specs/table.md). The left bound is `WASTE_X - CARD_W` (`246`) rather
 * than the stock's own anchor, because a build is free to inset its empty-slot
 * stroke by a unit and that mark is admitted by the same footprint and anchor
 * tolerances this filter allows; twenty-two units of clearance keep the stock's
 * mark out of the count whichever way it is drawn. The `none` and `simple-2d`
 * suites read the same band.
 */
const BAND_LEFT = WASTE_X - CARD_W;
const BAND_RIGHT = FOUNDATION_X[0];

/**
 * Frames held either side of each play.
 *
 * Presentation only: the recording this point leaves is the fan counting down,
 * and a clip of three frames reads as a jump cut. Nothing is measured across
 * them — every reading below is taken on the frame that follows a play — and the
 * table holds nothing that moves on its own, so the wait changes no verdict.
 */
const HOLD_FRAMES = 18; // 0.3 s at the suite's 60 Hz

/**
 * The waste, bottom first, and its sets, oldest first.
 *
 * Two cards under an older set of two, then three Aces under the newest set of
 * three. The buried pair is what a refilling build would pull up.
 */
const WASTE = [
  card("clubs", FIVE),
  card("spades", NINE),
  card("spades", ACE),
  card("hearts", ACE),
  card("diamonds", ACE),
];
const SETS = [2, 3];

/** How many distinct positions the waste drew a card at, on one frame's calls. */
function wastePositions(shapes: readonly DrawnShape[]): number {
  const xs = shapes
    .filter(
      (shape) =>
        Math.abs(shape.w - CARD_W) <= SIZE_TOLERANCE &&
        Math.abs(shape.h - CARD_H) <= SIZE_TOLERANCE &&
        Math.abs(shape.y - TOP_ROW_Y) <= ANCHOR_TOLERANCE &&
        shape.x >= BAND_LEFT &&
        shape.x < BAND_RIGHT,
    )
    .map((shape) => shape.x)
    .sort((a, b) => a - b);

  let positions = 0;
  let previous = -Infinity;
  for (const x of xs) {
    if (x - previous > SAME_POSITION) positions += 1;
    previous = x;
  }
  return positions;
}

/** What the fan looked like on one frame: the reported count, and the positions drawn. */
interface Step {
  visible: number;
  positions: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("counts the fan down from three to one without refilling it", async () => {
  openTable(h);
  poseWaste(h, WASTE, SETS);

  /** Read the fan off one drawn frame. */
  const readFan = async (): Promise<Step> => ({
    visible: h.snapshot().wasteVisibleCount,
    positions: wastePositions(drawnShapes(h, await h.drawFrame())),
  });

  /** The waste's top card, sent home by the game's own move rules. */
  const playTopHome = (foundation: number): void => {
    const waste = h.snapshot().waste;
    const top = waste[waste.length - 1];
    const accepted = h.debug.move(
      "waste",
      0,
      waste.length - 1,
      "foundation",
      foundation,
    );
    assertEqual(
      accepted,
      true,
      `move() to accept the ${top?.suit} Ace onto empty foundation ` +
        `${foundation} (specs/foundations.md)`,
    );
  };

  const steps = await captureReplay(h, "fan", async () => {
    const taken: Step[] = [];
    await h.advance(HOLD_FRAMES);
    taken.push(await readFan());

    playTopHome(0);
    await h.advance(HOLD_FRAMES);
    taken.push(await readFan());

    playTopHome(1);
    await h.advance(HOLD_FRAMES);
    taken.push(await readFan());

    await h.advance(HOLD_FRAMES);
    return taken;
  });

  const EXPECTED = [3, 2, 1];
  EXPECTED.forEach((count, step) => {
    const played = step === 0 ? "the full set" : `${step} card(s) played home`;
    assertEqual(steps[step].visible, count, `wasteVisibleCount with ${played}`);
    assertEqual(
      steps[step].positions,
      count,
      `cards the waste laid side by side with ${played} — the fan counts down ` +
        `within its own set and never refills from the cards buried beneath it ` +
        `(specs/stock.md)`,
    );
  });

  // The buried pair is still there, so the fan shrank because its own set shrank
  // rather than because the waste ran out of cards to show.
  assertGreaterThanOrEqual(
    h.snapshot().waste.length,
    SETS[0] + 1,
    "cards still on the waste under the shrunken fan",
  );
});

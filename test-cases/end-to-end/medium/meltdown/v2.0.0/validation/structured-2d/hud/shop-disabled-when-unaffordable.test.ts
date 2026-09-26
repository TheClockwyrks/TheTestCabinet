// hud/shop-disabled-when-unaffordable — an entry whose cost is above the money is
// drawn plainly apart from an affordable one.
//
// THE RULE. specs/hud.md, The shop: "An entry whose build cost is above the
// current money is drawn disabled, plainly apart from an affordable entry."
//
// THE MONEY IS POSED ON THE BOUNDARY THE RULE STATES, which is what makes this a
// reading of the rule rather than of a gulf. The Lance costs `150`
// (specs/towers.md), so at `149` its cost is above the money and the entry is
// disabled, and at `150` it is not above the money — "above", not "at or above" —
// and the entry is affordable. One money of difference is the whole of the
// arrangement, so a build that disables an entry it can exactly afford fails here
// and a build that draws the two states alike fails here.
//
// WHAT IS DECIDED, AND WHERE THE BAR COMES FROM. specs/overview.md fixes no
// palette, so nothing here says what disabled looks like and nothing says how far
// apart the two states must read — that is the reviewer's. The Lance's own box —
// the rectangle the panel reports for it — is photographed at each of the two
// money levels and the two pictures are compared. A build may grey the name, dim
// the cost, cross the box out or stamp it; every one of those moves pixels, and a
// build that draws the two states identically moves none. How far a box moves on
// its own is measured first, by photographing it twice at the same money, and the
// change has to beat that by `NOISE_MARGIN` on the Lance while staying inside it
// on the Arc.
//
// THE ARC IS THE CONTROL. It costs `15`, so it is affordable at both money levels
// and its box must not move: without it, a panel that redrew its whole strip
// differently at `150` than at `149` — a money readout inside every entry, say —
// would pass on a change that had nothing to do with affordability.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { TOWER_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  shopEntry,
  startRun,
  type Harness,
  type ShopControl,
} from "../harness";
import { controlOf, largestChange, pixelsOver } from "./panel";

/** The entry under test, and the one that stays affordable throughout. */
const DEAR = "lance" as const;
const CHEAP = "arc" as const;

/** The money one short of the Lance's cost, where its entry is unaffordable. */
const SHORT = TOWER_DEFS[DEAR].cost - 1;

/** The money exactly equal to it, where its entry is affordable. */
const EXACTLY = TOWER_DEFS[DEAR].cost;

/**
 * How far above the movement two unchanged frames show a reading must sit for
 * an entry to count as having been drawn differently, out of the 441 a full
 * swing across the cube is.
 *
 * NOT A LEGIBILITY BAR. specs/overview.md gives the palette to the build, so no
 * figure here says how far apart a disabled entry and an affordable one must
 * read; how plainly they do is what the reviewer's presentation rating judges.
 * This is the tolerance on the noise measurement itself: two frames of an
 * animated build do not move by exactly the same amount every pair, so a reading
 * has to clear the measured movement by a little rather than by nothing. Eight
 * units is under two per cent of the scale.
 */
const NOISE_MARGIN = 8;

/** The entry the panel drew for `type`, or a failure naming the missing one. */
function entryOf(entry: ShopControl | undefined, type: string): ShopControl {
  return controlOf(entry ?? null, `${type} shop`) as ShopControl;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the Lance's entry apart at 149 money from the same entry at 150", async () => {
  startRun(h);

  h.debug.setMoney(SHORT);
  // A frame, so what the canvas holds is the panel drawn for this money: a pose
  // moves the state and the picture is what the next frame leaves behind.
  await h.advance(1);
  const short = h.snapshot();
  const dearFirst = pixelsOver(h, entryOf(shopEntry(short, DEAR), DEAR));
  const cheapFirst = pixelsOver(h, entryOf(shopEntry(short, CHEAP), CHEAP));

  // The same money again, so how far each box moves on its own is measured.
  await h.advance(1);
  const dearShort = pixelsOver(h, entryOf(shopEntry(short, DEAR), DEAR));
  const cheapShort = pixelsOver(h, entryOf(shopEntry(short, CHEAP), CHEAP));
  const dearNoise = largestChange(dearFirst, dearShort);
  const cheapNoise = largestChange(cheapFirst, cheapShort);
  captureStill(h, "disabled");

  h.debug.setMoney(EXACTLY);
  await h.advance(1);
  const exactly = h.snapshot();
  const dearExactly = pixelsOver(h, entryOf(shopEntry(exactly, DEAR), DEAR));
  const cheapExactly = pixelsOver(h, entryOf(shopEntry(exactly, CHEAP), CHEAP));

  assertEqual(
    short.money,
    SHORT,
    "precondition: the money one short of the Lance's cost",
  );
  assertEqual(
    exactly.money,
    EXACTLY,
    "precondition: the money exactly the Lance's cost",
  );

  assertGreaterThanOrEqual(
    largestChange(dearShort, dearExactly),
    dearNoise + NOISE_MARGIN,
    `the Lance's entry to be drawn differently at ${SHORT} money from the ` +
      `same entry at ${EXACTLY}, past the ${dearNoise} two frames at ` +
      `${SHORT} showed (specs/hud.md)`,
  );
  assertLessThanOrEqual(
    largestChange(cheapShort, cheapExactly),
    cheapNoise + NOISE_MARGIN,
    `the Arc's entry, affordable at both, to be drawn the same way at ` +
      `${SHORT} money as at ${EXACTLY} — within the ${cheapNoise} two frames ` +
      `at ${SHORT} showed`,
  );
});

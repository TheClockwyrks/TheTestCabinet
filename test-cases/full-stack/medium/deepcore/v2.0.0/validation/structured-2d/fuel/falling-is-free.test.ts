// fuel/falling-is-free — a fall costs no thrust or drill fuel.
//
// specs/character.md: with open space below, the miner accelerates downward at
// `GRAVITY` up to its terminal speed, and "falling costs no fuel". What it does
// pay while it falls is the underground life-support trickle, which is charged
// whatever the miner is doing — so descending is cheap and only the climb burns.
//
// The scene is a one-tile shaft twenty rows deep with rock walls either side, and
// the miner is posed in the air at the top of it with nothing held. The span is
// one second, which carries the miner about eight tiles of the twenty the shaft
// holds, so it is still airborne at the reading and no landing has intervened.
// The drill is gated, since nothing here is about cutting.

import { afterEach, beforeEach, it } from "vitest";
import { LIFE_SUPPORT_BURN } from "../../src/constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  digShaft,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  placeAt,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The shaft: a column, and the rows it is open through. */
const COL = 8;
const TOP_ROW = 6;
const BOTTOM_ROW = 25;

/** How long the fall runs, in seconds. */
const FALL_SECONDS = 1;

/** The spend, and the two frames of it a build may bill either side of the fall. */
const EXPECTED = LIFE_SUPPORT_BURN * FALL_SECONDS;
const TOLERANCE = (2 * LIFE_SUPPORT_BURN) / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends only life support while the miner falls", async () => {
  openScene(h);
  digShaft(h, COL, TOP_ROW, BOTTOM_ROW);
  placeAt(h, minerXOn(COL), minerYOn(TOP_ROW + 1));
  pinDrill(h);

  const before = h.snapshot();

  const after = await captureReplay(h, "plunge", async () => {
    await h.advance(FALL_SECONDS * TICK_HZ);
    return h.snapshot();
  });

  // It really fell, and it is still falling, so nothing but the fall was billed.
  assertGreaterThan(after.miner.y - before.miner.y, 0, "specs/character.md");
  assertEqual(after.miner.grounded, false, "specs/character.md");
  assertEqual(after.miner.state, "fall", "specs/character.md");

  assertBetween(
    before.miner.fuel - after.miner.fuel,
    EXPECTED - TOLERANCE,
    EXPECTED + TOLERANCE,
    "specs/character.md",
  );
});

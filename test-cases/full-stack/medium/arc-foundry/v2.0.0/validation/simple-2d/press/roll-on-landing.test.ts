// press/roll-on-landing — a rock is blank until it lands.
//
// `specs/scrap-press.md` is explicit about the moment: a rock rolls the instant
// it lands, not when the press is pulled. It is what makes the placement a
// decision about the yard rather than about the roll — a player who could see the
// type and the quality before choosing the footprint would place every Discharge
// Rig on the long leg and every Regulator in the corner, and the whole press
// would be a different mechanism.
//
// SO THE YARD IS READ WITH A ROCK IN HAND. There is no structure yet and nothing
// armed, and the type and the quality turn up only once the rock is on the
// ground.

import { afterEach, beforeEach, it } from "vitest";

import { COMPONENT_TYPES } from "../../src/constants";
import {
  assertBetween,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import {
  TIERS,
  captureStill,
  createHarness,
  lastStructure,
  openYard,
  pressAction,
  type Harness,
} from "../harness";

/** Where the pointer carries the held rock before it is put down. */
const CARRIED_TO = { x: 400, y: 400 };

/** Where the held rock is dropped. */
const AT = { col: 20, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows no type and no quality until the rock is on the ground", async () => {
  openYard(h);

  // The press is pulled, and the rock is carried across the yard: the pointer is
  // the engine's, so the frame is what lets the game read where it went.
  await pressAction(h, "stamp");
  h.pointerMove(CARRIED_TO.x, CARRIED_TO.y);
  await h.advance(1);

  const held = h.snapshot();
  assertEqual(held.held.active, true, "the rock held on the cursor");
  assertLength(
    held.structures,
    0,
    "the structures on the yard while a rock is still held",
  );
  assertNull(held.nextRoll, "the press's roll while a rock is still held");

  h.debug.placeRock(AT.col, AT.row);
  const landed = h.snapshot();
  await h.advance(1);
  captureStill(h, "roll");

  assertLength(
    landed.structures,
    1,
    "the structures on the yard once the rock landed",
  );
  const candidate = lastStructure(landed);
  assertEqual(candidate.kind, "candidate", "what a landed rock becomes");
  assertEqual(
    COMPONENT_TYPES.includes(candidate.type as never),
    true,
    `the type the drop rolled, one of the eight base types; it reads ` +
      `${String(candidate.type)}`,
  );
  assertBetween(
    candidate.quality ?? 0,
    TIERS[0]!,
    TIERS[TIERS.length - 1]!,
    "the quality the drop rolled, on the five-rung ladder",
  );
});

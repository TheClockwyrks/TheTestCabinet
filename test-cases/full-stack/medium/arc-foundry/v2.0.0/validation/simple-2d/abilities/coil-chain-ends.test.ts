// abilities/coil-chain-ends — a chain with nowhere to go simply ends.
//
// specs/components.md fixes the edge case the chain rule implies: "A leap that
// finds no unit in range it has not already struck ends the chain." It is its own
// point because it is the case a build reaches on almost every early wave — one
// unit walking alone past a Coil — and the case a chain written as a loop over
// neighbours most easily throws on.
//
// The yard holds one Coil and one held unit and nothing else, so the first leap
// has nothing to find. Two things are read: the lone unit lost exactly the primary
// hit and not a leap's worth more, and the simulation carried on afterwards. A
// build that throws while resolving the chain fails here even if the health
// happens to come out right, because a thrown update is a game that has stopped.
//
// UNDER THIS ENGINE A THROW IS THE CHECK'S OWN FAILURE. The game runs in this
// process, so an exception out of `update` travels straight out of the
// `engine.advance` that ran the frame and fails this check where it happened,
// naming the build's own stack. What is left to read is the OTHER way a game
// stops: a build that catches its own fault and freezes. So the drive continues
// past the impact for a further span, and the simulation clock and the frame
// counter are read to say the game is still running the update that resolved
// the chain.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan, assertLength } from "../assert";
import {
  captureReplay,
  componentDamage,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  unitById,
  type Harness,
} from "../harness";
import { awaitImpact } from "./impact";

const ANCHOR = { col: 10, row: 10 };

/** Inside the Scrap Coil's `110`. */
const TARGET_RANGE = 60;

/** The tier the lone hit is read at. */
const TIER = 1;

/** How long the game is driven on for after the chain resolved, in seconds. */
const AFTERMATH = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes the primary hit off a lone unit and throws nothing", async () => {
  openYard(h, { wave: 5 });
  const id = standComponent(h, "coil", TIER, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  const lone = parkUnit(h, "dynamo", {
    x: structure.cx + TARGET_RANGE,
    y: structure.cy,
  });

  const before = h.snapshot();
  assertLength(
    before.units,
    1,
    "units on the yard: the chain has nowhere to go",
  );

  const after = await captureReplay(h, "lone", () => awaitImpact(h, lone));

  assertCloseTo(
    unitById(before, lone).hp - unitById(after, lone).hp,
    componentDamage("coil", TIER),
    6,
    "the health the lone unit lost: the primary hit, with no leap to add to it",
  );
  // The game is still running the update that resolved the chain with nowhere
  // to leap to: a further span of frames advanced the simulation clock.
  const settled = h.snapshot().simTime;
  const frames = h.frame();
  await h.advanceSeconds(AFTERMATH);
  assertGreaterThan(
    h.frame(),
    frames,
    "frames the engine ran after the chain resolved with nothing to leap to",
  );
  assertGreaterThan(
    h.snapshot().simTime,
    settled,
    `the game's own simulation clock ${AFTERMATH}s after the chain resolved ` +
      `with nothing to leap to: a build that caught its own fault and stopped ` +
      `updating reports the clock it stopped at`,
  );
});

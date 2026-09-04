// runs/bank-seeds-gripper-hexes — the area bank opens holding every gripper hex,
// at the length the arm rests at.
//
// THE RULE. "At the start of the run it takes every hex of every placed part,
// every fixture hex, and every gripper hex at rest" (`specs/simulation.md`,
// Completion and metrics). Where a gripper is, is `specs/parts.md`: "a base fixed
// on the anchor hex, a length, and one gripper per spoke at
// `base + length * DIRS[d]`", at the pose the run opens on — "An arm's placed
// rotation and length are its rest pose. Each run starts every arm at its rest
// pose." `sim.area` is what the bank reads as: "distinct hexes banked so far"
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION PINS THE HEX, NOT JUST THE COUNT. One `arm` at the origin,
// rotation `0`, at `ARM_MAX_LEN` (`3`), whose one gripper therefore rests three
// hexes along spoke `0`. Beside it, a two-cell track laid on the two hexes
// BETWEEN the anchor and that gripper. Those two are part hexes, so they are in
// the bank whatever happens; a build that banked its gripper at the wrong
// distance would land on one of them and add nothing, and a build that banked no
// gripper at all would add nothing either. Both report three. Only a bank that
// took the hex three along the spoke reports four.
//
// The arm's tape is empty and the field is cleared, so nothing moves and no mote
// exists: the phrase the point turns on is "at rest", and this arm never moves at
// all.
//
// THE EXPECTED FIGURE IS COMPUTED, NOT COUNTED, from `parts.ts`'s `partHexes` —
// placement rule 1 — and `gripperHexes`, which is `base + length * DIRS[d]` over
// the spokes `specs/parts.md` gives the kind.
//
// THE VERDICT. `sim.area` is that count before a single cycle has run, with no
// mote on the field and the arm still on its placed pose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { ARM_MAX_LEN } from "../constants";
import { at, type Hex } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";
import { gripperHexes, partHexes, type Patterns } from "../parts";

/** The two hexes between the arm's anchor and its resting gripper. */
const BETWEEN = [at(1, 0), at(2, 0)];

/** A track over those two hexes, and one arm at the origin at its longest. */
const MACHINE = solution([
  trackPart(BETWEEN),
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, ARM_MAX_LEN, []),
]);

/** Where the arm sits in the machine's placement order. */
const ARM_INDEX = 1;

/** The molecules a rise's and a set's footprints would be drawn from. */
const PATTERNS: Patterns = { reagents: BARE.reagents, products: BARE.products };

/** Placement rule 1's hexes: the arm's anchor and the track's two cells. */
const PART_HEXES = MACHINE.parts.flatMap((part) => partHexes(part, PATTERNS));

/** The arm's one resting gripper hex, three along spoke `0`. */
const GRIPPER_HEXES = gripperHexes("arm", ORIGIN, 0, ARM_MAX_LEN);

/** Everything the bank opens holding, as distinct `"q,r"` keys. */
const SEEDED = new Set(
  [...PART_HEXES, ...GRIPPER_HEXES].map((hex: Hex) => `${hex.q},${hex.r}`),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the bank holding the hex three along the spoke of a length-3 arm", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });
  const arm = (await partIds(h))[ARM_INDEX] ?? -1;

  const opened = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "seeded");

  assertNotNull(opened.sim, "the run is live once it has been started");
  assertLength(
    opened.sim?.motes ?? [],
    0,
    "no mote is on the field, so nothing but parts and grippers can be in this bank",
  );
  assertNotNull(poseOf(opened, arm), "the run reports a live pose for the arm");
  assertEqual(
    poseOf(opened, arm)?.length,
    ARM_MAX_LEN,
    "the arm rests at ARM_MAX_LEN, which is where its gripper's hex is measured from",
  );

  assertEqual(
    opened.sim?.area,
    SEEDED.size,
    "at the start of the run the bank takes every gripper hex at rest, so an arm at length 3 banks the hex three hexes along its spoke without ever moving",
  );
});

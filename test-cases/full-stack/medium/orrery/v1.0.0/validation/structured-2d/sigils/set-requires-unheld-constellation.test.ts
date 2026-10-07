// sigils/set-requires-unheld-constellation — a set leaves a HELD constellation
// resting on the field, however exactly it matches the pattern.
//
// THE RULE. "For a plain product, a constellation is accepted when it is UNHELD
// and is exactly the placed pattern: one mote of the pattern's type on each
// pattern hex, one filament of the pattern's weight for each pattern filament,
// and no further mote or filament in the constellation" (`specs/sigils.md`,
// Rises and sets). The same file fixes the term it leans on, for a mote at rest
// on a sigil hex: "unheld: no gripper holds any mote of the mote's
// constellation." A hold on ANY ONE mote of a constellation therefore holds the
// whole of it, and a held constellation is not accepted.
//
// THE CONFIGURATION. A product of two motes — a `luna` on `(0, 0)` and a `nova`
// on `(1, 0)`, joined by one filament of weight `1` — and its set placed at the
// middle of the field at rotation `0`, so its pattern hexes are exactly those
// two. The constellation posed on them is the pattern exactly: the right type on
// each pattern hex, one filament of the pattern's weight, and nothing further.
//
// Two arms stand beside it with BLANK TAPES, "which every part rests on"
// (`specs/simulation.md`), one reaching each pattern hex: an arm anchored on
// `(-1, 0)` at rotation `0` and length `1` has its gripper on `(0, 0)`, and an
// arm anchored on `(2, 0)` at rotation `3` has its gripper on `(1, 0)`
// (`specs/parts.md`: "one gripper per spoke at `base + length * DIRS[d]`").
// Neither ever moves; each is only somewhere for a hold to come from, and the
// hold itself is given with `setGrip`, "which takes hold with no `grab` ever
// running" (`specs/instrumentation.md`).
//
// THE VERDICT, in three phases over the one posed world, each differing from the
// last by the hold alone:
//
//   1. The gripper on `(0, 0)` holds the `luna`. At the boundary the set accepts
//      nothing: the tally stands at `0` and both motes are still on their hexes,
//      still joined.
//   2. That gripper opens and the gripper on `(1, 0)` holds the `nova` instead —
//      the mote that is NOT on the set's anchor hex. The constellation is held
//      through one of its motes, so it is held, and the set again accepts
//      nothing.
//   3. THE SET IS LIVE. That gripper opens too and nothing else changes. At the
//      next boundary the same constellation, on the same hexes, is consumed and
//      the tally rises by one — so the two refusals were about the hold rather
//      than about a set that accepts nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import {
  armPart,
  challenge,
  link,
  loneMote,
  molecule,
  mote,
  setPart,
  solution,
} from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  constellationOf,
  createHarness,
  filamentBetween,
  holdGrip,
  moteAt,
  openBareRun,
  partIds,
  spawnConstellation,
  takeGrip,
  tallyOf,
  type Harness,
} from "../harness";

/** A `luna` on `(0, 0)` and a `nova` on `(1, 0)`, joined by one weight `1` filament. */
const PRODUCT = molecule(
  [mote(0, 0, "luna"), mote(1, 0, "nova")],
  [link(at(0, 0), at(1, 0), 1)],
);

const HELD = challenge({
  name: "Held Product",
  reagents: [loneMote("luna")],
  products: [PRODUCT],
  permitted: ["arm"],
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a held constellation resting, and consumes it once every hold opens", async () => {
  await openBareRun(h, {
    challenge: HELD,
    machine: solution([
      setPart(0, ORIGIN.q, ORIGIN.r, 0),
      armPart("arm", ORIGIN.q - 1, ORIGIN.r, 0, 1, []),
      armPart("arm", ORIGIN.q + 2, ORIGIN.r, 3, 1, []),
    ]),
  });
  const placed = await partIds(h);
  const west = placed[1] ?? -1;
  const east = placed[2] ?? -1;

  const anchorHex = at(ORIGIN.q, ORIGIN.r);
  const secondHex = at(ORIGIN.q + 1, ORIGIN.r);
  const [luna, nova] = await spawnConstellation(
    h,
    [
      { hex: anchorHex, type: "luna" },
      { hex: secondHex, type: "nova" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );

  // 1. The gripper on the anchor hex holds the `luna`.
  await takeGrip(h, west, 0, luna ?? -1);
  await advanceCycles(h, 1);
  await captureStill(h, "held");

  const heldAtAnchor = await h.snapshot();
  assertNotNull(
    heldAtAnchor.sim,
    "the run is still live at the first boundary",
  );
  assertEqual(
    tallyOf(heldAtAnchor, 0),
    0,
    "a constellation a gripper holds is not accepted, so the tally stands at 0",
  );
  assertEqual(
    moteAt(heldAtAnchor, anchorHex)?.id,
    luna,
    "the refused constellation is left resting on the pattern's first hex",
  );
  assertEqual(
    moteAt(heldAtAnchor, secondHex)?.id,
    nova,
    "the refused constellation is left resting on the pattern's second hex",
  );
  assertNotNull(
    filamentBetween(heldAtAnchor, luna ?? -1, nova ?? -1),
    "the refused constellation keeps the filament joining its two motes",
  );

  // 2. The hold moves to the mote that is NOT on the set's anchor hex.
  await holdGrip(h, west, 0);
  await takeGrip(h, east, 3, nova ?? -1);
  await advanceCycles(h, 1);

  const heldAtSecond = await h.snapshot();
  assertEqual(
    tallyOf(heldAtSecond, 0),
    0,
    "a gripper holding any one mote holds the whole constellation, so it is still not accepted",
  );
  assertDeepEqual(
    constellationOf(heldAtSecond, luna ?? -1),
    [luna, nova].sort((a, b) => (a ?? 0) - (b ?? 0)),
    "the refused constellation is still the two joined motes it was posed as",
  );

  // 3. Every hold opens, and nothing else changes.
  await holdGrip(h, east, 3);
  await advanceCycles(h, 1);

  const released = await h.snapshot();
  assertEqual(
    tallyOf(released, 0),
    1,
    "the same constellation, now unheld, is exactly the placed pattern and is accepted",
  );
  assertNull(
    moteAt(released, anchorHex),
    "an accepted constellation is consumed whole, so the pattern's first hex is bare",
  );
  assertNull(
    moteAt(released, secondHex),
    "an accepted constellation is consumed whole, so the pattern's second hex is bare",
  );
});

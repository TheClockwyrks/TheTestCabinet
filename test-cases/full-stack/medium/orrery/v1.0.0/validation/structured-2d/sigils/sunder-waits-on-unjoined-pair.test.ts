// sigils/sunder-waits-on-unjoined-pair — a `sunder` whose two motes are not
// joined removes nothing, there or anywhere else.
//
// THE RULE. `sunder`'s footprint is `(0, 0)` first and `(1, 0)` second, and
// "when a filament joins the motes on its two hexes, that filament is removed,
// whatever its weight" (`specs/sigils.md`, Sundering). The condition is a
// filament joining THAT pair, and "a sigil whose condition does not hold at a
// boundary waits" (`specs/sigils.md`) — so an unjoined pair is left as it is, and
// what a waiting sigil removes is nothing at all.
//
// THE CONFIGURATION. Three pairs of `dust`, on a field holding nothing else:
//
//   - THE UNJOINED PAIR, on the two hexes of a `sunder` anchored at `(-4, 0)`,
//     with NO filament between them. This is the pair the item is about.
//   - A JOINED PAIR far from every sigil, on `(-4, 3)` and `(-3, 3)`. Its
//     filament is the "anywhere else" of the item: a build that answers an
//     unsatisfied `sunder` by removing some other filament fails here.
//   - THE CONTROL, on the two hexes of a second `sunder` anchored at `(2, 0)`,
//     JOINED. Its filament is the one filament this boundary is entitled to
//     remove.
//
// WHY THE CONTROL IS THERE. Without it a build that engraves no `sunder` at all
// passes: every filament survives a boundary that never ran a sigil. The control
// is read back for exactly that reason — it says the boundary ran and `sunder`
// acted at it — and it is a second sigil on its own hexes, so it decides nothing
// about the pair under test.
//
// THE VERDICT. After the cycle: the unjoined pair's two motes are still resting
// on the `sunder`'s two hexes, still joined by nothing; the far pair's filament
// is still there; and the field carries exactly one filament, so the only one
// removed was the control's.
//
// THE WORLD IS POSED, NOT SEARCHED. The bare opener empties the field, and
// nothing on it moves: every part is a sigil, and a sigil carries no tape.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
  moteById,
  openBareRun,
  spawnConstellation,
  type Harness,
} from "../harness";

let h: Harness;

/** The `sunder` the item is about: its first and second hexes. */
const WAITING = at(-4, 0);
const WAITING_SECOND = at(-3, 0);

/** A pair joined well clear of every footprint, which nothing may touch. */
const FAR = at(-4, 3);
const FAR_SECOND = at(-3, 3);

/** The control `sunder`, whose pair IS joined, and its two hexes. */
const CUTTING = at(2, 0);
const CUTTING_SECOND = at(3, 0);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves an unjoined pair, and every other filament, exactly as they were", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      sigilPart("sunder", WAITING.q, WAITING.r, 0),
      sigilPart("sunder", CUTTING.q, CUTTING.r, 0),
    ]),
  });

  const unjoined = await spawnConstellation(h, [
    { hex: WAITING, type: "dust" },
    { hex: WAITING_SECOND, type: "dust" },
  ]);
  const first = unjoined[0] as number;
  const second = unjoined[1] as number;

  const far = await spawnConstellation(
    h,
    [
      { hex: FAR, type: "dust" },
      { hex: FAR_SECOND, type: "dust" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );

  const cut = await spawnConstellation(
    h,
    [
      { hex: CUTTING, type: "dust" },
      { hex: CUTTING_SECOND, type: "dust" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );

  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await captureStill(h, "unjoined");

  assertNull(
    filamentBetween(before, first, second),
    "the pair under test starts unjoined, which is the condition sunder waits on",
  );
  assertLength(
    before.sim?.filaments ?? [],
    2,
    "and the field starts with two filaments: the far pair's and the control's",
  );

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "the cycle reaches its boundary: nothing on the field moves and nothing faults",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "and the boundary really ran, so the sigil phase ran with it",
  );

  assertNull(
    filamentBetween(after, cut[0] as number, cut[1] as number),
    "the control sunder removed the filament joining the motes on ITS two hexes",
  );

  assertNull(
    filamentBetween(after, first, second),
    "the pair under test is still joined by nothing: a sunder with no filament to remove removes none",
  );
  const restingFirst = moteById(after, first);
  assertNotNull(restingFirst, "the first mote is still on the field");
  assertEqual(
    `${restingFirst?.q},${restingFirst?.r}`,
    `${WAITING.q},${WAITING.r}`,
    "and still resting on the sunder's first hex",
  );
  const restingSecond = moteById(after, second);
  assertNotNull(restingSecond, "the second mote is still on the field");
  assertEqual(
    `${restingSecond?.q},${restingSecond?.r}`,
    `${WAITING_SECOND.q},${WAITING_SECOND.r}`,
    "and still resting on the sunder's second hex",
  );

  assertNotNull(
    filamentBetween(after, far[0] as number, far[1] as number),
    "the filament joining the far pair, which no sunder covers, survives the boundary",
  );
  assertLength(
    after.sim?.filaments ?? [],
    1,
    "and it is the only filament left: exactly one was removed, the control's",
  );
});

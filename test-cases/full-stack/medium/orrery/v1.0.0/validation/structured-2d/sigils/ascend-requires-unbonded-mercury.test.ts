// sigils/ascend-requires-unbonded-mercury — a `mercury` on the prime that carries
// a filament is not spent, and the crown's planet does not rise.
//
// THE RULE. "When the prime holds an unbonded, unheld `mercury` and the crown
// holds a planet below `sol`, the `mercury` is consumed and the planet rises one
// rung of `PLANETS`" (`specs/sigils.md`, Transmuting sigils). "Unbonded" is
// defined in the same file, for a mote at rest on a sigil hex: "the mote carries
// no filament". A `mercury` carrying one therefore fails the prime condition, and
// "a sigil whose condition does not hold at a boundary waits" — with no partial
// effect, so neither half of "consumed and rises" happens.
//
// THE CONFIGURATION. An `ascend` anchored at `(0, 0)` at rotation `0`, so its
// prime is `(0, 0)` and its crown is `(1, 0)`. A `mercury` on the prime and a
// `saturn` — the first rung, well below `sol` — on the crown, so every other part
// of the condition holds. The `mercury` is then bonded to a `dust` on `(0, -1)`,
// which is `DIRS[4]` from the prime and so adjacent to it, and is a hex no sigil
// footprint covers: the filament is the ONE thing separating this world from one
// that would raise the planet.
//
// AND ONE CONTROL, so a build whose sigil phase does nothing cannot pass. A
// second `ascend`, well clear of the first, with an UNBONDED `mercury` on its
// prime and a `saturn` on its crown, which the same boundary must raise. It
// decides nothing about the bonded case; it is read back only to say that
// `ascend` acted at this boundary at all.
//
// THE VERDICT. After one cycle the bonded `mercury` is still there, still resting
// on the prime, still joined to its `dust`; the crown is still `saturn`; and the
// control's crown is `jupiter` with its `mercury` spent.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, neighbor } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  filamentBetween,
  moteAt,
  moteById,
  openBareRun,
  spawnConstellation,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

/** The ascend under test: its prime, its crown, and the hex the bond runs to. */
const PRIME = ORIGIN;
const CROWN = neighbor(ORIGIN, 0);
const BONDED_TO = neighbor(ORIGIN, 4);

/** The control ascend, clear of the first footprint and of the bond. */
const CONTROL_PRIME = at(-4, 2);
const CONTROL_CROWN = neighbor(CONTROL_PRIME, 0);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a bonded mercury standing and its crown's planet unrisen", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      sigilPart("ascend", PRIME.q, PRIME.r, 0),
      sigilPart("ascend", CONTROL_PRIME.q, CONTROL_PRIME.r, 0),
    ]),
  });

  const bonded = await spawnConstellation(
    h,
    [
      { hex: PRIME, type: "mercury" },
      { hex: BONDED_TO, type: "dust" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );
  const mercury = bonded[0] as number;
  const anchorMote = bonded[1] as number;
  const crown = await spawnMote(h, CROWN, "saturn");

  const controlMercury = await spawnMote(h, CONTROL_PRIME, "mercury");
  await spawnMote(h, CONTROL_CROWN, "saturn");

  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await captureStill(h, "bonded-mercury");

  assertNotNull(
    filamentBetween(before, mercury, anchorMote),
    "the mercury on the prime starts carrying a filament, so it is not unbonded",
  );

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  assertEqual(
    moteAt(after, CONTROL_CROWN)?.type,
    "jupiter",
    "the control's saturn rose over an unbonded mercury, so ascend really did act at this boundary",
  );
  assertNull(
    moteById(after, controlMercury),
    "and the control's mercury was spent doing it",
  );

  const stayed = moteById(after, mercury);
  assertNotNull(stayed, "the bonded mercury is not consumed");
  assertEqual(stayed?.type, "mercury", "and it is still mercury");
  assertEqual(
    `${stayed?.q},${stayed?.r}`,
    `${PRIME.q},${PRIME.r}`,
    "still resting on the prime hex",
  );
  assertNotNull(
    filamentBetween(after, mercury, anchorMote),
    "still carrying the filament that made it bonded",
  );
  assertEqual(
    moteById(after, crown)?.type,
    "saturn",
    "and the crown's planet did not rise, because a bonded mercury fails the prime condition",
  );
});

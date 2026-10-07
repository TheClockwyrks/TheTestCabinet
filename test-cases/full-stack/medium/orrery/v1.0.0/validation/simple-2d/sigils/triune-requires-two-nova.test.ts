// sigils/triune-requires-two-nova — `nova` on both hexes, or nothing happens.
//
// THE RULE. `triune` acts "When BOTH HEXES HOLD `nova` MOTES and no filament joins
// that pair" (`specs/sigils.md`), and "A sigil whose condition does not hold at a
// boundary waits". The condition names one type, and `specs/field.md`'s roster is
// what makes the other fourteen not it: `nova` is "The essence of fire", and
// `comet`, `meteor` and `dust` are each their own entry of `MOTES`.
//
// THE CASES. Every arrangement below holds a pair of types other than two `nova`,
// and each is posed on its own bare run so none can leave anything behind for the
// next:
//
//   * `nova` then `comet` — "a nova beside a comet included", the review item's own
//     example, and the case that separates a build reading only its first hex;
//   * `comet` then `nova` — the same pair the other way round, which separates a
//     build reading only its second;
//   * `nova` then `dust`, a pair with one essence and one base type;
//   * `dust` then `dust`, a pair with no `nova` at all.
//
// THE CONFIGURATION, in each case. One `triune` anchored on `(0, 0)` at rotation
// `0`, so its hexes are `(0, 0)` and `(1, 0)`, with the case's two motes resting
// on them. Nothing else is placed and nothing else is on the field — in particular
// no `bind`, so a filament reported afterwards could only be this triune's.
//
// NOTHING MOVES AND NOTHING COLLIDES: a sigil carries no tape, and the two motes
// rest `HEX_PITCH` (`48`) apart, above `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. In every case no filament at all, both motes still resting on their
// own hexes and still their own types, and the run still running on the cycle it
// completed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import type { MoteName } from "../constants";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteById,
  openBareRun,
  solePartOfKind,
  spawnMote,
  type Harness,
} from "../harness";

/** Where the triune is engraved. */
const ANCHOR = at(0, 0);

/** The `first` hex of `triune`'s footprint, placed. */
const FIRST = place(at(0, 0), ANCHOR, 0);

/** The `second` hex of `triune`'s footprint, placed. */
const SECOND = place(at(1, 0), ANCHOR, 0);

/** The pairs of types the check poses, none of them two `nova`. */
const CASES: readonly (readonly [MoteName, MoteName])[] = [
  ["nova", "comet"],
  ["comet", "nova"],
  ["nova", "dust"],
  ["dust", "dust"],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates nothing for any pair of types but two nova", async () => {
  for (const [firstType, secondType] of CASES) {
    const label = `${firstType} and ${secondType}`;
    await openBareRun(h, {
      challenge: BARE,
      machine: solution([sigilPart("triune", ANCHOR.q, ANCHOR.r, 0)]),
    });
    const first = await spawnMote(h, FIRST, firstType);
    const second = await spawnMote(h, SECOND, secondType);

    const before = await h.snapshot();
    assertNotNull(
      solePartOfKind(before, "triune"),
      `${label}: the machine carries the one triune the check placed`,
    );
    assertLength(
      before.sim?.filaments ?? [],
      0,
      `${label}: no filament joins the pair when the boundary runs`,
    );

    await advanceCycles(h, 1);
    // The verdict is the state the BOUNDARY left. The frame after it is only
    // what puts the picture on the canvas for the evidence below.
    const snapshot = await h.snapshot();
    await h.advance(1);
    await captureStill(h, "wrong-types");
    const sim = snapshot.sim;
    assertNotNull(sim, `${label}: the run is live through the cycle`);
    assertEqual(
      sim?.status,
      "running",
      `${label}: an unsatisfied triune waits, and waiting halts nothing`,
    );
    assertNull(
      sim?.fault ?? null,
      `${label}: no fault is raised: nothing moves`,
    );
    assertEqual(sim?.cycle, 1, `${label}: the cycle reached its boundary`);

    assertLength(
      sim?.filaments ?? [],
      0,
      `${label}: triune requires nova on both hexes, so this boundary created nothing`,
    );
    for (const [mote, hex, type] of [
      [first, FIRST, firstType],
      [second, SECOND, secondType],
    ] as const) {
      const found = moteById(snapshot, mote);
      assertEqual(
        `${found?.q},${found?.r}`,
        `${hex.q},${hex.r}`,
        `${label}: the mote on (${hex.q}, ${hex.r}) is still resting on its own hex`,
      );
      assertEqual(
        found?.type,
        type,
        `${label}: the mote on (${hex.q}, ${hex.r}) is still ${type}`,
      );
    }
  }
});

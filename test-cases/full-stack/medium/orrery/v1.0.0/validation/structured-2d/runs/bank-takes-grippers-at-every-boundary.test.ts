// runs/bank-takes-grippers-at-every-boundary — every boundary banks the hex of
// every gripper, whether or not it is carrying anything.
//
// THE RULE. "After every boundary, the settle included, it takes the hex of every
// mote and of every gripper" (`specs/simulation.md`, Completion and metrics). The
// clause is unconditional: a gripper's hex is banked because it is a gripper's
// hex, not because a mote is on it. Where a gripper is, is `specs/parts.md`:
// "one gripper per spoke at `base + length * DIRS[d]`", turning with the part —
// "The part's direction turns 60 degrees about its base ... sweeping `60 * t`
// degrees" (`specs/simulation.md`, Motion and carrying).
//
// THE CONFIGURATION IS AN EMPTY FIELD. One `arm` at the origin, rotation `0`, at
// `ARM_MAX_LEN` (`3`), whose tape is a single `rotate-cw`, and NOTHING ELSE:
// there is no rise, no wheel, and the field is cleared, so `sim.motes` is empty
// at every reading. Nothing but a gripper can put a hex into this bank, so
// whatever `area` grows by is what the gripper contributed. Every hex the sweep
// visits is a fresh one, because a length-`3` arm at rotation `0` turns onto a
// different hex of the radius-three ring each cycle.
//
// THE EXPECTED HEXES ARE COMPUTED FROM `specs/field.md`'s own rotation, through
// `field.ts`'s `rotateAbout`, and the arm's live rotation is read back at every
// boundary, so the figures belong to a sweep that really happened.
//
// THE VERDICT. The bank opens at two — the anchor and the resting gripper hex —
// and rises by exactly one at each of the three boundaries, reaching five, with
// no mote on the field at any point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { ARM_MAX_LEN } from "../constants";
import { rotateAbout, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
  type OrrerySnapshot,
} from "../harness";
import { gripperHexes } from "../parts";

/** One arm at its longest, turning one step clockwise about its base each cycle. */
const MACHINE = solution([
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, ARM_MAX_LEN, ["rotate-cw"]),
]);

/** How many cycles the empty arm sweeps through. */
const CYCLES = 3;

const key = (hex: Hex): string => `${hex.q},${hex.r}`;

/** The arm's resting gripper hex: `base + ARM_MAX_LEN * DIRS[0]`. */
const RESTING_HEX = gripperHexes("arm", ORIGIN, 0, ARM_MAX_LEN)[0] as Hex;

/** Where the gripper rests after `n` clockwise steps. */
const gripperAt = (n: number): Hex => rotateAbout(RESTING_HEX, ORIGIN, n);

/** What the bank holds after `n` boundaries: the anchor and every hex swept so far. */
const banked = (n: number): Set<string> =>
  new Set([
    key(ORIGIN),
    ...Array.from({ length: n + 1 }, (_, i) => key(gripperAt(i))),
  ]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("grows the bank as an empty arm sweeps, carrying nothing at all", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });
  const arm = (await partIds(h))[0] ?? -1;

  const opened = await h.snapshot();

  const seen = await captureReplay(h, "sweep", async () => {
    const boundaries: OrrerySnapshot[] = [];
    for (let n = 0; n < CYCLES; n += 1) {
      await advanceCycles(h, 1);
      boundaries.push(await h.snapshot());
    }
    return boundaries;
  });

  assertNotNull(opened.sim, "the run is live once it has been started");
  assertLength(
    opened.sim?.motes ?? [],
    0,
    "the field is empty, so nothing but a gripper can put a hex into this bank",
  );
  assertEqual(
    opened.sim?.area,
    banked(0).size,
    "the bank opens holding the arm's anchor and its one resting gripper hex",
  );

  for (const [n, snapshot] of seen.entries()) {
    assertNotNull(snapshot.sim, `the run is still live at boundary ${n + 1}`);
    assertLength(
      snapshot.sim?.motes ?? [],
      0,
      `the arm carries nothing at all at boundary ${n + 1}: the field is still empty`,
    );
    assertNotNull(
      poseOf(snapshot, arm),
      `the run reports a live pose for the arm at boundary ${n + 1}`,
    );
    assertEqual(
      poseOf(snapshot, arm)?.rotation,
      (n + 1) % 6,
      `rotate-cw really turned the arm one step at boundary ${n + 1}, so its gripper is on a new hex`,
    );
    assertEqual(
      snapshot.sim?.area,
      banked(n + 1).size,
      `after every boundary the bank takes the hex of every gripper, so area grows by the hex the sweep reached at boundary ${n + 1}`,
    );
  }
});

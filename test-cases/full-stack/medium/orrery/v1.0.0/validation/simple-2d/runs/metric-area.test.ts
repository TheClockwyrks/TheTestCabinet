// runs/metric-area — the recorded `area` counts hexes, and counts each of them
// once.
//
// THE RULE. The metric table of `specs/simulation.md` (Completion and metrics)
// gives `area` as "The size of the area bank", and the paragraph under it says
// what the bank holds: "At the start of the run it takes every hex of every
// placed part, every fixture hex, and every gripper hex at rest. A placed part's
// hexes are an arm or wheel's anchor, every cell of a track, and every footprint
// hex of a sigil, rise, or set. After every boundary, the settle included, it
// takes the hex of every mote and of every gripper ... `area` is how many
// DISTINCT hexes the bank holds when the run completes."
//
// THE CONFIGURATION is a machine that never moves, so the bank is exactly the
// list above and a reader can lay it out on the field: an `arm` at `(-3, 0)` on a
// blank tape, whose one gripper rests on `(-2, 0)`; a `wheel` at `(3, 0)` on a
// blank tape, whose six fixtures take its six neighbours; and the `set` at
// `(0, 3)` that lets the run finish. A loose `sol` rests on the bare hex
// `(0, -3)`, which belongs to no part, so the "hex of every mote" clause has
// something of its own to add. Nothing has an instruction, so no pose, no
// gripper and no mote ever leaves the hex it started on.
//
// THE VERDICT. The expected bank is built here from the specification's own
// clauses, over the machine the check placed — part hexes, resting gripper hexes,
// fixture hexes, and the hexes the motes rest on — as a SET, so the counting-once
// rule is in the expectation rather than assumed. The completed run's recorded
// `area` and its live `sim.area` are both that set's size, which for this machine
// is eleven.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at, type Hex } from "../field";
import { armPart, setPart, solution } from "../formats";
import { ONE_DELIVERY, ONE_SOL } from "../fixtures";
import { gripperHexes, setFootprint, wheelFixtureHexes } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  fixturesOf,
  openRun,
  partIds,
  spawnMote,
  type Harness,
} from "../harness";

/** The arm's anchor; its one gripper rests one hex east, on `(-2, 0)`. */
const ARM = at(-3, 0);

/** The wheel's anchor; its six fixtures take the six hexes around it. */
const WHEEL = at(3, 0);

/** The set's anchor, and so its one footprint hex. */
const SET_AT = at(0, 3);

/** A bare hex, on no part, where the loose mote rests for the whole run. */
const BARE_HEX = at(0, -3);

/** An arm, a wheel and a set, none of them carrying an instruction. */
const MACHINE = solution([
  armPart("arm", ARM.q, ARM.r, 0, 1, []),
  armPart("wheel", WHEEL.q, WHEEL.r, 0, 1, []),
  setPart(0, SET_AT.q, SET_AT.r),
]);

/** One hex, as the key a set of hexes is kept under. */
function key(hex: Hex): string {
  return `${hex.q},${hex.r}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("records how many distinct hexes the machine, its fixtures, its grippers and its motes occupied", async () => {
  await openRun(h, { challenge: ONE_DELIVERY, machine: MACHINE });
  const ids = await partIds(h);
  const wheel = ids[1] as number;

  await spawnMote(h, BARE_HEX, "sol");
  await spawnMote(h, SET_AT, "sol");

  const before = await h.snapshot();
  assertLength(
    fixturesOf(before, wheel),
    6,
    "the wheel's six fixtures are on the field, so their hexes are in the bank",
  );

  // The bank the specification describes, over the machine this check placed.
  const banked = new Set<string>();
  for (const hex of [ARM, WHEEL]) banked.add(key(hex)); // an arm or wheel's anchor
  for (const hex of setFootprint(ONE_SOL, SET_AT, 0)) banked.add(key(hex)); // a set's footprint
  for (const hex of gripperHexes("arm", ARM, 0, 1)) banked.add(key(hex)); // a gripper hex at rest
  for (const hex of wheelFixtureHexes(WHEEL)) banked.add(key(hex)); // every fixture hex
  banked.add(key(BARE_HEX)); // the hex of every mote, at every boundary

  await advanceCycles(h, 1);
  await captureStill(h, "area");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "complete",
    "the delivery reached the target of 1, so the metrics were recorded",
  );
  assertNotNull(
    after.sim?.metrics ?? null,
    "a completed run records its metrics",
  );
  assertEqual(
    after.sim?.area,
    banked.size,
    "the bank holds exactly the distinct hexes the parts, fixtures, grippers and motes occupied",
  );
  assertEqual(
    after.sim?.metrics?.area,
    banked.size,
    "the recorded area is the size of the area bank when the run completed",
  );
});

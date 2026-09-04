// instructions/blank-keeps-the-grip — a blank cell leaves a gripper holding what
// it held.
//
// THE RULE. "A blank cell is a rest: the part holds its pose for the cycle,
// keeping whatever grip it has" (`specs/instructions.md`, The instruction set).
// Nothing about a blank opens a gripper: "`drop` — Every gripper opens, releasing
// whatever it held" is an instruction of its own, and "Grips persist across
// cycles until dropped" (`specs/simulation.md`, Motion and carrying). `sim.grips`
// is where a hold is read: "one entry per holding gripper: the part, the spoke
// direction the gripper currently sits on, and the mote at the gripper"
// (`specs/state.md`).
//
// THE CONFIGURATION. One arm at the origin, rest rotation `0`, rest length `1`,
// whose tape holds a blank at column `0` and `rotate-cw` at column `1` — so the
// tape's length is `2`, the machine's period is `2`, and cycle `0` fetches a
// WRITTEN blank rather than a cell past the tape's end. The arm's one gripper
// sits at `base + length * DIRS[0]`, which is `(1, 0)` (`specs/parts.md`).
//
// What it holds is a CONSTELLATION of two, not a lone mote: two `dust` on
// `(1, 0)` and `(2, 0)` joined by one filament, which is "the maximal group
// joined by filaments" (`specs/field.md`). The hold is given with `setGrip`,
// "which takes hold with no `grab` ever running" (`specs/instrumentation.md`), so
// no earlier cycle could have taken or dropped it, and a gripper "takes hold of
// that mote's constellation" (`specs/simulation.md`) — so the reading is that the
// same constellation is still held.
//
// THE VERDICT. At the boundary `sim.grips` carries one entry for the arm, and its
// part, spoke and mote are the ones it carried before the cycle; the two motes
// are still joined into one constellation, and both are still on their hexes.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  constellationOf,
  createHarness,
  gripsOf,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The gripper hex of an arm at rotation 0, length 1, anchored on the origin. */
const HELD_HEX = at(1, 0);

/** The other mote of the held constellation, joined to the first by a filament. */
const FAR_HEX = at(2, 0);

it("still holds the same constellation, on the same spoke, at the boundary", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [null, "rotate-cw"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const [near, far] = await spawnConstellation(
    h,
    [
      { hex: HELD_HEX, type: "dust" },
      { hex: FAR_HEX, type: "dust" },
    ],
    [{ a: 0, b: 1 }],
  );
  await takeGrip(h, arm, 0, near as number);

  const before = await h.snapshot();
  const held = gripsOf(before, arm);
  assertLength(
    held,
    1,
    "the arm's one gripper is holding before the cycle runs",
  );
  assertEqual(held[0]?.mote, near, "it is holding the mote it was given");

  await captureReplay(h, "grip-held", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is live through the cycle");
  assertEqual(
    after.sim?.status,
    "running",
    "a blank cell is a rest and never faults, so the cycle runs to its boundary",
  );
  assertNull(after.sim?.fault ?? null, "a rest raises no fault");

  const still = gripsOf(after, arm);
  assertLength(
    still,
    1,
    "a blank cell opens no gripper, so the arm is still holding at the boundary",
  );
  assertEqual(
    still[0]?.part,
    held[0]?.part,
    "sim.grips carries the same part after the cycle as before it",
  );
  assertEqual(
    still[0]?.spoke,
    held[0]?.spoke,
    "sim.grips carries the same spoke after the cycle as before it",
  );
  assertEqual(
    still[0]?.mote,
    held[0]?.mote,
    "sim.grips carries the same mote after the cycle as before it",
  );
  assertDeepEqual(
    constellationOf(after, near as number),
    [near, far].sort((a, b) => (a as number) - (b as number)),
    "the constellation the gripper took hold of is still the same two motes",
  );
  assertEqual(
    `${moteById(after, near as number)?.q},${moteById(after, near as number)?.r}`,
    `${HELD_HEX.q},${HELD_HEX.r}`,
    "a blank imposes no motion on what the part holds, so the held mote is still on its hex",
  );
  assertEqual(
    `${moteById(after, far as number)?.q},${moteById(after, far as number)?.r}`,
    `${FAR_HEX.q},${FAR_HEX.r}`,
    "the rest of the held constellation is still on its hex too",
  );
});

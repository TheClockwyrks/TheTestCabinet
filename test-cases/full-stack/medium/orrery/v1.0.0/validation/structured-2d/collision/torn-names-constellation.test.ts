// collision/torn-names-constellation — a tear names EVERY mote of the
// constellation, the ones no gripper is on included.
//
// THE RULE, from the payload table of `specs/simulation.md` (Faults): "`torn` —
// `parts`: every part holding the constellation; `motes`: every mote of the
// constellation", with "`motes` is in ascending mote id". What a constellation is
// comes from `specs/field.md`: "A constellation is a maximal group of motes
// connected by filaments", and a gripper "takes hold of that mote's
// constellation", so the whole body is torn rather than the two motes under
// grippers.
//
// THE CONFIGURATION. A chain of three motes on `(1, 0)`, `(2, 0)` and `(3, 0)`,
// joined by two plain filaments — "A filament is a rigid link between two motes on
// adjacent hexes" — so all three are one constellation. Two grippers hold it, each
// on one of the first two motes and NEITHER on the third:
//
//   * an arm on `(0, 0)` at rotation `0`, gripper `(1, 0)`, with `rotate-cw`;
//   * an arm on `(1, 0)` at rotation `0`, gripper `(2, 0)`, with a blank tape.
//
// A rotation about `(0, 0)` and no motion do not agree, so the constellation is
// torn. The mote on `(3, 0)` is carried by neither gripper and is what the reading
// is really about.
//
// THE VERDICT. `sim.fault.motes` names all three motes, in ascending id — the
// unheld one included.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
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

it("names the whole chain, including the mote no gripper is on", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, 0, 1, ["rotate-cw"]),
      armPart("arm", 1, 0, 0, 1, []),
    ]),
  });
  const placed = await partIds(h);
  const chain = await spawnConstellation(
    h,
    [
      { hex: at(1, 0), type: "dust" },
      { hex: at(2, 0), type: "dust" },
      { hex: at(3, 0), type: "dust" },
    ],
    [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
    ],
  );
  await takeGrip(h, placed[0] ?? -1, 0, chain[0] ?? -1);
  await takeGrip(h, placed[1] ?? -1, 0, chain[1] ?? -1);

  const posed = await h.snapshot();
  assertEqual(
    posed.sim?.grips.length,
    2,
    "two grippers hold the chain, and the third mote is under neither",
  );

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "named");

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the tear");
  assertEqual(
    sim?.fault?.kind,
    "torn",
    "a rotation and a rest do not agree, so the constellation is torn",
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [...chain].sort((a, b) => a - b),
    "the fault names every mote of the constellation, in ascending mote id",
  );
});

// collision/torn-names-holders — a tear names EVERY part holding the
// constellation.
//
// THE RULE, from the payload table of `specs/simulation.md` (Faults): "`torn` —
// `parts`: every part holding the constellation; `motes`: every mote of the
// constellation", with "Both lists name each part and each mote once, however many
// pairs or grips reached it" and "`parts` is in placement order".
//
// THE CONFIGURATION. One mote on `(1, 0)` held by THREE grippers, so the reading
// covers "all of them when more hold it" rather than only the two a pair would
// give. Each arm is placed so its gripper stands on `(1, 0)` — "one gripper per
// spoke at `base + length * DIRS[d]`" (`specs/parts.md`) with the offsets of
// `specs/field.md`:
//
//   * an arm on `(0, 0)` at rotation `0`  — `DIRS[0]` is `(+1, 0)`;
//   * an arm on `(2, 0)` at rotation `3`  — `DIRS[3]` is `(-1, 0)`;
//   * an arm on `(1, -1)` at rotation `1` — `DIRS[1]` is `(0, +1)`.
//
// The first carries `rotate-cw`; the other two carry blank tapes, and "A blank cell
// is a rest", which imposes no motion. A rotation and no motion do not agree, so
// the constellation is torn. Every hold is given with `setGrip`, "which takes hold
// with no `grab` ever running" (`specs/instrumentation.md`).
//
// THE VERDICT. `sim.fault.parts` names all three arms, once each, in placement
// order — including the two that were resting, because the list is of every part
// HOLDING rather than of the one whose instruction differed.

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
  spawnMote,
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

it("names all three holders of the torn constellation, in placement order", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, 0, 1, ["rotate-cw"]),
      armPart("arm", 2, 0, 3, 1, []),
      armPart("arm", 1, -1, 1, 1, []),
    ]),
  });
  const placed = await partIds(h);
  const mote = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, placed[0] ?? -1, 0, mote);
  await takeGrip(h, placed[1] ?? -1, 3, mote);
  await takeGrip(h, placed[2] ?? -1, 1, mote);

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "named");

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the tear");
  assertEqual(
    sim?.fault?.kind,
    "torn",
    "a rotation and two rests do not agree, so the constellation is torn",
  );
  assertDeepEqual(
    sim?.fault?.parts,
    placed,
    "the fault names every part holding the constellation, once each, in placement order",
  );
});

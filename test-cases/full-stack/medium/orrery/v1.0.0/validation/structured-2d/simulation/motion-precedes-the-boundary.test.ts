// simulation/motion-precedes-the-boundary — the boundary reads the field the
// motion left.
//
// THE RULE, from the cycle order of `specs/simulation.md` (Cycles and the clock):
//
//   4. Motion. "The moving parts sweep across the cycle, as the next section
//      defines."
//   5. Boundary. "Motes are at rest on hex centers again. The boundary sequence
//      runs: the sigil phase, then sets, then rises, then the area bank, then the
//      completion check."
//
// The motion step completes before the boundary, so the field a sigil reads is the
// field the motion left: "at `t = 1` every mote lands exactly on a hex center"
// (Motion and carrying), and it is that landing the sigil phase acts on.
//
// THE SIGIL. `wane`'s footprint is the one hex `(0, 0)` under the role "seat", and
// "An essence mote on the seat becomes `dust`. Its filaments, its constellation,
// and any hold on it are untouched" (`specs/sigils.md`). The hold being untouched
// is what lets a CARRIED essence be the mote under test: a mote still in a
// gripper's hold at the boundary wanes exactly as a loose one does.
//
// THE CONFIGURATION. An `arm` on `(0, 0)` at rotation `0`, length `1`, so its
// gripper is `(1, 0)` ("one gripper per spoke at `base + length * DIRS[d]`",
// `specs/parts.md`), carrying one `nova` — an essence, by the roster of
// `specs/field.md` — with `rotate-cw` on its tape. Clockwise about `(0, 0)` the
// offset `(1, 0)` becomes `(0, 1)` (`specs/field.md`: "Clockwise:
// `(q, r) -> (-r, q + r)`"), so the carry ends on `(0, 1)` — and a `wane` is
// engraved there, its seat on that hex and nothing else on the field.
//
// The hold is given with `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`), so the cycle under test is the first cycle, and
// the field holds this one mote alone so nothing else can be what waned.
//
// THE VERDICT. After ONE cycle the mote is `dust`, resting on `(0, 1)`. A build
// whose boundary ran before its motion would find the seat empty at that boundary
// — the mote still standing on `(1, 0)` where the cycle began — and would leave a
// `nova` on `(0, 1)` instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
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

it("wanes the carried essence at the boundary of the cycle that delivered it", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, 0, 1, ["rotate-cw"]),
      sigilPart("wane", 0, 1, 0),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const carried = await spawnMote(h, at(1, 0), "nova");
  await takeGrip(h, arm, 0, carried);

  const before = await h.snapshot();
  assertEqual(
    moteById(before, carried)?.type,
    "nova",
    "the mote is an essence when the cycle begins",
  );

  await captureReplay(h, "waned", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is live through the cycle");
  assertEqual(
    after.sim?.status,
    "running",
    "one arm carrying one mote across an otherwise empty field faults at nothing",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  const landed = moteById(after, carried);
  assertNotNull(landed, "the carried mote is still reported after the cycle");
  assertEqual(
    `${landed?.q},${landed?.r}`,
    "0,1",
    "rotate-cw carried the mote from (1, 0) onto the wane seat at (0, 1): the motion really ran",
  );
  assertEqual(
    landed?.type,
    "dust",
    "the motion completed before the boundary, so the sigil phase found the essence on its seat that same cycle",
  );
});

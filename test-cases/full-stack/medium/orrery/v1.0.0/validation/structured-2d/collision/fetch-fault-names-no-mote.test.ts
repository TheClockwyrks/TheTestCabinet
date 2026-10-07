// collision/fetch-fault-names-no-mote — a fetch fault names no mote, whatever the
// faulting part was holding.
//
// THE RULE, from the payload table of `specs/simulation.md` (Faults): "Every fetch
// fault — `parts`: the faulting part; `motes`: empty." A fetch fault is about an
// instruction a part cannot perform, so no mote is implicated even where the part
// is carrying one.
//
// THE CONFIGURATION. One ARM at `(0, 0)` at rotation `0`, length `1`, with
// `extend` in cell `0`, which the fetch refuses as `impossible` — "`impossible` —
// `extend` or `retract` on a part that is not a piston". Its gripper stands at
// "base + length * DIRS[d]" (`specs/parts.md`) — `(1, 0)` — and it is HOLDING a
// mote there, given with `setGrip`, "which takes hold with no `grab` ever running"
// (`specs/instrumentation.md`). A second mote rests on `(0, 3)`, clear of
// everything, so the field is not empty either: if a build filled `motes` with
// whatever was on the field, or with what the part held, this is where it would
// show.
//
// THE FAULT IS A VEHICLE, NOT THE SUBJECT. Any fetch fault would serve, and this
// one is deliberately not the fault the `overextended`, `overretracted` and
// `track-end` items decide, so a build that broke one of those loses those points
// rather than also hiding this one.
//
// THE VERDICT. `sim.fault.motes` is empty, while the run really did fault and
// really was holding a mote.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
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

it("reports an empty sim.fault.motes even while the faulting part is holding one", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["extend"])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const held = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, arm, 0, held);
  await spawnMote(h, at(0, 3), "dust");

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "motes");

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is still live after the fault");
  assertEqual(
    sim?.fault?.kind,
    "impossible",
    "extend on a part that is not a piston is refused at the fetch",
  );
  assertLength(
    gripsOf(snapshot, arm),
    1,
    "the faulting part still reports its one closed gripper",
  );
  assertEqual(
    heldBy(snapshot, arm, 0),
    held,
    "the faulting part really was carrying a mote when its cell was fetched",
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [],
    "every fetch fault reports an empty motes list",
  );
});

// collision/track-end-advance — `advance` at an open track's last cell is
// `track-end`.
//
// THE RULE. "`track-end` — `advance` at the last cell, or `recede` at the first
// cell, of an open track" (`specs/simulation.md`, Faults), raised at the fetch:
// "A non-blank cell the part cannot perform raises the fault named for it under
// Faults" (Cycles and the clock). `specs/parts.md` states the same from the
// track's side: "on a closed track both wrap between the ends, and on an open
// track moving past either end faults".
//
// THE CONFIGURATION. An open three-cell track `(0, 0)`, `(1, 0)`, `(2, 0)` — "A
// track is `closed` when its last cell is adjacent to its first and the editor has
// joined them into a loop ... otherwise it is open" — with one arm anchored on
// `(2, 0)`, its LAST cell, so the arm is mounted there ("An arm or wheel whose
// anchor hex is a cell of a track is mounted on that track"). Its tape cell for the
// cycle is `advance`. Nothing else is placed and the field is empty.
//
// THE VERDICT. `sim.status` is `faulted`, `sim.fault.kind` is `track-end`, the
// fraction is `0`, and the arm's live base cell is still `(2, 0)`: the fetch
// refused before anything moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { at } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("faults as track-end when a mounted arm at the last cell fetches advance", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([at(0, 0), at(1, 0), at(2, 0)]),
      armPart("arm", 2, 0, 0, 1, ["advance"]),
    ]),
  });
  const arm = (await partIds(h))[1] ?? -1;

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "faulted");

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is still live after the fault");
  assertEqual(
    sim?.status,
    "faulted",
    "the cycle faults rather than completing",
  );
  assertEqual(
    sim?.fault?.kind,
    "track-end",
    "advance at the last cell of an open track is track-end",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a fetch fault leaves the fraction at 0, because no motion ran",
  );
  assertEqual(
    `${poseOf(snapshot, arm)?.cell.q},${poseOf(snapshot, arm)?.cell.r}`,
    "2,0",
    "the arm is still on the track's last cell: nothing advanced past the end",
  );
});

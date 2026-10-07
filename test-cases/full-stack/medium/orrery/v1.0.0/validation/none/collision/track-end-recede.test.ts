// collision/track-end-recede — `recede` at an open track's first cell is
// `track-end`.
//
// THE RULE. "`track-end` — `advance` at the last cell, or `recede` at the first
// cell, of an open track" (`specs/simulation.md`, Faults), raised at the fetch.
// `specs/parts.md`: "The `advance` instruction carries a mounted arm's base to the
// next cell of the path and `recede` to the previous one; on a closed track both
// wrap between the ends, and on an open track moving past either end faults."
//
// THE CONFIGURATION. The same open three-cell track `(0, 0)`, `(1, 0)`, `(2, 0)`,
// with one arm anchored on `(0, 0)` — its FIRST cell — and `recede` in tape cell
// `0`. This is the other end of the same rule, and it is its own item because a
// build that guarded one end and not the other must grade differently from one
// that guarded neither.
//
// THE VERDICT. `sim.status` is `faulted`, `sim.fault.kind` is `track-end`, the
// fraction is `0`, and the arm's live base cell is still `(0, 0)`.

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

it("faults as track-end when a mounted arm at the first cell fetches recede", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([at(0, 0), at(1, 0), at(2, 0)]),
      armPart("arm", 0, 0, 0, 1, ["recede"]),
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
    "recede at the first cell of an open track is track-end",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a fetch fault leaves the fraction at 0, because no motion ran",
  );
  assertEqual(
    `${poseOf(snapshot, arm)?.cell.q},${poseOf(snapshot, arm)?.cell.r}`,
    "0,0",
    "the arm is still on the track's first cell: nothing receded past the start",
  );
});

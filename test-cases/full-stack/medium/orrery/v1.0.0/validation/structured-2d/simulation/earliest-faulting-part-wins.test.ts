// simulation/earliest-faulting-part-wins — one fetch raises the EARLIEST faulting
// part's fault.
//
// THE RULE. "When more than one part faults at one fetch, the run raises the fault
// of the earliest such part in placement order and names that part"
// (`specs/simulation.md`, Cycles and the clock, step 1). The payload table fixes
// what "names" means: "Every fetch fault — `parts`: the faulting part; `motes`:
// empty".
//
// PLACEMENT ORDER IS THE DOCUMENT'S ORDER. "The order of `parts` is the machine's
// placement order, which fixes the tape panel's row order and the part indices the
// debug surface reports" (`specs/formats.md`, Solutions), and `editor.parts` is
// reported in that order (`specs/instrumentation.md`), which is what `partIds`
// reads.
//
// THE CONFIGURATION. Two arms, far enough apart that neither reaches the other,
// each given an instruction it cannot perform, and each a DIFFERENT fault so the
// reading tells them apart by kind as well as by id:
//
//   * `extend` on an `arm`, which is `impossible` — "`extend` or `retract` on a
//     part that is not a piston" (`specs/simulation.md`, Faults);
//   * `advance` on an arm standing on no track, which is `unmounted` — "`advance`
//     or `recede` on a part not on a track".
//
// Both faults are raised at the same fetch of the same cycle, so exactly one of
// them can be the run's.
//
// THE ORDER IS POSED BOTH WAYS, which is the whole of the check. A build that
// picked by fault kind, by hex, or by whichever part it happened to visit last
// passes one of the two arrangements and fails the other; only a build that picks
// the earliest in placement order passes both.
//
// THE VERDICT. In each arrangement the fault reports the kind of the FIRST part
// listed and names that part alone, and names no mote.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { armPart, solution, type SolutionPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  type Harness,
} from "../harness";

/** An arm on `(0, 0)` whose `extend` the fetch refuses as `impossible`. */
const IMPOSSIBLE: SolutionPart = armPart("arm", 0, 0, 0, 1, ["extend"]);

/** An arm on `(0, 3)`, on no track, whose `advance` the fetch refuses. */
const UNMOUNTED: SolutionPart = armPart("arm", 0, 3, 0, 1, ["advance"]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Run one cycle on a machine of two faulting parts and read the fault back.
 *
 * Asserts that the run named the first part of `machine` and raised `kind`.
 * Poses nothing of its own: the caller states the order under test.
 */
async function raisesTheFirstPartsFault(
  machine: readonly SolutionPart[],
  kind: string,
  capture: string | null,
): Promise<void> {
  await openBareRun(h, { challenge: BARE, machine: solution(machine) });
  const placed = await partIds(h);
  const earliest = placed[0] ?? -1;

  await advanceCycles(h, 1);
  await h.advance(1);
  if (capture !== null) await captureStill(h, capture);

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the cycle that faulted it");
  assertEqual(
    sim?.status,
    "faulted",
    "two parts fetch instructions they cannot perform, so the cycle faults",
  );
  assertEqual(
    sim?.fault?.kind,
    kind,
    "the run raises the fault of the earliest faulting part in placement order",
  );
  assertDeepEqual(
    sim?.fault?.parts,
    [earliest],
    "a fetch fault names the faulting part, and the faulting part is the earliest one",
  );
  assertDeepEqual(sim?.fault?.motes, [], "a fetch fault names no mote");
}

it("raises the fault of the earlier-placed part, whichever of the two it is", async () => {
  // The impossible arm first: its fault is the run's, and the unmounted one's is
  // not raised at all.
  await raisesTheFirstPartsFault(
    [IMPOSSIBLE, UNMOUNTED],
    "impossible",
    "faulted",
  );

  // The same two parts, the other way round: now the unmounted arm is earliest.
  await raisesTheFirstPartsFault([UNMOUNTED, IMPOSSIBLE], "unmounted", null);
});

// parts/moving-a-track-off-an-arm-unmounts-it — mounting is positional the other
// way too, so a track moved out from under an arm leaves it unmounted.
//
// THE RULE. "An arm or wheel whose anchor hex is a cell of a track is mounted on
// that track ... Mounting is positional: moving a track or an arm in the editor
// changes what is mounted" (`specs/parts.md`, Track). When no cell covers the
// anchor any more, the arm is on no track, and `advance` is then an instruction it
// cannot perform: "`unmounted` — `advance` or `recede` on a part not on a track"
// (`specs/simulation.md`, Faults), raised at the fetch — "A non-blank cell the
// part cannot perform raises the fault named for it under Faults" — which names
// the part: "Every fetch fault — `parts`: the faulting part; `motes`: empty."
//
// THE CONFIGURATION. A three-cell open track through `(0, 0)`, `(1, 0)`, `(2, 0)`,
// and an `arm` anchored on `(0, 0)`, a cell of it, which placement rule 4 allows
// and which mounts it: "An arm or wheel's anchor may sit on any sigil footprint
// hex ... or on a track cell; sitting on a track cell is what mounts it"
// (`specs/parts.md`). `movePart` then translates the whole path three rows south —
// "`movePart(part, q, r)` — Translates the whole part, a track's path included, so
// its anchor is `(q, r)`" (`specs/instrumentation.md`), and a track's "anchor is
// the first cell of `cells`" (`specs/formats.md`) — so the path runs `(0, 3)`,
// `(1, 3)`, `(2, 3)` and covers the arm's anchor no longer. The arm itself is
// untouched, and its tape is `["advance"]`. The move is made while editing, before
// the run starts. Nothing else is placed and no mote is on the field.
//
// THE VERDICT. The cycle does not reach its boundary: `sim.status` is `faulted`,
// `sim.fault.kind` is `unmounted`, `sim.fault.parts` names the arm alone,
// `sim.fault.motes` is empty, the fraction is `0` because the fetch refused before
// any motion, and the arm's base is still on the hex it was anchored on.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { at, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  holdCompletion,
  openChallengeDocument,
  partById,
  placePart,
  placeTrack,
  poseOf,
  writeTape,
  type Harness,
} from "../harness";

/** The track's path, the arm's anchor on its first cell, and where the path goes. */
const CELLS: readonly Hex[] = [at(0, 0), at(1, 0), at(2, 0)];
const ANCHOR = at(0, 0);
const MOVED_TO = at(0, 3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("faults as unmounted when the track under a mounted arm is moved away", async () => {
  await openChallengeDocument(h, BARE);
  await holdCompletion(h);

  const track = await placeTrack(h, CELLS);
  const arm = await placePart(h, "arm", ANCHOR, 0);
  await writeTape(h, arm, ["advance"]);

  const before = await h.snapshot();
  assertEqual(
    (partById(before, track)?.cells ?? [])
      .map((cell) => `${cell.q},${cell.r}`)
      .includes(`${ANCHOR.q},${ANCHOR.r}`),
    true,
    "as placed, a cell of the track covers the arm's anchor, which is what mounts it",
  );

  await h.debug.movePart(track, MOVED_TO.q, MOVED_TO.r);

  const moved = await h.snapshot();
  assertEqual(
    (partById(moved, track)?.cells ?? [])
      .map((cell) => `${cell.q},${cell.r}`)
      .includes(`${ANCHOR.q},${ANCHOR.r}`),
    false,
    "after the move no cell of the track covers the arm's anchor",
  );
  assertEqual(
    `${partById(moved, arm)?.q},${partById(moved, arm)?.r}`,
    `${ANCHOR.q},${ANCHOR.r}`,
    "the arm itself did not move: the track moved out from under it",
  );

  await h.debug.startRun();
  const snapshot = await captureReplay(h, "unmounted", async () => {
    await advanceCycles(h, 1);
    return h.snapshot();
  });

  const sim = snapshot.sim;
  assertNotNull(sim, "the run is still live after the fault");
  assertEqual(
    sim?.status,
    "faulted",
    "the cycle faults rather than completing: the arm is on no track",
  );
  assertEqual(
    sim?.fault?.kind,
    "unmounted",
    "advance on a part not on a track is unmounted",
  );
  assertDeepEqual(
    sim?.fault?.parts,
    [arm],
    "a fetch fault names the faulting part, and the arm is the only part that fetched one",
  );
  assertDeepEqual(sim?.fault?.motes, [], "a fetch fault names no mote");
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a fetch fault leaves the fraction at 0, because no motion ran",
  );
  assertEqual(
    `${poseOf(snapshot, arm)?.cell.q},${poseOf(snapshot, arm)?.cell.r}`,
    `${ANCHOR.q},${ANCHOR.r}`,
    "the arm's base is still on the hex it was anchored on: nothing advanced",
  );
});

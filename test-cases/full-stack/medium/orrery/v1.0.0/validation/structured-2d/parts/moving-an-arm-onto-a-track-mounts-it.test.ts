// parts/moving-an-arm-onto-a-track-mounts-it — mounting is re-derived from
// position, so an arm moved onto a track is mounted on it.
//
// THE RULE. "An arm or wheel whose anchor hex is a cell of a track is mounted on
// that track" (`specs/parts.md`, Track) — a statement about where the anchor IS,
// not about how it got there — and the same section says so outright: "Mounting is
// positional: moving a track or an arm in the editor changes what is mounted."
// `specs/editor.md` repeats it for the drag that does the moving: "mounting
// relationships are re-derived from position, as `specs/parts.md` states."
//
// WHAT MOUNTING BUYS. "The `advance` instruction carries a mounted arm's base to
// the next cell of the path" (`specs/parts.md`), and the alternative is a fault:
// "`unmounted` — `advance` or `recede` on a part not on a track"
// (`specs/simulation.md`, Faults). So running `advance` is how the mounting is
// read: a mounted arm rides, an unmounted one halts the run.
//
// THE CONFIGURATION. A three-cell open track through `(0, 0)`, `(1, 0)`, `(2, 0)`,
// and an `arm` placed at `(0, 2)` — a hex on none of those cells, so at the moment
// it is placed it is mounted on nothing. `movePart` then translates it onto the
// track's FIRST cell: "`movePart(part, q, r)` — Translates the whole part, a
// track's path included, so its anchor is `(q, r)`"
// (`specs/instrumentation.md`). The move is made while editing, before the run
// starts, so what the run begins from is the moved machine. The arm's tape is
// `["advance"]` and nothing else is placed; the field carries no mote, so nothing
// can collide.
//
// THE VERDICT. The cycle reaches its boundary with `sim.status` still `running`
// and no fault — no `unmounted` was raised — and the arm's live base cell is
// `(1, 0)`, the NEXT cell of the path. It rode the track it was moved onto.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
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

/** The track's path, the hex the arm starts off it, and the cell it moves onto. */
const CELLS: readonly Hex[] = [at(0, 0), at(1, 0), at(2, 0)];
const OFF_TRACK = at(0, 2);
const ONTO = at(0, 0);
const NEXT = at(1, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances an arm that was placed off a track and then moved onto one", async () => {
  await openChallengeDocument(h, BARE);
  await holdCompletion(h);

  const track = await placeTrack(h, CELLS);
  const arm = await placePart(h, "arm", OFF_TRACK, 0);
  await writeTape(h, arm, ["advance"]);

  const before = await h.snapshot();
  const path = (partById(before, track)?.cells ?? []).map(
    (cell) => `${cell.q},${cell.r}`,
  );
  assertEqual(
    `${partById(before, arm)?.q},${partById(before, arm)?.r}`,
    `${OFF_TRACK.q},${OFF_TRACK.r}`,
    "the arm was placed off the track",
  );
  assertEqual(
    path.includes(`${OFF_TRACK.q},${OFF_TRACK.r}`),
    false,
    "the hex it was placed on is a cell of no track, so it is mounted on nothing",
  );

  await h.debug.movePart(arm, ONTO.q, ONTO.r);

  const moved = await h.snapshot();
  assertEqual(
    `${partById(moved, arm)?.q},${partById(moved, arm)?.r}`,
    `${ONTO.q},${ONTO.r}`,
    "the move put the arm's anchor where it was asked for",
  );
  assertContains(
    (partById(moved, track)?.cells ?? []).map((cell) => `${cell.q},${cell.r}`),
    `${ONTO.q},${ONTO.r}`,
    "that anchor hex is a cell of the track, which is what mounts it",
  );

  await h.debug.startRun();
  const snapshot = await captureReplay(h, "mounted", async () => {
    await advanceCycles(h, 1);
    return h.snapshot();
  });

  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle that advanced");
  assertEqual(
    sim?.status,
    "running",
    "the moved arm is mounted, so advance is an instruction it can perform",
  );
  assertNull(
    sim?.fault ?? null,
    "no unmounted fault: mounting was re-derived from the arm's new position",
  );
  assertEqual(
    sim?.cycle,
    1,
    "the cycle ran to its boundary rather than freezing",
  );
  assertEqual(
    `${poseOf(snapshot, arm)?.cell.q},${poseOf(snapshot, arm)?.cell.r}`,
    `${NEXT.q},${NEXT.r}`,
    "advance carried the arm's base to the next cell of the path it was moved onto",
  );
});

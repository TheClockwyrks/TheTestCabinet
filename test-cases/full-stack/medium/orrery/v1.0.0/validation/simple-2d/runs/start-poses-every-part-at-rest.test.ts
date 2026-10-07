// runs/start-poses-every-part-at-rest — a run opens with every arm and wheel back
// on the pose the editor placed it at.
//
// THE RULE. "Starting a run: 1. Every arm and wheel takes its rest pose"
// (`specs/simulation.md`, The run), and what a rest pose IS comes from
// `specs/parts.md`: "An arm's placed rotation and length are its rest pose. Each
// run starts every arm at its rest pose." A track arm's third figure is its base
// cell: `sim.poses` carries "one entry per arm and wheel: its live rotation,
// length, and base cell" (`specs/state.md`), and the base a run opens on is the
// anchor the editor placed the part at. `specs/instrumentation.md` restates the
// whole of it under `startRun`: "every arm and wheel at its rest pose holding
// nothing".
//
// THE CONFIGURATION. Four parts, each carrying a DIFFERENT non-default figure so
// that a build restoring some constant rather than the placed pose is caught:
// an `arm` at rotation `2` and length `2`, a `wheel` at rotation `3`, a two-cell
// track, and a `piston` mounted on that track's FIRST cell at rotation `1`. Every
// tape is empty, so nothing moves of its own accord and the only thing that ever
// touches a live pose is this check.
//
// HOW THE FIRST RUN IS LEFT SOMEWHERE ELSE. Through the faculty gate
// `specs/instrumentation.md` names for a part's live pose — "`setPoseRotation`,
// `setPoseLength`, and `setPoseCell`, which move it with no tape running", and
// which leave the REST pose in `editor.parts` exactly as it stands. Each of the
// three live poses is moved off its rest pose, the move is read back so the
// scenario is known to be posed, the run is stopped, and a second run is started
// on the same machine.
//
// THE VERDICT. Every entry of `sim.poses` on the second run reports the part's
// placed rotation, its placed length, and its anchor cell — whatever the first
// run was left holding.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  posePart,
  stopRun,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The track the piston is mounted on: its first cell is the piston's anchor. */
const TRACK_CELLS = [at(-3, 0), at(-2, 0)];

/** Four parts, each placed at a pose of its own. */
const MACHINE = solution([
  armPart("arm", ORIGIN.q, ORIGIN.r, 2, 2, []),
  armPart("wheel", 0, 3, 3, 1, []),
  trackPart(TRACK_CELLS),
  armPart("piston", -3, 0, 1, 1, []),
]);

/** The rest pose each taped part was placed at, by its index in placement order. */
const REST = [
  { index: 0, label: "the arm", rotation: 2, length: 2, cell: ORIGIN },
  { index: 1, label: "the wheel", rotation: 3, length: 1, cell: at(0, 3) },
  { index: 3, label: "the piston", rotation: 1, length: 1, cell: at(-3, 0) },
];

/**
 * Where the first run is left. Every entry moves the live rotation; the two arms
 * move the live length as well, and the wheel does not, because a wheel's
 * "`length` is always `1`" (`specs/parts.md`).
 */
const MOVED = [
  { index: 0, rotation: 5, length: 3 },
  { index: 1, rotation: 0, length: undefined },
  { index: 3, rotation: 4, length: 3 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One part's pose as three plain figures, or `null` when the run reports none. */
function poseFigures(
  snapshot: OrrerySnapshot,
  part: number,
): { rotation: number; length: number; cell: string } | null {
  const pose = poseOf(snapshot, part);
  return pose === null
    ? null
    : {
        rotation: pose.rotation,
        length: pose.length,
        cell: `${pose.cell.q},${pose.cell.r}`,
      };
}

it("puts every arm and wheel back at its placed rotation, length and anchor", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });
  const ids = await partIds(h);

  for (const step of MOVED) {
    await posePart(h, ids[step.index] ?? -1, {
      rotation: step.rotation,
      ...(step.length === undefined ? {} : { length: step.length }),
    });
  }
  await posePart(h, ids[3] ?? -1, { cell: at(-2, 0) });

  const firstRun = await h.snapshot();

  await stopRun(h);
  await h.debug.startRun();
  await h.advance(1);
  await captureStill(h, "rest");

  const secondRun = await h.snapshot();
  for (const step of REST) {
    const moved = poseFigures(firstRun, ids[step.index] ?? -1);
    assertNotNull(
      moved,
      `the run reports a live pose for ${step.label}, which this check has just moved`,
    );
    assertNotEqual(
      JSON.stringify(moved),
      JSON.stringify({
        rotation: step.rotation,
        length: step.length,
        cell: `${step.cell.q},${step.cell.r}`,
      }),
      `${step.label} is left off its rest pose by the first run, so the second run has something to restore`,
    );
  }
  for (const step of REST) {
    const pose = poseFigures(secondRun, ids[step.index] ?? -1);
    assertNotNull(
      pose,
      `the second run reports a live pose for ${step.label}: sim.poses carries one entry per arm and wheel`,
    );
    assertEqual(
      pose?.rotation,
      step.rotation,
      `${step.label} starts the run at its placed rotation, whatever pose the earlier run left it in`,
    );
    assertEqual(
      pose?.length,
      step.length,
      `${step.label} starts the run at its placed length, whatever pose the earlier run left it in`,
    );
    assertEqual(
      pose?.cell,
      `${step.cell.q},${step.cell.r}`,
      `${step.label} starts the run on its anchor cell, whatever pose the earlier run left it in`,
    );
  }
});

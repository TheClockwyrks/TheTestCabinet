// simulation/advance-moves-the-base-forward — `advance` carries a mounted part's
// base to the next cell.
//
// THE RULE, from the motion table of `specs/simulation.md` (Motion and carrying):
// "`advance`, `recede` — The base translates to the adjacent track cell, wrapping
// on a closed track." `specs/instructions.md` names which adjacent cell —
// "`advance` — A mounted part's base moves to the next cell of its track" — and
// `specs/parts.md` says the same from the track's side: "The `advance` instruction
// carries a mounted arm's base to the next cell of the path and `recede` to the
// previous one."
//
// Neither the rotation nor the length appears in that row, so neither moves: what
// travels is the base, and the part rides it unchanged in every other respect.
//
// WHAT MAKES IT MOUNTED. "An arm or wheel whose anchor hex is a cell of a track is
// mounted on that track" (`specs/parts.md`), and the placement rules allow it: "An
// arm or wheel's anchor may sit on any sigil footprint hex... or on a track cell;
// sitting on a track cell is what mounts it."
//
// THE CONFIGURATION. An open three-cell track `(-1, 0)`, `(0, 0)`, `(1, 0)` — its
// cells adjacent in order, as `specs/parts.md` requires — with one `piston`
// anchored on its MIDDLE cell `(0, 0)`, at rotation `1` and length `2`, with
// `advance` in cell `0`. The middle cell is chosen so the step is an ordinary one
// rather than the `track-end` fault an open track's last cell raises, which is a
// different item's. The rotation and the length are both off their resting figures
// so "unchanged" is a reading rather than a tautology, and the field is empty, so
// nothing but the pose is in play.
//
// THE VERDICT. The pose the run reports ends the cycle based on `(1, 0)`, the
// track's next cell, still at rotation `1` and still at length `2`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at, type Hex } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

/** The track's path, in order: the piston stands on its middle cell. */
const TRACK: readonly Hex[] = [at(-1, 0), at(0, 0), at(1, 0)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the cycle based on the next cell of the track, its rotation and length untouched", async () => {
  const from = TRACK[1] as Hex;
  const to = TRACK[2] as Hex;
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      trackPart([...TRACK]),
      armPart("piston", from.q, from.r, 1, 2, ["advance"]),
    ]),
  });
  const piston = (await partIds(h))[1] ?? -1;

  const before = poseOf(await h.snapshot(), piston);
  assertNotNull(before, "the run reports a live pose for the mounted piston");
  assertEqual(
    `${before?.cell.q},${before?.cell.r}`,
    `${from.q},${from.r}`,
    "the run starts the part on its anchor, which is the track's middle cell",
  );

  await captureReplay(h, "advanced", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "one mounted piston advancing over an empty field faults at nothing",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );

  const pose = poseOf(after, piston);
  assertNotNull(
    pose,
    "the run reports a live pose for the piston after the cycle",
  );
  assertEqual(
    `${pose?.cell.q},${pose?.cell.r}`,
    `${to.q},${to.r}`,
    "advance carries a mounted part's base to the next cell of that track's path",
  );
  assertEqual(
    pose?.rotation,
    1,
    "advance translates the base alone, so the part's rotation is unchanged",
  );
  assertEqual(
    pose?.length,
    2,
    "advance translates the base alone, so the part's length is unchanged",
  );
});

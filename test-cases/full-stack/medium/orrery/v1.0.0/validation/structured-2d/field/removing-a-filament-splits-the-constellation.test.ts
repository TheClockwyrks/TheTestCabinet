// field/removing-a-filament-splits-the-constellation — removing a filament splits
// one constellation into two.
//
// THE RULE. "A constellation is a maximal group of motes connected by filaments.
// A lone mote with no filaments is a constellation of one. Constellations are
// rigid: when any mote of one is carried, the whole group moves as a body"
// (`specs/field.md`, Filaments and constellations). Membership is not a label a
// mote carries: it is derived from the filaments AS THEY STAND, so a filament
// removed is a constellation split, and the carrying rule reads the split one.
// `specs/simulation.md` says the same from the carrying side: a gripper "takes
// hold of that mote's CONSTELLATION", and "a carried constellation moves as one
// rigid body: every mote of it follows the motion", while "a mote held by nothing
// rests on its hex for the whole cycle".
//
// THE CONFIGURATION. An arm at `(0, 0)`, length `1`, whose gripper stands on
// `(1, 0)`, with `rotate-cw` on its tape. Two motes on `(1, 0)` and `(2, 0)` —
// adjacent, `DIRS[0]` apart — joined by a filament and then UNJOINED with
// `unlinkMotes`, which "removes the filament joining `a` and `b`"
// (`specs/instrumentation.md`). The gripper is then given the mote on its own
// hex, and one cycle is run.
//
// WHY THIS GEOMETRY. `rotate-cw` turns the arm's direction "60 degrees about its
// base", carrying the held mote from `(1, 0)` toward `(0, 1)` — which is the
// sweep of `specs/simulation.md`'s worked example A. The resting mote is on
// `(2, 0)` rather than on example A's `(1, 1)`, and every sample of the sweep
// stays `48` or more from it, so nothing here faults: what the check reads is
// where two motes ended up, and a run frozen at a fault would tell it nothing.
//
// THE VERDICT is the split, read three ways: the held mote lands on `(0, 1)`,
// where the gripper went; the other stays on `(2, 0)`, because nothing holds it;
// and the constellation the run reports for the carried mote is that mote alone.
// Had the filament survived, the pair would have swept as one body.
//
// THE HOLD IS POSED, NOT GRABBED. `setGrip` "takes hold with no `grab` ever
// running" (`specs/instrumentation.md`), so the only cycle that runs is the one
// under test. The bare opener emptied the field first, so the two motes and the
// one arm are the whole of the world.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { at, neighbor } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  constellationOf,
  createHarness,
  filamentBetween,
  gripsOf,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

/** Where the arm's one gripper stands at rest: the base plus `DIRS[0]`. */
const GRIPPED = neighbor(ORIGIN, 0);

/** The hex beyond it, adjacent to the gripped hex and clear of the sweep. */
const RESTING = at(2, 0);

/** Where `rotate-cw` carries the gripper: the base plus `DIRS[1]`. */
const SWEPT_TO = neighbor(ORIGIN, 1);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the held mote alone once the filament joining the pair is removed", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-cw"]),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  const ids = await spawnConstellation(
    h,
    [
      { hex: GRIPPED, type: "dust" },
      { hex: RESTING, type: "dust" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );
  const carried = ids[0] as number;
  const left = ids[1] as number;

  const joined = await h.snapshot();

  await h.debug.unlinkMotes(carried, left);
  const split = await h.snapshot();

  await takeGrip(h, arm, 0, carried);
  await captureReplay(h, "split", () => advanceCycles(h, 1));

  assertNotNull(
    filamentBetween(joined, carried, left),
    "the pair was joined before the filament was removed",
  );
  assertDeepEqual(
    constellationOf(joined, carried),
    [carried, left].sort((a, b) => a - b),
    "and joined, the two were one constellation",
  );
  assertEqual(
    filamentBetween(split, carried, left),
    null,
    "unlinkMotes removed the filament joining the pair",
  );
  assertLength(
    split.sim?.filaments ?? [],
    0,
    "and left no filament on the field at all",
  );
  assertDeepEqual(
    constellationOf(split, carried),
    [carried],
    "so the carried mote is a constellation of one, derived from the filaments as they stand",
  );

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "the sweep clears the resting mote by 48 or more, so the cycle runs to its boundary",
  );
  assertEqual(after.sim?.fault ?? null, null, "and nothing faulted");
  const grips = gripsOf(after, arm);
  assertLength(
    grips,
    1,
    "the arm's one gripper is still holding: a grip persists across cycles until dropped",
  );
  assertEqual(
    grips[0]?.mote,
    carried,
    "and what it holds is still the mote it was given, alone",
  );

  const swept = moteById(after, carried);
  assertNotNull(swept, "the carried mote is still on the field");
  assertEqual(
    swept?.q,
    SWEPT_TO.q,
    "the held mote rode the rotation to (0, 1): q",
  );
  assertEqual(
    swept?.r,
    SWEPT_TO.r,
    "the held mote rode the rotation to (0, 1): r",
  );

  const stayed = moteById(after, left);
  assertNotNull(stayed, "the other mote is still on the field");
  assertEqual(
    stayed?.q,
    RESTING.q,
    "a mote held by nothing rests on its hex for the whole cycle: q",
  );
  assertEqual(
    stayed?.r,
    RESTING.r,
    "a mote held by nothing rests on its hex for the whole cycle: r",
  );
});

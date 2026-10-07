// sigils/sunder-splits-constellation — when the filament a `sunder` removes was
// the only one holding a group together, what is left is two constellations, and
// a gripper carries one of them alone.
//
// THE RULE, in two sentences from two files. `specs/sigils.md`: "when a filament
// joins the motes on its two hexes, that filament is removed". `specs/field.md`:
// "a constellation is a maximal group of motes connected by filaments. A lone
// mote with no filaments is a constellation of one. Constellations are rigid:
// when any mote of one is carried, the whole group moves as a body." Membership
// is derived from the filaments AS THEY STAND rather than carried as a label, so
// the removal IS the split. `specs/simulation.md` reads the split group from the
// carrying side: a gripper "takes hold of that mote's constellation", "a carried
// constellation moves as one rigid body: every mote of it follows the motion",
// and "a mote held by nothing rests on its hex for the whole cycle".
//
// THE CONFIGURATION. An arm at `(0, 0)`, rotation `0`, length `1`, so its one
// gripper stands on `(1, 0)`. A `sunder` anchored at `(1, 0)`, so its first hex
// is `(1, 0)` and its second is `(2, 0)`. Two `dust` on those two hexes, joined
// by a filament, and the gripper given the one on its own hex with `setGrip`,
// "which takes hold with no `grab` ever running" (`specs/instrumentation.md`).
// Nothing else is on the field.
//
// TWO CYCLES, BECAUSE THE SIGIL PHASE IS AT THE BOUNDARY. The arm's tape is
// blank, then `rotate-cw`, so its period is `2`: cycle `0` rests while the
// `sunder` cuts at its boundary, and cycle `1` sweeps the gripper afterwards. A
// single cycle would sweep the pair while it was still one body, because motion
// is step 4 of a cycle and the sigil phase is step 5.
//
// WHY THIS SWEEP. `rotate-cw` "turns the part one 60 degree step clockwise about
// its base", carrying the gripper from `(1, 0)` to `(0, 1)`. The mote left behind
// rests on `(2, 0)`, which every sample of that sweep clears by `48` or more, so
// nothing faults and what the check reads is where two motes ended up.
//
// THE VERDICT, read at two moments. At the first boundary the filament is gone
// and the carried mote's constellation is that mote alone. After the second the
// carried mote is on `(0, 1)`, where the gripper went, and the other is still
// resting on `(2, 0)` — which is what "carries that side alone and leaves the
// other resting" means. Had the two still been one constellation, both would have
// swept.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, neighbor } from "../field";
import { armPart, sigilPart, solution } from "../formats";
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
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

/** Where the arm's one gripper stands at rest, and the sunder's first hex. */
const GRIPPED = neighbor(ORIGIN, 0);

/** The sunder's second hex, where the other mote rests. */
const RESTING = at(2, 0);

/** Where `rotate-cw` carries the gripper: the base plus `DIRS[1]`. */
const SWEPT_TO = neighbor(ORIGIN, 1);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries one side of the sundered group and leaves the other resting", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [null, "rotate-cw"]),
      sigilPart("sunder", GRIPPED.q, GRIPPED.r, 0),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  const pair = await spawnConstellation(
    h,
    [
      { hex: GRIPPED, type: "dust" },
      { hex: RESTING, type: "dust" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );
  const carried = pair[0] as number;
  const left = pair[1] as number;

  await takeGrip(h, arm, 0, carried);

  const joined = await h.snapshot();

  const cut: OrrerySnapshot = await captureReplay(h, "split", async () => {
    await advanceCycles(h, 1);
    const mid = await h.snapshot();
    await advanceCycles(h, 1);
    return mid;
  });

  assertNotNull(
    filamentBetween(joined, carried, left),
    "the pair starts joined, which is the condition the sunder acts on",
  );
  assertDeepEqual(
    constellationOf(joined, carried),
    [carried, left].sort((a, b) => a - b),
    "and joined, the two are one constellation the gripper holds",
  );

  assertEqual(
    cut.sim?.cycle,
    1,
    "the resting cycle reached its boundary, where the sigil phase runs",
  );
  assertNull(
    filamentBetween(cut, carried, left),
    "the sunder removed the filament joining the motes on its two hexes",
  );
  assertLength(
    cut.sim?.filaments ?? [],
    0,
    "and it was the only filament there was",
  );
  assertDeepEqual(
    constellationOf(cut, carried),
    [carried],
    "so the held mote is now a constellation of one: the removal disconnected the group",
  );
  assertDeepEqual(
    constellationOf(cut, left),
    [left],
    "and the mote left unconnected is a separate constellation of its own",
  );

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "the sweep clears the resting mote by 48 or more, so the second cycle reaches its boundary",
  );
  assertEqual(after.sim?.fault ?? null, null, "and nothing faulted");
  const grips = gripsOf(after, arm);
  assertLength(
    grips,
    1,
    "the gripper is still holding: a grip persists across cycles until dropped",
  );
  assertEqual(grips[0]?.mote, carried, "and what it holds is still that mote");

  const swept = moteById(after, carried);
  assertNotNull(swept, "the carried mote is still on the field");
  assertEqual(
    `${swept?.q},${swept?.r}`,
    `${SWEPT_TO.q},${SWEPT_TO.r}`,
    "the held side rode the rotation to (0, 1), carried alone",
  );
  const stayed = moteById(after, left);
  assertNotNull(stayed, "the other mote is still on the field");
  assertEqual(
    `${stayed?.q},${stayed?.r}`,
    `${RESTING.q},${RESTING.r}`,
    "and the other side, held by nothing now, rested on its hex for the whole cycle",
  );
});

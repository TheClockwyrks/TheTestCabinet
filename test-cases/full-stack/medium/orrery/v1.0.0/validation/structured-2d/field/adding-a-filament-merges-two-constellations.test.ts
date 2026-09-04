// field/adding-a-filament-merges-two-constellations — a filament between two
// bodies makes them one body.
//
// THE RULE, from `specs/field.md` (Filaments and constellations): "A constellation
// is a maximal group of motes connected by filaments. A lone mote with no
// filaments is a constellation of one. Constellations are rigid: when any mote of
// one is carried, the whole group moves as a body and every filament keeps its
// length and relative direction." Maximality is the whole of the merge: once one
// filament joins a mote of one group to a mote of another, no group containing
// either is maximal short of the union, so there is ONE constellation where there
// were two. `specs/sigils.md` says the same from `bind`'s side — "binding two
// constellations merges them into one" — and `specs/simulation.md` (Grabs) is what
// makes the merge observable through an arm: "a gripper over a mote that is not a
// fixture takes hold of that mote's constellation."
//
// THE CONFIGURATION. Two two-mote bodies, side by side and joined by nothing:
//
//   * one on `(1, 0)` and `(1, -1)`, which "A filament is a rigid link between two
//     motes on adjacent hexes" allows, `(1, 0) + DIRS[4]` being `(1, -1)`;
//   * one on `(2, 0)` and `(2, -1)`, joined the same way.
//
// Both are read back as constellations of two, disjoint, BEFORE anything joins
// them — otherwise there is no merge to observe. Then one filament is laid across
// the gap, from `(1, 0)` to `(2, 0)`, which `DIRS[0]` makes adjacent.
//
// THE MOTION. An arm on `(0, 0)` at rotation `0` and length `1` puts its one
// gripper on "`base + length * DIRS[d]`" (`specs/parts.md`) — `(1, 0)` — and takes
// hold of the mote there with `setGrip`, "which takes hold with no `grab` ever
// running" (`specs/instrumentation.md`), so the only cycle that runs is the one
// under test. Its tape is `rotate-cw`, which imposes "the same rotation about the
// base" on each held constellation (`specs/simulation.md`, Motion and carrying),
// and `specs/field.md` fixes the step: `(q, r) -> (-r, q + r)` about `(0, 0)`.
//
// THE VERDICT. Every mote of BOTH bodies lands on its own hex turned one step —
// the two the gripper is nowhere near included — and "at `t = 1` every mote lands
// exactly on a hex center". A build that merged nothing carries the two motes it
// grabbed and leaves the other two where they rest, which this fails.
//
// A RIGID ROTATION KEEPS EVERY PAIR APART. The four motes turn about one center,
// so every distance between them is the distance it was: `48` for the three
// adjacent pairs and `83.14` for the two diagonal ones, none within `2 *
// MOTE_COLLIDE_R` (`38`). The cycle therefore reaches its boundary, and the check
// reads that it did.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, rotate, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  constellationOf,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  takeGrip,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Where a mote rests, as `q,r`, or `"absent"` when the run reports none. */
function restingOn(snapshot: OrrerySnapshot, mote: number): string {
  const found = moteById(snapshot, mote);
  return found === null ? "absent" : `${found.q},${found.r}`;
}

/** A hex, as `q,r`. */
function spell(hex: Hex): string {
  return `${hex.q},${hex.r}`;
}

it("carries every mote of both bodies once one filament joins them", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  const first = await spawnConstellation(
    h,
    [
      { hex: at(1, 0), type: "dust" },
      { hex: at(1, -1), type: "dust" },
    ],
    [{ a: 0, b: 1 }],
  );
  const second = await spawnConstellation(
    h,
    [
      { hex: at(2, 0), type: "dust" },
      { hex: at(2, -1), type: "dust" },
    ],
    [{ a: 0, b: 1 }],
  );

  const apart = await h.snapshot();
  assertDeepEqual(
    constellationOf(apart, first[0] ?? -1),
    [...first].sort((a, b) => a - b),
    "before the filament, the first body is the maximal group its two filaments connect",
  );
  assertDeepEqual(
    constellationOf(apart, second[0] ?? -1),
    [...second].sort((a, b) => a - b),
    "before the filament, the second body is a separate maximal group",
  );

  // The one filament under test: `(1, 0)` to `(2, 0)`, a rigid link between two
  // motes on adjacent hexes.
  await h.debug.linkMotes(first[0] ?? -1, second[0] ?? -1, 1);

  const joined = await h.snapshot();
  const whole = [...first, ...second].sort((a, b) => a - b);
  assertDeepEqual(
    constellationOf(joined, second[1] ?? -1),
    whole,
    "one filament across the gap leaves one maximal group holding every mote of both",
  );

  await takeGrip(h, arm, 0, first[0] ?? -1);
  const held = await h.snapshot();
  assertEqual(
    held.sim?.grips.length,
    1,
    "one gripper holds the merged constellation, and nothing else holds anything",
  );

  await captureReplay(h, "merged", () => advanceCycles(h, 1));

  const swept = await h.snapshot();
  assertNotNull(swept.sim, "the run is live through the cycle");
  assertNull(
    swept.sim?.fault ?? null,
    "a rigid rotation keeps every pair the distance it was, so nothing collides",
  );
  assertEqual(
    swept.sim?.status,
    "running",
    "the cycle reaches its boundary rather than halting",
  );

  const carried: readonly (readonly [number, Hex])[] = [
    [first[0] ?? -1, at(1, 0)],
    [first[1] ?? -1, at(1, -1)],
    [second[0] ?? -1, at(2, 0)],
    [second[1] ?? -1, at(2, -1)],
  ];
  for (const [mote, from] of carried) {
    assertEqual(
      restingOn(swept, mote),
      spell(rotate(from, 1)),
      `the mote resting on ${spell(from)} is carried one clockwise step about (0, 0), because the whole merged group moves as a body`,
    );
  }
});

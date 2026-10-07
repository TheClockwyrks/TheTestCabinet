// sigils/bind-merges-constellations — a bind across two bodies leaves one body.
//
// THE RULE. `specs/sigils.md` states it in `bind`'s own sentence: "binding two
// constellations merges them into one." `specs/field.md` says what that means and
// what it is worth: "A constellation is a maximal group of motes connected by
// filaments", and "Constellations are rigid: when any mote of one is carried, the
// whole group moves as a body and every filament keeps its length and relative
// direction." `specs/simulation.md` is what makes the merge observable through an
// arm — a carried constellation "moves as one rigid body: every mote of it follows
// the motion" — and `setGrip` takes hold of "`mote`'s constellation"
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION. Two two-mote bodies, side by side and joined by nothing:
// one on `(1, 0)` and `(1, -1)`, one on `(2, 0)` and `(2, -1)`, each pair adjacent
// by `DIRS[4]` and each joined by one filament. A `bind` engraved on `(1, 0)` at
// rotation `0`, so its hexes are `(1, 0)` and `(2, 0)` — one mote of each body.
// An `arm` anchored on `(0, 0)` at rotation `0` and length `1`, whose one gripper
// stands on `(1, 0)`.
//
// TWO CYCLES, EACH DOING ONE THING. The arm's tape is `[blank, rotate-cw]`, so
// cycle `0` moves nothing — "A blank cell is a rest on every part"
// (`specs/simulation.md`) — and its boundary is the merge under test. NOTHING IS
// HELD ACROSS THAT BOUNDARY: the grip is posed afterwards, with `setGrip`, "which
// takes hold with no `grab` ever running", so this check does not lean on "held
// motes bind like any others" to reach its own point. Cycle `1` then runs
// `rotate-cw`, under which the held constellation takes "The same rotation about
// the base", and `specs/field.md` fixes the step: `(q, r) -> (-r, q + r)` about
// `(0, 0)`.
//
// A RIGID ROTATION KEEPS EVERY PAIR APART. All four motes turn about one center,
// so every distance between them is the distance it was — `48` for the four
// adjacent pairs and `83.14` for the diagonal one — none within `2 *
// MOTE_COLLIDE_R` (`38`). The cycle reaches its boundary, and the check reads that
// it did.
//
// THE VERDICT. Before the boundary the two bodies are two disjoint maximal groups.
// After it there is ONE group holding all four. And the merge is a real merge
// rather than a bookkeeping entry: one gripper on ONE mote of the former first
// body then carries all four, the two motes it is nowhere near included. A build
// that created the filament but left the groups apart carries two motes and leaves
// two behind, which this fails.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, place, rotate, type Hex } from "../field";
import { armPart, sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  constellationOf,
  createHarness,
  filamentBetween,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  takeGrip,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** Where the bind is engraved: its hexes are `(1, 0)` and `(2, 0)`. */
const ANCHOR = at(1, 0);

/** The bind's `first` hex, placed — also the arm's gripper hex. */
const FIRST = place(at(0, 0), ANCHOR, 0);

/** The bind's `second` hex, placed. */
const SECOND = place(at(1, 0), ANCHOR, 0);

/** The other mote of the body on the bind's first hex. */
const FIRST_TAIL = at(1, -1);

/** The other mote of the body on the bind's second hex. */
const SECOND_TAIL = at(2, -1);

/** Where the arm stands, and the center its sweep turns about. */
const BASE = at(0, 0);

/** The arm's one spoke: `DIRS[0]` is `(1, 0)`, east. */
const SPOKE = 0;

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

it("merges the two bodies it binds, and a gripper then carries all four motes", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      sigilPart("bind", ANCHOR.q, ANCHOR.r, 0),
      armPart("arm", BASE.q, BASE.r, SPOKE, 1, [null, "rotate-cw"]),
    ]),
  });
  const arm = (await partIds(h))[1] ?? -1;

  const first = await spawnConstellation(
    h,
    [
      { hex: FIRST, type: "dust" },
      { hex: FIRST_TAIL, type: "dust" },
    ],
    [{ a: 0, b: 1 }],
  );
  const second = await spawnConstellation(
    h,
    [
      { hex: SECOND, type: "dust" },
      { hex: SECOND_TAIL, type: "dust" },
    ],
    [{ a: 0, b: 1 }],
  );

  const apart = await h.snapshot();
  assertDeepEqual(
    constellationOf(apart, first[0] ?? -1),
    [...first].sort((a, b) => a - b),
    "before the boundary the body on the bind's first hex is its own maximal group",
  );
  assertDeepEqual(
    constellationOf(apart, second[0] ?? -1),
    [...second].sort((a, b) => a - b),
    "before the boundary the body on the bind's second hex is a separate maximal group",
  );
  assertLength(
    apart.sim?.grips ?? [],
    0,
    "nothing is holding anything across the boundary that binds",
  );

  await captureReplay(h, "merged", async () => {
    await advanceCycles(h, 1);

    const merged = await h.snapshot();
    const whole = [...first, ...second].sort((a, b) => a - b);
    assertEqual(
      filamentBetween(merged, first[0] ?? -1, second[0] ?? -1)?.weight,
      1,
      "the bind's two hexes each held a mote, so the boundary joined them at weight 1",
    );
    assertDeepEqual(
      constellationOf(merged, first[1] ?? -1),
      whole,
      "binding two constellations merges them into one, so every mote of both is in one maximal group",
    );
    assertDeepEqual(
      constellationOf(merged, second[1] ?? -1),
      whole,
      "the merged group is the same group read from a mote of the other former body",
    );

    await takeGrip(h, arm, SPOKE, first[0] ?? -1);
    await advanceCycles(h, 1);
  });

  const swept = await h.snapshot();
  const sim = swept.sim;
  assertNotNull(sim, "the run is live through both cycles");
  assertEqual(
    sim?.status,
    "running",
    "a rigid rotation keeps every pair the distance it was, so the cycle reaches its boundary",
  );
  assertNull(sim?.fault ?? null, "no fault is raised by the sweep");
  assertEqual(sim?.cycle, 2, "two cycles of game time completed two cycles");

  for (const [mote, from] of [
    [first[0] ?? -1, FIRST],
    [first[1] ?? -1, FIRST_TAIL],
    [second[0] ?? -1, SECOND],
    [second[1] ?? -1, SECOND_TAIL],
  ] as const) {
    assertEqual(
      restingOn(swept, mote),
      spell(rotate(from, 1)),
      `the mote resting on ${spell(from)} is carried one clockwise step about (0, 0): the merged group moves as one rigid body`,
    );
  }
});

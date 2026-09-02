// presentation/fault-effect-tie-break — two named motes at the same height put the
// effect on the left-hand one.
//
// THE RULE, from the particle-effect table of `specs/assets.md`: "Fault |
// `assets/particles/fault.json` | the position of the mote the fault of
// `specs/simulation.md` names, LOWEST IN `y` AND THEN LOWEST IN `x` AMONG THEM."
// The second clause only ever decides anything when the first does not, so this
// point poses precisely the case that reaches it: two named motes whose `y` is
// equal.
//
// WHY THEIR `y` IS EQUAL, EXACTLY. `specs/field.md` fixes
// `hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r` — a function of `r` alone
// — so two hexes with the same `r` sit at the same height whatever their `q`.
// `(0, 0)` and `(1, 0)` are such a pair, and they are adjacent, so a filament may
// join them (`specs/field.md`). `hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)`
// then puts `(0, 0)` to the left of `(1, 0)`, so the tie breaks toward `(0, 0)`.
//
// THE FAULT IS A `torn`, whose payload is "every mote of the constellation"
// (`specs/simulation.md`), so both motes are named. It is raised because "At the
// start of the motion step, every held constellation's imposed motions must agree
// ... unless every imposed motion is the same one, the run faults as `torn`": one
// arm's cell is `rotate-cw` and the other's is blank, which the motion table gives
// as "None". Being at the START of the motion step, the tear happens with every
// mote still on its own hex, so the positions the rule reads are the two hex
// centres.
//
// HOW AN EFFECT IS READ. A played system is a picture that changes from frame to
// frame — "Each play of a system varies, and that variation is correct" — where it
// plays, and a faulted run is the quietest place to read one: "A fault freezes the
// run where it stood ... nothing advances further" (`specs/simulation.md`). No rise
// and no set is placed, so no aperture turns either. Each system is "authored
// radially symmetric", so an instance centered on one of the two moves more of that
// mote's own hex than of the other's.
//
// THE VERDICT. The run tears naming both motes; the two are reported at the same
// `y`; and the pixels around the one with the lower `x` change, and change more
// than the pixels around the other.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertNotNull,
} from "../assert";
import { HEX_PITCH, SPEEDS } from "../constants";
import { at, type Hex, type StagePoint } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  pixelsDiffering,
  spawnConstellation,
  takeGrip,
  type Harness,
  type PixelRect,
} from "../harness";

/** The fastest speed step, so the frame that tears is a short one. */
const FAST = SPEEDS.length - 1;

/**
 * Two adjacent hexes on ONE row, so `hexY` gives them the same `y`.
 *
 * Neither is `(0, 0)`. The completion effect of the same table is fired at hex
 * `(0, 0)` whatever raised it, so a build that fired every effect over the middle
 * of the field would satisfy a check whose named mote stood there; standing the
 * pair off the middle means such a build lights neither of them.
 */
const LEFT: Hex = at(1, 1);
const RIGHT: Hex = at(2, 1);

/**
 * The two arms, each with a gripper on one of those hexes.
 *
 * `specs/parts.md` puts a gripper at `base + length * DIRS[d]`: rotation `0` is
 * `DIRS[0]` = `(1, 0)`, so the base `(0, 1)` grips `(1, 1)`; rotation `3` is
 * `DIRS[3]` = `(-1, 0)`, so the base `(3, 1)` grips `(2, 1)`. The first turns and
 * the second rests, which is the disagreement.
 */
const MACHINE = solution([
  armPart("arm", 0, 1, 0, 1, ["rotate-cw"]),
  armPart("arm", 3, 1, 3, 1, []),
]);

/** Which spoke each of them grips with. */
const TURNING_SPOKE = 0;
const RESTING_SPOKE = 3;

/** Half the hex pitch: the square read back covers one hex and no neighbour's centre. */
const PATCH_R = HEX_PITCH / 2;

/** How many frames after the fault the picture is watched over. */
const WATCHED = 6;

/** How long each of those frames is, in seconds of game time. */
const WATCH_SECONDS = 0.008;

/** How near two drawn positions must agree, in logical units. */
const ON_POINT = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The square of the stage around a point, read back as pixels. */
function patch(point: StagePoint): Promise<PixelRect> {
  return h.pixelRect(
    point.x - PATCH_R,
    point.y - PATCH_R,
    PATCH_R * 2,
    PATCH_R * 2,
  );
}

/** How many pixels of each patch changed over the frames driven. */
async function churn(points: readonly StagePoint[]): Promise<number[]> {
  let before = await Promise.all(points.map(patch));
  const moved = points.map(() => 0);
  for (let frame = 0; frame < WATCHED; frame += 1) {
    await h.advanceSeconds(WATCH_SECONDS, 1);
    const now = await Promise.all(points.map(patch));
    for (const [index, rect] of now.entries()) {
      moved[index] =
        (moved[index] ?? 0) + pixelsDiffering(rect, before[index] as PixelRect);
    }
    before = now;
  }
  return moved;
}

it("puts the fault effect on the lower x when the two named motes share a y", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE, speed: FAST });
  const ids = await partIds(h);
  const [left, right] = await spawnConstellation(
    h,
    [
      { hex: LEFT, type: "dust" },
      { hex: RIGHT, type: "dust" },
    ],
    [{ a: 0, b: 1 }],
  );
  await takeGrip(h, ids[0] ?? -1, TURNING_SPOKE, left ?? -1);
  await takeGrip(h, ids[1] ?? -1, RESTING_SPOKE, right ?? -1);

  const moved = await captureReplay(h, "tie", async () => {
    await advanceCycles(h, 1, 1);

    const torn = await h.snapshot();
    assertEqual(
      torn.sim?.status,
      "faulted",
      "a rotation and a rest disagree, so the constellation held by both tears",
    );
    assertEqual(torn.sim?.fault?.kind, "torn", "and the fault is a torn");
    assertDeepEqual(
      torn.sim?.fault?.motes,
      [left, right].sort((a, b) => (a as number) - (b as number)),
      "a torn names every mote of the constellation, in ascending mote id",
    );

    const lower = moteById(torn, left ?? -1);
    const higher = moteById(torn, right ?? -1);
    assertNotNull(lower, "the mote on (1, 1) is still reported on the field");
    assertNotNull(higher, "and so is the mote on (2, 1)");
    assertNear(
      lower?.y ?? 0,
      higher?.y ?? -1,
      ON_POINT,
      "the two named motes share a row, so hexY puts them at the same y and the " +
        "first clause of the rule decides nothing",
    );
    assertGreaterThan(
      higher?.x ?? 0,
      lower?.x ?? 0,
      "and hexX puts (1, 1) to the left of (2, 1), so the tie breaks toward it",
    );
    assertNear(
      (higher?.x ?? 0) - (lower?.x ?? 0),
      HEX_PITCH,
      ON_POINT,
      "one hex apart along the row, which is HEX_PITCH (48)",
    );

    const measured = await churn([
      { x: lower?.x ?? 0, y: lower?.y ?? 0 },
      { x: higher?.x ?? 0, y: higher?.y ?? 0 },
    ]);
    assertEqual(
      (await h.snapshot()).sim?.status,
      "faulted",
      "nothing advanced while the picture was watched: a fault freezes the run",
    );
    return measured;
  });

  assertGreaterThan(
    moved[0] ?? 0,
    0,
    "the fault effect is played at the named mote with the lower x, so the " +
      "picture there changes across the frames after the fault",
  );
  assertGreaterThan(
    moved[0] ?? 0,
    moved[1] ?? 0,
    "and it is played THERE rather than at the mote sharing its y: a radially " +
      "symmetric system moves more of the hex it is centered on",
  );
});

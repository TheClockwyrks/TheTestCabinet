// presentation/fault-effect-at-the-named-mote — a fault marks the mote it names.
//
// THE RULE, from the particle-effect table of `specs/assets.md`: "Fault |
// `assets/particles/fault.json` | THE POSITION OF THE MOTE THE FAULT OF
// `specs/simulation.md` NAMES, LOWEST IN `y` AND THEN LOWEST IN `x` AMONG THEM, or
// the anchor hex of the part it names when it names no mote." Which motes a fault
// names is `specs/simulation.md`'s payload table: "`torn` | `parts`: every part
// holding the constellation | `motes`: EVERY MOTE OF THE CONSTELLATION", and
// "`motes` is in ascending mote id" — an order that is deliberately NOT the order
// the effect's rule picks from, so a build that took the first entry of the list
// rather than the lowest in `y` is caught here.
//
// THE FAULT IS A `torn`: "At the start of the motion step, every held
// constellation's imposed motions must agree ... unless every imposed motion is the
// same one, the run faults as `torn`" (`specs/simulation.md`). Two motes joined by
// a filament are held by two arms: one whose cell is `rotate-cw` and one whose cell
// is blank, which is "None" in the motion table. A rotation and no motion are not
// the same motion, so the cycle tears at the start of its motion step — before any
// collision sample, and with every mote still resting on its own hex, so the
// positions the effect's rule reads are the hex centres `specs/field.md` fixes.
//
// THE TWO MOTES ARE ONE HEX APART, so they "rest 48 apart" — `HEX_PITCH` — and
// their `y` differs, because they sit on hexes of different `r`:
// `hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r`. The mote on the hex with
// the smaller `r` is the one lowest in `y`, and that is the one the rule names.
//
// HOW AN EFFECT IS READ. A played system goes on changing the picture over the
// frames after the one it fired on — "A play is watched rather than glimpsed: an
// instance fired on one frame goes on changing the picture at its event's position
// over the frames that follow it, decaying to empty across them rather than being
// over by the next frame" (`specs/assets.md`) — where it
// plays. A faulted run is the quietest place there is to read one: "A fault freezes
// the run where it stood: the status becomes `faulted` and NOTHING ADVANCES
// FURTHER" (`specs/simulation.md`). No rise and no set is placed, so no aperture
// turns either. Everything that can still change the picture is the effect.
//
// AND WHICH MOTE THE RULE NAMES IS READ FROM STATE. The two motes are one hex
// apart, so a system played on either reaches the other's hex and no absence can
// be read there; what fixes the choice instead is the snapshot, whose reported
// positions say which of the two is lowest in `y` by `hexY`'s own formula. The
// picture is then read for one thing only: that an effect played at that mote.
//
// THE VERDICT. The run faults as `torn` naming both motes; the two rest `HEX_PITCH`
// apart; the snapshot puts the named one lowest in `y`; and the pixels around it
// change across the frames after the fault.

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
  type MoteView,
  type PixelRect,
} from "../harness";

/** The fastest speed step, so the frame that tears is a short one. */
const FAST = SPEEDS.length - 1;

/** The two hexes the constellation rests on: adjacent, and on different rows. */
const LOWER_ROW: Hex = at(0, -1);
const UPPER_ROW: Hex = at(0, 0);

/**
 * The two arms, each with a gripper on one of those hexes.
 *
 * `specs/parts.md` puts a gripper at `base + length * DIRS[d]`: the first arm's
 * rotation `0` is `DIRS[0]` = `(1, 0)` east, so its base `(-1, 0)` grips `(0, 0)`;
 * the second's rotation `1` is `DIRS[1]` = `(0, 1)`, so its base `(0, -2)` grips
 * `(0, -1)`. The first turns and the second rests, which is the disagreement.
 */
const MACHINE = solution([
  armPart("arm", -1, 0, 0, 1, ["rotate-cw"]),
  armPart("arm", 0, -2, 1, 1, []),
]);

/** Which spoke each of them grips with. */
const TURNING_SPOKE = 0;
const RESTING_SPOKE = 1;

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

/** The mote of a list lowest in `y`, and then lowest in `x`. */
function lowest(motes: readonly MoteView[]): MoteView | null {
  return [...motes].sort((a, b) => a.y - b.y || a.x - b.x)[0] ?? null;
}

it("plays the fault effect on the named mote lowest in y rather than on the other", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE, speed: FAST });
  const ids = await partIds(h);
  const [upper, lower] = await spawnConstellation(
    h,
    [
      { hex: UPPER_ROW, type: "dust" },
      { hex: LOWER_ROW, type: "dust" },
    ],
    [{ a: 0, b: 1 }],
  );
  await takeGrip(h, ids[0] ?? -1, TURNING_SPOKE, upper ?? -1);
  await takeGrip(h, ids[1] ?? -1, RESTING_SPOKE, lower ?? -1);

  const moved = await captureReplay(h, "collision", async () => {
    await advanceCycles(h, 1, 1);

    const torn = await h.snapshot();
    assertEqual(
      torn.sim?.status,
      "faulted",
      "a rotation and a rest disagree, so the constellation held by both tears",
    );
    assertEqual(
      torn.sim?.fault?.kind,
      "torn",
      "and the fault is the torn of specs/simulation.md",
    );
    assertDeepEqual(
      torn.sim?.fault?.motes,
      [upper, lower].sort((a, b) => (a as number) - (b as number)),
      "a torn names every mote of the constellation, in ascending mote id",
    );

    const named = (torn.sim?.fault?.motes ?? []).flatMap((id) => {
      const mote = moteById(torn, id);
      return mote === null ? [] : [mote];
    });
    assertEqual(
      named.length,
      2,
      "both named motes are still reported on the field",
    );
    const first = named[0] as MoteView;
    const second = named[1] as MoteView;
    assertNear(
      Math.hypot(first.x - second.x, first.y - second.y),
      HEX_PITCH,
      ON_POINT,
      "the two named motes rest one hex apart, which is HEX_PITCH (48)",
    );

    const marked = lowest(named);
    const other = named.find((mote) => mote.id !== marked?.id) ?? null;
    assertNotNull(marked, "one of the named motes is lowest in y");
    assertNotNull(other, "and the other is the one it is read against");
    assertEqual(
      marked?.id,
      moteById(torn, lower ?? -1)?.id,
      "the mote on the row above is the one lowest in y, by hexY's own formula",
    );

    const measured = await churn([{ x: marked?.x ?? 0, y: marked?.y ?? 0 }]);
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
    "the fault effect is played at the position of the named mote lowest in y, " +
      "so the picture there changes across the frames after the fault",
  );
});

// simulation/a-constellation-moves-as-one-body — a carried constellation is
// rigid: every mote of it follows the one motion together.
//
// THE RULE. "A carried constellation moves as one rigid body: every mote of it
// follows the motion, and at `t = 1` every mote lands exactly on a hex center"
// (`specs/simulation.md`, Motion and carrying). `specs/field.md` says the same of
// the shape: "Constellations are rigid: when any mote of one is carried, the whole
// group moves as a body and every filament keeps its length and relative
// direction."
//
// THE MOTION IMPOSED. The gripper here holds under `rotate-cw`, whose row of the
// motion table reads "The part's direction turns 60 degrees about its base,
// clockwise or counterclockwise, sweeping `60 * t` degrees | The same rotation
// about the base." So the body's imposed motion is a rotation about the arm's base
// hex, and `specs/field.md` fixes what one step of it does to a hex: "Clockwise:
// `(q, r) -> (-r, q + r)`", applied to the offset from the center of rotation.
//
// THE CONFIGURATION. An arm on `(0, 0)` at rotation `0`, length `1`, so its
// gripper is `(1, 0)` ("one gripper per spoke at `base + length * DIRS[d]`",
// `specs/parts.md`). A constellation of FOUR motes rests under and beyond it —
// `(1, 0)`, `(2, 0)`, `(3, 0)` and `(2, -1)` — joined by three filaments into one
// maximal group ("A constellation is a maximal group of motes connected by
// filaments", `specs/field.md`), with a branch so the shape is not a line and a
// build that carried only the chain it walked would be caught. Only the mote under
// the gripper is held; the other three follow because the body does.
//
// The four motes and their images under the sweep are the whole of the field, and
// a rigid rotation preserves every distance among them: the nearest pair stands
// `HEX_PITCH` (`48`) apart at every sample, outside the `38` the collision rule
// watches, so nothing faults and the reading is about the body alone.
//
// THE MIDPOINT READING IS THE RIGIDITY ITSELF. At `sim.fraction` `t` each mote is
// drawn where the whole-body rotation puts it: its cycle-start point turned
// `60 * t` degrees clockwise about the stage point of `(0, 0)`, which
// `specs/field.md` places at `(FIELD_CX, FIELD_CY)`. Every mote is measured
// against that one motion, so a build that carried the held mote and dragged the
// rest along some other path fails here rather than at the boundary.
//
// THE VERDICT AT THE BOUNDARY. Each mote is on the hex the clockwise step sends it
// to; all three filaments still join the same pairs at the same weight; and each
// filament's two ends still stand one hex apart in the direction the whole body
// turned that filament to — the same length and the same relative direction.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import {
  FIELD_CX,
  FIELD_CY,
  FRACTION_TOLERANCE,
  HEX_PITCH,
} from "../constants";
import { at, hexCenter, rotate, rotateAbout, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  filamentBetween,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of a hex step. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

/** The arm's base, which `rotate-cw` turns the held body about. */
const BASE: Hex = at(0, 0);

/** The four motes of the body, in the order they are spawned. */
const SHAPE: readonly Hex[] = [at(1, 0), at(2, 0), at(3, 0), at(2, -1)];

/** The three filaments, by index into {@link SHAPE}: a chain with one branch. */
const LINKS = [
  { a: 0, b: 1 },
  { a: 1, b: 2 },
  { a: 1, b: 3 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries every mote and every filament of a four-mote body through one sweep", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", BASE.q, BASE.r, 0, 1, ["rotate-cw"])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const ids = await spawnConstellation(
    h,
    SHAPE.map((hex) => ({ hex, type: "dust" as const })),
    [...LINKS],
  );
  await takeGrip(h, arm, 0, ids[0] ?? -1);

  const seen = await captureReplay(h, "rigid", async () => {
    await advanceFraction(h, 1 / 2);
    const midway = await h.snapshot();
    await advanceFraction(h, 1 / 2);
    return { midway, boundary: await h.snapshot() };
  });

  // Halfway: every mote is drawn where ONE rotation about the base puts it.
  const fraction = seen.midway.sim?.fraction ?? -1;
  assertNear(
    fraction,
    1 / 2,
    FRACTION_TOLERANCE,
    "the run is halfway through the sweeping cycle",
  );
  const turned = (Math.PI / 3) * fraction;
  for (const [index, hex] of SHAPE.entries()) {
    const start = hexCenter(hex);
    const dx = start.x - FIELD_CX;
    const dy = start.y - FIELD_CY;
    const drawn = moteById(seen.midway, ids[index] ?? -1);
    assertNotNull(drawn, `the run reports mote ${index} of the carried body`);
    assertNear(
      drawn?.x ?? Number.NaN,
      FIELD_CX + dx * Math.cos(turned) - dy * Math.sin(turned),
      DRAWN_TOLERANCE,
      `mote ${index} follows the body's own rotation of 60 * t degrees about the arm's base`,
    );
    assertNear(
      drawn?.y ?? Number.NaN,
      FIELD_CY + dx * Math.sin(turned) + dy * Math.cos(turned),
      DRAWN_TOLERANCE,
      `mote ${index} follows the body's own rotation of 60 * t degrees about the arm's base`,
    );
  }

  // The boundary: every mote on the hex one clockwise step sends it to.
  assertEqual(
    seen.boundary.sim?.status,
    "running",
    "a rigid rotation holds every distance in the body, so no pair comes within 38",
  );
  assertEqual(
    seen.boundary.sim?.cycle,
    1,
    "one cycle of game time completes the cycle it covered",
  );
  for (const [index, hex] of SHAPE.entries()) {
    const landed = rotateAbout(hex, BASE, 1);
    assertEqual(
      `${moteById(seen.boundary, ids[index] ?? -1)?.q},${moteById(seen.boundary, ids[index] ?? -1)?.r}`,
      `${landed.q},${landed.r}`,
      `mote ${index} of the body lands where the clockwise step about the base sends it`,
    );
  }

  // Every filament survives, joining the same pair at the same length and the
  // same direction relative to the body it was carried in.
  assertLength(
    seen.boundary.sim?.filaments ?? [],
    LINKS.length,
    "the carried body keeps its filaments: one per link, and no more",
  );
  for (const link of LINKS) {
    const a = ids[link.a] ?? -1;
    const b = ids[link.b] ?? -1;
    const joined = filamentBetween(seen.boundary, a, b);
    assertNotNull(
      joined,
      `the filament joining motes ${link.a} and ${link.b} still joins that pair`,
    );
    assertEqual(
      joined?.weight,
      1,
      `the filament joining motes ${link.a} and ${link.b} keeps the weight it carried`,
    );
    const from = SHAPE[link.a] as Hex;
    const to = SHAPE[link.b] as Hex;
    const step = rotate({ q: to.q - from.q, r: to.r - from.r }, 1);
    const seenA = moteById(seen.boundary, a);
    const seenB = moteById(seen.boundary, b);
    assertEqual(
      `${(seenB?.q ?? 0) - (seenA?.q ?? 0)},${(seenB?.r ?? 0) - (seenA?.r ?? 0)}`,
      `${step.q},${step.r}`,
      `the filament joining motes ${link.a} and ${link.b} keeps its length and its direction relative to the body`,
    );
  }
});

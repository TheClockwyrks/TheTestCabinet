// presentation/hud-charge — how the two charge readouts on the HUD are read.
//
// `specs/ui.md` — "The HUD": "Loaded | The charge the injector holds, drawn as
// that charge's core" and "Queued | The charge that loads on the next firing,
// drawn as that charge's core and placed so it is never mistaken for the loaded
// one". `specs/ui.md` — "Presentation" states the same rule once for every
// screen: "Wherever a screen names a charge it draws that charge's core, so the
// player reads which charge is meant without reading its name."
//
// SO THE READING IS: WHICH SPRITE. Not which file — `specs/assets.md` resolves
// every produced PNG through the bundler, which inlines a 28 x 28 core as a
// `data:` URI, so there is no path to match and a check that matched one would
// fail a build that did as it was told. A sprite's identity within one harness is
// what there is, and a charge's own sprite is named by POSING A CORE OF THAT
// CHARGE and taking the sprite the frame drew where the snapshot says that core
// stands. The identity holds for the life of a harness, so the sprite named on
// one frame is looked for on another.

import {
  CORE_RADIUS,
  INJECTOR,
  INJECTOR_RADIUS,
  SPRITE_CENTRE_TOL,
  type ChargeId,
} from "../constants";
import { assertEqual, assertNotNull } from "../assert";
import { distance, poseHall, type Harness, type ImageDraw } from "../harness";
import { coreDraws, spriteAt } from "./readouts";

/** The level whose charge set holds all five charges (`specs/progression.md`). */
export const ALL_CHARGES_LEVEL = 5;

/** The head of the posed block, in units from the inlet, on the straight top run. */
const BLOCK_HEAD_S = 400;

/** How many cores are posed. */
const BLOCK_SIZE = 3;

/**
 * How far from the injector's centre a core sprite is the HUD's rather than the
 * injector's own.
 *
 * `specs/ui.md` draws the live hall with "the injector at its fixed position with
 * the direction it is aimed readable and the core it holds", so the loaded
 * charge's sprite is drawn on the machine as well as on the HUD, and a reading
 * that took either would not be about the HUD at all. The injector is a base
 * "centered on `(420, 330)`" of radius 22 (`specs/injector.md`), and a core is a
 * disc of radius 14, so a core sprite whose centre is further than 36 units from
 * the injector's centre does not touch the machine. `specs/ui.md` has the HUD
 * "draw over the hall and hide none of them", so a conformant build's readout is
 * not on top of the injector.
 */
const OFF_THE_INJECTOR = INJECTOR_RADIUS + CORE_RADIUS;

/** Pose a block of `charge` cores with the injector holding neither of them. */
export async function poseBlockOf(
  h: Harness,
  charge: ChargeId,
  held: readonly [ChargeId, ChargeId],
): Promise<void> {
  await poseHall(h, {
    level: ALL_CHARGES_LEVEL,
    cores: Array.from(
      { length: BLOCK_SIZE },
      (_, index) => [BLOCK_HEAD_S - index * 120, charge, null] as const,
    ),
    loaded: held[0],
    queued: held[1],
  });
}

/**
 * The identity of `charge`'s produced core sprite, named by posing cores of it.
 *
 * Fails the point when no produced 28 x 28 sprite was drawn where the cores
 * stand: the HUD cannot draw a charge as its core when the build has no core
 * sprite to draw.
 */
export async function identifyCharge(
  h: Harness,
  charge: ChargeId,
  held: readonly [ChargeId, ChargeId],
): Promise<number> {
  await poseBlockOf(h, charge, held);
  const calls = await h.frameCalls();
  const drawn = coreDraws(calls);
  const posed = await h.snapshot();
  assertEqual(posed.train.length, BLOCK_SIZE, `the ${charge} cores posed`);
  const id = spriteAt(
    drawn,
    { x: posed.train[0].x, y: posed.train[0].y },
    SPRITE_CENTRE_TOL,
  );
  assertNotNull(id, `a produced 28 x 28 sprite drawn at a ${charge} core`);
  return id as number;
}

/** Every draw of `id` that is neither on a posed core nor on the injector. */
export function readoutDraws(
  draws: readonly ImageDraw[],
  id: number,
  cores: readonly { x: number; y: number }[],
): ImageDraw[] {
  return draws.filter((draw) => {
    if (draw.image.id !== id) return false;
    const at = { x: draw.cx, y: draw.cy };
    if (distance(at, INJECTOR) <= OFF_THE_INJECTOR) return false;
    return !cores.some((core) => distance(at, core) <= SPRITE_CENTRE_TOL);
  });
}

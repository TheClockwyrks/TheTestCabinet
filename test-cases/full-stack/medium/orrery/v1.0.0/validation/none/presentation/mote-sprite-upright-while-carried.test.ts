// presentation/mote-sprite-upright-while-carried — a carried mote is translated
// along its path, never turned with the arm that carries it.
//
// THE RULE. The Motes row of `specs/assets.md` (The sprites) draws the sprite
// "centered on every mote's position, at rest and while carried, upright at every
// moment of a cycle". A `rotate-cw` turns "the same rotation about the base" onto
// each held constellation (`specs/simulation.md`, Motion and carrying), so a build
// that rotates its context about the arm's base and draws the mote inside that
// transform has turned the picture as well as moved it — which is what "upright at
// every moment of a cycle" forbids.
//
// WHAT IT READS. The rotation in force at the draw, in degrees clockwise on the
// stage, at four moments spread across one cycle: `0.2`, `0.4`, `0.6` and `0.8`.
// None of them is a boundary, so a build that snaps the picture upright only where
// the sweep begins and ends is read mid-sweep, where the arm stands at `12`, `24`,
// `36` and `48` degrees of its `60`.
//
// THE CONFIGURATION. `BARE` opened as a bare run — the completion switch held
// off, an EMPTY FIELD — with one arm at `(0, 0)`, rotation `0`, length `1`, whose
// tape is a single `rotate-cw`, and one mote spawned back on `(1, 0)`, the arm's
// gripper hex. The hold is given with `setGrip`, "which takes hold with no `grab`
// ever running" (`specs/instrumentation.md`), so the only cycle that runs is the
// sweep, and nothing else is on the field.
//
// THE TOLERANCE is one degree, which at `MOTE_R` (`22`) from a sprite's centre
// moves its edge by less than half a logical unit — under the one screen pixel
// `specs/assets.md` (Scale) makes a logical unit at the reference fit.
//
// THE EVIDENCE is the carry itself, recorded across the four moments read.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, fail } from "../assert";
import { FRAMES_PER_CYCLE, MOTE_SPRITE_PATHS } from "../constants";
import { at, distance } from "../field";
import { BARE } from "../fixtures";
import { armPart, solution } from "../formats";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  imageDraws,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";
import { assetFile } from "../assets/files";
import { decodeSprite, sameAsDrawn, type Sprite } from "../assets/sprites";

/** One degree (see the header). */
const ANGLE_TOLERANCE = 1;

/** The hex the carried mote begins the cycle on, and the type it is. */
const START = at(1, 0);
const TYPE = "sol";

/** The four moments of the cycle the sprite is read at, none of them a boundary. */
const MOMENTS = [0.2, 0.4, 0.6, 0.8] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the carried mote's sprite upright at four moments of one cycle", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  const [arm] = await partIds(h);
  const mote = await spawnMote(h, START, TYPE);
  await takeGrip(h, arm, 0, mote);

  const file = assetFile(MOTE_SPRITE_PATHS[TYPE]);
  const read = await decodeSprite(file);
  if (read.sprite === null) fail(`a decoded ${file}`, read.reason);
  const sprite: Sprite = read.sprite;

  /** The angle the frame turned the mote's sprite to, or `null` where it drew none. */
  const angleOfMote = async (): Promise<number | null> => {
    const snapshot = await h.snapshot();
    const carried = moteById(snapshot, mote);
    if (carried === null) return null;
    let best: { angle: number; away: number } | null = null;
    for (const draw of imageDraws(await h.lastCalls())) {
      const drawn = await h.imagePixels(draw.image.id);
      if (drawn === null || !sameAsDrawn(sprite, drawn)) continue;
      const away = distance(
        { x: draw.cx, y: draw.cy },
        { x: carried.x, y: carried.y },
      );
      if (best === null || away < best.away) best = { angle: draw.angle, away };
    }
    return best === null ? null : best.angle;
  };

  const seen = await captureReplay(h, "upright", async () => {
    const angles: (number | null)[] = [];
    let reached = 0;
    for (const moment of MOMENTS) {
      await advanceFraction(
        h,
        moment - reached,
        Math.max(1, Math.round((moment - reached) * FRAMES_PER_CYCLE)),
      );
      reached = moment;
      angles.push(await angleOfMote());
    }
    return angles;
  });

  for (const [index, angle] of seen.entries()) {
    if (angle === null) {
      fail(
        `an image draw of ${file} in the frame at fraction ${MOMENTS[index]}`,
        "no such draw",
      );
    }
    assertAngleNear(
      angle,
      0,
      ANGLE_TOLERANCE,
      `the degrees the mote's sprite was turned to at fraction ${MOMENTS[index]} of the cycle`,
    );
  }
});

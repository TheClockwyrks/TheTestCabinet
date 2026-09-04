// presentation/filament-strip-follows-its-carried-motes — half way through a
// carry the strip is between the motes where they are now.
//
// THE RULE. The Filaments row of `specs/assets.md` (The sprites) draws the strip
// "centered on the midpoint between the two motes' centers and turned to the angle
// from the first to the second", and the paragraph under the table makes it a
// statement about every moment: "A filament joins motes on adjacent hexes and a
// constellation is rigid, so the strip spans exactly `HEX_PITCH` (`48`) at every
// moment and is drawn at native size." `specs/field.md` says why the span holds
// through a carry: "Constellations are rigid: when any mote of one is carried, the
// whole group moves as a body and every filament keeps its length and relative
// direction." And `specs/editor.md` puts it on the field each frame: "The machine,
// the motes, and the arms' live poses are drawn on the field as the run leaves them
// each frame, motion interpolated smoothly along the same paths the collision rule
// samples."
//
// WHERE THE MOTES ARE READ FROM. `specs/instrumentation.md` reports each mote's
// "drawn position at the current fraction, in stage units" as `x` and `y`, so the
// midpoint the strip belongs on is the midpoint between those two readings — not
// the midpoint of the hexes the pair began the cycle on.
//
// THE CONFIGURATION. `BARE` opened as a bare run — the completion switch held off,
// an EMPTY FIELD — with one arm at `(0, 0)`, rotation `0`, length `1`, whose tape is
// a single `rotate-cw`, and a two-mote constellation spawned back on `(1, 0)` and
// `(2, 0)` joined by one filament. The gripper hex of a length `1` arm at rotation
// `0` is `(1, 0)` ("one gripper per spoke at `base + length * DIRS[d]`",
// `specs/parts.md`), and the hold is given with `setGrip`, "which takes hold with no
// `grab` ever running", so the only cycle that runs is the sweep. The two motes
// stay `HEX_PITCH` apart throughout, so nothing comes within `2 * MOTE_COLLIDE_R`
// (`38`) and no collision interrupts the carry.
//
// THE VERDICT is read at `sim.fraction` `0.5`. The check first reads back that the
// pair has genuinely left the midpoint it began on, so what follows is a comparison
// against a midpoint that moved.
//
// THE TOLERANCES are one logical unit, which `specs/assets.md` (Scale) makes one
// screen pixel at the reference `1280`-pixel fit, and one degree over the `48`
// units the strip spans.
//
// THE EVIDENCE is the frame half way through the carry, written before the
// assertions.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertAngleNear,
  assertGreaterThan,
  assertNear,
  fail,
} from "../assert";
import { FRACTION_TOLERANCE, FRAMES_PER_CYCLE, HEX_PITCH } from "../constants";
import { at, distance, hexCenter } from "../field";
import { BARE } from "../fixtures";
import { armPart, solution } from "../formats";
import {
  advanceFraction,
  captureStill,
  createHarness,
  imageDraws,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  takeGrip,
  type Harness,
  type ImageDraw,
} from "../harness";
import { FILAMENT_SPRITES } from "../assets/files";
import { decodeProduced, sameAsDrawn } from "../assets/sprites";

/** One logical unit, and one degree (see the header). */
const PLACEMENT_TOLERANCE = 1;
const ANGLE_TOLERANCE = 1;

/** The two hexes the carried constellation begins the cycle on. */
const HELD = at(1, 0);
const TRAILING = at(2, 0);
const TYPE = "dust";

/** Where in the cycle the strip is read: half way, well clear of both ends. */
const AT_FRACTION = 0.5;

/** The destination rectangle's own two sides, read back through the turn it was drawn under. */
function spanOf(draw: ImageDraw): { along: number; across: number } {
  const radians = (draw.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    along: Math.abs(draw.dw * cos + draw.dh * sin),
    across: Math.abs(draw.dh * cos - draw.dw * sin),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the strip on the midpoint the two carried motes report at half a cycle", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  const [arm] = await partIds(h);
  const [held, trailing] = await spawnConstellation(
    h,
    [
      { hex: HELD, type: TYPE },
      { hex: TRAILING, type: TYPE },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );
  await takeGrip(h, arm, 0, held);

  await advanceFraction(h, AT_FRACTION, FRAMES_PER_CYCLE / 2);
  await captureStill(h, "strip-mid-sweep");

  const snapshot = await h.snapshot();
  assertNear(
    snapshot.sim?.fraction ?? -1,
    AT_FRACTION,
    FRACTION_TOLERANCE,
    "the fraction the cycle was read at",
  );
  const first = moteById(snapshot, held);
  const second = moteById(snapshot, trailing);
  if (first === null || second === null) {
    fail(
      "both motes of the carried constellation in sim.motes",
      "one is missing",
    );
  }

  const midpoint = {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
  const began = hexCenter(HELD);
  const trailedFrom = hexCenter(TRAILING);
  assertGreaterThan(
    distance(midpoint, {
      x: (began.x + trailedFrom.x) / 2,
      y: (began.y + trailedFrom.y) / 2,
    }),
    PLACEMENT_TOLERANCE,
    "how far the midpoint between the two reported positions has left the midpoint the pair began the cycle on",
  );
  assertNear(
    distance({ x: first.x, y: first.y }, { x: second.x, y: second.y }),
    HEX_PITCH,
    PLACEMENT_TOLERANCE,
    "how far apart the two carried motes report themselves, which a rigid constellation holds at HEX_PITCH (48)",
  );

  const readings = await decodeProduced(FILAMENT_SPRITES);
  const strips = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(`a decoded ${FILAMENT_SPRITES[index].label}`, read.reason);
    }
    return read.sprite;
  });

  const calls = await h.lastCalls();
  let painted: ImageDraw | null = null;
  let away = Number.POSITIVE_INFINITY;
  for (const draw of imageDraws(calls)) {
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    if (!strips.some((sprite) => sameAsDrawn(sprite, pixels))) continue;
    const off = distance({ x: draw.cx, y: draw.cy }, midpoint);
    if (off < away) {
      painted = draw;
      away = off;
    }
  }
  if (painted === null) {
    fail(
      "an image draw of a produced filament strip somewhere in the frame",
      "the frame drew neither strip",
    );
  }

  assertNear(
    painted.cx,
    midpoint.x,
    PLACEMENT_TOLERANCE,
    "the stage x the strip is centred on, against the midpoint between the two reported positions",
  );
  assertNear(
    painted.cy,
    midpoint.y,
    PLACEMENT_TOLERANCE,
    "the stage y the strip is centred on, against the midpoint between the two reported positions",
  );
  assertNear(
    spanOf(painted).along,
    HEX_PITCH,
    PLACEMENT_TOLERANCE,
    "the logical units the strip was drawn across along its length, which is HEX_PITCH (48) at every moment",
  );

  const bearing =
    (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI;
  assertAngleNear(
    painted.angle * 2,
    bearing * 2,
    ANGLE_TOLERANCE * 2,
    "twice the degrees the strip was turned to, against twice the bearing between the two reported positions",
  );
});

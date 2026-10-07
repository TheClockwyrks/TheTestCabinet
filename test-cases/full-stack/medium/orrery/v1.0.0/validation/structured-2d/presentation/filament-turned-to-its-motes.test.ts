// presentation/filament-turned-to-its-motes — a strip lies along the pair it joins,
// on every one of the six directions.
//
// THE RULE. The Filaments row of `specs/assets.md` (The sprites) draws the strip
// "centered on the midpoint between the two motes' centers and turned to the angle
// from the first to the second". A filament joins motes on adjacent hexes
// (`specs/field.md`), and `DIRS` "holds the six neighbor offsets, indexed `0` to
// `5`, in clockwise order on the stage starting from east", so there are six angles
// a strip has to be turned to and only one of them is horizontal.
// `specs/field.md`'s Presentation asks for the visible consequence: "A filament
// visibly joins the centers of the two motes it links."
//
// WHAT IT READS. The rotation in force at each strip's draw, against the bearing
// from the first hex centre to the second. The comparison is made MODULO half a
// turn, by doubling both angles before comparing them: a strip turned by the
// bearing and a strip turned by the bearing plus `180` lie along the same line
// between the same two motes, and no sentence of `specs/` fixes which end of a
// filament is "the first" once a build has stored it. What the reading decides is
// what the rule is for — that the strip lies along the direction it spans rather
// than always horizontally.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the
// completion switch held off, a live run, an EMPTY FIELD — with six pairs of motes
// spawned back, one pair per entry of `DIRS`, each pair joined by one filament of
// weight `1`. The pairs sit around the field far enough apart that no strip is
// within half a hex pitch of another pair's midpoint, so the draw read for each
// direction is that filament's own.
//
// THE TOLERANCE is one degree, which over the `48` units a strip spans moves an end
// by less than one logical unit — the screen pixel `specs/assets.md` (Scale) makes a
// logical unit at the reference fit.
//
// THE EVIDENCE is the frame holding all six, written before the assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertLessThanOrEqual, fail } from "../assert";
import { DIRS, HEX_PITCH } from "../constants";
import { at, distance, hexCenter, neighbor, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  imageDraws,
  openBareRun,
  spawnConstellation,
  type Harness,
} from "../harness";
import { FILAMENT_SPRITES } from "../assets/files";
import { decodeProduced, sameAsDrawn } from "../assets/sprites";

/** One degree (see the header). */
const ANGLE_TOLERANCE = 1;

/**
 * One anchor per entry of `DIRS`, each pair being that anchor and its neighbour in
 * that direction.
 *
 * Every hex named, the neighbours included, is on the field —
 * `max(|q|, |r|, |q + r|) <= FIELD_R` (`5`), `specs/field.md` — and no two pairs
 * are near enough for one pair's strip to be the nearest draw to another's
 * midpoint.
 */
const ANCHORS: readonly Hex[] = [
  at(-4, -1),
  at(0, -4),
  at(4, -4),
  at(4, 0),
  at(0, 4),
  at(-4, 4),
];

/** The type of mote every pair is made of; a filament joins motes of any type. */
const TYPE = "dust";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns each of the six filaments to the direction it spans", async () => {
  await openBareRun(h, { challenge: BARE });
  for (const [d, anchor] of ANCHORS.entries()) {
    await spawnConstellation(
      h,
      [
        { hex: anchor, type: TYPE },
        { hex: neighbor(anchor, d), type: TYPE },
      ],
      [{ a: 0, b: 1, weight: 1 }],
    );
  }

  const calls = await h.frameCalls();
  await captureStill(h, "angles");

  const readings = await decodeProduced(FILAMENT_SPRITES);
  const strips = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(`a decoded ${FILAMENT_SPRITES[index].label}`, read.reason);
    }
    return read.sprite;
  });

  // The strips the frame drew, each with where it landed: read once, then matched
  // to the six midpoints below.
  const drawn: { x: number; y: number; angle: number }[] = [];
  for (const draw of imageDraws(calls)) {
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    if (!strips.some((sprite) => sameAsDrawn(sprite, pixels))) continue;
    drawn.push({ x: draw.cx, y: draw.cy, angle: draw.angle });
  }

  for (const [d, anchor] of ANCHORS.entries()) {
    const first = hexCenter(anchor);
    const second = hexCenter(neighbor(anchor, d));
    const midpoint = {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
    const offset = DIRS[d];
    const bearing =
      (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI;

    let nearest: { away: number; angle: number } | null = null;
    for (const strip of drawn) {
      const away = distance({ x: strip.x, y: strip.y }, midpoint);
      if (nearest === null || away < nearest.away) {
        nearest = { away, angle: strip.angle };
      }
    }
    if (nearest === null) {
      fail(
        "an image draw of a produced filament strip somewhere in the frame",
        "the frame drew neither strip",
      );
    }
    assertLessThanOrEqual(
      nearest.away,
      HEX_PITCH / 2,
      `DIRS[${d}] = (${offset[0]}, ${offset[1]}): how far the nearest strip landed from that filament's midpoint, so the reading below is that filament's own strip`,
    );

    // Doubled, so a strip turned to the bearing and one turned to the bearing plus
    // half a turn are the same line between the same two motes.
    assertAngleNear(
      nearest.angle * 2,
      bearing * 2,
      ANGLE_TOLERANCE * 2,
      `DIRS[${d}] = (${offset[0]}, ${offset[1]}): twice the degrees that filament's strip was turned to, against twice the bearing from the first hex centre to the second`,
    );
  }
});

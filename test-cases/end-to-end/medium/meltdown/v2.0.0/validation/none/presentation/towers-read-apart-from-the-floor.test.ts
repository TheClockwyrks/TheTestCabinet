// presentation/towers-read-apart-from-the-floor — a tower is drawn on the
// footprint it stands on, whatever it is and however hot it is running.
//
// THE RULE. `specs/overview.md`'s legibility table: "Towers against the floor — A
// tower reads apart from the floor behind it." `specs/towers.md` fixes the roster
// it is asked of — six emitters and the two movers — and `specs/heat.md` the range
// an emitter's heat runs over, `0` to `TRIP_HEAT`. So the item is the whole
// roster, read on its own footprint, at heats spread across that range.
//
// WHY THE READING IS A REMOVAL AND NOT A COMPARISON. `specs/overview.md` hands
// the palette to the build — "The palette, the type, the glow, and every other
// aspect of the look are yours" — so how far a tower's colour sits from a floor
// colour is the reviewer's to judge and not a figure any check may invent. What a
// check can decide is whether the build drew a tower there at all, and
// `specs/instrumentation.md` gives it the operation that answers that: the body
// is read with the tower standing and again after `removeTower` has taken it
// away, and the tower is what disappeared. Every other thing the build drew on
// that patch — its floor art, its plate texture, its grid — is identical in the
// two frames and cancels exactly.
//
// HOW MUCH MOVEMENT COUNTS. Measured rather than assumed. The same points are
// read on two frames with the tower standing, which is how far the picture moves
// on its own under a build that animates its glow, and the removal has to beat
// that by `NOISE_MARGIN`.
//
// WHERE THE READING IS TAKEN. The body ring of `read.ts`, well inside the
// footprint: `specs/instrumentation.md` says removing a tower reopens its tiles
// and repaths, so a build that tints a build zone or draws a route overlay moves
// pixels at the footprint's EDGE for reasons other than the tower, and the ring
// sits a long way inside it.
//
// WHY THE EMITTERS ARE PINNED. `posePinnedTower` holds each emitter's part in the
// heat model (`specs/instrumentation.md`), so the heat this check posed is the heat
// the frame drew. Air cooling is proportional to heat (`specs/heat.md`) and
// maximal near the trip, so an unpinned tower posed at 99 would be drawn at
// something lower, and the check would be reading a heat it did not choose. The
// two movers carry no heat of their own and report `0` for it forever
// (`specs/heat.md`), so their reading does not move with the pass.
//
// WHY THE WHOLE ROSTER STANDS AT ONCE. Eight towers, each at least three tiles
// clear of the next, so no two share an edge-tile. `specs/heat.md` gives
// conduction only across a SHARED edge-tile, so a spread of eight is eight
// isolated towers rather than a thermal arrangement — and posing them together is
// what lets one pass answer for the roster instead of eight.
//
// WHAT IT DOES NOT DECIDE. That the drawing MOVES with the heat is
// `presentation/heat-glow-ramp`'s item, and a tripped tower is
// `presentation/tripped-reads-apart`'s. Here every reading is one tower against
// the same patch with that tower gone.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  EMITTER_TYPES,
  isEmitterType,
  TOWER_TYPES,
  TRIP_HEAT,
} from "../constants";
import type { TowerType } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import {
  NOISE_MARGIN,
  bodyPoints,
  readPixels,
  widestGap,
  type Point,
} from "./read";

/** The heats each emitter is read at, spread across `specs/heat.md`'s range. */
const HEATS: readonly number[] = [0, 25, 50, 75, TRIP_HEAT - 1];

/** Which pass leaves the picture behind: the middle of the ramp. */
const CAPTURE_AT = HEATS[2];

/**
 * Where each type stands, at least three tiles clear of every other, clear of
 * the casing and clear of both vent-to-exhaust corridors.
 */
const STANDS: Record<TowerType, { col: number; row: number }> = {
  arc: { col: 4, row: 4 },
  stutter: { col: 10, row: 4 },
  rime: { col: 16, row: 4 },
  flak: { col: 22, row: 4 },
  bloom: { col: 30, row: 4 },
  lance: { col: 38, row: 4 },
  forge: { col: 4, row: 12 },
  sink: { col: 10, row: 12 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Stand the whole roster up at one heat, and hand back each type's id. */
async function poseRoster(heat: number): Promise<Map<TowerType, number>> {
  const ids = new Map<TowerType, number>();
  for (const type of TOWER_TYPES) {
    const { col, row } = STANDS[type];
    ids.set(
      type,
      isEmitterType(type)
        ? await posePinnedTower(h, type, col, row, heat)
        : await poseTower(h, type, col, row),
    );
  }
  for (const type of EMITTER_TYPES) {
    await h.debug.setTowerHeat(ids.get(type) as number, heat);
  }
  return ids;
}

it("draws every tower on its footprint at every heat", async () => {
  await startRun(h);

  for (const heat of HEATS) {
    await h.debug.clearTowers();
    const ids = await poseRoster(heat);
    await h.advance(1);

    const snapshot = await h.snapshot();
    const rings = new Map<TowerType, Point[]>();
    const points: Point[] = [];
    for (const type of TOWER_TYPES) {
      const tower = requireTower(
        snapshot,
        ids.get(type) as number,
        `the ${type} at heat ${heat}`,
      );
      const ring = bodyPoints(tower);
      rings.set(type, ring);
      points.push(...ring);
    }

    const first = await readPixels(h, points);
    await h.advance(1);
    const second = await readPixels(h, points);
    if (heat === CAPTURE_AT) await captureStill(h, "towers");

    await h.debug.clearTowers();
    await h.advance(1);
    const cleared = await readPixels(h, points);

    let at = 0;
    for (const type of TOWER_TYPES) {
      const ring = rings.get(type) as Point[];
      const from = at;
      at += ring.length;
      const noise = widestGap(
        first.slice(from, at),
        second.slice(from, at),
      ).distance;
      const gone = widestGap(second.slice(from, at), cleared.slice(from, at));

      assertGreaterThanOrEqual(
        gone.distance,
        noise + NOISE_MARGIN,
        `the ${type} at heat ${heat}, on tile ` +
          `(${STANDS[type].col}, ${STANDS[type].row}): its body ring changes ` +
          `when the tower is taken away, by more than the ${noise} two frames ` +
          `with it standing moved on their own (specs/overview.md: a tower ` +
          `reads apart from the floor behind it)`,
      );
    }
  }
});

// Automated validation for the Placement sub-item `range-gate`.
//
// A tower reaches only matter within its range: "A tower's range is a radius in logical
// pixels measured from its placed position. A unit is targetable while the point it occupies
// on its path lies within that radius" (specs/board.md). The check builds one Emitter and
// poses two real units — one inside the radius and one plainly outside it — and running the
// real sim damages only the near one.
//
// The far unit's spot is FOUND, not assumed. A map's geometry is the build's own, and a
// conformant single path is often a serpentine that folds back on itself, so an arc length
// half way along it can pass within a stone's throw of a tower near its start — "half the
// path away" is not a synonym for "out of range". `farthestFrom` picks the arc length whose
// world point really is furthest from the tower, the item states the clearance it got, and
// it re-reads that distance at the end of the window so the pass rests on the far unit
// having been out of range throughout rather than on where it was posed.

import {
  startRun,
  pathGeom,
  placeCovering,
  farthestFrom,
  spawnAt,
  unitById,
  towerById,
  preconditionUnmet,
  MAP,
} from "../_helpers.mjs";

const WINDOW_TICKS = 72; // 72 ticks = the old 1.2 s
// How much conduit to leave between the far unit and its collector. The fastest atom moves
// at 112 px/s (specs/matter.md), so this is comfortably more than it can cover in the window
// — the far unit has to still be ON the path at the end of it, not leaked at the collector.
const LEAK_MARGIN_PX = 220;

export default function item() {
  let near;
  let far;
  let nearHp0;
  let farHp0;
  let towerId;
  let farDist0;
  let farDist1;
  let now;

  return {
    id: "placement.range-gate",

    async arrange(api) {
      const snap = await startRun(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.18;
      const t = await placeCovering(api, "emitter", g, s0);
      towerId = t.id;
      const tower = towerById(await api.snapshot(), t.id);

      // The point on this path that is furthest from the tower, short of the run-in to the
      // collector. It has to clear the radius by a real margin, since the far unit keeps
      // travelling during the window.
      const out = farthestFrom(g, tower, {
        to: g.length - LEAK_MARGIN_PX,
      });
      if (out.dist < tower.range * 1.8) {
        throw preconditionUnmet(
          `no point on the path is clear of the tower's range (furthest ${Math.round(
            out.dist,
          )}px vs range ${tower.range})`,
        );
      }

      near = await spawnAt(api, {
        type: "atom",
        electrons: 5,
        pathId: 0,
        s: s0,
      });
      far = await spawnAt(api, {
        type: "atom",
        electrons: 5,
        pathId: 0,
        s: out.s,
      });

      const snap0 = await api.snapshot();
      nearHp0 = unitById(snap0, near).hp;
      farHp0 = unitById(snap0, far).hp;
      farDist0 = Math.hypot(
        unitById(snap0, far).x - tower.x,
        unitById(snap0, far).y - tower.y,
      );
    },

    // The tower working on the near unit and plainly ignoring the far one.
    async act(api) {
      await api.advance(WINDOW_TICKS);
      now = await api.snapshot();
      const tw = towerById(now, towerId);
      const u = unitById(now, far);
      farDist1 = u ? Math.hypot(u.x - tw.x, u.y - tw.y) : Infinity;
    },

    async assert(api, check) {
      const tw = towerById(now, towerId);
      // Both reads are guarded: a unit that is gone reports as the failure it is, rather
      // than throwing and being reported as a broken debug API.
      const nearNow = unitById(now, near);
      const farNow = unitById(now, far);
      check.expectLt(
        "the in-range unit is fired on (hp drops)",
        nearNow ? nearNow.hp : nearHp0,
        nearHp0,
      );

      // The far unit was outside the radius for the whole window — the premise the next
      // assertion rests on, stated rather than assumed.
      check.expectGt(
        "the far unit starts outside the tower's range (px vs radius)",
        farDist0,
        tw.range,
      );
      check.expectGt(
        "...and is still outside it at the end of the window",
        farDist1,
        tw.range,
      );
      check.expectEq(
        "the out-of-range unit is untouched (hp unchanged)",
        farNow ? farNow.hp : -1,
        farHp0,
      );
    },
  };
}

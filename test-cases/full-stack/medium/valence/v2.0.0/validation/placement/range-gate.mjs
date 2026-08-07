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
  startScenario,
  pathGeom,
  placeCovering,
  farthestFrom,
  spawnAt,
  unitById,
  towerById,
  preconditionUnmet,
  LEAD_TICKS,
  TAIL_TICKS,
  TICK,
  MAP,
} from "../_helpers.mjs";

// The contrast is the evidence here, and a contrast needs long enough to read: one unit
// visibly taking hit after hit while the other, on screen the whole time, is never touched.
// At the old 1.2 s the clip was over before the Emitter's second shot (it reloads at
// 1.8/s), so what a reviewer saw was one shot and a cut.
const WINDOW_TICKS = 180; // 3 s of the tower working on one unit and ignoring the other

// Both posed atoms carry SIX electrons, the most an atom can (specs/matter.md), for two
// separate reasons. Six is the slowest atom (44 px/s against a 1-electron atom's 112), so
// the far one stays where it was posed for the whole of a now much longer window rather
// than walking to its collector; and six shells is six Emitter hits at 1 damage each, so
// the near one is still alive at the end to be read.
const ATOM_ELECTRONS = 6;

// How much conduit to leave between the far unit and its collector. The far unit travels
// for the whole framed span — the lead-in, the window, and the tail — and has to still be
// ON the path at the end of it rather than leaked at the collector. A 6-electron atom
// covers 44 px/s × (120 + 180 + 120)/60 s ≈ 308 px, so this leaves real headroom on top.
const LEAK_MARGIN_PX = 380;

export default function item() {
  let near;
  let far;
  let nearHp0;
  let farHp0;
  let towerId;
  let farDist0;
  let farDist1;
  let now;
  // The lowest hp the near unit was ever seen at during the window (0 if it was stripped
  // out of existence). A fresh value per pass, so it is set in `arrange`.
  let nearLow;

  return {
    id: "placement.range-gate",

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
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
        electrons: ATOM_ELECTRONS,
        pathId: 0,
        s: s0,
      });
      far = await spawnAt(api, {
        type: "atom",
        electrons: ATOM_ELECTRONS,
        pathId: 0,
        s: out.s,
      });

      const snap0 = await api.snapshot();
      nearHp0 = unitById(snap0, near).hp;
      farHp0 = unitById(snap0, far).hp;
      nearLow = nearHp0;
      farDist0 = Math.hypot(
        unitById(snap0, far).x - tower.x,
        unitById(snap0, far).y - tower.y,
      );
    },

    // The tower working on the near unit and plainly ignoring the far one.
    async act(api) {
      // The board as posed, before the tower's first shot lands: both units on screen, so
      // the reviewer knows which two the rest of the clip is about.
      await api.advance(LEAD_TICKS);

      // The window itself, swept rather than jumped, so the LOWEST hp the near unit ever
      // reaches is what the verdict reads. Reading only the snapshot at the end makes the
      // check fragile in one direction it should be strongest in: a tower that strips the
      // near unit all the way to zero has demonstrated the requirement about as forcefully
      // as it can be demonstrated, and the unit is then gone from `matter` — so an
      // end-of-window read finds nothing, falls back to the starting hp, and reports "the
      // in-range unit is fired on" as FAILED against a build that did exactly that.
      await api.until(
        (s) => {
          const u = unitById(s, near);
          if (u == null) nearLow = 0;
          else nearLow = Math.min(nearLow, u.hp);
          return false;
        },
        { max: WINDOW_TICKS, poll: TICK },
      );

      now = await api.snapshot();
      const tw = towerById(now, towerId);
      const u = unitById(now, far);
      farDist1 = u ? Math.hypot(u.x - tw.x, u.y - tw.y) : Infinity;

      // Hold on the outcome: the near unit spent, the far one still sailing past untouched.
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      const tw = towerById(now, towerId);
      // Both reads are guarded: a unit that is gone reports as the failure it is, rather
      // than throwing and being reported as a broken debug API.
      const farNow = unitById(now, far);
      check.expectLt(
        "the in-range unit is fired on (lowest hp seen)",
        nearLow,
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

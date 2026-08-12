// Automated validation for the Detection sub-item `catalyst`.
//
// A Catalyst's aura reveals inert matter in its field, after which a nearby damage tower
// can fire on it. The check places a Catalyst and an Emitter over the same point, poses
// an inert Noble UPSTREAM of the aura, and runs the real sim: the noble travels in
// unrevealed and untouched, the field reveals it, and the emitter then damages it.
//
// THE NOBLE STARTS OUTSIDE THE FIELD. Posed inside it, the reveal had already happened by
// the time the clip's first frame was drawn, so the recording opened on a revealed unit
// being shot and showed no detection at all — there was no undetected state for the
// revealed one to be a change from. It also made the check weaker than it looks: a build
// that simply reveals every inert unit on spawn, with no aura involved, satisfies "the unit
// is revealed" just as well as one whose Catalyst does the work. Walking the noble in from
// outside distinguishes them, and gives the clip its before.

import {
  startScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  towerById,
  preconditionUnmet,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

// How far outside the Catalyst's radius the noble is posed. A 6-electron atom is the
// slowest there is (44 px/s, specs/matter.md), so this is about two seconds of approach —
// enough to read "sealed, and nothing can touch it" before the field reaches it.
const APPROACH_PX = 90;
const MAX_REVEAL_TICKS = 300; // 5 s — generous for the walk-in plus the aura applying
const MAX_DAMAGE_TICKS = 180; // 3 s — comfortably longer than an Emitter's 1.8/s reload

export default function item() {
  let id;
  let posedRevealed;
  let revealed;
  let hpAtReveal;
  let damaged;

  return {
    id: "detection.catalyst",

    clipMs: clipBudget(
      LEAD_TICKS + MAX_REVEAL_TICKS + MAX_DAMAGE_TICKS + TAIL_TICKS,
    ),

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.3;
      const cat = await placeCovering(api, "catalyst", g, s0);
      await placeCovering(api, "emitter", g, s0);

      // Outside the aura by a real margin, read off the tower the build actually built
      // rather than off the number in the spec — a tier-I Catalyst is 120, but the range
      // this item needs to clear is whatever this tower reports.
      const catalyst = towerById(await api.snapshot(), cat.id);
      const startAt = s0 - (catalyst.range + APPROACH_PX);
      if (startAt < 0) {
        throw preconditionUnmet(
          `the lane has no room upstream of the Catalyst to pose an undetected approach ` +
            `(needs ${Math.round(catalyst.range + APPROACH_PX)}px before s=${Math.round(s0)})`,
        );
      }

      // Give the Noble a full six-electron shell. A default 1-electron Noble is
      // neutralised by the Emitter's very first shot, before the reveal can be read — the
      // read raced the kill and dereferenced a dead unit. Six shells also make it the
      // slowest atom, which is what makes the approach legible.
      id = await spawnAt(api, {
        type: "noble",
        electrons: 6,
        pathId: 0,
        s: startAt,
      });
      posedRevealed = unitById(await api.snapshot(), id).revealed;
    },

    // Sealed on the way in, revealed by the field, then shot — three states, each given
    // time on screen.
    async act(api) {
      // Travelling in, still sealed: the state the reveal is a change FROM.
      await api.advance(LEAD_TICKS);

      const seen = await api.until(
        (s) => {
          const u = unitById(s, id);
          return u == null || u.revealed === true;
        },
        { max: MAX_REVEAL_TICKS, poll: 3 },
      );
      const u = unitById(seen.snap, id);
      revealed = u != null && u.revealed === true;
      hpAtReveal = u ? u.hp : 0;

      // ...and now that it can be seen, a tower that could not touch it a moment ago can.
      damaged = await api.until(
        (s) => {
          const v = unitById(s, id);
          return v == null || v.hp < hpAtReveal;
        },
        { max: MAX_DAMAGE_TICKS, poll: 3 },
      );

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "the inert unit is sealed when it is released, outside the field",
        posedRevealed,
        false,
      );
      check.expectEq(
        "the Catalyst reveals it once it enters the field",
        revealed,
        true,
      );
      check.expectOk(
        "a nearby tower can now fire on the revealed inert unit",
        damaged.hit,
      );
    },
  };
}

// Automated validation for the Tower Art sub-item `projectiles-travel`.
//
// A shot is a visible projectile that travels across the board over time before it lands,
// rather than an instantaneous hitscan. The check fires a slow Cleaver shot, confirms the
// projectile carries a travel velocity, then advances a little and confirms it moved while
// still in flight.

import {
  startScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  towerById,
  firstInRange,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  TICK,
  MAP,
} from "../_helpers.mjs";

// How far upstream of the tower's reach the atom starts: about the distance a 6-electron
// atom (44 px/s) covers during the lead-in, so it arrives just as the lead-in ends.
const APPROACH_PX = 90;
const MAX_SHOT_TICKS = 120; // 2 s cap for the first shot to leave the muzzle
// The two-tick measurement below is exactly right for the READING — long enough for
// measurable travel, short enough that the shot has not landed — and exactly wrong as a
// clip. Two ticks is a thirtieth of a second, so the recording ended before the shot it had
// just measured got anywhere. Held for three seconds afterwards, the reviewer watches shots
// leave the muzzle, cross the gap and land, which is what "not a hitscan" looks like.
const FLIGHT_TICKS = 180;
// How long to follow one shot before giving up on seeing its damage land.
const MAX_FLIGHT_TICKS = 60;

export default function item() {
  let r;
  let p0;
  let before;
  let after;
  let moved;
  let impactTicks;

  return {
    id: "tower-art.projectiles-travel",

    clipMs: clipBudget(LEAD_TICKS + MAX_SHOT_TICKS + FLIGHT_TICKS + TAIL_TICKS),

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.2;
      const t = await placeCovering(api, "cleaver", g, s0);
      // Posed OUTSIDE the Cleaver's reach, so the lead-in below is spent walking in rather
      // than walking out. A Cleaver reaches only 88px and reloads every 50 ticks, so an atom
      // that spends the first two seconds of the clip inside the radius has left it before
      // the next shot is due — which is how this item came to report "no shot is fired"
      // against a build that fires perfectly well.
      const s = Math.max(
        0,
        firstInRange(g, towerById(await api.snapshot(), t.id)) - APPROACH_PX,
      );
      await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s });
    },

    // The shot leaving the tower and crossing the board — the behavior, and the clip.
    async act(api) {
      // The tower and its target standing, before the first shot.
      await api.advance(LEAD_TICKS);
      // The old poll of 0.02 s is 1.2 ticks, which the
      // contract refuses; it meant "sample as finely as possible", and a projectile can
      // be gone within a few ticks, so one TICK is the right resolution.
      r = await api.until((s) => s.projectiles.length > 0, {
        max: MAX_SHOT_TICKS,
        poll: TICK,
      });
      // A HITSCAN build — the very thing specs/towers.md forbids ("Hitscan does not satisfy
      // this") — never puts a projectile in the snapshot at all, so this is the expected
      // shape of a failing build and not a surprise. Reading `projectiles[0]` unguarded
      // threw out of `act`, which the runtime reports as a broken debug API rather than as a
      // failed requirement: the harshest signal there is, and pinned on the wrong thing.
      // Leaving the readings null lets the assertions below record the real failure.
      p0 = r.snap.projectiles[0] ?? null;
      if (p0 == null) {
        // Nothing to measure, but the clip still needs to show the tower doing whatever it
        // does instead — which for a hitscan build is the evidence.
        await api.advance(FLIGHT_TICKS);
        return;
      }

      before = { x: p0.x, y: p0.y };

      // WHAT "TRAVELS" IS MEASURED AS: the damage arriving on a LATER tick than the launch.
      //
      // specs/towers.md asks for a projectile that "travels to the unit and deals its damage
      // on impact, never before", and says "Hitscan does not satisfy this". It says nothing
      // about how FAST, and it must not: a build whose shot crosses a short gap in a tick or
      // two is travelling, it is just quick. Asserting the projectile is still in the air two
      // ticks later measures speed rather than travel, and failed a build whose shots carry a
      // real velocity of several hundred px/s over a gap they cross in one tick.
      //
      // So the shot is followed tick by tick: its movement is recorded if it is still there
      // to be seen, and the tick its damage lands on is recorded either way. A hitscan build
      // — damage on the launch tick, with no projectile at all — fails both.
      const targetId = p0.targetId;
      const hp0 = r.snap.matter.find((u) => u.id === targetId)?.hp ?? null;
      for (let i = 1; i <= MAX_FLIGHT_TICKS; i += 1) {
        await api.advance(TICK);
        const s = await api.snapshot();
        const live = s.projectiles.find((p) => p.id === p0.id) ?? null;
        if (live && after == null) {
          moved = Math.hypot(live.x - before.x, live.y - before.y);
          after = live;
        }
        const u = s.matter.find((m) => m.id === targetId);
        if (hp0 != null && (u == null || u.hp < hp0)) {
          impactTicks = i;
          break;
        }
      }

      // ...and then the shots actually crossing the board.
      await api.advance(FLIGHT_TICKS);
    },

    async assert(api, check) {
      check.expectOk("a shot is fired", r.hit);
      check.expectOk(
        "the shot exists as a projectile on the board (not a hitscan hit)",
        p0 != null,
      );
      check.expectGt(
        "the projectile has a travel velocity (not hitscan)",
        p0 ? Math.hypot(p0.vx, p0.vy) : 0,
        1,
      );
      check.expectGt(
        "its damage lands on a later tick than its launch (not hitscan)",
        impactTicks ?? 0,
        0,
      );
      // Only meaningful for a shot slow enough to be sighted twice; a faster one has already
      // proved it travels by landing a tick or more after it was fired.
      if (after != null) {
        check.expectGt(
          "...and it moved across the board between ticks",
          moved,
          0.5,
        );
      }
    },
  };
}

// Automated validation for the Instrumentation sub-item `scenario-round`.
//
// `startScenario` opens the board every other scripted scenario in this checklist runs
// on: a live round the wave system leaves empty and that does not end on its own
// (specs/instrumentation.md). This item exists so that a build without one fails HERE,
// by name, instead of surfacing as several dozen unrelated-looking failures scattered
// across matter, towers, damage, detection, the economy and the effects — every one of
// which would really be this same missing board. If this item fails, read the rest of
// the automated verdicts as untested rather than as answers.
//
// It checks the four things the other items lean on, in the order they lean on them:
//
//   1. it opens a LIVE round — `phase` is "round" on the "playing" screen — from the
//      build phase, without advancing the round number (`startRound` would advance it);
//   2. the wave system leaves it EMPTY, so the only matter on the board is what a
//      scenario poses and nothing else can touch a measurement;
//   3. it is a REAL round — a unit posed on it flows along its path and a tower in
//      range acquires and damages it, which is the whole reason to want the round phase;
//   4. it HOLDS — the board emptying does not clear the round back to the build phase,
//      so an item may kill, leak, and pose further matter inside one `act`.
//
// Nothing here is announced: the control ops arrange the board and time runs the real
// systems over it.

import {
  startRun,
  pathGeom,
  placeCovering,
  firstInRange,
  spawnAt,
  towerById,
  unitById,
  MAP,
  TICK,
} from "../_helpers.mjs";

// 300 ticks = 5 s. A round's wave opens on its first units at once (specs/matter.md), so
// five seconds of an empty board is emphatic about nothing having been sent.
const QUIET_TICKS = 300;
// 240 ticks = 4 s for the posed atom to cover ground under a firing tower.
const UNDER_FIRE_TICKS = 240;
// The ground the atom must cover for "it flows" to mean anything — comfortably more than
// a rounding wobble, comfortably less than the slowest matter's 4 s of travel.
const MOVED_PX = 20;
// 900 ticks = 15 s cap for the board to empty (the tower finishes the atom, or it runs on
// to the collector and leaks — either empties it).
const CLEAR_TICKS = 900;
// 180 ticks = 3 s of empty board AFTER it empties: long enough for a clear to have landed.
const HOLD_TICKS = 180;

export default function item() {
  let inBuild;
  let opened;
  let quiet;
  let born;
  let sawTarget;
  let sawDamage;
  let moved;
  let cleared;
  let held;

  return {
    id: "instrumentation.scenario-round",

    async arrange(api) {
      // The run opens where `selectMap` leaves it — the untimed opening build phase — and
      // the scenario round is opened from there, as the spec describes. The raw op is
      // called directly rather than through the `startScenario` helper: that helper throws
      // when no scenario round appears, which is what gives every OTHER item one legible
      // line, whereas this item is the one that has to state it as a verdict.
      inBuild = await startRun(api, MAP.single);
      await api.call("startScenario");
      opened = await api.snapshot();
    },

    async act(api) {
      // 2. Nothing is sent into it. A real round would have released its opening units
      //    well inside this window.
      await api.advance(QUIET_TICKS);
      quiet = await api.snapshot();

      // 3. It is a real round. Pose a tower and an atom at the upstream edge of its
      //    range, so the atom travels the whole in-range window under fire.
      const g = pathGeom(opened.paths[0]);
      const tower = await placeCovering(api, "emitter", g, g.length * 0.4);
      const towerId = tower.id;
      const s0 = firstInRange(g, towerById(await api.snapshot(), towerId));
      const unitId = await spawnAt(api, {
        type: "atom",
        electrons: 4,
        pathId: 0,
        s: s0,
      });
      born = unitById(await api.snapshot(), unitId);

      sawTarget = false;
      sawDamage = false;
      let furthest = born.progress;
      await api.until(
        (s) => {
          if (towerById(s, towerId)?.targetId === unitId) sawTarget = true;
          const u = unitById(s, unitId);
          if (u == null) {
            sawDamage = true; // stripped to nothing, or leaked away
            return true;
          }
          if (u.hp < born.hp) sawDamage = true;
          if (u.progress > furthest) furthest = u.progress;
          return sawTarget && sawDamage && furthest - born.progress > MOVED_PX;
        },
        { max: UNDER_FIRE_TICKS, poll: TICK },
      );
      moved = furthest - born.progress;

      // 4. It holds. Run the atom out — the tower finishes it, or it reaches the
      //    collector and leaks — and then keep stepping an empty board.
      cleared = await api.until((s) => s.matter.length === 0, {
        max: CLEAR_TICKS,
        poll: 6,
      });
      await api.advance(HOLD_TICKS);
      held = await api.snapshot();
    },

    async assert(api, check) {
      // 1. A live round, opened from the build phase, leaving the round number alone.
      check.expectEq(
        "a run opens on the build phase, as selectMap leaves it",
        inBuild.phase,
        "build",
      );
      check.expectEq("startScenario opens a live round", opened.phase, "round");
      check.expectEq("the run is in play", opened.screen, "playing");
      check.expectEq(
        "it does not advance the round number",
        opened.round,
        inBuild.round,
      );
      check.expectEq("the board opens empty", opened.matter.length, 0);

      // 2. The wave system sends nothing into it.
      check.expectEq(
        "no wave is sent into a scenario round",
        quiet.matter.length,
        0,
      );
      check.expectEq(
        "and an empty scenario round has not ended on its own",
        quiet.phase,
        "round",
      );

      // 3. The real systems run on it.
      check.expectGt(
        "a unit posed on it flows along its path (px)",
        moved,
        MOVED_PX,
      );
      check.expectOk("a tower in range acquires it", sawTarget);
      check.expectOk("and the real damage model runs on it", sawDamage);

      // 4. It survives the board emptying.
      check.expectOk("the board empties", cleared.hit);
      check.expectEq(
        "a scenario round does not clear when the board empties",
        held.phase,
        "round",
      );
      check.expectEq("the run is still in play", held.screen, "playing");
    },
  };
}

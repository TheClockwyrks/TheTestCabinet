// Automated validation for enemies.overload-dynamo: after the final wave an invincible Overload
// Dynamo walks the maze once — it takes no HP loss, costs no integrity, and grounding out wins
// the run.
//
// The post-final boss is released through the real spawner ("overload"); it must report as
// invincible, its HP must not fall as it walks, and grounding out at the Collector must win
// (Victory) rather than cost integrity.
//
// SOMETHING HAS TO BE SHOOTING AT IT. "It takes no HP loss" is a claim about a boss under fire,
// and the old script put nothing on the board at all — so the clip was a boss strolling an empty
// yard, which shows invincibility exactly as well as an empty yard shows anything, and the
// measurement was of a unit nothing was trying to hurt. A heavy Discharge Rig now stands on the
// corridor and works on the boss the whole way past, so the HP that does not move is HP that is
// being shot at.
//
// WHERE THE CLIP SITS. The boss's walk to the Collector is most of a minute. The old script
// filmed it from the release, so the recording ran out mid-yard and neither the ground-out nor
// the Victory screen — the two things the last assertions are about — was ever on screen. The
// crossing is skipped instead (instant in both passes, so the verdict is untouched), and the
// clip is the boss coming down on the Collector under fire, grounding out, and the run being won.

import {
  startBuild,
  placeCandidate,
  spawnControlled,
  skipClearWave,
  skipUntilNearCollector,
  unitById,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

const WIN_TICKS = 30 * SECOND;
// A beat on the Victory screen so it is readable in the clip.
const TAIL_TICKS = 2 * SECOND;

export default function item() {
  // The boss as released, the integrity before the walk, and what the walk produced.
  let d;
  let i0;
  let hp0;
  let hpDropped = false;
  let arrived;
  let grounded;
  let s;

  // Watch the boss's HP. Used as a sweep predicate, which evaluates exactly once per sample.
  const watch = (st) => {
    const l = unitById(st, d.id);
    if (l && l.hp < hp0) hpDropped = true;
    return st.screen === "victory" || !unitById(st, d.id);
  };

  return {
    id: "enemies.overload-dynamo",

    async arrange(api) {
      await startBuild(api, { difficulty: "easy" });
      await api.call("setIntegrity", 999);

      // A heavy gun on the corridor, so the boss walks past something actively shooting it.
      const gun = await placeCandidate(api, "discharge", 3, 12, 7);
      await api.call("keep", gun.id); // Wave 1
      await skipClearWave(api); // reopen the build phase, instantly, filming nothing
      await api.call("setIntegrity", 20);
      i0 = (await snap(api)).integrity;

      [d] = await spawnControlled(api, "overload");
      hp0 = d.hp;

      // Walk it past the gun and across the chain, sampling its HP the whole way — the walk
      // past a firing tower is exactly where a build that forgets `invincible` would show it.
      //
      // This used to sweep on distance to the Collector alone, which stopped the boss a whole lap
      // early: the Substation's WP1->WP2 leg runs down column 44 and clears the sink by 100 px, so
      // the sweep called it arrived while it still had four legs to walk. "It reached the
      // Collector" then passed, the act spent its budget waiting for a victory that was minutes
      // away, and the clip filmed the middle of the yard instead of the ground-out. The shared
      // helper gates on the final stretch as well as the distance, which is what this needed.
      arrived = await skipUntilNearCollector(api, d.id, {
        poll: 10,
        onSample: (st) => {
          const l = unitById(st, d.id);
          if (l && l.hp < hp0) hpDropped = true;
        },
      });
    },

    async act(api) {
      const r = await api.until(watch, { max: WIN_TICKS, poll: TICK });
      grounded = r.hit;
      s = await snap(api);

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("an Overload Dynamo was released", !!d);
      check.expectEq("it is invincible", d.invincible, true);
      check.expectOk("the Overload Dynamo walked the chain to the Collector", arrived.hit);
      check.expectOk("the Overload Dynamo took no HP loss (invincible)", !hpDropped);
      check.expectOk("grounding out won the run (Victory)", grounded && s.screen === "victory");
      check.expectGe("no Grid Integrity was spent on the invincible boss", s.integrity, i0);
    },
  };
}

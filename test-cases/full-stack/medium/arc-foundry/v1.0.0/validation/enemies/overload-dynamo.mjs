// Automated validation for enemies.overload-dynamo: after the final wave an invincible Overload
// Dynamo walks the maze once — it takes no HP loss, costs no integrity, and grounding out wins
// the run.
//
// The post-final boss is released through the real spawner ("overload"); it must report as
// invincible, its HP must not fall as it walks, and grounding out at the Collector must win
// (Victory) rather than cost integrity.
//
// Releasing the boss is a control op (the arrange). Its walk is both the behavior under test
// AND the thing worth watching, so it is the act — one implementation where the old script had
// two: a real-time clip of the boss looming down the maze, then the same walk re-run under
// instant stepping to decide the verdict.

import { startBuild, spawnControlled, unitById, snap, SECOND } from "../_helpers.mjs";

// 150 s of game time = 9000 ticks, polled every 0.5 s = 30 ticks. The poll stays coarse: HP is
// constant between hits (and here must never change at all), as is the screen.
const WALK_TICKS = 150 * SECOND;
const POLL_TICKS = 0.5 * SECOND;

export default function item() {
  // The boss as released, the integrity before the walk, and what the walk produced.
  let d;
  let i0;
  let hpDropped = false;
  let grounded;
  let s;

  return {
    id: "enemies.overload-dynamo",

    async arrange(api) {
      await startBuild(api, { difficulty: "easy" });
      await api.call("setIntegrity", 20);
      i0 = (await snap(api)).integrity;
      [d] = await spawnControlled(api, "overload");
    },

    async act(api) {
      const hp0 = d.hp;

      // It never loses HP as it is worn on; the run wins when it grounds out.
      const r = await api.until(
        (st) => {
          const l = unitById(st, d.id);
          if (l && l.hp < hp0) hpDropped = true;
          return st.screen === "victory" || !unitById(st, d.id);
        },
        { max: WALK_TICKS, poll: POLL_TICKS },
      );
      grounded = r.hit;
      s = await snap(api);
    },

    async assert(api, check) {
      check.expectOk("an Overload Dynamo was released", !!d);
      check.expectEq("it is invincible", d.invincible, true);
      check.expectOk("the Overload Dynamo took no HP loss (invincible)", !hpDropped);
      check.expectOk("grounding out won the run (Victory)", grounded && s.screen === "victory");
      check.expectGe("no Grid Integrity was spent on the invincible boss", s.integrity, i0);
    },
  };
}

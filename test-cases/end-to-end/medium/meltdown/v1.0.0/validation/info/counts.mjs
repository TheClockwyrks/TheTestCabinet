// Automated validation for the Info sub-item `counts`.
//
// A placed tower shows its lifetime kills and total damage dealt — runtime tallies
// that grow as it fights (specs/playfield.md). We drive a real Arc into a stream of
// Motes and read its kill and damage tallies climb.

import { newGame, build, spawn, tower, actTail } from "../_helpers.mjs";

export default function item() {
  let id;
  let r;
  let t;

  return {
    id: "info.counts",

    // The Motes walk in, the Arc kills one, and the inspector tallies are held. The
    // ceiling stops a build that routes them the long way round from stretching it.
    clipMs: 7000,

    // An Arc on the lane, hot enough to actually kill, with a stream of real Motes
    // walking into it.
    //
    // The Arc is SELECTED, because the tallies live in the selected-tower inspector
    // (`specs/ui.md`) and that is the only place they are drawn. Without the selection
    // the clip is a tower shooting Motes with the inspector area showing the
    // between-wave hint instead — the kill happens, the check passes on it, and the
    // counters this item is about are nowhere in its own evidence. `selectTower` is a
    // control op and consumes no time, so it belongs here with the rest of the pose.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      id = await build(api, "arc", 3, 20);
      await api.call("setHeat", id, 80); // real damage so it kills
      await api.call("selectTower", id); // so the clip shows the inspector's tallies
      for (let i = 0; i < 5; i += 1) await spawn(api, "mote", "left");
    },

    // Run the real combat until the tower's own tally records a kill. 720 ticks = the
    // old 12s cap, polled every 6 ticks (the old 0.1s chunk) — a tally only changes on
    // a kill, so a coarse sweep is enough. The sweep stops on the sample the first
    // kill lands, so the tail is what keeps the inspector on screen while the tallies
    // sit at their new values and the next Motes walk in.
    async act(api) {
      r = await api.until(
        (s) => s.towers.some((t2) => t2.id === id && t2.kills > 0),
        { max: 720, poll: 6 },
      );
      t = await tower(api, id);
      await actTail(api, 240); // 4 s on the climbing kill and damage tallies
    },

    async assert(api, check) {
      check.expectOk("the tower recorded a kill", r.hit);
      check.expectGt("its lifetime kill count is above zero", t.kills, 0);
      check.expectGt("its total damage dealt is above zero", t.damageDealt, 0);
    },
  };
}

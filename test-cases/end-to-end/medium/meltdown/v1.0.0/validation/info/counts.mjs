// Automated validation for the Info sub-item `counts`.
//
// A placed tower shows its lifetime kills and total damage dealt — runtime tallies
// that grow as it fights (specs/reactor.md). We drive a real Arc into a stream of
// Motes and read its kill and damage tallies climb.

import { newGame, build, spawn, tower } from "../_helpers.mjs";

export default function item() {
  let id;
  let r;
  let t;

  return {
    id: "info.counts",

    // An Arc on the lane, hot enough to actually kill, with a stream of real Motes
    // walking into it.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      id = await build(api, "arc", 3, 20);
      await api.call("setHeat", id, 80); // real damage so it kills
      for (let i = 0; i < 5; i += 1) await spawn(api, "mote", "left");
    },

    // Run the real combat until the tower's own tally records a kill. 720 ticks = the
    // old 12s cap, polled every 6 ticks (the old 0.1s chunk) — a tally only changes on
    // a kill, so a coarse sweep is enough.
    async act(api) {
      r = await api.until(
        (s) => s.towers.some((t2) => t2.id === id && t2.kills > 0),
        { max: 720, poll: 6 },
      );
      t = await tower(api, id);
    },

    async assert(api, check) {
      check.expectOk("the tower recorded a kill", r.hit);
      check.expectGt("its lifetime kill count is above zero", t.kills, 0);
      check.expectGt("its total damage dealt is above zero", t.damageDealt, 0);
    },
  };
}

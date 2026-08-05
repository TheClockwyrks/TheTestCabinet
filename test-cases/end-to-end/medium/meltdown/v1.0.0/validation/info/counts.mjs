// Automated validation for the Info sub-item `counts`.
//
// A placed tower shows its lifetime kills and total damage dealt — runtime tallies
// that grow as it fights (specs/playfield.md). We drive a real Arc into a stream of
// Motes and read its kill and damage tallies climb.

// The Arc stands at the gate rather than beside the lane a Mote is assumed to walk.
// This item needs KILLS, and a build is free to route its Motes off the rows they
// entered on without being wrong (see the note above `buildGate` in `_helpers`) — aimed
// at the assumed lane, the Arc never fires, nothing dies, and an inspector item reports
// tallies that never moved for an emitter that had nothing in range.

import {
  newGame,
  buildGate,
  spawn,
  tower,
  actTail,
  GATE_WALLS,
} from "../_helpers.mjs";

export default function item() {
  let id;
  let walls;
  let r;
  let t;

  return {
    id: "info.counts",

    // The Motes walk in, the Arc kills one, and the inspector tallies are held. The
    // ceiling stops a build that routes them the long way round from stretching it.
    clipMs: 7000,

    // An Arc at the gate, hot enough to actually kill, with a stream of real Motes
    // filing through the gap in front of it.
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
      const gate = await buildGate(api, "arc");
      id = gate.id;
      walls = gate.walls;
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
      // A hole in the gate lets the Motes walk round the Arc, and tallies stuck at zero
      // would then be about the scenery rather than about the counters.
      check.expectEq("the gate wall was built", walls, GATE_WALLS);
      check.expectOk("the tower recorded a kill", r.hit);
      check.expectGt("its lifetime kill count is above zero", t.kills, 0);
      check.expectGt("its total damage dealt is above zero", t.damageDealt, 0);
    },
  };
}

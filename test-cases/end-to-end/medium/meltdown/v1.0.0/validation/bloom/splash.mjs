// Automated validation for the Bloom sub-item `splash`.
//
// A Bloom shot damages every unit within its splash radius of the impact
// (specs/towers.md), so ONE shot hits several units at once. We place a Bloom by the
// lane, spawn a tight clump of real Motes, and confirm a single shot damages more
// than one of them.
//
// "More than one damaged unit" is not the same claim, and does not need splash to
// come true: a single-target emitter firing at 1.2 shots/s into a clump has damaged
// two Motes within a couple of seconds, one after the other. So the sweep watches for
// two units becoming damaged on the SAME tick — the simulation is a 60 Hz fixed step
// and this floor holds exactly one tower, so a pair of fresh casualties inside one
// step can only have come from one shot landing on both.

// The Bloom is set into a vent corridor. Two things follow from that, and this item
// needs both: the clump has to come into the Bloom's range at all — which an emitter
// parked beside an assumed lane cannot count on, since the spec fixes the vent and the
// exhaust but not the route between them (see the note above `buildVentCorridor` in
// `_helpers`) — and the corridor funnels the four Motes down the same two rows, so
// they arrive as the tight clump a splash claim needs rather than fanned across the
// opening's four rows, which are further apart than the splash radius.

import {
  newGame,
  buildVentCorridor,
  spawn,
  actTail,
  CORRIDOR_WALLS,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  let walls;
  let hit = false;
  let mostInOneTick = 0;

  return {
    id: "bloom.splash",

    // The clump walks into the Bloom's range almost immediately, so this is short by
    // nature; the ceiling only stops a badly-routed clump from stretching it.
    clipMs: 4000,

    // A Bloom beside the lane at moderate power, with a tight clump of real Motes
    // walking into its range.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const corridor = await buildVentCorridor(api, "bloom");
      walls = corridor.walls;
      await api.call("setHeat", corridor.id, 40); // moderate power: hits, but does not one-shot Motes
      for (let i = 0; i < 4; i += 1) await spawn(api, "mote", "left");
    },

    // Run the real firing/splash systems, stepping one tick at a time so each shot is
    // resolved in its own sample, until a tick lands damage on two units at once.
    // 300 ticks = the old 5s cap.
    async act(api) {
      const damagedIds = (s) =>
        new Set(s.surge.filter((u) => u.hp < u.maxHp).map((u) => u.id));
      let seen = damagedIds(await api.snapshot());

      const r = await api.until(
        (s) => {
          const now = damagedIds(s);
          let fresh = 0;
          for (const id of now) if (!seen.has(id)) fresh += 1;
          // Carry every id forward, so a unit that dies and leaves the floor is
          // never counted as freshly damaged again.
          for (const id of now) seen.add(id);
          if (fresh > mostInOneTick) mostInOneTick = fresh;
          return fresh >= 2;
        },
        { max: 300, poll: TICK },
      );
      hit = r.hit;
      // The sweep stops on the tick the splash lands, which is the tick before its
      // effect is legible: the two damaged Motes have had no frame to show their
      // reduced health bars yet, and the burst itself is still being drawn. Run on so
      // the clip carries the shot, the splash, and the pair it caught.
      await actTail(api);
    },

    async assert(api, check) {
      // A hole in the corridor lets the clump spread out or bypass the Bloom, and
      // "nothing was splashed" would then be about the scenery, not the splash.
      check.expectEq("the vent corridor was built", walls, CORRIDOR_WALLS);
      check.expectOk(
        "one Bloom shot damaged more than one unit in the clump",
        hit,
      );
      check.expectGe(
        "the most units damaged by a single shot",
        mostInOneTick,
        2,
      );
    },
  };
}

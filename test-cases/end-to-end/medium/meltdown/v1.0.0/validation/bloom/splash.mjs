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

import { newGame, build, spawn, TICK } from "../_helpers.mjs";

export default function item() {
  let hit = false;
  let mostInOneTick = 0;

  return {
    id: "bloom.splash",

    // A Bloom beside the lane at moderate power, with a tight clump of real Motes
    // walking into its range.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const bloom = await build(api, "bloom", 5, 20);
      await api.call("setHeat", bloom, 40); // moderate power: hits, but does not one-shot Motes
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
    },

    async assert(api, check) {
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

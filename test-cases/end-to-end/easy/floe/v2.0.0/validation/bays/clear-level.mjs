// Automated validation for the Bays item `clear-level`.
//
// Filling the last of the five bays clears the level: the level advances and the
// bays reset. Four bays are pre-filled and the fifth is filled by a real hop; the
// real level logic then advances the level, which the snapshot reads back after the
// between-levels pause. See validation/_helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // The level before the clearing hop, read instantly in `arrange` (by the time
  // `assert` runs it has already advanced), and the outcome `act` swept for.
  let startLevel;
  let r;

  return {
    id: "bays.clear-level",

    // Pose the last-bay-open board: four bays already filled, a stationary floe
    // below bay 4's column, and the critter standing on it. Only the fifth bay is
    // left, so the single hop `act` drives is the one that clears the level.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setBays", [true, true, true, true, false]);
      await api.call("setLane", WATER_TOP, { cols: [35], speed: 0 }); // floe below bay 4
      await api.call("placeCritter", 35, WATER_TOP);
      startLevel = (await api.snapshot()).level;
    },

    // The hop that fills the fifth bay and the real level logic that follows it —
    // which is exactly what the clip should show: the last bay filling and the level
    // turning over.
    async act(api) {
      await api.call("press", "ArrowUp"); // fill the fifth bay -> clear the level
      await api.advance(18); // 0.15 s, just past the hop cooldown, so the hop lands
      // The clear runs through a between-levels pause, so sweep for the new level
      // rather than reading one instant: 2.5 s at a 0.1 s cadence.
      r = await api.until((s) => s.level === 2, { max: 300, poll: 12 });
    },

    async assert(api, check) {
      check.expectEq("starting at level 1", startLevel, 1);
      check.expectOk("filling all five bays advances the level", r.hit);
      check.expectEq("the level is now 2", r.snap.level, 2);
      check.expectOk(
        "the bays reset for the new level",
        r.snap.bays.every((b) => b === false),
      );
    },
  };
}

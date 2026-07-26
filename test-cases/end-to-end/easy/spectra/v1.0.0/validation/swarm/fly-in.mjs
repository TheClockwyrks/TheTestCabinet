// Automated validation for the Swarm sub-item `fly-in`.
//
// Drones are absent at the start of a wave: they fly in along entrance paths (phase
// entering) and settle into the formation (phase formation). A real stage is
// started and the real entrance systems are advanced; the phases are read from
// snapshot().

import { startStageClean } from "../_helpers.mjs";

const entering = (s) => s.drones.filter((d) => d.phase === "entering").length;
const formation = (s) => s.drones.filter((d) => d.phase === "formation").length;

export default function item() {
  // The field early in the entrance and once it has completed.
  let early;
  let late;

  return {
    // The entrance runs 8 s, the default budget exactly, so the record pass would cut
    // at the instant the formation completes — losing the half of the clip that shows
    // the swarm settled, which is the second thing the assertions check. 11 s films
    // the whole arc. The validate pass is uncapped, so no verdict depends on this.
    clipMs: 11000,

    id: "swarm.fly-in",

    // Keep the REAL wave (do not clear it) — the entrance behavior is the thing
    // under test, so it must be the game's own wave that flies in.
    async arrange(api) {
      await startStageClean(api, 1, { clear: false });
    },

    // The entrance itself IS the clip: the old script re-posed a whole second wave
    // just to film one, which is exactly the duplication the two-pass runtime
    // removes.
    async act(api) {
      // Just after launch: drones are flying in, none has assembled yet.
      await api.advance(24); // 24 ticks = the old 0.2 s
      early = await api.snapshot();

      // After the entrances complete: the formation has assembled.
      await api.advance(960); // 960 ticks = the old 8 s
      late = await api.snapshot();
    },

    async assert(api, check) {
      check.expectGt(
        "drones are flying in near wave start",
        entering(early),
        0,
      );
      check.expectEq("no drone has assembled yet", formation(early), 0);
      check.expectGt("the formation assembles", formation(late), 0);
      check.expectEq("no drone is still entering", entering(late), 0);
    },
  };
}

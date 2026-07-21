// Scoring: surviving a brush inside the near-miss margin of a moving car awards a
// living-dangerously bonus. The worker is posed just below a train's lethal band (a 2 px
// gap, inside the 10 px margin) with the train's body over its column; one step brushes it.

import { setPos, startFresh, SCORE, TICK } from "../_helpers.mjs";

export default function item() {
  // The snapshot the brush produced.
  let snap;

  return {
    id: "scoring.near-miss",

    // Pose the worker a hair outside the lethal band. The train is spawned in `act` so
    // the clip shows it arriving over the worker rather than opening on the brush.
    async arrange(api) {
      await startFresh(api, 1);
      // Lane 8's lethal band is y 402..438; the worker's foot top sits at y 440 — a 2 px gap.
      await setPos(api, 220, 450);
    },

    async act(api) {
      await api.call("spawnTrain", {
        line: 8,
        orientation: "horizontal",
        dir: "east",
        kind: "freight",
        headPos: 300,
      });

      await api.advance(TICK); // brush past within the margin
      snap = await api.snapshot();

      // Hold so the clip shows the train continuing past the surviving worker.
      // 36 ticks = the old 600ms clip hold.
      await api.advance(36);
    },

    async assert(api, check) {
      check.expectEq(
        "the survived brush is counted a near-miss",
        snap.level.nearMisses,
        1,
      );
      check.expectEq(
        "the near-miss bonus is scored",
        snap.level.scoreParts.nearMiss,
        SCORE.nearMiss,
      );
      check.expectEq("the worker survived the brush", snap.phase, "playing");
    },
  };
}

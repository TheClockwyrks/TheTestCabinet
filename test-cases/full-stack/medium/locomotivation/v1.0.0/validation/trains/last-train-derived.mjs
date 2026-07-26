// Trains: the optional last train's spawn time is DERIVED from its path length and speed
// (t_spawn = clock − (P + L) / v), so its tail clears the map exactly as the clock ends.
// Level 3's last train is a westbound freight; we confirm it is absent early, present late,
// and that its inferred spawn time matches the derivation.

import { startFresh, lastTrain, TRAIN, VIEW_W, TICK_HZ } from "../_helpers.mjs";

// Level 3's last-train consist and the derived spawn time.
const CAR_LEN = { engine: 80, boxcar: 80, "flat-top": 80, "flat-top-half": 40 };
const CONSIST = [
  "engine",
  "boxcar",
  "flat-top",
  "boxcar",
  "flat-top-half",
  "flat-top",
];
const L = CONSIST.reduce((s, c) => s + CAR_LEN[c], 0); // 440
const V = TRAIN.freight.speed; // 90
const CLOCK = 110;
const DERIVED_SPAWN = CLOCK - (VIEW_W + L) / V; // ~90.889

// The two waypoints on the shift clock, in TICKS. The old script advanced by 80 and then
// 15 — those are SECONDS, not tick counts, despite looking like them: they run the shift
// clock to t = 80 s and then t = 95 s, either side of the ~90.889 s derived spawn. At
// 60 Hz that is 4800 and 900 ticks.
const TO_T80 = 80 * TICK_HZ; // 4800
const TO_T95 = 15 * TICK_HZ; // 900

export default function item() {
  // The snapshots either side of the derived spawn window.
  let early;
  let late;

  return {
    id: "trains.last-train-derived",

    // Enter level 3 at the top of its shift; everything else is the clock running.
    async arrange(api) {
      await startFresh(api, 3);
    },

    // Run the shift clock past the derived spawn. This is a long stretch of game time —
    // the record pass films the opening and unwinds when its budget runs out, which is
    // expected here: the verdict comes from the uncapped validate pass.
    async act(api) {
      await api.advance(TO_T80); // well before the derived spawn
      early = await api.snapshot();

      await api.advance(TO_T95); // t = 95, after the derived spawn
      late = await api.snapshot();
    },

    async assert(api, check) {
      check.expectOk(
        "no last train before its derived window",
        !lastTrain(early),
      );

      const lt = lastTrain(late);
      check.expectOk(
        "the last train has arrived after its derived window",
        !!lt,
      );
      if (lt) {
        const inferredSpawn = late.simTime - lt.headPos / lt.speed;
        check.expectClose(
          "the inferred spawn time matches the derivation",
          inferredSpawn,
          DERIVED_SPAWN,
          0.6,
        );
      }
    },
  };
}

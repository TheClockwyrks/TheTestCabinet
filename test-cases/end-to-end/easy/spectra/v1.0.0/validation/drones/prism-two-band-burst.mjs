// Automated validation for the Drones sub-item `prism-two-band-burst`.
//
// A diving Prism fires a two-band burst — one cyan and one magenta bullet — so it
// threatens you whichever band you shield as. A Prism is posed, sent into a REAL
// dive, and stepped forward; the enemy bullets it fires are read from snapshot()
// and must include both bands.

import { spawnDrone, findDrone, enemyBullets } from "../_helpers.mjs";

// The old sweep was 150 reads 0.02 s apart — a 3 s window. 0.02 s is 2.4 ticks,
// which the tick contract refuses rather than rounds, so the poll rounds DOWN to 2:
// this is a SAMPLING poll hunting for the instant a bullet of each band exists on
// the field, and reading more often can only catch a bullet a coarser sweep would
// step past. The tick budget is set to 360 so the window stays the original 3 s
// (180 reads at 2 ticks) rather than shrinking with the finer poll.
const POLL_TICKS = 2;
const WINDOW_TICKS = 360;

export default function item() {
  // The Prism, and the bands of every enemy bullet seen across its dive.
  let prismId;
  const seen = new Set();

  return {
    id: "drones.prism-two-band-burst",

    // A seeded stage-1 wave, field emptied, holding one Prism and the ship centred
    // so the dive has a target to aim its burst at.
    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("startGame");
      await api.call("clearField");
      await api.call("setShipX", 640);
      prismId = await spawnDrone(api, {
        kind: "prism",
        band: "cyan",
        shellBand: "cyan",
        x: 640,
        y: 200,
        phase: "formation",
      });
    },

    // The dive IS the clip. The old script filmed a second, separately posed dive
    // after the checks; there is no need for one now, because the dive the
    // assertions read is the dive on screen.
    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s, arming the dive systems
      await api.call("forceDive", prismId);

      // Collect the bands of enemy bullets fired across the dive. The predicate
      // carries the collecting because `until` only hands back the final snapshot;
      // it stops on the same two conditions the old loop broke on — the Prism
      // leaving the field, or both bands having been seen.
      await api.until(
        (s) => {
          for (const b of enemyBullets(s)) seen.add(b.band);
          if (findDrone(s, prismId) === null) return true;
          return seen.has("cyan") && seen.has("magenta");
        },
        { max: WINDOW_TICKS, poll: POLL_TICKS },
      );

      // Let the burst travel so both bullets are visibly on screen at once, which is
      // the point of the check and impossible to see at the instant they spawn.
      await api.advance(60); // 60 ticks (0.5 s) of the burst spreading out
    },

    async assert(api, check) {
      check.expectOk("the diving Prism fires a cyan bullet", seen.has("cyan"));
      check.expectOk(
        "the diving Prism fires a magenta bullet",
        seen.has("magenta"),
      );
    },
  };
}

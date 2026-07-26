// Automated validation for the Controls sub-item `fire-cap`.
//
// No more than three of your bullets are alive at once, however long fire is held.
// Fire is held and the real sim stepped through a long window; the live friendly
// count is watched and must reach — but never exceed — the cap of three.

import {
  startClean,
  friendlyBullets,
  actHoldSample,
  PBULLET_CAP,
} from "../_helpers.mjs";

// The old sweep was 70 reads 0.02 s apart — a 1.4 s window. 0.02 s is 2.4 ticks,
// which the tick contract refuses rather than rounds, so the poll rounds DOWN to 2:
// this is a SAMPLING poll looking for the instant the live count peaks, and a finer
// sweep can only catch a peak a coarser one would step over, never miss one. The
// window is then held at the original 1.4 s by raising the tick budget to 168
// (84 reads at 2 ticks), so the check still watches exactly as much of the game.
const POLL_TICKS = 2;
const WINDOW_TICKS = 168;

export default function item() {
  // The most friendly bullets ever seen alive at one instant.
  let maxLive = 0;

  return {
    id: "controls.fire-cap",

    // A clean wave with the ship centered: nothing on the field can absorb a bullet
    // and make the live count read low for a reason other than the cap.
    async arrange(api) {
      await startClean(api);
      await api.call("setShipX", 640);
    },

    // Hold fire across the whole window, sampling the live count as it evolves. The
    // 1.4 s of held fire IS the clip — the reviewer watches shots leave, the count
    // sit at three, and no fourth appear.
    async act(api) {
      await actHoldSample(api, "Space", {
        ticks: WINDOW_TICKS,
        poll: POLL_TICKS,
        sample: (snap) => {
          maxLive = Math.max(maxLive, friendlyBullets(snap).length);
        },
      });
    },

    async assert(api, check) {
      check.expectLe(
        "live player bullets never exceed the cap",
        maxLive,
        PBULLET_CAP,
      );
      check.expectGe("held fire reaches the cap", maxLive, PBULLET_CAP);
    },
  };
}

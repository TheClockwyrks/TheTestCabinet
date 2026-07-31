// Automated validation for the Bullets item `lifetime`: a bullet expires after a limited
// lifetime (~1.5 s). A real bullet is placed far from the star, drifting AWAY from it (so
// gravity never sweeps it into the core, where it would be absorbed early and look like an
// expiry), and the real sim is stepped: it is still alive just before 1.5 s and gone just
// after.
//
// Placing the bullet is instant (`arrange`); running out its lifetime is the behavior under
// test (`act`), so the clip is exactly that — the bullet crossing open field until it winks
// out on its own, which is the whole claim. It is given that drift rather than left at rest
// because the record pass films `act`: a bullet parked on a fixed point for a second and a
// half reads as a frozen frame, and there is nothing in the clip to say the game was even
// running until the moment it vanishes.
//
// The bullet's `life` field is reported in SECONDS (the unit the game states it in), so the
// assertion against BULLET_LIFE stays in seconds. Only the DURATIONS advanced are ticks:
// 1.4 s x 120 Hz = 168, and the further 0.2 s = 24 that carries past the 1.5 s lifetime.

import { newGame, BULLET_LIFE } from "../_helpers.mjs";

export default function item() {
  // The bullet shortly before it expires, and the field once it has, read by `assert`.
  let nearEnd;
  let afterEnd;

  return {
    id: "bullets.lifetime",

    async arrange(api) {
      await newGame(api);
      // Up and to the left, away from the star at (640, 360): the pull it does feel
      // only bleeds the drift off, and never turns the bullet back toward the core.
      await api.call("addBullet", { x: 200, y: 200, vx: -120, vy: -60 });
    },

    async act(api) {
      await api.advance(168); // 1.4 s — just short of the lifetime
      nearEnd = await api.snapshot();

      await api.advance(24); // 0.2 s more — past the 1.5 s lifetime
      afterEnd = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "the bullet is still alive shortly before its lifetime ends",
        nearEnd.bullets.length,
        1,
      );
      if (nearEnd.bullets[0]) {
        check.expectClose(
          "its remaining life reads ~0.1 s at t=1.4 s",
          nearEnd.bullets[0].life,
          BULLET_LIFE - 1.4,
          0.03,
        );
      }
      check.expectEq(
        "the bullet is gone once its lifetime elapses",
        afterEnd.bullets.length,
        0,
      );
    },
  };
}

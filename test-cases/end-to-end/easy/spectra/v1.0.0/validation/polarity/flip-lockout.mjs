// Automated validation for the Polarity sub-item `flip-lockout`.
//
// A flip imposes a roughly 0.30s fire lockout: firing is blocked immediately after
// a flip and works again once the lockout elapses. A real flip is performed, then
// the fire key is held while the real simulation steps — no bullet appears while
// the lockout stands, and one appears once it clears.

import { startClean, friendlyBullets, FLIP_LOCKOUT } from "../_helpers.mjs";

// Halfway through the 0.30 s lockout: late enough that a build with no lockout would
// certainly have fired by now, early enough that a correct build certainly has not.
const DURING_TICKS = 18; // 18 ticks = the old 0.15 s

// Past the far end of the lockout, so firing must have resumed.
const PAST_TICKS = 24; // 24 ticks = the old 0.2 s

export default function item() {
  // The ship the instant it flipped, and the bullet counts during and after lockout.
  let afterFlip;
  let duringCount;
  let afterCount;

  return {
    id: "polarity.flip-lockout",

    // A clean wave with the ship on a known band. The field is empty so nothing can
    // consume a bullet and make "no bullet fired" true for the wrong reason.
    async arrange(api) {
      await startClean(api);
      await api.call("setShipBand", "cyan");
    },

    async act(api) {
      await api.call("flip");
      // Read the lockout the instant the flip lands — it starts full and drains, so
      // any delay here would under-report its length.
      afterFlip = (await api.snapshot()).ship;

      // Hold fire while the lockout still stands (~0.15s): no bullet may spawn.
      await api.call("keyDown", "Space");
      await api.advance(DURING_TICKS);
      duringCount = friendlyBullets(await api.snapshot()).length;

      // Past the lockout: firing works.
      await api.advance(PAST_TICKS);
      afterCount = friendlyBullets(await api.snapshot()).length;
      await api.call("keyUp", "Space");

      // Hold on the resumed fire so the clip shows the pause and then the shots,
      // which is what makes the lockout legible as a lockout.
      await api.advance(120); // 120 ticks = the old 1000 ms
    },

    async assert(api, check) {
      check.expectOk(
        "firing is locked out right after a flip",
        afterFlip.canFire === false,
      );
      check.expectClose(
        "the lockout is about 0.30s",
        afterFlip.lockout,
        FLIP_LOCKOUT,
        0.02,
      );
      check.expectEq(
        "no bullet fires while the lockout stands",
        duringCount,
        0,
      );
      check.expectGt("a bullet fires once the lockout clears", afterCount, 0);
    },
  };
}

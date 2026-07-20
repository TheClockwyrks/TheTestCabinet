// Automated validation for the Controls sub-item `fire`.
//
// The fire key (Space, or Up / W) fires a bullet of the ship's current band. Each
// binding is held briefly through injected input; the real fire code, stepped
// forward, spawns a friendly bullet of the ship's band, read back from snapshot().

import { startClean, friendlyBullets } from "../_helpers.mjs";

const HOLD_TICKS = 6; // 6 ticks = the old 0.05 s hold

// Every binding the spec offers for fire. All three are checked, so a build that
// wires only one of them fails on the ones it missed rather than passing on an
// average.
const BINDINGS = ["Space", "ArrowUp", "KeyW"];

export default function item() {
  // Per binding, the friendly bullets that were alive after its hold.
  const seen = new Map();

  return {
    id: "controls.fire",

    // A clean wave with the ship on a known band, so the band a bullet carries can
    // only have come from the ship.
    async arrange(api) {
      await startClean(api);
      await api.call("setShipBand", "cyan");
    },

    async act(api) {
      for (const code of BINDINGS) {
        // Re-pose between bindings with control ops rather than a reset (which the
        // runtime forbids in `act` — it would take the clock back and freeze the
        // recording). `clearField` empties the bullets the previous binding fired,
        // which matters for more than tidiness: with three bullets left alive the
        // player-bullet cap would block the next binding from firing at all and the
        // check would blame the binding for the cap.
        await api.call("clearField");
        await api.call("setShipBand", "cyan");

        await api.call("keyDown", code);
        await api.advance(HOLD_TICKS);
        await api.call("keyUp", code);
        seen.set(code, friendlyBullets(await api.snapshot()));

        // Let the shot travel a readable distance before the next binding clears the
        // field, so the clip shows three distinct shots rather than a flicker. The
        // bullets above are already captured, so this cannot affect the verdict.
        await api.advance(48); // 48 ticks (0.4 s) of visible travel
      }
    },

    async assert(api, check) {
      for (const code of BINDINGS) {
        const bullets = seen.get(code);
        check.expectGt(`${code} fires a bullet`, bullets.length, 0);
        if (bullets.length > 0) {
          check.expectEq(
            `${code} fires a bullet of the ship's band`,
            bullets[0].band,
            "cyan",
          );
        }
      }
    },
  };
}

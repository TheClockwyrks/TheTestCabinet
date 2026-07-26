// Automated validation for the overload variant's Mode sub-item `mode.flux-overload`.
//
// A Flux driven to overload flips its band and fires a three-shot spread in its new
// band. A Flux is posed in a held window, brought to the brink (setDroneCharge), and
// tipped over by a real mismatched shot; the real overload flips its band and fires
// the spread, both read back from snapshot().

import {
  startClean,
  spawnDrone,
  findDrone,
  shootDrone,
  enemyBullets,
} from "../_helpers.mjs";

// The old script stepped 0.02 s to settle the Flux into its held window. At 120 Hz
// that is 2.4 ticks, which the tick contract refuses rather than rounds. Round UP to
// 3: this settle waits for the flux update to have RUN, so shortening it risks
// reading a state that has not been computed yet — and the whole scenario depends on
// the Flux being held (chargeable) rather than shimmering.
const SETTLE_TICKS = 3;

const OVERLOAD_TICKS = 12; // 12 ticks = the old 0.1 s for the overload to resolve

export default function item() {
  // The Flux, its shimmer state before charging, and the field after the overload.
  let fluxId;
  let heldState;
  let after;

  return {
    id: "mode.flux-overload",

    // One Flux at the start of its cycle, so it is held on cyan (and therefore
    // chargeable — a shimmering Flux has no band to mismatch).
    async arrange(api) {
      await startClean(api);
      fluxId = await spawnDrone(api, {
        kind: "flux",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
        fluxClock: 0, // held on cyan
      });
    },

    async act(api) {
      await api.advance(SETTLE_TICKS); // settle into the held window (not shimmering)
      heldState = findDrone(await api.snapshot(), fluxId);
      await api.call("setDroneCharge", fluxId, 2);

      await shootDrone(api, fluxId, "magenta"); // wrong band while held -> charges, then overloads
      await api.advance(OVERLOAD_TICKS);
      after = await api.snapshot();

      // Let the spread travel so all three shots are visibly on screen in their new
      // band, which is exactly what the assertions below count. Already captured.
      await api.advance(120); // 120 ticks = the old 1000 ms
    },

    async assert(api, check) {
      check.expectOk(
        "the Flux is held (chargeable)",
        heldState.shimmer === false,
      );

      const d = findDrone(after, fluxId);
      const enemies = enemyBullets(after);
      check.expectOk("the overloaded Flux is still on the field", d !== null);
      if (d)
        check.expectEq(
          "the overloaded Flux flips to the new band",
          d.band,
          "magenta",
        );
      check.expectEq(
        "the overload fires a three-shot spread",
        enemies.length,
        3,
      );
      check.expectOk(
        "the spread is in the new band",
        enemies.every((b) => b.band === "magenta"),
      );
    },
  };
}

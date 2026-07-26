// Automated validation for the Drones sub-item `flux-oscillates`.
//
// A Flux alternates its band on a telegraphed rhythm: a held window on one band, a
// brief shimmer settled on neither, then the other band. A Flux is posed at the
// start of its cycle (fluxClock 0) and the real oscillation is stepped through one
// cycle; the held/shimmer/held states are read back from snapshot() at the right
// moments (stage-1 hold 1.6s, shimmer 0.4s).

import { startClean, spawnDrone, findDrone } from "../_helpers.mjs";

// The three sampling instants, as ticks from the start of the cycle. Each lands
// comfortably inside its window rather than on a boundary, so the check reads a
// settled state and not the frame the state changes on.
const TO_HELD_TICKS = 48; // 48 ticks (0.4 s) -> fluxClock ~0.4, inside the 1.6 s hold
const TO_SHIMMER_TICKS = 162; // +162 ticks (1.35 s) -> ~1.75, inside the 1.6-2.0 s telegraph
const TO_OTHER_TICKS = 90; // +90 ticks (0.75 s) -> ~2.5, inside the 2.0-3.6 s window

export default function item() {
  // The Flux, and the three states `act` sampled across one cycle.
  let fluxId;
  let held;
  let shimmering;
  let other;

  return {
    id: "drones.flux-oscillates",

    // One Flux at the very start of its cycle, on an otherwise empty field. Lives
    // are padded so a dive of its own during the sweep cannot end the run and cut
    // the cycle short.
    async arrange(api) {
      await startClean(api);
      await api.call("setLives", 9);
      fluxId = await spawnDrone(api, {
        kind: "flux",
        band: "cyan",
        x: 640,
        y: 200,
        phase: "formation",
        fluxClock: 0,
      });
    },

    // One full oscillation, which is exactly what the item checks and exactly what a
    // reviewer needs to see: hold, telegraph, hold on the other band.
    async act(api) {
      // Held on the first band (fluxClock ~0.4, inside the 1.6s hold).
      await api.advance(TO_HELD_TICKS);
      held = findDrone(await api.snapshot(), fluxId);

      // Shimmer (fluxClock ~1.75, inside the 1.6–2.0s telegraph).
      await api.advance(TO_SHIMMER_TICKS);
      shimmering = findDrone(await api.snapshot(), fluxId);

      // Held on the OTHER band (fluxClock ~2.5, inside the 2.0–3.6s window).
      await api.advance(TO_OTHER_TICKS);
      other = findDrone(await api.snapshot(), fluxId);
    },

    async assert(api, check) {
      check.expectEq("the Flux holds its first band", held.band, "cyan");
      check.expectOk(
        "it is not shimmering during the held window",
        held.shimmer === false,
      );
      check.expectOk(
        "the Flux shimmers between bands",
        shimmering.shimmer === true,
      );
      check.expectEq(
        "the Flux emerges holding the other band",
        other.band,
        "magenta",
      );
      check.expectOk(
        "it is settled again (not shimmering)",
        other.shimmer === false,
      );
    },
  };
}

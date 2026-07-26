// Automated validation for the Drones sub-item `flux-shimmer-immune`.
//
// During its shimmer a Flux has no settled band, so no shot destroys it; a matching
// shot during a held window does. A Flux is posed mid-shimmer (fluxClock in the
// telegraph) and a matching-band shot fired — the real collision leaves it alive;
// then a Flux posed in a held window takes a matching shot and dies.

import { startClean, spawnDrone, findDrone, shootDrone } from "../_helpers.mjs";

// The old script stepped 0.02 s to let `updateFlux` register the posed clock. At
// 120 Hz that is 2.4 ticks, which the tick contract refuses rather than rounds.
// Round UP to 3: this settle waits for a state to BECOME true, so it must never be
// shortened — reading before the flux update has run would misreport the shimmer
// the whole check turns on.
const REGISTER_TICKS = 3;

// Long enough for the posed shot to reach the drone and the collision to resolve.
const RESOLVE_TICKS = 24; // 24 ticks = the old 0.2 s

export default function item() {
  // The shimmering Flux (spawned while arranging, shot in `act`) and what `act`
  // observed in each of its two scenarios. All in the factory closure, so the two
  // passes cannot see each other's state.
  let shimmerId;
  let shimmerState;
  let shimmerSurvivor;
  let heldState;
  let heldAfter;

  return {
    id: "drones.flux-shimmer-immune",

    // The first scenario: one Flux posed with its clock already inside the shimmer
    // telegraph, so it is between bands when the shot arrives.
    async arrange(api) {
      await startClean(api);
      shimmerId = await spawnDrone(api, {
        kind: "flux",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
        fluxClock: 1.7, // inside the 1.6–2.0s shimmer window
      });
    },

    async act(api) {
      // Mid-shimmer: a matching shot must NOT destroy it.
      await api.advance(REGISTER_TICKS); // let updateFlux register the shimmer
      shimmerState = findDrone(await api.snapshot(), shimmerId);
      await shootDrone(api, shimmerId, "cyan"); // its held band, but it is mid-shimmer
      await api.advance(RESOLVE_TICKS);
      shimmerSurvivor = findDrone(await api.snapshot(), shimmerId);

      // Held window: a matching shot DOES destroy it. The second Flux is posed with
      // `clearField` + `spawnDrone` — control ops, which is what the old script
      // already used here and what the runtime requires, since `reset` in `act`
      // would take the clock back and freeze the recording.
      await api.call("clearField");
      const heldId = await spawnDrone(api, {
        kind: "flux",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
        fluxClock: 0.5, // inside the held window
      });
      await api.advance(REGISTER_TICKS);
      heldState = findDrone(await api.snapshot(), heldId);
      await shootDrone(api, heldId, "cyan");
      await api.advance(RESOLVE_TICKS);
      heldAfter = findDrone(await api.snapshot(), heldId);
    },

    async assert(api, check) {
      check.expectOk("the Flux is shimmering", shimmerState.shimmer === true);
      check.expectOk(
        "a matching shot does not kill a shimmering Flux",
        shimmerSurvivor !== null,
      );
      check.expectOk("the Flux is settled (held)", heldState.shimmer === false);
      check.expectEq("a matching shot kills a held Flux", heldAfter, null);
    },
  };
}

// Automated validation for the Drones sub-item `flux-shimmer-immune`.
//
// During its shimmer a Flux has no settled band, so no shot destroys it; a matching
// shot during a held window does. A Flux is stepped into its shimmer telegraph and
// a matching-band shot fired — the real collision leaves it alive; then a Flux in a
// held window takes a matching shot and dies.
//
// The Flux is posed EARLY in its cycle and walked into the shimmer inside `act`
// rather than being posed mid-shimmer, so the clip shows the held band, the
// telegraph starting, and the shot bouncing off it. Posed mid-shimmer, both
// scenarios resolved inside half a second with no gap between them, so a reviewer
// saw a shimmering Flux and, a frame later, an explosion — the SECOND scenario's
// legitimate held-window kill, read as the first one dying mid-shimmer (see
// `LEAD_IN_TICKS`).

import {
  startClean,
  spawnDrone,
  spawnBystander,
  findDrone,
  readsAs,
  shootDrone,
  shootUntil,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

// The old script stepped 0.02 s to let `updateFlux` register the posed clock. At
// 120 Hz that is 2.4 ticks, which the tick contract refuses rather than rounds.
// Round UP to 3: this settle waits for a state to BECOME true, so it must never be
// shortened — reading before the flux update has run would misreport the shimmer
// the whole check turns on.
const REGISTER_TICKS = 3;

// Where the Flux's cycle starts, and how far `act` walks it before the shot. The
// sum lands at `1.70 s`, comfortably inside the 1.6–2.0 s telegraph, while the walk
// itself is the clip's lead-in. (Stage 1 holds for 1.6 s, then shimmers for 0.4 s.)
const SHIMMER_START_CLOCK = 0.35;
const TO_SHIMMER_TICKS = 162; // 1.35 s -> fluxClock 1.70

// Long enough for the posed shot to reach the drone and the collision to resolve.
const RESOLVE_TICKS = 24; // 24 ticks = the old 0.2 s

// Long enough for a shot fired from the ship's lane to cross the ~280 px up to the
// drone (0.37 s at the specified bullet speed), with room for a slower build.
const RESOLVE_MAX_TICKS = 180;

// Held on the survivor, so "the shot did not destroy it" is something a reviewer
// watches rather than infers.
const SURVIVOR_HOLD_TICKS = 120;

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

    // The first scenario: one Flux posed early in its held window, which `act` walks
    // forward into the shimmer telegraph before firing at it.
    async arrange(api) {
      await startClean(api);
      await spawnBystander(api);
      shimmerId = await spawnDrone(api, {
        kind: "flux",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
        fluxClock: SHIMMER_START_CLOCK,
      });
    },

    async act(api) {
      // Walk the Flux out of its held window and into the telegraph. This is also
      // the clip's lead-in: the reviewer sees the settled band give way to the
      // shimmer before anything is fired.
      await api.advance(TO_SHIMMER_TICKS);
      shimmerState = findDrone(await api.snapshot(), shimmerId);

      // Mid-shimmer: a matching shot must NOT destroy it.
      //
      // This shot is posed ON the drone rather than flown up from the lane, unlike
      // every other shot in this case. The shimmer is only 0.4 s wide, and a shot
      // from the ship's lane spends most of that in flight — on a build whose
      // bullets travel slower than specified it would arrive after the Flux had
      // settled and destroy it, failing a correct build. The immunity window is too
      // narrow to film a travelled shot into safely, so precision wins here.
      await shootDrone(api, shimmerId, "cyan"); // its held band, but it is mid-shimmer
      await api.advance(RESOLVE_TICKS);
      shimmerSurvivor = findDrone(await api.snapshot(), shimmerId);

      // Hold on the survivor before moving on, so the two scenarios read as two
      // separate events instead of one flicker.
      await api.advance(SURVIVOR_HOLD_TICKS);

      // Held window: a matching shot DOES destroy it. The second Flux is posed with
      // `clearField` + `spawnDrone` — control ops, which is what the old script
      // already used here and what the runtime requires, since `reset` in `act`
      // would take the clock back and freeze the recording.
      await api.call("clearField");
      await spawnBystander(api);
      const heldId = await spawnDrone(api, {
        kind: "flux",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
        fluxClock: 0.2, // early in the 1.6 s held window
      });
      await api.advance(REGISTER_TICKS);
      heldState = findDrone(await api.snapshot(), heldId);

      // The held window is 1.6 s wide, which is ample for a shot to fly up from the
      // ship's lane — so this half of the comparison IS filmed as a real shot
      // rising into the drone and killing it.
      await shootUntil(
        api,
        heldId,
        (s) => readsAs(s, heldId),
        (s) => findDrone(s, heldId) === null,
        { max: RESOLVE_MAX_TICKS },
      );
      heldAfter = findDrone(await api.snapshot(), heldId);

      // Hold on the pop so the clip ends on the kill rather than cutting on it.
      await api.advance(72);
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

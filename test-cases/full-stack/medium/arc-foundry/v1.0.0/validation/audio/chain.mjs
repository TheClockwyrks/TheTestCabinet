// Automated validation for the Audio item `chain`: a crackling chain plays when a Coil
// fires (its bolt leaps to nearby units). Audio is read from the Web Audio sources the
// build starts (see `api.audio`). A Coil is armed on the entry corridor and the level's own
// Wave 1 is walked up to it; audio is armed, and the real simulation is
// stepped until the tower's own `firing` flag reports the shot — the audio log must grow
// across it.
//
// The target comes from the level's own Wave 1 rather than a separately released unit. This item
// is about the CUE, not about which unit was shot: pinning it to a specific release made an audio
// check depend on the debug spawner as well as on the audio, so a build with working sound but a
// shaky `spawnUnit` failed a sound check. `armTower({ clear: false })` leaves the harvest's wave
// walking the corridor and `skipToFirstTarget` runs it up to the tower, instantly.

import {
  armTower,
  towerById,
  armAudio,
  audioCount,
  audioCueLabel,
  waitForAudio,
  skipToFirstTarget,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// Several cadences of the type under test. The old 1 s budget assumed a component fires on
// its opening tick (a zero starting cooldown); nothing in `specs/towers.md` says whether it
// does, and a Discharge Rig's own cadence is 2 s all by itself.
const FIRE_MAX_TICKS = 4 * SECOND;

export default function item() {
  let before;
  let after;
  let fired;
  let towerId;

  return {
    id: "audio.chain",

    async arrange(api) {
      towerId = await armTower(api, { type: "coil", tier: 1, clear: false });
      // Walk the harvest's own Wave 1 up to the tower before arming audio, so the cue this
      // item listens for is the one the shot makes rather than a wave that never arrived.
      await skipToFirstTarget(api, towerId);
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => Boolean(towerById(s, towerId)?.firing), {
        max: FIRE_MAX_TICKS,
        poll: TICK,
      });
      fired = r.hit;
      after = await waitForAudio(api, before);
    },

    async assert(api, check) {
      check.expectOk("the Coil fires", fired);
      check.expectGt(
        audioCueLabel("a chain cue plays on the shot", after),
        after,
        before,
      );
    },
  };
}

// Automated validation for the Audio item `saucer`: a distinct synthesized cue marks the
// saucer's presence. Audio is armed with one neutral key press first (the game must not
// autoplay), then the real game is run forward until a saucer arrives on its own spawn cadence
// (the first saucer enters ~18 s into a game). Nothing else makes a sound in that window — the
// ship is idle and no rock is shot — so the audio log growing when the saucer appears is the
// arrival cue. Driving the NATURAL spawn (rather than the debug `spawnSaucer`) keeps the check
// fair: it tests the game's own arrival event, not a debug-op side effect.
//
// The first spawn is ~18 s out, so this item films longer than the default clip budget: the
// record pass needs to reach the arrival, hence `clipMs`. The verdict comes from the uncapped
// validate pass regardless. 20 s x 120 Hz = 2400 ticks bounds the sweep; polling every 12 ticks
// keeps it cheap while still catching the arrival closely.

import { newGame, armAudio } from "../_helpers.mjs";

export default function item() {
  let before;
  let result;
  let after;

  return {
    id: "audio.saucer",
    clipMs: 21000, // the first saucer arrives ~18 s in; film long enough to reach it

    async arrange(api) {
      await newGame(api); // keeps the ship invulnerable so it survives to the spawn
      await armAudio(api);
    },

    async act(api) {
      before = (await api.audio()).length;
      result = await api.until((s) => s.saucer !== null, { max: 2400, poll: 12 });
      after = (await api.audio()).length;
    },

    async assert(api, check) {
      check.expectOk("a saucer arrives on its own cadence", result.hit);
      check.expectGt(
        "a cue marks the saucer's arrival (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}

// Automated validation for the Audio item `music`: a tense reactor music bed the build
// produced with `music` plays under the board, via Web Audio — not silence, a
// download, or a hand-oscillated stand-in (specs/assets.md: "loop the music bed").
// Audio is read from the Web Audio sources the build starts (see `api.audio`). No
// source exists before the player ever interacts (the build must not autoplay), so
// the check reads the log both before and after a single real gesture arms audio —
// which is also what starts the looped bed (`audio.ts`'s `resume` → `startMusic`) —
// then runs a little gameplay forward while it plays. If the bed has not arrived by
// then the round is sent and the log watched again, since when the bed starts is the
// build's own choice; see the note in `act`.

import {
  startRun,
  armAudio,
  audioCount,
  audioCountAbove,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "audio.music",

    async arrange(api) {
      await startRun(api, MAP.single);
    },

    async act(api) {
      before = await audioCount(api); // nothing has played yet — no gesture so far
      await armAudio(api); // the real gesture that unlocks audio and starts the bed
      await api.advance(60); // ~1 s of gameplay underway while the bed loops
      // Wait for the bed rather than reading once: a build may defer it until its clip has
      // decoded or start it off a short timer after the unlocking gesture, both of which are
      // invisible to a player. Nothing else on this board can make a sound, so a source
      // appearing here is the bed.
      after = await audioCountAbove(api, before);

      // A bed that has not arrived by now may simply be waiting for a round. specs/assets.md
      // asks for "a driving, low, atmospheric loop under the board" and does not say when it
      // starts, so a build entitled to hold it until the containment run is actually underway
      // — rather than under an untimed opening build phase where nothing is happening — is
      // conformant, and pinning the arming gesture as the trigger pins one reading of the two.
      // So send the round and watch again. The window stays honest: no tower has been placed,
      // so there is no shot or build cue, and the wave has only just left the inlet — the
      // fastest matter needs many seconds to cross a path — so no leak alarm can sound inside
      // it either. A source appearing here is still the bed.
      if (after <= before) {
        await api.call("startRound");
        await api.advance(60);
        after = await audioCountAbove(api, before);
      }
    },

    async assert(api, check) {
      check.expectOk(
        "no Web Audio source plays before the player interacts",
        before === 0,
      );
      check.expectGt(
        "a Web Audio source starts for the reactor music bed",
        after,
        before,
      );
    },
  };
}

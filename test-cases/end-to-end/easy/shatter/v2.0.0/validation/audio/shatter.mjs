// Automated validation for the Audio item `shatter`: a distinct synthesized cue plays when a
// rock shatters. Audio is armed with one neutral key press first (the game must not autoplay),
// then a single Small rock is destroyed with a real shot. The rock is posed with `addRock` and
// shot down with `addBullet` (neither routes through the fire cue), so the only cue in the
// window is the shatter. The audio log must grow across the kill. A Small takes one hit in both
// variants, so this reads the same for base and Warhead.

import { arrangePosedRock, actFireUntilGone, armAudio } from "../_helpers.mjs";

export default function item() {
  let before;
  let result;
  let after;

  return {
    id: "audio.shatter",

    async arrange(api) {
      await arrangePosedRock(api, "small");
      await armAudio(api);
    },

    async act(api) {
      before = (await api.audio()).length;
      result = await actFireUntilGone(api, "small");
      after = (await api.audio()).length;
      await api.advance(30); // a short tail so the clip shows the shatter
    },

    async assert(api, check) {
      check.expectEq("the rock is destroyed", result.snap.rocks.length, 0);
      check.expectGt(
        "a cue plays when the rock shatters (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}

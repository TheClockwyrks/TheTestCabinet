// Automated validation for the Audio item `place-cue`: a distinct cue plays when a
// tower is placed. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). Audio is armed with plenty of money to build, then a real Arc is
// placed through the real placement code, which must grow the audio log.

import { newGame, armAudio, audioCount } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let placed;

  return {
    id: "audio.place-cue",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      await api.call("placeTower", "arc", 10, 10);
      after = await audioCount(api);
      placed = (await api.snapshot()).towers.some(
        (t) => t.type === "arc" && t.col === 10 && t.row === 10,
      );
      await api.advance(30); // a short tail so the clip shows the placed tower
    },

    async assert(api, check) {
      check.expectOk("the Arc is placed on the floor", placed);
      check.expectGt(
        "a cue plays when a tower is placed (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}

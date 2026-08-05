// Automated validation for the Audio item `place-cue`: a distinct cue plays when a
// tower is placed. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). Audio is armed with plenty of money to build, then a real Arc is
// placed through the real placement code, which must grow the audio log.
//
// THE CLOCK IS THE BUILD'S FOR THE COUNTED WINDOW. A cue is played by a presentation
// layer reading events the simulation emitted, and a build is free to raise it from its
// frame loop rather than from inside `step` — see the note above `giveClockToBuild` in
// `_helpers` for why that is the architecture the spec asks for. Driving with `step` and
// then asking what played reports silence for a game whose cues work.
//
// This item is the cheapest of the eight: placing a tower is instantaneous, so there is no
// window to run forward — the clock only has to be the build's across the settle that lets
// the cue land, which is what `audioSettled` already waits for.

import {
  newGame,
  armAudio,
  audioSettled,
  giveClockToBuild,
} from "../_helpers.mjs";

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
      // The build drives itself from here, so its frame loop can play what it queues.
      await giveClockToBuild(api);

      before = await audioSettled(api);
      await api.call("placeTower", "arc", 10, 10);
      after = await audioSettled(api);

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

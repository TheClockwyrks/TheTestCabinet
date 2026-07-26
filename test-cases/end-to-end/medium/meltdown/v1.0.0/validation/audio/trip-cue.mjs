// Automated validation for the Audio item `trip-cue`: a distinct cue plays when a
// tower trips offline. Audio is read from the Web Audio sources the build starts
// (see `api.audio`). A Stutter is posed near its redline with a real Core target in
// range (the same setup as `trip.trips-at-100`); audio is armed, and the real
// firing/heat systems carry it over 100, where the real trip system takes it
// offline and must grow the audio log.

import {
  newGame,
  arrangeNearRedline,
  armAudio,
  audioCount,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  let id;
  let before;
  let after;
  let tripped;

  return {
    id: "audio.trip-cue",

    // 92 is near the redline; the real firing carries it the rest of the way.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      const c = await arrangeNearRedline(api, "stutter", { heat: 92 });
      id = c.id;
      await armAudio(api);
    },

    // 360 ticks = the old 6s cap; polling every tick reads the exact step the trip
    // takes hold.
    async act(api) {
      before = await audioCount(api);
      const r = await api.until(
        (s) => s.towers.some((t) => t.id === id && t.tripped),
        { max: 360, poll: TICK },
      );
      after = await audioCount(api);
      tripped = r.hit;
      await api.advance(30); // a short tail so the clip shows the trip
    },

    async assert(api, check) {
      check.expectOk("the Stutter trips from overheating", tripped);
      check.expectGt(
        "a cue plays when a tower trips (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}

// Automated validation for the Audio item `level-clear`: a cue plays when the last bay
// of a level is filled and the level clears. Audio is read from the Web Audio sources
// the build starts (see `api.audio`). Four bays are posed filled, the critter is placed
// one hop below the last open bay, audio is armed, and a real up-hop fills it — clearing
// the level (level 1, below the final level, so it is a clear rather than victory). The
// audio log must grow across the clear.

import {
  startCrossing,
  armAudio,
  audioCount,
  BAYS,
  WATER_TOP,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let didClear;
  const col = BAYS[4][0]; // the last (rightmost) bay's column

  // "The level cleared" is read as the level ACTUALLY ADVANCING (or the run being
  // won), waited for over a generous window — not as a snapshot of the bays.
  //
  // `bays.every(Boolean)` is the tempting proxy and it is wrong twice over. It is
  // too STRICT for a build that rolls straight into the next level, which empties
  // the bays the same step it advances, so the all-filled state is never observable;
  // and it is too LOOSE for a build that fills the fifth bay and then does nothing,
  // which sits at all-filled forever and passes a check that never establishes a
  // clear happened at all. The level number is the fact the item actually depends
  // on, and it distinguishes both cases.
  //
  // The window is generous because a build may hold a clearing pause of its own
  // choosing before starting the next level (the reference holds 1.6 s), and
  // specs/gameplay.md pins no duration. This is only the guard, so it can afford to
  // wait; the cue measurement below stays tight around the fill.
  const cleared = (level, s) => s.level > level || s.screen === "victory";

  return {
    id: "audio.level-clear",

    async arrange(api) {
      await startCrossing(api);
      await api.call("setBays", [true, true, true, true, false]); // only the last bay open
      await api.call("setLane", WATER_TOP, { cols: [col], speed: 0 });
      await api.call("placeCritter", col, WATER_TOP);
      await armAudio(api);
    },

    async act(api) {
      const level = (await api.snapshot()).level;
      before = await audioCount(api);
      await api.call("press", "ArrowUp"); // fill the last bay → level clears
      // The cue window stays tight around the fill: the clear's sound is scheduled
      // as the bay lands, so widening this would only invite an unrelated later cue
      // to be counted as this one.
      await api.advance(30);
      after = await audioCount(api);
      // The guard then waits as long as it needs to for the level to actually turn
      // over, which a build may sit on through a clearing pause of its own length.
      didClear = (
        await api.until((s) => cleared(level, s), { max: 600, poll: 6 })
      ).hit; // 5 s at 0.05 s
    },

    async assert(api, check) {
      check.expectOk("the last bay fills and the level clears", didClear);
      check.expectGt(
        "a cue plays on the level clear (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}

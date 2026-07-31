// Automated validation for the Audio item `game-over-cue`: the Game-over sting plays
// when the run ends. Audio is read from the Web Audio sources the build starts (see
// `api.audio`).
//
// The probe COUNTS sources; it cannot say which cue started one. The run ends on the
// tick a leak takes the last life, and a leak plays its own cue, so "the log grew as
// the run ended" is true of a build with no Game-over sting at all. The two are
// separated by differencing: each window below contains exactly ONE leak, and only
// the second one is fatal.

//
// The baseline window's own cue is measured but NOT asserted on. Whether a shot or a
// leak is itself audible belongs to `audio.fire-cue` and `audio.leak-cue`; requiring
// it here too would fail this item for a defect another item already owns, and the
// comparison below is sound either way — a build that plays nothing at all fails it,
// because then neither window grows.

import {
  newGame,
  spawn,
  armAudio,
  audioCount,
  skipToApproach,
} from "../_helpers.mjs";

export default function item() {
  let onLeak;
  let onFatal;
  let survived;
  let ended;

  return {
    id: "audio.game-over-cue",

    // Two lives and one Mote on the floor: this leak costs a life without ending the
    // run, which is the control for the fatal one released after it. Each Mote's walk
    // to the exhaust is 16 s that carries neither cue, so both are run through
    // unfilmed and each measured window opens on the arrival it is about.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 2);
      const firstMote = await spawn(api, "mote", "left");
      await skipToApproach(api, firstMote);
      await armAudio(api);
    },

    // Window 1: a survivable leak. Window 2: an identical leak that takes the last
    // life and ends the run. 300 ticks = 5s, ample for the approach each skip stopped
    // on. Both counts are taken after their skip, so the walk contributes nothing to
    // either window and the two stay comparable.
    async act(api) {
      const leakBefore = await audioCount(api);
      const first = await api.until((s) => s.lives <= 1, {
        max: 300,
        poll: 6,
      });
      onLeak = (await audioCount(api)) - leakBefore;
      survived = first.hit && (await api.snapshot()).screen === "playing";

      const fatalMote = await spawn(api, "mote", "left");
      await skipToApproach(api, fatalMote);
      const fatalBefore = await audioCount(api);
      const over = await api.until((s) => s.screen === "gameover", {
        max: 300,
        poll: 6,
      });
      onFatal = (await audioCount(api)) - fatalBefore;
      ended = over.hit;
      await api.advance(120); // 2 s on the Game-over screen the sting belongs to
    },

    async assert(api, check) {
      check.expectOk("a leak costs a life without ending the run", survived);
      check.expectOk("the last-life leak ends the run", ended);
      check.expectGt(
        "the fatal leak plays more than a survivable one (the Game-over sting)",
        onFatal,
        onLeak,
      );
    },
  };
}

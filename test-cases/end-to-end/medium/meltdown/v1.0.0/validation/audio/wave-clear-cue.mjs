// Automated validation for the Audio item `wave-clear-cue`: a distinct cue plays when
// a wave clears. Audio is read from the Web Audio sources the build starts (see
// `api.audio`).
//
// The probe COUNTS sources; it cannot say which cue started one. A wave clears on the
// tick its last unit dies or leaks, and both of those play their own cue, so "the log
// grew as the wave cleared" is true of a build with no wave-clear cue at all. The two
// are separated by differencing: each window below contains exactly ONE unit leaving
// the floor through an exhaust, and only the second one also clears a wave.
//
// The milestone wave is what makes the windows comparable. Containment's midpoint
// wave is a single Core (specs/surge.md), so the wave's last unit is also its only
// one and the clear is reachable with exactly one leak in the window. The control
// leaks the same unit type with no wave running at all — a Core injected during the
// untimed opening phase walks the same floor to the same exhaust, and the run has no
// wave to clear.

//
// The baseline window's own cue is measured but NOT asserted on. Whether a shot or a
// leak is itself audible belongs to `audio.fire-cue` and `audio.leak-cue`; requiring
// it here too would fail this item for a defect another item already owns, and the
// comparison below is sound either way — a build that plays nothing at all fails it,
// because then neither window grows.

import { newGame, spawn, armAudio, audioCount } from "../_helpers.mjs";

export default function item() {
  let onLeak;
  let onClear;
  let leaked;
  let cleared;

  return {
    id: "audio.wave-clear-cue",

    // Nothing is built, so a unit released here walks straight out an exhaust.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 1000000);
      await spawn(api, "core", "left");
      await armAudio(api);
    },

    // Window 1: the opening build phase, one Core walking out. A leak, and no wave to
    // clear. Window 2: the midpoint milestone wave, whose single Core walks out the
    // same way — the same one leak, plus the clear it completes. 3600 ticks = 60s,
    // enough for a 30 px/s Core to cross the floor after the wave's spawn delay.
    async act(api) {
      const lives0 = (await api.snapshot()).lives;
      const leakBefore = await audioCount(api);
      const out = await api.until((s) => s.lives < lives0, {
        max: 3600,
        poll: 6,
      });
      onLeak = (await audioCount(api)) - leakBefore;
      leaked = out.hit;

      await api.call("setWave", 10); // the midpoint Core wave (specs/surge.md)
      await api.call("setLives", 1000000);
      await api.call("startWave");
      const clearBefore = await audioCount(api);
      const done = await api.until((s) => s.wave >= 11, { max: 3600, poll: 6 });
      onClear = (await audioCount(api)) - clearBefore;
      cleared = done.hit;
    },

    async assert(api, check) {
      check.expectOk(
        "a Core walks out an exhaust with no wave running",
        leaked,
      );
      check.expectOk("the milestone wave's Core leaks and clears it", cleared);
      check.expectGt(
        "a leak that clears a wave plays more than one that does not (the wave-clear cue)",
        onClear,
        onLeak,
      );
    },
  };
}

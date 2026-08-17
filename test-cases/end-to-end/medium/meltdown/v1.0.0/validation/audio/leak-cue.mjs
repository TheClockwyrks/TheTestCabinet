// Automated validation for the Audio item `leak-cue`: a distinct cue plays when a
// unit leaks an exhaust. Audio is read from the Web Audio sources the build starts
// (see `api.audio`). A real Mote is spawned with no defense (the same setup as
// `surge.leak-costs-life`); audio is armed, and letting it walk out an exhaust must
// grow the audio log.

//
// EVERY READ OF THE AUDIO LOG IS A SETTLED ONE (`audioSettled`, not `audioCount`).
// The validate pass advances the simulation instantly, so a count taken on the tick an
// event happens gives the build no wall clock in which to schedule anything — and a
// build that raises its cues from its render frame, or rate-limits them against
// `AudioContext.currentTime`, has scheduled nothing yet. Both are conformant, and
// reading unsettled reported a full set of working cues as silence. See the note above
// `armAudio` in `_helpers`.

import {
  newGame,
  spawn,
  armAudio,
  audioSettled,
  skipToApproach,
  giveClockToBuild,
  untilOnOwnClock,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let leaked;

  return {
    id: "audio.leak-cue",

    // A recorded clip carries no audio track, so what this item's media can show is
    // the EVENT the cue is supposed to accompany. That event is the Mote's ARRIVAL at
    // an exhaust, not the 16 s walk to it, so the walk is run through unfilmed and the
    // measured window opens on the final approach.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 10);
      const moteId = await spawn(api, "mote", "left");
      await skipToApproach(api, moteId);
      await armAudio(api);
    },

    // 300 ticks = 5s, ample for the stretch the skip stopped on — the Mote's walk to
    // the exhaust is the only thing that can drop lives. The count is taken after the
    // skip, so nothing the approach played is inside the window.
    async act(api) {
      await giveClockToBuild(api);
      before = await audioSettled(api);
      const r = await untilOnOwnClock(api, (s) => s.lives < 10, {
        maxMs: 8000,
      });
      after = await audioSettled(api);
      leaked = r.hit;
      await api.advance(60); // a short tail so the clip shows the leak
    },

    async assert(api, check) {
      check.expectOk("the Mote leaks an exhaust", leaked);
      check.expectGt(
        "a cue plays when a unit leaks (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}

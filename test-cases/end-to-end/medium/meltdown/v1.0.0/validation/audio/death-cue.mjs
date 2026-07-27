// Automated validation for the Audio item `death-cue`: a distinct cue plays when a
// surge unit dies. Audio is read from the Web Audio sources the build starts (see
// `api.audio`).
//
// The probe COUNTS sources; it cannot say which cue started one. A kill is always
// delivered by a shot, and a shot plays the firing cue, so "the log grew while the
// unit was being killed" is true of a build with no death cue at all — the growth is
// the firing. The two events are separated by differencing instead: the same emitter
// fires exactly ONE shot in each of two windows, at a target that survives it and
// then at one that does not. Both windows carry a firing cue; only the second carries
// a death, so the death cue is whatever the second window has that the first does not.
//
// Counting is what makes the differencing necessary rather than just tidy: a build is
// free to synthesize one cue from several sources (an arpeggio is three), so no fixed
// number of sources means "a cue played" and only a comparison against a matched
// window is sound.
//
// A Lance posed at its redline one-shots a Mote (43 base x3.5 = ~150 vs 40 HP), so
// the kill lands on its first shot and the window cannot stretch to a second one.
// A Core (1600 HP) shrugs the same shot off, which is what makes it the control.

//
// The baseline window's own cue is measured but NOT asserted on. Whether a shot or a
// leak is itself audible belongs to `audio.fire-cue` and `audio.leak-cue`; requiring
// it here too would fail this item for a defect another item already owns, and the
// comparison below is sound either way — a build that plays nothing at all fails it,
// because then neither window grows.

import {
  newGame,
  restartGame,
  build,
  spawn,
  unit,
  armAudio,
  audioCount,
  TICK,
} from "../_helpers.mjs";

const LANCE_COL = 6;
const LANCE_ROW = 20;

// A Lance on the lane at its redline, with one unit of `type` walking into range.
async function poseLanceAgainst(api, start, type) {
  await start(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const id = await build(api, "lance", LANCE_COL, LANCE_ROW);
  await api.call("setHeat", id, 92); // its redline: full power, one-shots a Mote
  const target = await spawn(api, type, "left");
  return { id, target };
}

export default function item() {
  let lanceId;
  let coreId;
  let onShot;
  let onKill;
  let survived;
  let killed;

  return {
    id: "audio.death-cue",

    // Configuration A: the control — one shot at a Core, which survives it.
    async arrange(api) {
      const posed = await poseLanceAgainst(api, newGame, "core");
      lanceId = posed.id;
      coreId = posed.target;
      await armAudio(api);
    },

    // Window 1 ends on the tick the Lance first fires: exactly one shot, no death.
    // Window 2 re-poses the same Lance against a Mote and ends on the tick that Mote
    // leaves the floor — the same single shot, plus the kill it lands.
    async act(api) {
      const shotBefore = await audioCount(api);
      const fired = await api.until(
        (s) => s.towers.some((t) => t.id === lanceId && t.firing),
        { max: 360, poll: TICK },
      );
      onShot = (await audioCount(api)) - shotBefore;
      survived = fired.hit && (await unit(api, coreId)) !== null;

      const test = await poseLanceAgainst(api, restartGame, "mote");
      const killBefore = await audioCount(api);
      const gone = await api.until(
        (s) => !s.surge.some((u) => u.id === test.target),
        { max: 360, poll: TICK },
      );
      onKill = (await audioCount(api)) - killBefore;
      killed = gone.hit;

      await api.advance(30); // a short tail so the clip shows the kill
    },

    async assert(api, check) {
      check.expectOk(
        "the Lance fires, and the Core survives the shot",
        survived,
      );
      check.expectOk("the same Lance kills the Mote outright", killed);
      check.expectGt(
        "a killing shot plays more than a shot that kills nothing (the death cue)",
        onKill,
        onShot,
      );
    },
  };
}

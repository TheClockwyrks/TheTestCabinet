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
// A Lance posed hot one-shots a Mote, so the kill lands on its first shot and neither
// window can stretch to a second one. A Core (1600 HP) shrugs the same shot off, which
// is what makes it the control.
//
// WHY THE LANCE IS NOT POSED AT ITS REDLINE.
//
// It used to be posed at 92, its redline, for the full 3.5x multiplier — and at that
// heat it trips on the shot this item is built around. A Lance adds `heatPerShot /
// mass` per shot (48.9 / 2.8 = 17.5, specs/towers.md), so its first shot from 92 takes
// it to 100, which IS the trip (specs/heat.md). Both windows then hinge on whether a
// build reports `firing` on the same step it goes offline — a question specs/heat.md
// and specs/instrumentation.md leave open — and on a build that reports it the other
// way the Lance spends the next five seconds offline while the Core walks out of the
// scenario.
//
// None of that is this item's subject, and the full multiplier was never needed for
// it. A Lance at heat 60 multiplies by 0.35 + 3.15 * (60/92)^2 = 1.69 (specs/heat.md),
// so its shot does about 73 against a 40 HP Mote — a one-shot kill with room to spare —
// and lands at 77.5 heat afterwards, comfortably short of the trip. The Core's 1600 HP
// is untouched by either figure, so the control is unaffected.
//
// The window also ends on the shot CONNECTING rather than on the `firing` flag, for the
// same reason: `firing` is "whether it has a target and is firing this step"
// (specs/instrumentation.md), a per-step flag a sweep can land either side of, while a
// target whose `hp` has dropped has unambiguously been shot once.

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

// See the note above on why this is short of the Lance's 92 redline.
const LANCE_HEAT = 60;

// A Lance on the lane at its redline, with one unit of `type` walking into range.
async function poseLanceAgainst(api, start, type) {
  await start(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const id = await build(api, "lance", LANCE_COL, LANCE_ROW);
  // Hot enough to one-shot a Mote (x1.69 on 43 base ~= 73 vs 40 HP), cool enough that
  // the shot's own 17.5 heat leaves it at 77.5 and well short of the 100 trip.
  await api.call("setHeat", id, LANCE_HEAT);
  const target = await spawn(api, type, "left");
  return { id, target };
}

export default function item() {
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
      coreId = posed.target;
      await armAudio(api);
    },

    // Window 1 ends on the tick the Lance's shot connects with the Core: exactly one
    // shot, no death. Window 2 re-poses the same Lance against a Mote and ends on the
    // tick that Mote leaves the floor — the same single shot, plus the kill it lands.
    async act(api) {
      const shotBefore = await audioCount(api);
      // Ends on the shot CONNECTING — the Core's hp dropping — rather than on the
      // `firing` flag, so exactly one shot is in the window on any build.
      const fired = await api.until(
        (s) => s.surge.some((u) => u.id === coreId && u.hp < u.maxHp),
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

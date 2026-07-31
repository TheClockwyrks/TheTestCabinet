// Automated validation for the Audio item `trip-cue`: a distinct short cue plays when
// a tower trips its redline. Audio is read from the Web Audio sources the build starts
// (see `api.audio`).
//
// The probe COUNTS sources; it cannot say which cue started one. So the scenario has
// to be built such that the trip is the only cue-worthy thing that can happen inside
// the measured window, or the check proves nothing. Driving a tower to its redline by
// FIRING cannot do that: every shot on the way up plays the firing cue, so the log
// grows across the window whether or not the build has a trip cue at all — a build
// with `trip()` deleted passes.
//
// So the trip is reached without a shot being fired. A tower boxed in on all four
// faces has no air-facing edge to shed through and no conduction drain (the Forge and
// Sink have no heat of their own), so heat posed at the redline stays there rather
// than cooling back below it, and the real trip system takes it offline on the next
// step. Nothing is spawned, so no unit can fire at, die, or leak. The window then
// holds exactly one event.
//
// The same boxed tower posed just BELOW the redline is the control: identical floor,
// identical stepping, no trip. Its window must stay silent, which is what rules out a
// build that happens to emit sources continuously.

import { newGame, build, armAudio, audioCount, tower } from "../_helpers.mjs";

// Box a 2x2 emitter at (col,row) with a Forge on each face. Returns the emitter's id
// and how many faces were actually sealed — a refused placement leaves a face open to
// the air, which would let the posed heat bleed back down.
async function boxWithForges(api, type, col, row) {
  const id = await build(api, type, col, row);
  const faces = [
    [col, row - 2],
    [col, row + 2],
    [col - 2, row],
    [col + 2, row],
  ];
  let boxed = 0;
  for (const [c, r] of faces) {
    if ((await build(api, "forge", c, r)) !== null) boxed += 1;
  }
  return { id, boxed };
}

export default function item() {
  let id;
  let boxedFaces;
  let quiet;
  let onTrip;
  let tripped;

  return {
    id: "audio.trip-cue",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const c = await boxWithForges(api, "arc", 10, 10);
      id = c.id;
      boxedFaces = c.boxed;
      await armAudio(api);
    },

    // Control: posed below the redline, the boxed tower holds its heat and nothing
    // happens. Test: posed AT the redline, the real trip system takes it offline.
    // Both windows are 30 ticks of the same still floor.
    async act(api) {
      await api.call("setHeat", id, 96);
      const quietBefore = await audioCount(api);
      await api.advance(30);
      quiet = (await audioCount(api)) - quietBefore;

      await api.call("setHeat", id, 100);
      const tripBefore = await audioCount(api);
      await api.advance(30);
      onTrip = (await audioCount(api)) - tripBefore;

      const t = await tower(api, id);
      tripped = t !== null && t.tripped;
      await api.advance(30); // a short tail so the clip shows the trip
    },

    async assert(api, check) {
      check.expectEq(
        "the emitter was boxed in on all four faces",
        boxedFaces,
        4,
      );
      check.expectOk("the boxed emitter trips at the redline", tripped);
      check.expectEq(
        "a tower that has not tripped, on a still floor, plays nothing",
        quiet,
        0,
      );
      check.expectGt(
        "a cue plays when a tower trips (Web Audio sources started)",
        onTrip,
        0,
      );
    },
  };
}

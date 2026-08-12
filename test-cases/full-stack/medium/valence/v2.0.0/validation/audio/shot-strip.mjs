// Automated validation for the Audio item `shot-strip`: a distinct cue plays when a
// damage tower fires (specs/assets.md: "the shot cue when a damage tower fires").
// Audio is read from the Web Audio sources the build starts (see `api.audio`). Audio
// is armed with a real gesture first (the game must not autoplay before the player
// interacts); then a real Emitter is placed beside a large atom — the same set-up
// `fx.strip` uses — and the sim runs on until the tower's shot is in flight. The audio
// log must grow across the shot.

import {
  startScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  firstInRange,
  towerById,
  MAP,
  armAudio,
  settledAudioCount,
  audioCountAbove,
  TICK,
} from "../_helpers.mjs";

// ARMED BEFORE THE SCENARIO IS POSED.
//
// Arming audio costs REAL time — a browser gesture, then a wait for the log to go quiet and
// for the clips to decode, some seconds in all. specs/instrumentation.md says that time
// should be inert: `reset()` and `step()` put the game on its manual clock, and "while it is
// `false` the game still renders every frame but does not advance the simulation on its
// own". One of the builds under review advances anyway, and the posed unit walked the last
// of its lane and LEAKED during arming — so the item measured a window after the event it
// was about to look for, and reported no alarm on a build whose alarm had already sounded.
//
// Whether the clock is held is `instrumentation.scenario-round`'s business, not this item's.
// Posing after the arming costs nothing and makes this check independent of it.

export default function item() {
  let before;
  let after;
  let fired;

  return {
    id: "audio.shot-strip",

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const t = await placeCovering(api, "emitter", g, g.length * 0.18);
      // Armed with the lane still empty, so nothing can happen to the target while arming.
      await armAudio(api);
      const s0 = firstInRange(g, towerById(await api.snapshot(), t.id));
      await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 });
    },

    async act(api) {
      // A SETTLED baseline. Reading the log without letting the build paint first counts a
      // cue that was already queued but not yet drained as part of the event's gain — and,
      // worse, leaves a genuine cue straddling the baseline so it is subtracted from itself.
      // `settledAudioCount` is the same read with a paint pause on the near side.
      before = await settledAudioCount(api);
      // 180 ticks = the fx.strip cap; a shot is quick, so poll at the finest grain (TICK).
      const r = await api.until((s) => s.projectiles.length > 0, {
        max: 180,
        poll: TICK,
      });
      after = await audioCountAbove(api, before);
      fired = r.hit;
      await api.advance(30); // a short tail so the clip shows the shot
    },

    async assert(api, check) {
      check.expectOk("the tower fires a shot at the atom", fired);
      check.expectGt(
        "a shot cue plays on firing (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}

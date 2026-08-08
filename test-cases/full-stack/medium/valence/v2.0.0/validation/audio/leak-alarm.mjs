// Automated validation for the Audio item `leak-alarm`: a distinct cue plays when a
// unit reaches the collector and leaks (specs/assets.md: "the alarm on a leak"). Audio
// is read from the Web Audio sources the build starts (see `api.audio`). Audio is
// armed with a real gesture first, then a real unit is posed just short of the
// collector — the same set-up `maps.leak-at-collector` uses — and the sim runs on
// until it reaches the collector and is removed. The audio log must grow across the
// leak.

import {
  startScenario,
  pathGeom,
  spawnAt,
  unitById,
  armAudio,
  settledAudioCount,
  audioCountAbove,
  MAP,
} from "../_helpers.mjs";

// Real time allowed for the posed atom to cover the last stretch into the collector.
const LEAK_WINDOW_MS = 4000;

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
  let id;
  let before;
  let after;
  let leaked;

  return {
    id: "audio.leak-alarm",

    async arrange(api) {
      const snap = await startScenario(api, MAP.single, { integrity: 100000 });
      const g = pathGeom(snap.paths[0]);
      await armAudio(api);
      id = await spawnAt(api, {
        type: "atom",
        electrons: 3,
        pathId: 0,
        s: g.length - 25,
      });
    },

    // The unit covering the last stretch and leaking at the collector.
    async act(api) {
      // A SETTLED baseline. Reading the log without letting the build paint first counts a
      // cue that was already queued but not yet drained as part of the event's gain — and,
      // worse, leaves a genuine cue straddling the baseline so it is subtracted from itself.
      // `settledAudioCount` is the same read with a paint pause on the near side.
      before = await settledAudioCount(api);
      // THE LEAK IS RUN ON THE GAME'S OWN CLOCK.
      //
      // Nothing else is making a sound here — no tower is built — so the window can be as
      // wide as it likes; what it cannot be is INSTANT. A build is entitled to queue its
      // cues from the simulation and play them when it next paints, so under stepped time
      // the leak happens, the cue is queued, and the queue has not drained by the time the
      // log is read. One of the builds under review reported no alarm that way while
      // sounding it perfectly on its own clock. Handing the clock back for the crossing
      // measures what a player hears.
      await api.call("setAutoStep", true);
      let gone = false;
      for (let waited = 0; waited < LEAK_WINDOW_MS && !gone; waited += 100) {
        await api.settle(100);
        gone = unitById(await api.snapshot(), id) === null;
      }
      await api.call("setAutoStep", false);
      leaked = gone;

      after = await audioCountAbove(api, before);
      await api.advance(30); // a short tail so the clip shows the leak
    },

    async assert(api, check) {
      check.expectOk("the unit reaches the collector and is removed", leaked);
      check.expectGt(
        "an alarm cue plays on the leak (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}

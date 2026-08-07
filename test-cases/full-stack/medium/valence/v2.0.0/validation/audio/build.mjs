// Automated validation for the Audio item `build`: a distinct cue plays when a tower is
// placed (specs/assets.md: "the build cue on a placed tower"). Audio is read from the Web
// Audio sources the build starts (see `api.audio`), and audio is armed with a real gesture
// first, because the game must not autoplay.
//
// THE TOWER IS PLACED THE WAY A PLAYER PLACES ONE. That is the whole difference between this
// item reporting what a reviewer hears and reporting an implementation detail.
//
// specs/assets.md ties the cue to "a placed tower", and specs/instrumentation.md says the
// `placeTower` control op builds one "through the real placement path" — so on the face of it
// driving the debug op should be enough. It is not enough in practice: two of the builds
// under review start NO Web Audio source at all when a tower is placed through `placeTower`,
// while the reference starts exactly one, and in both of those builds the cue is plainly
// audible in game. Their cue lives on the pointer path — in the click that commits the
// placement — rather than inside the placement system the debug op reaches. Whether that
// makes their debug API imperfect is a question for the instrumentation item; it is not what
// THIS item asks, which is whether placing a tower makes a sound.
//
// So the placement is driven through the real bindings: the shop hotkey to enter build mode
// (specs/controls.md, "`1`–`7` for the seven towers in shop order") and a genuine
// browser-trusted click on a spot already known to be legal. If that path does not place a
// tower — a build may bind neither, and nothing in the spec forces it to answer a synthetic
// pointer — the check falls back to the control op rather than failing on the input layer,
// and the assertions state which path actually built the tower.

import {
  startRun,
  pathGeom,
  placeCovering,
  armAudio,
  settledAudioCount,
  audioCountAbove,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  STAGE_W,
  STAGE_H,
  MAP,
} from "../_helpers.mjs";

// The shop hotkey for the Emitter — the first entry in the shop order specs/towers.md lists.
const EMITTER_HOTKEY = "Digit1";

export default function item() {
  let spot;
  let towersBefore;
  let towersAfter;
  let placedBy;
  let before;
  let after;

  return {
    id: "audio.build",

    clipMs: clipBudget(LEAD_TICKS + TAIL_TICKS),

    // A legal spot is FOUND the reliable way — by really placing a tower there through the
    // control op and selling it again — so the pointer click that follows is aimed at a
    // position this build has already accepted. Guessing a point beside the lane and hoping
    // it is legal would make a silent build indistinguishable from a misaimed click.
    async arrange(api) {
      const snap = await startRun(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const probe = await placeCovering(api, "emitter", g, g.length * 0.18);
      spot = { x: probe.x, y: probe.y };
      await api.call("sellTower", probe.id);

      // Armed AFTER the probe, so the probe's own build and sell cues are behind the
      // baseline rather than inside the measured window.
      await armAudio(api);
      towersBefore = (await api.snapshot()).towers.length;
    },

    async act(api) {
      before = await settledAudioCount(api);
      await api.advance(LEAD_TICKS);

      // The player's path: hold an Emitter, then click the spot.
      await api.call("press", EMITTER_HOTKEY);
      await api.userDoubleClick(spot.x / STAGE_W, spot.y / STAGE_H);
      await api.settle(250);

      let now = await api.snapshot();
      if (now.towers.length > towersBefore) {
        placedBy = "pointer";
      } else {
        // This build does not answer the synthetic pointer or the hotkey. Fall back to the
        // control op so the item still measures a real placement.
        await api.call("placeTower", "emitter", spot.x, spot.y);
        await api.settle(250);
        now = await api.snapshot();
        placedBy = now.towers.length > towersBefore ? "control op" : "nothing";
      }
      towersAfter = now.towers.length;

      after = await audioCountAbove(api, before);
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        `a tower was placed (via the ${placedBy})`,
        towersAfter,
        towersBefore + 1,
      );
      check.expectGt(
        "a build cue plays on placement (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}

// Automated validation for the Audio item `fire`: a distinct synthesized cue plays when the
// ship fires. Audio is synthesized with the Web Audio API (specs/ui.md), so the driver
// reports every source the build starts (see `api.audio`). Audio is armed with one neutral key
// press first, because the game must not autoplay before the player interacts. Space is then
// pressed to fire a real shot, and the audio log must grow across it — the build played a cue.
// Nothing here inspects the sound itself; only that one was scheduled in response to the shot.
//
// The tap goes through `actTapFire`, which gives the shot one simulation tick before reading
// it. Firing is a simulation event, and a build may launch the round inside `press` or latch
// the tap and launch it on the next fixed step exactly as a real key tap does — both
// conformant. Reading with no time elapsed sees no bullet on the second kind, so this item
// would report a silent gun on a build that never got to fire at all.

import { newGame, poseShip, armAudio, actTapFire } from "../_helpers.mjs";

export default function item() {
  let before;
  let shot;
  let after;

  return {
    id: "audio.fire",

    async arrange(api) {
      await newGame(api); // clears rocks and the saucer, so only the shot can make a sound
      await poseShip(api, { x: 300, y: 360, vx: 0, vy: 0, angle: 0 });
      await armAudio(api);
    },

    async act(api) {
      before = (await api.audio()).length;
      shot = await actTapFire(api); // fire a single bullet
      after = (await api.audio()).length;
      await api.advance(60); // a tail so the clip shows the shot leave
    },

    async assert(api, check) {
      check.expectGt("a bullet is fired", shot.after, 0);
      check.expectGt(
        "a cue plays on firing (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}

// Automated validation for the Audio item `shatter`: a distinct synthesized cue plays when a
// rock shatters. Audio is armed with one neutral key press first (the game must not autoplay),
// then one of three posed Small rocks is destroyed with a real shot. The rocks are posed with
// `addRock` and the shot placed with `addBullet` (neither routes through the fire cue), so the
// only cue in the window is the shatter. The audio log must grow across the kill. A Small
// takes one hit in both variants, so this reads the same for base and Warhead.
//
// Three rocks rather than one, and only one of them shot, so that the kill this item listens
// to is never the kill that empties the field. Destroying the last rock clears the wave
// (`specs/gameplay.md`) and the game spawns the next one — five Large rocks — into the moment
// the check is reading, and "the rock is destroyed" (measured as an empty field) then read
// five. Killing one of three leaves two, which is a fact about the shot rather than about how
// quickly a build refills its field, and it holds on every build.
//
// Both ends of the audio comparison are read through `audioCount`, which settles a real frame
// first: a build may schedule its cues from the render loop, and the validate pass advances
// the clock instantly, so an unsettled read reports a silent build that is in fact playing.
// The baseline is taken at the end of `arrange`, not the top of `act`, because in the record
// pass the build is driving its own clock by then and the pause would be game time the
// scenario has not been watched through. See `_helpers.mjs`.

import {
  newGame,
  actFireOneShotAt,
  armAudio,
  audioCount,
} from "../_helpers.mjs";

// Three Smalls on separate lanes; only the first is shot.
const TARGETS = [
  { x: 380, y: 220 },
  { x: 520, y: 560 },
  { x: 900, y: 150 },
];

export default function item() {
  let before;
  let result;
  let after;

  return {
    id: "audio.shatter",

    async arrange(api) {
      await newGame(api); // clears rocks and the saucer, so only the shot can make a sound
      for (const t of TARGETS) {
        await api.call("addRock", "small", { ...t, vx: 0, vy: 0 });
      }
      await armAudio(api);
      before = await audioCount(api);
    },

    async act(api) {
      result = await actFireOneShotAt(api, TARGETS[0], { dwell: 30 });
      after = await audioCount(api);
    },

    async assert(api, check) {
      check.expectOk("the shot is spent on the rock", result.spent.hit);
      check.expectEq(
        "the rock is destroyed, leaving the two that were not shot",
        result.snap.rocks.length,
        2,
      );
      check.expectGt(
        "a cue plays when the rock shatters (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}

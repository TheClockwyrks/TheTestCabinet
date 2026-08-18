// controls.mute: M toggles mute during a dive, and a muted dive makes no sound.
//
// WHY THIS RUNS IN THE MAZE AND NOT AT THE TITLE. Muting is defined as part of audio
// (`specs/progression.md`: "Provide a mute toggle"), and every cue the spec names — the
// eat, the pulse, the ink, a predator's own pulse or flare, the catch, the descent — is
// something that happens inside a dive. Nothing requires a build to make, or to be able
// to silence, any sound on a menu screen. This item used to press M at the title and read
// the flag back, which asked for a binding on a screen the spec never gives one, and
// failed a build that binds mute exactly where its sound lives. It now drives the toggle
// where it does something, and reads that something: a muted dive that fires a sonar
// pulse must start no audio for it, and unmuting must bring the cue back.
//
// Entering play and arming audio is instant (`arrange`); the two toggles and the pulses
// either side of them are the real game, so they are `act`.
import { armAudio, audioCount, startPlaying } from "../_helpers.mjs";

export default function item() {
  let before;
  let muted;
  let unmuted;
  let mutedCues;
  let unmutedCues;

  return {
    id: "controls.mute",

    async arrange(api) {
      await startPlaying(api);
      // A GENUINE browser gesture, so a conforming build's AudioContext exists before
      // any cue is driven (see `armAudio`); a debug `press` may not unlock it.
      await armAudio(api);
      await api.call("clearCooldowns");
    },

    async act(api) {
      before = (await api.snapshot()).muted;

      await api.call("press", "KeyM");
      muted = (await api.snapshot()).muted;

      // The sonar pulse is one of the cues `specs/progression.md` requires, and it is
      // the one a scenario can fire on demand, so it is what mute is measured against.
      const quiet0 = await audioCount(api);
      await api.call("press", "Space");
      await api.advance(30); // 30 ticks = 0.25 s, well past the cue's own start
      mutedCues = (await audioCount(api)) - quiet0;
      await api.settle(150); // a REAL pause so the muted dive is painted for the still
      await api.screenshot("mute");

      await api.call("press", "KeyM");
      unmuted = (await api.snapshot()).muted;
      await api.call("clearCooldowns");
      const loud0 = await audioCount(api);
      await api.call("press", "Space");
      await api.advance(30);
      unmutedCues = (await audioCount(api)) - loud0;
    },

    async assert(api, check) {
      check.expectEq("a dive starts unmuted", before, false);
      check.expectEq("pressing M toggles mute on", muted, true);
      check.expectEq("pressing M again toggles mute off", unmuted, false);
      check.expectEq(
        "a muted dive starts no audio for a sonar pulse",
        mutedCues,
        0,
      );
      check.expectGt("unmuting restores the pulse's cue", unmutedCues, 0);
    },
  };
}

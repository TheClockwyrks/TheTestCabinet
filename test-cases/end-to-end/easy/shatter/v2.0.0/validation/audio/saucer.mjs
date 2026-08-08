// Automated validation for the Audio item `saucer`: a distinct synthesized cue marks the
// saucer's arrival. What this can observe is the reason the item is scoped to the arrival
// rather than to a hum held while the saucer is present: the driver's probe records that a
// Web Audio source was STARTED, and a sustained tone and a half-second blip both start
// exactly one source, so no assertion here could tell them apart. `specs/ui.md` therefore
// asks for the cue on arrival and leaves sustaining it optional, which is what the case's own
// reference implementation does. Audio is armed with one neutral key press first (the game must not
// autoplay), then the real game is run forward until a saucer arrives on its own spawn cadence
// (the first saucer enters ~18 s into a game). Nothing else makes a sound in that window — the
// ship is idle and no rock is shot — so the audio log growing when the saucer appears is the
// arrival cue. Driving the NATURAL spawn (rather than the debug `spawnSaucer`) keeps the check
// fair: it tests the game's own arrival event, not a debug-op side effect.
//
// Because the arrival is the game's own, the setup must not disturb the cadence it is about
// to measure — which is why this does NOT use `newGame`. That helper clears the field with
// `clearRocks` and `removeSaucer`, and removing a saucer is exactly the event that schedules
// the NEXT one: on a build that re-rolls the gap from that call, asking to remove a saucer
// that was never there replaces the game's "first one at about 18 s" with a fresh 25-to-35 s
// wait (`specs/hazards.md`), and the sweep then times out on a build whose cadence is
// perfectly correct. The game is started and left alone instead. Nothing else on the field
// makes a sound in the window: the ship is idle and invulnerable, and a rock the star recycles
// is not destroyed and scores nothing, so the log growing is the saucer.
//
// The first spawn is ~18 s out, so this item films longer than the default clip budget: the
// record pass needs to reach the arrival, hence `clipMs`. The verdict comes from the uncapped
// validate pass regardless. The sweep allows 25 s — room around the spec's "about 18 seconds"
// — and polls every 12 ticks, which keeps it cheap while still catching the arrival closely.
//
// Both ends of the audio comparison are read through `audioCount`, which settles a real frame
// first: a build may schedule its cues from the render loop, and the validate pass advances
// the clock instantly, so an unsettled read reports a silent build that is in fact playing.
// The baseline is taken at the end of `arrange`, not the top of `act`, because in the record
// pass the build is driving its own clock by then and the pause would be game time the
// scenario has not been watched through. See `_helpers.mjs`.

import { armAudio, ticks, audioCount } from "../_helpers.mjs";

export default function item() {
  let before;
  let result;
  let after;

  return {
    id: "audio.saucer",
    clipMs: 24000, // the first saucer arrives ~18 s in; film long enough to reach it

    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("startGame");
      await api.call("setInvuln", 99); // seconds — the ship survives to the spawn
      await armAudio(api);
      before = await audioCount(api);
    },

    async act(api) {
      result = await api.until((s) => s.saucer !== null, {
        max: ticks(25),
        poll: 12,
      });
      after = await audioCount(api);
      await api.advance(120); // 1 s, so the clip holds on the saucer that arrived
    },

    async assert(api, check) {
      check.expectOk("a saucer arrives on its own cadence", result.hit);
      check.expectGt(
        "a cue marks the saucer's arrival (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}

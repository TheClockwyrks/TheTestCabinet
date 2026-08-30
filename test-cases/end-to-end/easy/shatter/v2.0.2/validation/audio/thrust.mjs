// Automated validation for the Audio item `thrust`: a distinct synthesized cue plays while the
// ship thrusts. Audio is armed with one neutral key press first (the game must not autoplay),
// then the thrust key is held and the real sim stepped so the ship accelerates and the build
// starts its thrust sound. The ship must actually speed up, so whatever is heard is tied to real
// thrust rather than an idle key.
//
// Thrust is held TWICE, with the key released in between, because a build is free to shape a
// thrust sound in more than one way. One long hold sees a build that starts a rumble for the
// duration; a second hold after a release also sees one that restarts its sound per burst; and
// the sustained holds see one that puffs a source per exhaust tick.
//
// WHAT THE VERDICT GRADES. `api.audio` reports each Web Audio source the build `start()`s, and
// when. `specs/ui.md` asks thrust for a HELD sound — "running for as long as the thrust key is
// down ... a single blip when thrust begins is not enough" — and the idiomatic, click-free way to
// hold one is ONE voice started once and left running, its gain ramped up while thrusting and
// back down on release. That shape starts its source before the hold begins, so an item that
// asked only whether the log grew ACROSS the hold would mark it silent while it played exactly
// the sound the spec asked for. So the verdict accepts either witness:
//
//   - the build STARTS sources while thrusting, more than it does over an identical window in
//     which nothing is held (the per-burst and per-puff shapes); or
//   - the build starts nothing in EITHER window, but brought a voice up AS AUDIO WAS ARMED that
//     it could be ramping (the sustained shape).
//
// The second is a concession, and it is bounded by that last qualification, which is the whole
// reason the baseline is read TWICE — once before `armAudio` and once after. The clause counts
// only what the arming gesture itself brought up, not every source started since the page loaded.
// Without that, a source started anywhere earlier in the scenario would satisfy it: a build that
// plays a start-of-game cue from `startGame` — a natural thing to add, and `newGame` runs it
// during arrange — would pass the clause on that cue alone with a wholly mute thrust. Narrowing
// it to the arming step costs only one shape, a build that starts its voice at PAGE LOAD, and
// `specs/ui.md` already tells builds not to do that ("do not start audio until the player first
// interacts"). A build that instead defers its graph to the first BOUND key is unaffected: its
// voice comes up on the first thrust, which is a start inside the thrust window and so the first
// clause, not this one.
//
// Whether the cue is held for the duration or blips at each onset is the reviewer's call, off the
// clip; this item grades that a cue is driven by thrust.
//
// THE CONTROL WINDOW IS THE SAME LENGTH AS THE THRUST WINDOW. That is not tidiness: the counts
// are compared directly, so a build with a periodic ambient would contribute more starts to a
// longer window purely by its length and pass on noise that has nothing to do with thrust. Equal
// windows make the comparison mean what it says.
//
// Every end of the audio comparison is read through `audioCount`, which settles a real frame
// first: a build may schedule its cues from the render loop, and the validate pass advances the
// clock instantly, so an unsettled read reports a silent build that is in fact playing. The
// arm-time baseline is taken at the end of `arrange`, not the top of `act`, because in the record
// pass the build is driving its own clock by then and the pause would be game time the scenario
// has not been watched through. See `_helpers.mjs`.

import {
  newGame,
  poseShip,
  armAudio,
  actHoldKey,
  audioCount,
} from "../_helpers.mjs";

// The thrust window: a burst, a coasting gap with the key up, and a second burst. The control
// window that precedes it holds nothing for the same total, so the two are comparable.
const BURST = 60; // 0.5 s
const GAP = 24; // 0.2 s
const WINDOW = BURST + GAP + BURST;

export default function item() {
  let preArm;
  let atArm;
  let idle;
  let after;
  let ship;
  let again;

  return {
    id: "audio.thrust",

    async arrange(api) {
      await newGame(api); // clears rocks and the saucer, so only the thrust can make a sound
      await poseShip(api, { x: 300, y: 500, vx: 0, vy: 0, angle: 0 });
      // Read either side of the arming gesture, so a sustained voice can be told from anything
      // the scenario itself already played — see the header.
      preArm = await audioCount(api);
      await armAudio(api);
      atArm = await audioCount(api);
    },

    async act(api) {
      // The control window: the same span of live game with nothing held, so whatever the build
      // starts here is its idling, not its thrust.
      await api.advance(WINDOW);
      idle = await audioCount(api);

      // The thrust window.
      ship = await actHoldKey(api, "KeyW", BURST); // hold thrust 0.5 s and run the real sim
      await api.advance(GAP); // 0.2 s coasting, key released
      again = await actHoldKey(api, "KeyW", BURST); // and a second burst
      after = await audioCount(api);
    },

    async assert(api, check) {
      check.expectGt(
        "holding thrust actually accelerates the ship",
        ship.after.speed,
        ship.before.speed,
      );
      check.expectGt(
        "the second burst thrusts too",
        again.after.speed,
        again.before.speed,
      );

      const whileThrusting = after - idle;
      const whileIdle = idle - atArm;
      const onArming = atArm - preArm;
      // Either the build started sources for the thrust that it does not start when idling, or it
      // started nothing either way and brought a voice up on the arming gesture. See the header.
      const startsForThrust = whileThrusting > whileIdle;
      const holdsAVoice =
        whileThrusting === 0 && whileIdle === 0 && onArming > 0;
      // The probe times source starts, so this grades the cue as thrust-driven; the clip carries
      // the rest.
      check.expectOk(
        `a cue is driven by thrust rather than by idling (${whileThrusting} Web Audio source(s) ` +
          `started over the thrust, ${whileIdle} over an identical window with nothing held, ` +
          `${onArming} brought up by the arming gesture)`,
        startsForThrust || holdsAVoice,
      );
    },
  };
}

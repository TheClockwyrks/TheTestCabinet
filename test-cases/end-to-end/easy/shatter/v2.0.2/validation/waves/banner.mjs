// Automated validation for the Waves item `banner`: a brief WAVE N banner shows at the
// start of each wave. A real game is started and its wave SHOT down to nothing; the clear
// advances the wave and raises its banner, which the snapshot reports and a screenshot
// captures.
//
// The item waits for a banner EDGE rather than sampling a fixed moment. `specs/ui.md` puts
// a banner at the start of EACH wave, so a build may legitimately open the game with its
// wave 1 banner already showing, and may hold the next wave until that banner has
// finished. Sampling a fixed instant after the clear reads whichever banner happens to be
// up and calls it the new one — it would pass on a stale banner and fail a build whose
// opening banner has not yet elapsed. Letting the field settle first, then waiting for a
// banner to be RAISED, measures the banner this clear actually caused.
//
// THE FIELD IS CLEARED BY SHOOTING IT. An earlier revision emptied it with `clearRocks()`.
// That is a way to make room, not a way to destroy anything: `specs/instrumentation.md`
// gives it as "removes every rock from the field, so a scenario can start from a
// known-empty field or isolate a single rock it adds", it awards no score, and nothing
// makes a wave turn over on it. `specs/gameplay.md` says how a wave is cleared — "no rocks
// remain on the field, which happens only by shooting every rock down to nothing" — so a
// build may raise its next wave from the destruction that empties the field rather than
// from polling the field's emptiness. The two are the same thing in play and come apart
// only under a debug op, and a graded build that does it the first way was failed here for
// a banner it raises perfectly well when a wave is actually cleared.
//
// The grinding is `skipShootRocksDown`, instant in both passes, and it leaves ONE Small, so
// `act` opens on a single rock, shoots it, and the banner it raises is the next thing on
// screen. The screenshot is what this item declares, and it is taken on that banner.
//
// The wave number is waited for separately from the banner because the spec leaves the
// turnover point open: the banner names "the wave about to start", so a build may count
// the new wave from the banner or from the spawn that follows it. Either satisfies the
// item.
//
// The SPAWN's place in that sequence is not open, and this item is where it is graded.
// `specs/gameplay.md` puts the two in order — "show a brief WAVE N banner (about 1.5 s,
// with N the wave about to start) ... then spawn the next wave" — so the banner runs on a
// field the next wave has not been put on yet, which is what makes it a moment of respite
// rather than a caption over five Large rocks already bearing down. So the field is read
// at the instant the banner is raised (it must still be empty) and the spawn is then
// waited for separately (it must not have happened yet when the banner went up).
//
// The turnover latitude above is deliberately not extended to this. A build may count the
// new wave from either end of the banner because the spec never says which; it may not
// spawn during the banner, because the spec says "then".
//
// It is graded here rather than left to the items that merely trip over it. Several checks
// isolate a subject on a cleared field, and a wave arriving early lands in the middle of
// their measurements — but they now park a bystander rock so the field never empties at
// all (see `arrangeBystanderRock` in `_helpers.mjs`), which is the right way for an item
// to handle a rule that is not its subject. That leaves this one item asking the question
// directly, on a transition it drives on purpose.
//
// The pause before the capture is `api.settle`, not `api.advance`: the banner has to have
// been PAINTED for the screenshot to show it, and advancing further would risk stepping
// past it.

import {
  TICK,
  ticks,
  actShootRockAt,
  skipShootRocksDown,
} from "../_helpers.mjs";

const WINDOW = 3; // seconds to allow each transition (the banner itself is about 1.5 s)

export default function item() {
  // The wave in play before the clear, and the transitions `assert` reads.
  let before;
  let fielded;
  let settled;
  let ground;
  let lastRock;
  let cleared;
  let raised;
  let ended;
  let spawned;

  return {
    id: "waves.banner",

    async arrange(api) {
      await api.reset({ seed: 3 });
      await api.call("startGame");
      await api.call("setInvuln", 99); // seconds — keep the ship alive through the measurement

      // A wave has to be on the field before it can be cleared, and any banner the game
      // opened with has to have finished, so what follows is a banner THIS clear raised
      // rather than one that was already up.
      fielded = await api.skipUntil((s) => s.wave >= 1 && s.rocks.length > 0, {
        max: ticks(WINDOW),
        poll: TICK,
      });
      settled = await api.skipUntil((s) => !s.waveBanner, {
        max: ticks(WINDOW),
        poll: TICK,
      });
      before = settled.snap.wave;

      // Shoot the wave down to its last rock, off camera.
      ground = await skipShootRocksDown(api, { leave: 1 });
      lastRock = (await api.snapshot()).rocks.length;
    },

    async act(api) {
      // The last rock dies, which clears the wave.
      cleared = await actShootRockAt(api, { x: 640, y: 360 });
      // The grace the grind needed is over: the field is empty, so nothing can reach
      // the ship for the length of the banner. Dropping it matters for the STILL this
      // item declares — a build is free to blink an invulnerable ship (the reference
      // does, five times a second), so a screenshot taken while the timer is running
      // catches a field with no ship on it about half the time, and a reviewer holding
      // that up beside a run's own capture is comparing two coin flips.
      await api.call("setInvuln", 0);
      raised = await api.until((s) => s.waveBanner, {
        max: ticks(WINDOW),
        poll: TICK,
      });

      await api.settle(140); // let a frame paint the banner
      await api.screenshot("banner");

      // The wave number turns over to the next wave — whether the build turns it with the
      // banner or with the spawn that follows it.
      const turned = await api.until((s) => s.wave === before + 1, {
        max: ticks(WINDOW),
        poll: TICK,
      });
      // ...and the banner is brief: it goes away again rather than sticking.
      ended = await api.until((s) => !s.waveBanner, {
        max: ticks(WINDOW),
        poll: TICK,
      });
      // The next wave arrives — after the banner, which is what `spent` records: a
      // spawn that had already happened when the banner went up would have been
      // caught by the empty-field assertion at that instant instead.
      spawned = await api.until((s) => s.rocks.length > 0, {
        max: ticks(WINDOW),
        poll: TICK,
      });
      raised = { ...raised, turned };
    },

    async assert(api, check) {
      check.expectOk("a wave is on the field to be cleared", fielded.hit);
      check.expectOk(
        "the field is settled with no banner up before the clear",
        settled.hit,
      );
      check.expectEq(
        `the wave was shot down to a single rock (in ${ground} rounds)`,
        lastRock,
        1,
      );
      check.expectEq(
        "shooting the last rock leaves the field empty",
        cleared.snap.rocks.length,
        0,
      );
      check.expectOk("clearing the field raises a WAVE banner", raised.hit);
      check.expectEq(
        "the banner goes up on a field the next wave has not been spawned into yet",
        raised.snap.rocks.length,
        0,
      );
      check.expectOk("the wave advances to the next wave", raised.turned.hit);
      check.expectEq(
        "the banner is for the new wave",
        raised.turned.snap.wave,
        before + 1,
      );
      check.expectOk("the banner is brief — it clears again", ended.hit);
      check.expectOk(
        "the next wave is spawned once the banner has run, not during it",
        spawned.hit,
      );
    },
  };
}

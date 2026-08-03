// Automated validation for the Waves item `banner`: a brief WAVE N banner shows at the
// start of each wave. A real game is started and the field cleared; the clear advances the
// wave and raises its banner, which the snapshot reports and a screenshot captures.
//
// The item waits for a banner EDGE rather than sampling a fixed moment. `specs/ui.md` puts
// a banner at the start of EACH wave, so a build may legitimately open the game with its
// wave 1 banner already showing, and may hold the next wave until that banner has
// finished. Sampling a fixed instant after `clearRocks` reads whichever banner happens to
// be up and calls it the new one — it would pass on a stale banner and fail a build whose
// opening banner has not yet elapsed. Letting the field settle first, then waiting for a
// banner to be RAISED, measures the banner this clear actually caused.
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
// Everything here consumes time, so it all belongs to `act` — `clearRocks` is a control op,
// which is legal there — and the clip shows the transition itself.
//
// The pause before the capture is `api.settle`, not `api.advance`: the banner has to have
// been PAINTED for the screenshot to show it, and advancing further would risk stepping
// past it.

import { TICK, ticks } from "../_helpers.mjs";

const WINDOW = 3; // seconds to allow each transition (the banner itself is about 1.5 s)

export default function item() {
  // The wave in play before the clear, and the transitions `assert` reads.
  let before;
  let settled;
  let raised;
  let ended;
  let spawned;

  return {
    id: "waves.banner",

    async arrange(api) {
      await api.reset({ seed: 3 });
      await api.call("startGame");
      await api.call("setInvuln", 99); // seconds — keep the ship alive through the measurement
    },

    async act(api) {
      // Let any banner the game opened with finish, so what follows is a banner THIS clear
      // raised rather than one that was already up.
      settled = await api.until((s) => !s.waveBanner, {
        max: ticks(WINDOW),
        poll: TICK,
      });
      before = settled.snap.wave;

      await api.call("clearRocks"); // as if every rock were destroyed
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
      check.expectOk(
        "the field is settled with no banner up before the clear",
        settled.hit,
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

// gloamfin.silent-when-close: while it holds the forager at close hearing range the
// Gloamfin goes silent — it emits no ping until the forager slips back out of range.
//
// The Gloamfin holds a continuous lock straight off its hearing whenever the forager is
// inside its ~2-tile range, and while that lock holds it does not ping — not its ~4 s
// periodic ping and not a "lost you" ping (specs/predators/gloamfin.md). So this holds the
// forager inside that range for well past the 4 s ping cadence and confirms no ping ever
// leaves the Gloamfin while `hearingLock` stays true.
//
// THE PAIR IS POSED IN TWO SEALED POCKETS, DIAGONALLY ADJACENT. That does two jobs no
// amount of re-posing did well.
//
// It keeps them apart without touching them. An earlier form re-posed BOTH the forager and
// the Gloamfin onto fixed tiles every six ticks — a hundred and twenty times across the
// watch — because a Gloamfin that can reach the forager closes on it and takes a life
// mid-measurement. What a reviewer saw was the pair juddering in place for six seconds,
// and what the sensing code saw was its subject teleported out from under it on every
// other frame. Rock between them does the same job by standing still: hearing is explicitly
// "in or out of line of sight" (specs/predators/gloamfin.md), so a wall stops the Gloamfin
// reaching the forager without stopping it hearing one.
//
// And it puts the distance somewhere the answer is not a coin flip. Two tiles apart is
// `64 px`, which is exactly the hearing range — so whether a build locks at all came down
// to reading "within about 2 tiles" as `<=` or `<`. Every build under test failed here on
// that hair. Diagonally adjacent is `45 px`: inside "about 2 tiles" under any reading, and
// still far enough that nothing about contact comes into it.
import { startPlaying, poseMaze, denAllExcept, pred } from "../_helpers.mjs";

// `F` and `G` are diagonally adjacent, each walled into its own tile; the pocket off to
// the right holds the plankton, so eating the two tiles under the pair cannot clear the
// maze and descend mid-watch.
const SEALED_PAIR = [
  "F#  ...",
  "#G",
];

export default function item() {
  let lockedAtStart;
  let lockHeld;
  let pinged;
  let held = true;

  return {
    id: "gloamfin.silent-when-close",

    async arrange(api) {
      await startPlaying(api);
      const board = await poseMaze(api, SEALED_PAIR);
      // Park the other two predators in the den so only the Gloamfin is in play.
      await denAllExcept(api, ["gloamfin"]);
      await api.call("setForager", board.mark("F"));
      await api.call("setPredator", "gloamfin", {
        ...board.mark("G"),
        mode: "chase",
      });
    },

    async act(api) {
      await api.advance(6); // 6 ticks = 0.05 s: let the close-range lock take hold
      const opening = await api.snapshot();
      const lives = opening.lives;
      lockedAtStart = pred(opening, "gloamfin").hearingLock;

      lockHeld = lockedAtStart === true;
      pinged = false;
      const poll = 6; // 0.05 s sweeps
      const sweeps = Math.ceil(720 / poll); // 720 ticks = 6 s, well past the 4 s ping cadence
      for (let i = 0; i < sweeps; i++) {
        await api.advance(poll);
        const s = await api.snapshot();
        // The rock is what holds this scenario together, so notice if it stopped holding.
        // A Gloamfin that crosses it and takes a life re-dens every predator and respawns
        // the forager somewhere else entirely — after which "the lock dropped" is true and
        // says nothing about hearing. Reported on its own assertion below.
        if (s.lives < lives) held = false;
        if (pred(s, "gloamfin").hearingLock !== true) lockHeld = false;
        // Any Gloamfin wavefront in flight means a ping fired — it must not, while the
        // hearing lock holds.
        if (s.pulses.some((p) => p.source === "gloamfin")) pinged = true;
      }
    },

    async assert(api, check) {
      check.expectOk(
        "the walls held the pair apart for the whole watch (the forager was not caught through rock)",
        held,
      );
      if (!held) return;
      check.expectOk(
        "the Gloamfin holds a continuous close-range hearing lock",
        lockedAtStart === true,
      );
      check.expectOk(
        "it keeps the lock the whole time the forager stays in range",
        lockHeld === true,
      );
      check.expectOk(
        "it emits no ping while it holds the forager at close range (goes silent)",
        pinged === false,
      );
    },
  };
}

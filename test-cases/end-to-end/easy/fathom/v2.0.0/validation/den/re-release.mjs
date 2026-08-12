// den.re-release: losing a life returns every predator to the den and restarts the
// staggered release, so you get a moment to reorient.
//
// WHAT THE SCHEDULE IS MEASURED AGAINST HERE. `specs/predators.md` says the survivors
// "re-release on the same schedule" and nothing more, and a life lost drops the dive back
// into its countdown — so whether that countdown eats into the first timer is exactly the
// choice the spec leaves open (see the note in `den/stagger.mjs`). Unlike the first maze
// there is no `beginPlay` moment to collapse it: the countdown is part of what is being
// measured, and an assertion timed from the death would fail whichever reading it did not
// happen to assume.
//
// So the spacing is read as gaps, which are the same number under either reading. Gaps
// alone would not be enough: they pin the spacing and leave the ORIGIN free, and a den
// that holds every predator for half a minute after the respawn and then lets them out
// `5 s` apart would satisfy every gap while breaking the schedule outright. The head of
// the schedule is therefore anchored to the moment live play RESUMES — whichever way a
// build reads the countdown, once the game is running again the first predator is due —
// so the origin is pinned without the countdown ever entering the arithmetic. A build
// that releases DURING its countdown lands before the resume, which reads as early rather
// than late and passes, as it should.
//
// Note the shape a broken build takes, and why the catch is driven at once. A release
// timer held as an ABSOLUTE time against a clock that the respawn never resets looks
// perfect on the first maze — 0, 5, 10 against a sim time starting at 0 — and only comes
// apart after a life is lost, which is why this cannot be folded into `den/stagger.mjs`:
// the first maze is the case that build gets right.
//
// How badly it comes apart depends on WHEN the life was lost, and the answer is worst for
// the player and mildest for a check: a death at sim time `T` leaves the survivors' first
// slot already expired, so the Lanternjaw comes out as the countdown ends, at about
// `T + C`, while the Gloamfin still waits for the absolute `5 s` — a gap of `5 - (T + C)`
// rather than `5`, shrinking to nothing once `T + C` passes `5 s` and every predator
// spills out together. This item takes the life IMMEDIATELY, at `T ~ 0`, which is that
// build's BEST case (the widest gap it can produce, about `5 s` minus the countdown) and
// still outside the band. A check that waited to be caught in ordinary play would fail
// the same build more dramatically and would depend on a chase to land; failing it at its
// best case is the stronger result and the steadier scenario.
//
// The catch is driven through the real collision: the Lanternjaw is posed onto the
// forager's tile in `chase` and the game's own code takes the life. Nothing here fakes a
// death or writes a life count.
import {
  DEN_IMMEDIATE,
  DEN_ORDER,
  DEN_RELEASE_GAP,
  DEN_RELEASE_SLACK,
  DEN_RESUME_TOLERANCE,
  actDenReleases,
  parkClearOfDen,
  pred,
  quietBoard,
  startPlaying,
  ticksFor,
  unmetPrecondition,
} from "../_helpers.mjs";

export default function item() {
  let livesBefore;
  let caught;
  let dennedOnDeath = 0;
  let releases = [];
  let resumedAt = null;

  return {
    id: "den.re-release",

    // The catch, the countdown, and then a 10 s schedule to watch out.
    clipMs: 16000,

    async arrange(api) {
      const snap = await startPlaying(api);
      // One plankton, and the forager parked facing a wall on its own tile: it must not
      // graze the maze clear out from under a measurement that spans a respawn.
      await quietBoard(api);
      livesBefore = snap.lives;
    },

    async act(api) {
      const s = await api.snapshot();
      // Onto the forager's own tile, fixed on it: the real chase-and-contact code then
      // takes the life, on its own terms.
      await api.call("setPredator", "lanternjaw", {
        tx: s.forager.tx,
        ty: s.forager.ty,
        mode: "chase",
      });
      caught = await api.until((x) => x.lives < livesBefore, {
        max: ticksFor(4),
        poll: 2,
      });
      if (!caught.hit) {
        // A predator posed onto the forager's tile did not catch it within four seconds.
        // Whether contact costs a life is `scoring/caught-costs-life`'s verdict, not
        // this item's — without a death there is simply no re-release to read.
        throw unmetPrecondition(
          "a Lanternjaw posed onto the forager's tile did not catch it, so no life was " +
            "lost and there was no re-release to time",
        );
      }
      dennedOnDeath = DEN_ORDER.filter(
        (kind) => pred(caught.snap, kind)?.state === "den",
      ).length;

      // The respawn puts the forager back on its start tile, near the den it is about to
      // watch empty; park it clear again so the schedule can run out unmolested.
      await parkClearOfDen(api);
      // Slot deadlines rather than a window, as in `den/stagger.mjs` — and the wait for
      // live play covers the respawn countdown on its way through.
      ({ releases, resumedAt } = await actDenReleases(api));
    },

    async assert(api, check) {
      check.expectOk("the forager is caught and loses a life", Boolean(caught?.hit));
      if (!caught?.hit) return;

      check.expectEq(
        "every predator returns to the den",
        dennedOnDeath,
        DEN_ORDER.length,
      );
      check.expectEq(
        "the den empties again in order, each predator within a slot of the one before",
        releases.map((r) => r.kind).join(" → ") || "(none left the den)",
        DEN_ORDER.join(" → "),
      );
      if (releases.length < DEN_ORDER.length) return;

      check.expectOk("the dive returns to live play", resumedAt !== null);
      if (resumedAt === null) return;
      // Both sides of the resume. Late is the schedule stalling; EARLY is a predator
      // already loose while the player is still watching the countdown, which spends the
      // reorientation moment this item exists to protect. `den/stagger.mjs` needs only
      // the late half — `beginPlay` leaves it no countdown for anything to happen in.
      check.expectGe(
        "no predator is loose before play resumes",
        releases[0].t - resumedAt,
        -DEN_RESUME_TOLERANCE,
      );
      check.expectLe(
        "the Lanternjaw is out as soon as play resumes",
        releases[0].t - resumedAt,
        DEN_IMMEDIATE,
      );
      check.expectClose(
        "the schedule restarts: the Gloamfin 5 s behind the Lanternjaw",
        releases[1].t - releases[0].t,
        DEN_RELEASE_GAP,
        DEN_RELEASE_SLACK,
      );
      check.expectClose(
        "and the Flarefish 5 s behind the Gloamfin",
        releases[2].t - releases[1].t,
        DEN_RELEASE_GAP,
        DEN_RELEASE_SLACK,
      );
    },
  };
}

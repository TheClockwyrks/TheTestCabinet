// den.stagger: the predators leave the den one after another, 5 s apart, in the fixed
// order Lanternjaw, Gloamfin, Flarefish.
//
// WHY THE GAPS AND NOT THE INSTANTS. `specs/predators.md` fixes the ORDER and the
// SPACING ("each leaving `5 s` after the one before it"), and states one absolute: the
// first predator leaves "immediately (release time `0`)". What it does not fix is
// whether the dive countdown that precedes live play counts against that clock — a build
// that runs its den timers through the countdown and one that starts them when play
// begins are both conforming, and they differ by the whole countdown. So the spacing is
// asserted as gaps, which read the same under either choice.
//
// AND WHY THE GAPS ARE MEASURED FROM `released`. The spacing is between release times,
// not between arrivals in the corridor: a released predator still has to swim from
// whatever den tile it was waiting on out through the gate, and `specs/maze.md` fixes
// neither the tile nor the chamber's interior, so those two swims differ by however far
// apart the build parked them. Measured from the moment each hunter clears the den, a
// perfectly staggered build reports gaps that are wrong by the difference. `released`
// is the schedule itself (`specs/instrumentation.md`), and `outAt` — the tile leaving
// the chamber — carries the separate claim that the release actually happened in the
// maze. See `actDenReleases`.
//
// The one absolute IS asserted, and safely: `startPlaying` enters live play through
// `beginPlay`, which ends the countdown without consuming it (specs/instrumentation.md),
// so no time has passed under either reading at the moment the watch opens. "Release
// time 0" is therefore the same instant either way, and a Lanternjaw still sitting in the
// den a second later has not left immediately under any reading of the spec.
//
// The whole item is `act`: the release schedule is a clock, and the clip is that clock
// running — three predators leaving a den one after another is exactly what a reviewer
// needs to see to judge a stagger.
import {
  DEN_IMMEDIATE,
  DEN_ORDER,
  DEN_RELEASE_GAP,
  DEN_RELEASE_SLACK,
  actDenReleases,
  parkClearOfDen,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let releases = [];
  let resumedAt = null;
  let reportsReleased = false;

  return {
    id: "den.stagger",

    // The third predator is due 10 s in; the default 8 s budget would cut the clip off
    // before the release this item is most likely to catch a build out on.
    clipMs: 13000,

    async arrange(api) {
      await startPlaying(api);
    },

    async act(api) {
      await parkClearOfDen(api);
      // No window to pick: each release is waited for against its own slot deadline
      // (see `actDenReleases`), so a den that never opens stops the watch a slot later
      // rather than burning a budget someone had to guess at.
      ({ releases, resumedAt, reportsReleased } = await actDenReleases(api));
    },

    async assert(api, check) {
      // The schedule is read off `released`, so say so first: without that field this
      // item sees no releases at all, and "the den never opened" would name the wrong
      // thing. `specs/instrumentation.md` requires it of every predator entry.
      check.expectOk(
        "the build reports each predator's `released` flag, so the schedule can be read",
        reportsReleased,
      );
      if (!reportsReleased) return;
      // Order and completeness in one reading: comparing the sequence rather than
      // counting it means a den that stalls halfway shows exactly how far it got.
      check.expectEq(
        "the den empties in order, each predator within a slot of the one before",
        releases.map((r) => r.kind).join(" → ") || "(none left the den)",
        DEN_ORDER.join(" → "),
      );
      if (releases.length < DEN_ORDER.length) return;

      check.expectLe(
        "the Lanternjaw leaves immediately",
        releases[0].t - resumedAt,
        DEN_IMMEDIATE,
      );
      check.expectClose(
        "the Gloamfin follows 5 s later",
        releases[1].t - releases[0].t,
        DEN_RELEASE_GAP,
        DEN_RELEASE_SLACK,
      );
      check.expectClose(
        "the Flarefish 5 s after that",
        releases[2].t - releases[1].t,
        DEN_RELEASE_GAP,
        DEN_RELEASE_SLACK,
      );
      // And each of them actually LEFT. The three assertions above are about the schedule,
      // which is a matter of when a build stops calling a predator denned; this one is
      // about the release being a thing that happens in the maze. A build that flips the
      // flag and leaves the hunter standing in the chamber passes every timing above and
      // has released nobody — see `actDenReleases`.
      const stuck = releases.filter((r) => r.outAt === null).map((r) => r.kind);
      check.expectOk(
        "and each of them swims out of the chamber, not merely out of the den state" +
          (stuck.length ? ` — the ${stuck.join(" and ")} never left it` : ""),
        stuck.length === 0,
      );
    },
  };
}

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
      ({ releases, resumedAt } = await actDenReleases(api));
    },

    async assert(api, check) {
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
    },
  };
}

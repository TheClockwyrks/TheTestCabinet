// instrumentation/reset-seeds-randomness — `reset({ seed })` seeds all of the
// game's randomness, so the same seed lays the same strait and a different seed
// lays a different one.
//
// specs/instrumentation.md rests the surface on it: "The randomness the game uses
// runs off a generator seeded by `reset`, and the generator keeps its whole state
// in the game's own state, so reseeding and replaying the same calls reproduces
// the same result exactly. The lanes' phases and the bay each bonus catch appears
// in are drawn from it", and "`options.seed`, a number defaulting to
// `DEFAULT_SEED` (`1`), seeds all of the game's randomness". specs/ice.md and
// specs/water.md name the phases as one of the draws — "Where a lane's pattern
// sits along its row when a level is laid out is drawn from the game's own seeded
// randomness" — and specs/bays.md names the other: "The bay a bonus catch appears
// in is drawn from the game's own seeded randomness".
//
// THOSE TWO ARE THE WITNESSES BECAUSE THEY ARE THE TWO DRAWS THE SPECIFICATION
// NAMES. The sixteen phases are laid in one go when a level opens, so two runs
// that agree on all sixteen agree on the generator rather than on a single coin
// toss; the bay is the one draw taken later, so it also says the generator's state
// travelled with the run rather than being re-seeded per level.
//
// THE ASSERTION IS AGREEMENT AND DISAGREEMENT, NOT A LAYOUT. Asserting a
// particular set of phases would fix the generator rather than the seeding, so
// what is read is that two runs of ONE seed agree and two runs of DIFFERENT seeds
// do not.
//
// THE RUN IS OPENED THROUGH THE TITLE'S FIRST ITEM, WHICH IS THE ONLY ROUTE. The
// surface poses fields; it has no operation that opens a run, and a level's lanes
// are laid out when one does. So `confirm` on the title's highlighted item — which
// `reset` leaves at `0` — is how a layout is reached at all, and a build that
// cannot open a run from its title fails here as well as at
// `screens/cross-starts-run`.
//
// WHAT THIS DOES NOT DECIDE. Nothing about the layout itself: that a lane is
// evenly spaced, that the band is staggered, and that the bonus catch appears in
// an OPEN bay are `ice/*`, `water/*` and `bays/fish-appears-in-open-bay`. This
// point reads only whether two straits are the same strait.

import { afterEach, beforeEach, it } from "vitest";
import { FISH_INTERVAL, crossingTimer } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertNotEqual,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  keysFor,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The seed two runs share, and the one a third run is given instead. */
const SEED = 7;
const OTHER_SEED = 8;

/**
 * How long a run is given to put its first bonus catch in a bay, in seconds.
 *
 * specs/bays.md fixes it at `FISH_INTERVAL` (`8` s) after the level is laid out,
 * so this is twice that with two seconds over: a build whose cadence is slower
 * than the figure still produces one here and is graded on the figure by
 * `bays/fish-interval`. It is also short of `crossingTimer(1)` (`30` s), so the
 * crossing the wait runs inside never runs out of time.
 */
const FISH_WINDOW = 2 * FISH_INTERVAL + 2;

/** How much game time separates two samples of that wait, in seconds. */
const POLL_SECONDS = 0.25;

/**
 * The sixteen lanes' phases as one comparable string: every lane item's row, kind
 * and left edge, in a fixed order.
 *
 * Sorted rather than compared where they lie, because the order a roster reports
 * its entries in is not what this point is about.
 */
function phasesOf(snapshot: FloeSnapshot): string {
  return [...snapshot.vehicles, ...snapshot.floes]
    .map((item) => `${item.row}:${item.kind}@${item.x.toFixed(4)}`)
    .sort()
    .join(" ");
}

/** One run's two draws, as the pair this point compares. */
interface Laid {
  phases: string;
  fishBay: number | null;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays the same strait for one seed and a different one for another", async () => {
  /** Seed the generator, open a run from the title, and read what it drew. */
  const runWith = async (seed: number): Promise<Laid> => {
    h.debug.reset({ seed });
    const title = h.snapshot();
    assertEqual(
      title.screen,
      "title",
      `the screen reset({ seed: ${seed} }) opened, which is the only place the ` +
        `run below can be started from`,
    );
    assertEqual(
      title.menuIndex,
      0,
      "the title menu's highlighted item after reset(), which CROSS occupies",
    );
    await h.tap(keysFor("confirm")[0]);

    // Read before any of the wait below, so both runs' phases are read at the
    // same point of their own game time.
    const phases = phasesOf(h.snapshot());
    const arrived = await h.skipUntil((s) => s.fishBay !== null, {
      maxSeconds: FISH_WINDOW,
      pollSeconds: POLL_SECONDS,
    });
    assertTrue(
      arrived.hit,
      `a bonus catch to be in a bay within ${FISH_WINDOW} s of a run opened ` +
        `after reset({ seed: ${seed} }) — specs/bays.md puts the first one out ` +
        `FISH_INTERVAL (${FISH_INTERVAL} s) after the level is laid out, inside ` +
        `the ${crossingTimer(1)} s the crossing has, and this point cannot ` +
        `compare a bay that never filled`,
    );
    return { phases, fishBay: arrived.snapshot.fishBay };
  };

  const first = await runWith(SEED);
  // Before the assertions, so a failing seed still leaves the picture of the
  // strait the first run laid.
  captureStill(h, "seeded");

  assertGreaterThan(
    first.phases.length,
    0,
    `the lane items a run opened after reset({ seed: ${SEED} }) laid — a run ` +
      `opens on confirm at the title's first item and lays the sixteen lanes ` +
      `then (specs/progression.md), and an empty strait leaves nothing to compare`,
  );

  const again = await runWith(SEED);
  assertEqual(
    again.phases,
    first.phases,
    `the sixteen lanes a second run opened after reset({ seed: ${SEED} }) laid, ` +
      `against the lanes the first one laid — the same seed replays the same ` +
      `draws exactly (specs/instrumentation.md)`,
  );
  assertEqual(
    again.fishBay,
    first.fishBay,
    `the bay the second run's first bonus catch appeared in, against the first ` +
      `run's — both runs were opened after reset({ seed: ${SEED} }) and the bay ` +
      `is drawn from that same seeded generator (specs/bays.md)`,
  );

  const other = await runWith(OTHER_SEED);
  assertNotEqual(
    `${other.phases}|fish ${other.fishBay}`,
    `${first.phases}|fish ${first.fishBay}`,
    `the sixteen lanes and the first bonus catch's bay of a run opened after ` +
      `reset({ seed: ${OTHER_SEED} }), against what seed ${SEED} drew — a ` +
      `different seed draws a different result, in at least one of them`,
  );
});

// controls/setmaze-houses-predators — a posed board puts every hunter away, and
// holds it there.
//
// specs/instrumentation.md fixes both halves of the claim. `setMaze` leaves the
// board "in the state a freshly laid-out maze starts in", with "every predator
// returned to a den tile with its `released` flag `false`", and "The staggered
// release schedule is **suspended** while a posed board stands, so no release time
// arrives and no predator leaves the den until a later `setPredatorState` poses it
// out." specs/predators.md fixes the schedule that is being suspended: release
// times of `0 s`, `DEN_RELEASE_GAP` (`5 s`) and `10 s`, measured from the moment
// live play begins.
//
// WHY THIS IS ITS OWN POINT. Most of this suite poses a fixture and then measures
// something standing on it, and every one of those checks is only as good as this
// contract. A build that rebuilds the board but leaves its hunters at the
// coordinates its OWN den used to occupy drops them wherever the fixture put
// those tiles, which is regularly the corridor the scenario is about. One run went
// exactly that way: a Lanternjaw stood in the middle of a posed corridor, ate the
// forager a quarter of a second in, and three unrelated points reported an input
// bug and a turning bug against a build whose input and turning were fine. The
// posers now stand a scenario down in that state rather than misattributing it —
// but standing down is inconclusive, not a finding, so without this point a build
// could break a required operation and have every consequence quietly set aside.
// This is the point that fails for it.
//
// It poses with `housed: false`, so the poser leaves the judgement here instead of
// raising the precondition every other caller gets.
//
// AND THE LAST ASSERTION IS THE ONE A SEALED DEN CANNOT FAKE. Every fixture's den
// is walled on three sides precisely so a build that runs the schedule anyway
// cannot reach the scenario — which means "nobody left the den" is partly held up
// by the geometry rather than by the build. A hunter that tried to leave and was
// stopped by rock looks exactly like one that was held. `released` is the only
// thing that tells them apart: the schedule is suspended, so no release time
// arrives, so nothing is released. A build that re-arms the ordinary schedule
// reports it there, and would walk its hunters out of any fixture that was not
// sealed.

import { afterEach, beforeEach } from "vitest";
import { check } from "../scene";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { DEN_ORDER, DEN_RELEASE_GAP } from "../../src/constants";
import { housedTiles, looseOf, poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import type { FathomSnapshot } from "../surface";

/**
 * The fixture: a plain corridor.
 *
 * What it holds does not matter. What matters is the den the poser seals into the
 * bottom two rows of every fixture, which is where the hunters belong once the
 * board is posed.
 */
const BOARD = ["S......"];

/**
 * How long the den is watched after the board is posed, in seconds.
 *
 * Past the `10 s` the third hunter of a depth-`1` roster would be due at —
 * `DEN_RELEASE_GAP` twice over from the moment live play began — with room to
 * spare, so a build that runs the schedule anyway is caught rather than merely
 * not yet observed.
 */
const WATCH_SECONDS = 2 * DEN_RELEASE_GAP + 2;

/** How often the den is sampled, in seconds, so whoever leaves is named. */
const SAMPLE_SECONDS = 0.25;

/**
 * How much of the watch is filmed, in seconds.
 *
 * The opening two, which is the part worth looking at: a posed board with its den
 * holding. The rest runs outside the capture, which is the same real simulation
 * and costs the clip nothing.
 */
const FILMED_SECONDS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check(
  "re-dens every predator on a posed board and holds it there",
  async () => {
    startPlaying(h);
    await poseMaze(h, BOARD, { housed: false });

    const posed = h.snapshot();
    const housed = housedTiles(posed);
    const loose = looseOf(posed, housed);

    // Sampled across the whole watch rather than read once at the end, so a hunter
    // that left and came back is still named.
    const escaped = new Map<string, string>();
    const note = (snapshot: FathomSnapshot): void => {
      for (const one of looseOf(snapshot, housed)) {
        if (!escaped.has(one.kind)) escaped.set(one.kind, one.where);
      }
    };

    const stride = ticksFor(SAMPLE_SECONDS);
    const filmed = Math.round(FILMED_SECONDS / SAMPLE_SECONDS);
    const total = Math.round(WATCH_SECONDS / SAMPLE_SECONDS);

    await captureReplay(h, "housed", async () => {
      for (let taken = 0; taken < filmed; taken += 1) {
        await h.advance(stride);
        note(h.snapshot());
      }
    });
    for (let taken = filmed; taken < total; taken += 1) {
      await h.advance(stride);
      note(h.snapshot());
    }
    const ended = h.snapshot();

    // The fixture carries a den at all. If this fails the fixture is wrong rather
    // than the build, and everything below it would be meaningless.
    assertGreaterThan(
      housed.size,
      0,
      "den and gate tiles in the posed layout, for the hunters to be returned to",
    );

    assertLength(
      loose,
      0,
      `predators standing outside the posed layout's den the moment it was posed` +
        (loose.length > 0
          ? ` — ${loose.map((one) => one.where).join("; ")}`
          : ""),
    );

    const left = [...escaped.values()];
    assertLength(
      left,
      0,
      `predators that left the den over ${WATCH_SECONDS} s of live play, which is ` +
        `past the ${2 * DEN_RELEASE_GAP} s the third of them would ordinarily be ` +
        `due at` +
        (left.length > 0 ? ` — ${left.join("; ")}` : ""),
    );

    // The assertion the sealed den cannot fake.
    const released = ended.predators
      .filter((one) => one.released === true)
      .map((one) => one.kind);
    assertLength(
      released,
      0,
      `predators reporting released after ${WATCH_SECONDS} s on a posed board, ` +
        `whose release schedule is suspended (the roster releases in ` +
        `${DEN_ORDER.join(", ")} order)` +
        (released.length > 0 ? ` — ${released.join(", ")}` : ""),
    );

    // And the watch was worth taking: a roster with nothing in it would clear every
    // assertion above without the build having housed anything.
    assertGreaterThan(
      ended.predators.length,
      0,
      "predators on the roster the whole watch was about",
    );
    assertEqual(
      ended.screen,
      "playing",
      "the dive stayed in live play, so the release schedule this point says is " +
        "suspended was one that would otherwise have been running",
    );
  },
);

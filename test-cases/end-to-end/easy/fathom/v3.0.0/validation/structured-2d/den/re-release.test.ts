// den/re-release — losing a life puts every hunter back in the den, unreleased,
// and runs the whole staggered schedule again from the moment play resumes.
//
// `specs/predators.md`: "Losing a life returns every predator to the den
// unreleased, and the whole schedule runs again from the moment play resumes."
// `specs/progression.md` says the same of the attempt a catch sets up: "Every
// predator is back in the den with its `released` flag `false`, and the staggered
// release schedule in `specs/predators.md` runs again from the moment live play
// resumes."
//
// WHY THIS CANNOT BE FOLDED INTO `den/stagger`. The build this exists to catch is
// the one that holds each release time as an ABSOLUTE moment against a clock the
// respawn never resets. On the first maze that build is perfect — `0`, `5`, `10`
// against a `simTime` that started at `0` — and it only comes apart after a life
// is lost, when every slot is already in the past and the whole den spills out at
// once. `den/stagger` is the case that build gets right.
//
// THE CATCH IS A TRIGGER, NOT A SUBJECT, AND IT IS DRIVEN AT ONCE. The roster's
// own Lanternjaw is moved onto the forager's tile in `chase` and the build's own
// contact rule takes the life; nothing here writes a life count. The move is
// instant on purpose: every moment spent staging a prettier catch is a moment the
// OTHER hunters' den timers keep running before the clock this item reads has even
// started.
//
// AND THE RESUMED ORIGIN IS PINNED THE SAME WAY `den/stagger` pins the first one.
// The catch drops the dive back into a countdown of a length `specs/ui.md` leaves
// between `1 s` and `3 s`, so `setScreen("playing")` opens live play and the
// `simTime` straight after is release time `0` of the re-run schedule, exactly.
//
// THE BOARD IS POSED, and `schedule.ts` describes it: a den with its gate and,
// across solid rock, the corridor the forager stands in. Every hunter's body is
// held there too, so the re-run schedule is watched with nothing on the board
// travelling at all — the catch this item stages is posed onto the forager's own
// tile, and a held hunter still makes contact (`specs/instrumentation.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertTrue } from "../assert";
import { DEN_ORDER, DEN_RELEASE_GAP } from "../constants";
import {
  captureReplay,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import {
  DEN_ORDER_LINE,
  RELEASE_TOLERANCE,
  assertReleasedFlag,
  assertRoster,
  dueAt,
  holdRoster,
  orderLine,
  poseDenBoard,
  watchReleases,
  watchSeconds,
} from "./schedule";

/** The seed the dive is opened on, so the maze this watch runs in replays. */
const SEED = 1;

/**
 * How long a hunter posed onto the forager's own tile is given to take the life,
 * in ticks.
 *
 * `specs/gameplay.md` makes contact a tile test — "the forager is in contact with
 * a predator whose center lies on the forager's own tile" — which is already true
 * on the tick the pose lands, so a conforming build takes the life on the next
 * one. Two seconds is a ceiling rather than an expectation, and a build that
 * misses it is reported against `scoring/caught-costs-life` rather than here.
 */
const CATCH_TICKS = ticksFor(2);

/**
 * Ticks run after the life is lost before the den is read, so the reading is a
 * beat past the event rather than on the tick it landed.
 *
 * `specs/progression.md` fixes what the attempt is set up with and leaves the
 * order inside a tick to the build, so a build that drops the life and re-dens on
 * the following step honours the page exactly as one that does both at once.
 */
const SETTLE_TICKS = 4;

/** Ticks held after the last release, so the clip does not cut on it. */
const TAIL_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns every predator to the den on a catch and runs the whole staggered schedule again from the moment play resumes", async () => {
  h.debug.reset(SEED);
  const home = await poseDenBoard(h);
  assertRoster(h.snapshot());
  h.debug.setScreen("playing");

  // The roster's own first hunter is the trigger, so nothing joins the board
  // that the schedule below is not about.
  const hunter = 0;

  const run = await captureReplay(h, "rerelease", async () => {
    const before = h.snapshot();
    // Onto the forager's own tile, fixed on it: the build's own chase-and-contact
    // code takes the life on its own terms.
    h.debug.setPredatorTile(hunter, before.forager.tx, before.forager.ty);
    h.debug.setPredatorState(hunter, "chase");
    const caught = await h.until((snap) => snap.lives < before.lives, {
      maxFrames: CATCH_TICKS,
      poll: 1,
    });
    await h.advance(SETTLE_TICKS);
    const denned = h.snapshot();
    // Held again, in case the attempt this catch set up handed the den fresh
    // bodies: `specs/instrumentation.md` restores travel on a `reset` alone, but
    // a roster rebuilt from scratch would arrive travelling.
    holdRoster(h);

    // The attempt the catch set up rests the forager on the board's start tile,
    // in the same corridor it was parked in; it is faced into the rock again so
    // it holds that tile while the clock runs.
    await parkForager(h, home);
    // The resumed origin, pinned exactly as the first one is.
    h.debug.setScreen("playing");
    const resumed = h.snapshot();
    const guard = await sceneGuard(h);
    const den = await watchReleases(h, {
      seconds: watchSeconds(DEN_ORDER.length),
      count: DEN_ORDER.length,
    });
    await h.advance(TAIL_TICKS);
    return { before, caught, denned, resumed, den, guard };
  });

  // The life the whole item hangs on. Without it there is no re-release to read,
  // so a build whose contact rule never fires fails here as well as at
  // `scoring/caught-costs-life`.
  assertTrue(
    run.caught.hit,
    `a Lanternjaw moved onto the forager's own tile cost a life within ` +
      `${CATCH_TICKS} ticks, which is what puts every hunter back in the den`,
  );

  requireSceneHeld(h.snapshot(), run.guard);
  assertReleasedFlag(run.den);

  // Half one: the catch put every hunter back, unreleased.
  for (const predator of run.denned.predators) {
    assertEqual(
      predator.released,
      false,
      `the ${predator.kind}'s \`released\` flag ${SETTLE_TICKS} ticks after ` +
        `the life was lost`,
    );
    assertEqual(
      predator.state,
      "den",
      `the ${predator.kind}'s state ${SETTLE_TICKS} ticks after the life was lost`,
    );
  }
  assertTrue(
    run.resumed.screen === "playing",
    "the dive resumed live play after the catch, so the re-run schedule has a " +
      "moment to run from",
  );

  // Half two: the whole schedule again, in order and on its slots.
  assertEqual(
    orderLine(run.den.releases.map((release) => release.kind)),
    DEN_ORDER_LINE,
    `the order the den emptied in over the ` +
      `${watchSeconds(DEN_ORDER.length)} s after play resumed`,
  );
  for (const [slot, release] of run.den.releases.entries()) {
    assertLessThanOrEqual(
      Math.abs(release.t - run.resumed.simTime - dueAt(slot)),
      RELEASE_TOLERANCE,
      `how far the ${release.kind}'s release sat from the ${dueAt(slot)} s ` +
        `specs/predators.md gives slot ${slot} at ${DEN_RELEASE_GAP} s a slot, ` +
        `measured from the moment play resumed`,
    );
  }
});

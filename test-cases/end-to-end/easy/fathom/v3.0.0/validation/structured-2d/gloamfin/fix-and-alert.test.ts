// gloamfin/fix-and-alert — close hearing takes a fix and fires the alert.
//
// THE CLAIM. `specs/predators/gloamfin.md` gives the Gloamfin a third way to be
// heard: "close hearing. The distance between the two centers is at most
// `GLOAMFIN_HEAR` (`64`), 2 tiles", which "works in the dark, through rock, and
// through ink", and while it holds "the snapshot reports `hearingLock` true". Each
// of the three paths "is a fresh acquisition that fires the detection alert
// `specs/predators.md` defines", and that file has `alert` true "for `ALERT_TIME`
// (`0.5 s`) from that moment". The states table takes `"wander"` to `"chase"` when
// "any of the three senses takes a fix". So one crossing decides three readings:
// `hearingLock`, `state` and `alert`.
//
// THE PAIR STANDS EITHER SIDE OF ROCK, DIAGONALLY. Two things follow from that.
// The line between them crosses nothing but rock, so a fix taken here can only have
// been taken by ear — this Gloamfin has no light sense at all
// (`detectRange` is `null` for it), and the rock removes the question anyway. And
// each of them sits on a tile with no open neighbor, which
// `specs/movement.md` keeps a body on: neither can reach the other, so the reading
// cannot end in contact and a life lost.
//
// THE DISTANCE IS NOT THE BOUNDARY. Two tiles apart along a corridor is exactly
// `64`, which asks whether a build reads "at most `GLOAMFIN_HEAR`" as `<=` or `<`
// — a question no specification sentence settles and this point has no business
// deciding. Diagonally adjacent is `45.25`, inside the range under either reading
// and still nowhere near contact.
//
// THE PLANKTON GO FIRST. `clearPlankton` takes every one off without eating any,
// so it "scores nothing and clears no maze" (`specs/instrumentation.md`), and the
// forager's swim cannot raise `G` off the `0` this scenario opens on. The claim is
// about a fix taken "with no light on either", and that is what holds it.
//
// WHAT THIS DOES NOT DECIDE. What a chase then does (`gloamfin/chase-cap`), or
// what the alert looks like (`alert/gloamfin`).

import { afterEach, beforeEach } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { GLOAMFIN_HEAR, TICK_HZ } from "../../src/constants";
import { placeForager, poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  check,
  denAll,
  requireKind,
  requireScene,
  requireSwim,
  sceneGuard,
} from "../scene";
import { apart, gloamfinOf, placePredator } from "./pings";

/**
 * The fixture: the forager's corridor, and the Gloamfin walled into the tile
 * diagonally below its far end.
 *
 * `F` is where the forager rests, four tiles of corridor away from `A`, which is
 * the tile the swim ends against the rock on. `G` is diagonally adjacent to `A`,
 * with rock on all four of its own sides.
 */
const SEALED_PAIR = ["F..A#", "####G"];

/** How long the forager may swim before this scenario gives up on it, in ticks. */
const SWIM_BUDGET = Math.round(1.5 * TICK_HZ);

/**
 * How long after the crossing the three readings are taken, in ticks.
 *
 * Two ticks. A build may raise `hearingLock` on the step the distance closes and
 * open the chase on the next, or do both at once, and `specs/predators.md` fixes
 * neither order; what it does fix is that `alert` then stands for `ALERT_TIME`
 * (`0.5 s`), sixty ticks, so a reading two ticks in is inside that window under
 * either.
 */
const SETTLE_TICKS = 2;

/** Ticks held past the reading, purely so the clip shows the moment it lands on. */
const TAIL_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check("Close hearing takes a fix and fires the alert", async () => {
  startPlaying(h);
  const board = await poseMaze(h, SEALED_PAIR);
  const index = requireKind(h.snapshot(), "gloamfin");
  const quiet = await denAll(h, [index]);
  await placePredator(h, index, board.mark("G"), { state: "wander" });
  await placeForager(h, board.mark("F"), "right");
  await h.debug.clearPlankton();
  await h.debug.setBrightness(0);
  // The forager is this point's mover, so the guard watches everything BUT where
  // it stands: a life lost, the dive leaving live play, a denned hunter loose.
  const guard = await sceneGuard(h, quiet, { foragerParked: false });

  const opening = h.snapshot();
  const openingGloamfin = gloamfinOf(opening, index);

  const crossing = await captureReplay(h, "fix", async () => {
    h.hold("ArrowRight");
    const closed = await h.until(
      (snap) => apart(snap.forager, gloamfinOf(snap, index)) <= GLOAMFIN_HEAR,
      { maxFrames: SWIM_BUDGET, poll: 1 },
    );
    await h.advance(SETTLE_TICKS);
    const read = h.snapshot();
    // Held on past the reading purely so the clip carries a readable moment of
    // the acquisition. The state the check reads is already taken.
    await h.advance(TAIL_TICKS);
    h.release("ArrowRight");
    return { closed, read };
  });

  requireScene(h.snapshot(), guard);

  // The scenario opened on a Gloamfin that had heard nothing, which is what makes
  // every reading below a reading of the crossing rather than of the pose.
  assertEqual(
    openingGloamfin.state,
    "wander",
    "the Gloamfin's state before the forager closed on it",
  );
  assertEqual(
    openingGloamfin.hearingLock,
    false,
    "hearingLock before the forager closed on it — specs/state.md reports it " +
      "false at every moment the Gloamfin is not holding a close-range lock",
  );
  assertGreaterThan(
    apart(opening.forager, openingGloamfin),
    GLOAMFIN_HEAR,
    `logical units between the two centers at the start, against the ` +
      `GLOAMFIN_HEAR (${GLOAMFIN_HEAR}) close hearing reaches`,
  );

  requireSwim(
    opening.forager,
    crossing.read.forager,
    `swim the ${SEALED_PAIR[0].length - 1} tiles of corridor this scenario laid ` +
      `out to bring it inside GLOAMFIN_HEAR of the Gloamfin`,
  );

  const heard = gloamfinOf(crossing.read, index);
  assertLessThanOrEqual(
    apart(crossing.read.forager, heard),
    GLOAMFIN_HEAR,
    `logical units between the two centers at the reading, against the ` +
      `GLOAMFIN_HEAR (${GLOAMFIN_HEAR}) close hearing reaches`,
  );
  assertEqual(
    heard.hearingLock,
    true,
    "hearingLock once the forager stood inside GLOAMFIN_HEAR through rock — " +
      "specs/predators/gloamfin.md has close hearing work in the dark and " +
      "through rock, and reports the lock while it holds",
  );
  assertEqual(
    heard.state,
    "chase",
    "the Gloamfin's state on the fix — specs/predators/gloamfin.md takes " +
      '"wander" to "chase" when any of the three senses takes a fix',
  );
  assertEqual(
    heard.alert,
    true,
    "the Gloamfin's alert on the fix — specs/predators.md fires the detection " +
      "alert the moment a Gloamfin acquires a fix it was not already chasing on, " +
      "and reports alert true for ALERT_TIME (0.5 s) from that moment",
  );
});

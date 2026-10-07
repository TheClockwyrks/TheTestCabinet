// instrumentation/reset-restores-title — `reset()` puts every declared field
// back to its title-screen value, and leaves `muted` alone.
//
// THE RULE. specs/instrumentation.md lists what `reset` restores, in one
// sentence: `screen` to `"title"`; all thirteen piles and the waste's set
// memory emptied; the run in hand, the drop target and the last press cleared;
// the pointer at `(0, 0)` and up; `autoFlip`, `winDetect`, `launching` and
// `trailPainting` turned back on; `launchClock` `0`, `launched` `0`,
// `cascadeDone` `false`; every flyer removed; the painted layer cleared and
// `trailStamps` `0`; and `simTime` `0`. `muted` is left exactly as it stands,
// because muting is a player preference the runtime owns.
//
// THE STATE IS REALLY DIRTIED FIRST, or the reading would pass on a build whose
// `reset` did nothing at all. A game is won and its cascade run for half a
// second — so cards have launched, cards are in flight, the layer has been
// stamped and `simTime` has accumulated — then a run is picked up with the
// pointer, all four gates are switched off, a launch clock is posed, and the
// RUNTIME's mute bit is set through the engine's own audio bus, which is where
// the specification says muting lives.
//
// THE READING IS TAKEN WITH NO FRAME ADVANCED AFTER THE RESET. Two of the
// values depend on it. `simTime` is restored to `0` and every update adds its
// delta, so a frame in between would report a sixtieth rather than nothing; and
// `muted` is refreshed from the runtime's bit in every update, so a frame in
// between would hide a `reset` that had wrongly cleared the game's copy. Under
// this engine a pose acts on the live game at the call, so the snapshot right
// after `reset` is the honest one.
//
// WHAT IT DOES NOT DECIDE. That the painted PIXELS go with `trailStamps` is
// `instrumentation/reset-clears-trail`, and that the four gates start on is
// `instrumentation/auto-flip-defaults-on`. This point reads the declared fields.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { FOUNDATION_COUNT, TABLEAU_COLUMNS } from "../constants";
import {
  SEVEN,
  captureStill,
  card,
  createHarness,
  grabPoint,
  poseColumn,
  pressAt,
  startCascade,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** How long the won game's cascade is left running before the reset. */
const CASCADE_SECONDS = 0.5;

/** The column the run picked up before the reset is posed on. */
const HELD_COLUMN = 6;

/** The seconds posed onto the launch clock, so `0` afterwards is a restoration. */
const DIRTY_LAUNCH_CLOCK = 0.09;

/** Cards standing on the thirteen piles, which reset takes off all of them. */
function tableCards(snapshot: CascadeSnapshot): number {
  return (
    snapshot.stock.length +
    snapshot.waste.length +
    snapshot.foundations.reduce((n, pile) => n + pile.length, 0) +
    snapshot.tableau.reduce((n, pile) => n + pile.length, 0)
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores every declared field to its title-screen value and leaves muted untouched", async () => {
  // A real win, and half a second of its cascade: cards launch, fly and stamp,
  // and `simTime` accumulates.
  startCascade(h);
  await h.advanceSeconds(CASCADE_SECONDS);

  // Back to the table, so a press picks a run up rather than dealing a fresh
  // game (specs/victory.md), and one card posed to pick up.
  h.debug.setScreen("playing");
  poseColumn(h, HELD_COLUMN, [card("hearts", SEVEN)]);
  const grab = grabPoint(h.snapshot(), HELD_COLUMN, 0);
  pressAt(h, grab.x, grab.y);

  // Every gate off, and a launch clock that is neither `0` nor a whole interval.
  h.debug.setAutoFlip(false);
  h.debug.setWinDetect(false);
  h.debug.setLaunching(false);
  h.debug.setTrailPainting(false);
  h.debug.setLaunchClock(DIRTY_LAUNCH_CLOCK);

  // The RUNTIME's mute bit, which the engine owns and the game copies each
  // update (specs/instrumentation.md). One frame lands the copy.
  h.world.audio.setMuted(true);
  await h.advance(1);

  // EVERY FIELD THE READING BELOW RESTORES IS DIRTY FIRST. A field that was
  // already at its title value would be restored by a `reset` that did nothing
  // at all, so each of these is what makes the corresponding reading mean
  // something.
  const before = h.snapshot();
  assertGreaterThan(before.simTime, 0, "simTime accumulated before the reset");
  assertEqual(before.muted, true, "the runtime's mute bit before the reset");
  assertGreaterThan(
    before.flyers.length,
    0,
    "cards in flight before the reset",
  );
  assertGreaterThan(
    before.launched,
    0,
    "cards launched before the reset, which reset puts back to 0",
  );
  assertGreaterThan(
    before.trailStamps,
    0,
    "stamps on the painted layer before the reset, which reset clears",
  );
  assertGreaterThan(
    tableCards(before),
    0,
    "cards on the table before the reset, which reset takes off every pile",
  );
  assertNotNull(
    before.drag,
    "the run in hand before the reset, which reset clears: a press that " +
      "grabbed nothing would leave this reading nothing to say",
  );
  assertDeepEqual(
    {
      autoFlip: before.autoFlip,
      winDetect: before.winDetect,
      launching: before.launching,
      trailPainting: before.trailPainting,
    },
    {
      autoFlip: false,
      winDetect: false,
      launching: false,
      trailPainting: false,
    },
    "the four gates before the reset, all four switched off, which reset " +
      "turns back on",
  );
  assertEqual(
    before.launchClock,
    DIRTY_LAUNCH_CLOCK,
    "the launch clock posed before the reset, which reset puts back to 0",
  );

  // The reset under test, read with no frame between.
  h.debug.reset();
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "title");

  assertEqual(after.screen, "title", "the screen reset restores");

  assertLength(after.stock, 0, "cards left on the stock");
  assertLength(after.waste, 0, "cards left on the waste");
  assertLength(after.wasteSets, 0, "entries left in the waste's set memory");
  assertLength(after.foundations, FOUNDATION_COUNT, "reported foundations");
  after.foundations.forEach((pile, index) => {
    assertLength(pile, 0, `cards left on foundation ${index}`);
  });
  assertLength(after.tableau, TABLEAU_COLUMNS, "reported columns");
  after.tableau.forEach((pile, index) => {
    assertLength(pile, 0, `cards left on column ${index}`);
  });

  assertNull(after.drag, "the run in hand reset clears");
  assertNull(after.dropTarget, "the drop target reset clears");
  assertNull(after.lastPress, "the last press reset clears");
  assertDeepEqual(
    after.pointer,
    { x: 0, y: 0, down: false },
    "the pointer reset puts back at (0, 0) and up",
  );

  assertDeepEqual(
    {
      autoFlip: after.autoFlip,
      winDetect: after.winDetect,
      launching: after.launching,
      trailPainting: after.trailPainting,
    },
    { autoFlip: true, winDetect: true, launching: true, trailPainting: true },
    "the four gates reset turns back on",
  );

  assertEqual(after.launchClock, 0, "the launch clock reset restores");
  assertEqual(after.launched, 0, "the cards launched reset restores");
  assertEqual(
    after.cascadeDone,
    false,
    "the cascade's end flag reset restores",
  );
  assertLength(after.flyers, 0, "cards left in flight");
  assertEqual(after.trailStamps, 0, "stamps reset leaves on the painted layer");
  assertEqual(after.simTime, 0, "the simulation time reset restores");

  assertEqual(
    after.muted,
    true,
    "the mute bit after the reset: muting is the runtime's preference and " +
      "reset leaves it exactly as it stands (specs/instrumentation.md)",
  );
});

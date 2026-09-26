// instrumentation/reset-restores-title — `reset()` puts every declared field back
// to the title-screen value the specification lists, and leaves `muted` where it
// stands.
//
// THE RULE. `specs/instrumentation.md` writes the list out in one sentence:
// `reset` "restores `screen` to `"title"`; empties all thirteen piles and the
// waste's set memory; clears the run in hand, the drop target, and the last
// press; puts the pointer at `(0, 0)` and up; turns `autoFlip`, `winDetect`,
// `launching`, and `trailPainting` back on; sets `launchClock` to `0`, `launched`
// to `0`, and `cascadeDone` to `false`; removes every flyer; clears the painted
// layer and sets `trailStamps` to `0`; and sets `simTime` to `0`." Every one of
// those is read below, in that order.
//
// EVERY FIELD IS POSED AWAY FROM ITS TITLE VALUE FIRST. A reset that restored
// nothing would pass on a game still sitting at the title, so the run this point
// resets is one in which almost none of those fields holds the value it is about
// to be restored to: all thirteen piles carrying cards, a waste with two sets, a
// run in hand over a resolved drop target, a pointer down away from the origin
// and a press recorded, all four gates held off, a launch clock part-way to the
// next launch, cards counted out and in flight, a painted layer that has taken
// stamps, and accumulated game time.
//
// THE LAUNCHED COUNT AND THE PAINTED LAYER ARE DRIVEN, NOT POSED. No operation
// sets `launched` or `trailStamps` — the first "is counted up by the cascade as
// it launches cards" and the second counts the stamps flight left
// (`specs/instrumentation.md`) — so the scenario wins a game through its own win
// path and runs half a second of the real cascade before posing the rest. That is
// also what gives the launch clock a remainder to carry.
//
// `cascadeDone` IS THE ONE FIELD THIS POINT CANNOT POSE AWAY, and it is asserted
// all the same. It is set only by the cascade's own end test, "when every card
// has launched and none is in flight", so reaching `true` means running all
// fifty-two launches to the last card off a side edge — a span whose failure
// would belong to `cascade/cascade-ends` rather than here. It stands at `false`
// before the reset and is required to stand at `false` after it.
//
// `muted` IS THE ONE FIELD THAT MUST SURVIVE. "`muted` is left exactly as it
// stands, because muting is a player preference the runtime owns"
// (`specs/instrumentation.md`), so the bit is read immediately before the reset
// and held to that same reading afterwards. It is posed with `setMuted` first, so
// the bit under test is more likely to be the interesting one, but the comparison
// is against what the snapshot ACTUALLY reported a moment earlier — whether the
// HUD's own `SOUND` control works is `screens/hud-sound-mutes`'s point and
// `screens/hud-sound-unmutes`'s, and a build that failed those must not fail this
// one too.
//
// NO FRAME RUNS BETWEEN THE RESET AND THE READING, because `simTime` "accumulates
// every update's delta, whatever the screen" and a check that advanced first
// would be reading the update rather than the reset.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNull,
} from "../assert";
import {
  captureStill,
  card,
  cardCenter,
  cards,
  columnCardTopLeft,
  createHarness,
  dropRect,
  everyCard,
  faceDown,
  framesFor,
  openTable,
  poseColumn,
  poseStock,
  poseWaste,
  rectCenter,
  startCascade,
  type Harness,
} from "../harness";

/** How much of a real cascade is run, so `launched` and `trailStamps` rise. */
const CASCADE_SECONDS = 0.5;

/** The stock and the waste this scenario lays, and the waste's two sets. */
const STOCK = ["2C", "3D"] as const;
const WASTE = ["4H", "5S", "6D"] as const;
const WASTE_SETS = [1, 2] as const;

/**
 * The two columns the held run is carried between.
 *
 * The source's lowest card is the black five over a face-down card, and the
 * target's is the red six, which `specs/tableau.md` has accept it — so the press
 * lifts a run and the move resolves a drop target.
 */
const FROM_COLUMN = 5;
const TO_COLUMN = 6;
const FROM_CARDS = [card("9C", false), card("5S")] as const;
const TO_CARDS = [card("6H")] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores every declared field to its title value and leaves muted alone", async () => {
  await openTable(h);

  // The runtime's mute bit, posed directly (`specs/instrumentation.md`, Muting),
  // so that what the reset is held to is a bit that was really set.
  await h.debug.setMuted(true);
  await h.advance(1);

  // A real win and half a second of its cascade, so cards have been counted out,
  // cards are in flight, the layer has taken stamps and the launch clock is
  // carrying a remainder.
  await startCascade(h);
  await h.advance(framesFor(CASCADE_SECONDS));

  // Back to the table to pose the rest: a press on the `won` screen deals a
  // fresh game (`specs/victory.md`), and `setScreen` changes no other field.
  await h.debug.setScreen("playing");
  await poseStock(h, faceDown(...STOCK));
  await poseWaste(h, cards(...WASTE), [...WASTE_SETS]);
  await poseColumn(h, FROM_COLUMN, [...FROM_CARDS]);
  await poseColumn(h, TO_COLUMN, [...TO_CARDS]);

  const grabbed = columnCardTopLeft(
    FROM_COLUMN,
    FROM_CARDS.length - 1,
    FROM_CARDS.map((c) => c.faceUp ?? true),
  );
  const press = cardCenter(grabbed.x, grabbed.y);
  await h.debug.pointerDown(press.x, press.y);
  const lifted = (await h.snapshot()).drag;
  const centre = cardCenter(lifted?.x ?? grabbed.x, lifted?.y ?? grabbed.y);
  const target = rectCenter(
    dropRect(
      "tableau",
      TO_COLUMN,
      TO_CARDS.map((c) => c.faceUp ?? true),
    ),
  );
  await h.debug.pointerMove(
    press.x + (target.x - centre.x),
    press.y + (target.y - centre.y),
  );

  for (const gate of [
    "setAutoFlip",
    "setWinDetect",
    "setLaunching",
    "setTrailPainting",
  ] as const) {
    await h.debug[gate](false);
  }

  const before = await h.snapshot();

  // The scenario really did leave the fields away from their title values, so
  // every reading below is of a restoration rather than of a game that was
  // already sitting at the title.
  assertGreaterThan(
    everyCard(before).length,
    0,
    "the cards on the table before the reset, which reset empties",
  );
  assertGreaterThan(
    before.launched,
    0,
    "the cards the cascade had counted out before the reset, which reset " +
      "returns to 0 — with none counted there would be nothing to restore",
  );
  assertGreaterThan(
    before.trailStamps,
    0,
    "the stamps the painted layer had taken before the reset, which reset " +
      "returns to 0",
  );
  assertGreaterThan(
    before.simTime,
    0,
    "the game time accumulated before the reset, which reset returns to 0",
  );
  assertGreaterThan(
    before.flyers.length,
    0,
    "the cards in flight before the reset, which reset removes",
  );
  assertEqual(
    before.drag === null,
    false,
    "whether the press lifted nothing — this point resets a game with a run " +
      "in hand (specs/controls.md)",
  );
  assertEqual(
    before.cascadeDone,
    false,
    "the cascade's end flag before the reset, which this scenario leaves " +
      "standing at the value reset restores",
  );

  await h.debug.reset();
  // Read with no frame between: `simTime` accumulates every update's delta, so a
  // frame run here would be reading the update rather than the reset.
  const title = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing reset still leaves the picture of the
  // screen it produced.
  await captureStill(h, "title");

  assertEqual(title.screen, "title", "snapshot().screen after reset()");

  assertLength(title.stock, 0, "the cards on the stock after reset()");
  assertLength(title.waste, 0, "the cards on the waste after reset()");
  assertLength(title.wasteSets, 0, "the waste's set memory after reset()");
  for (const [index, pile] of title.foundations.entries()) {
    assertLength(pile, 0, `the cards on foundation ${index} after reset()`);
  }
  for (const [index, pile] of title.tableau.entries()) {
    assertLength(pile, 0, `the cards in column ${index} after reset()`);
  }

  assertNull(title.drag, "snapshot().drag after reset()");
  assertNull(title.dropTarget, "snapshot().dropTarget after reset()");
  assertNull(title.lastPress, "snapshot().lastPress after reset()");
  assertDeepEqual(
    title.pointer,
    { x: 0, y: 0, down: false },
    "snapshot().pointer after reset(), which the specification puts at (0, 0) " +
      "and up",
  );

  assertEqual(title.autoFlip, true, "snapshot().autoFlip after reset()");
  assertEqual(title.winDetect, true, "snapshot().winDetect after reset()");
  assertEqual(title.launching, true, "snapshot().launching after reset()");
  assertEqual(
    title.trailPainting,
    true,
    "snapshot().trailPainting after reset()",
  );

  assertEqual(title.launchClock, 0, "snapshot().launchClock after reset()");
  assertEqual(title.launched, 0, "snapshot().launched after reset()");
  assertEqual(title.cascadeDone, false, "snapshot().cascadeDone after reset()");
  assertLength(title.flyers, 0, "the cards in flight after reset()");
  assertEqual(title.trailStamps, 0, "snapshot().trailStamps after reset()");
  assertEqual(title.simTime, 0, "snapshot().simTime after reset()");

  // And the one field reset must not touch.
  assertEqual(
    title.muted,
    before.muted,
    "snapshot().muted after reset(), against the bit the snapshot reported a " +
      "moment before it — muting is a player preference the runtime owns, and " +
      "reset leaves it exactly as it stands",
  );
});

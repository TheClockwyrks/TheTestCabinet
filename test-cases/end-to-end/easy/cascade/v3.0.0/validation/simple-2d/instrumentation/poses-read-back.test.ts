// instrumentation/poses-read-back — every pose the surface carries is reported by
// `snapshot`.
//
// specs/instrumentation.md states the reason the snapshot shape is what it is:
// "Every field an operation can set is present, so every operation is verifiable by
// setting a value and reading it back." This point is that sentence, run over the
// poses the item names: the screen, a card's face, the waste's sets, the four
// gates, a flyer's position and velocity, and the launch clock. A pose that quietly
// does nothing, writes a field the snapshot does not report, or rounds a value it
// was given away is a pose no other check in this project can trust, so much of the
// checklist rests on this one.
//
// NO FRAME RUNS BETWEEN A POSE AND ITS READING. A pose is a precondition, not an
// event: it puts the game into a situation, and the game's own rules run from there
// when a frame is advanced. Advancing one here would let the very rules this point
// is establishing the ground for, the launch clock counting up and a flyer falling
// under gravity, move the value between the write and the read. So every pose below
// is written and read on the same state, which is exactly the "set a value and read
// it back" the specification names, and the one frame the still needs is run after
// the reading is taken.
//
// MUTE AND THE CLOCK ARE DELIBERATELY ABSENT. There is no `setMuted`: the mute bit
// belongs to the engine's audio bus, is reached through the HUD's `SOUND` control,
// and is decided by `screens.hud-sound-toggles` and `audio.mute-silences`. There is
// no `setAutoStep` either: under an engine the clock is the engine's, and
// `setAutoStep` changes no game state, so no field reports it.
//
// THE VALUES ARE CHOSEN TO BE DISTINGUISHING. None of them is the value the field
// already held, so a pose that was dropped reads as the value it replaced rather
// than as the value it was given: `"howto"` is neither the `"title"` a reset leaves
// nor the `"playing"` the scenario opened on, the card is posed face-DOWN and then
// turned up, each gate is posed `false` against the `true` it defaults to, the
// flyer is added at one position and velocity and then posed at another, and the
// launch clock is posed at a figure that is neither `0` nor `LAUNCH_INTERVAL`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  cardOf,
  createHarness,
  flyerOf,
  lastFlyer,
  openTable,
  poseColumn,
  posePile,
  type Harness,
} from "../harness";

/** The screen posed: neither the title's own nor the one the table opened on. */
const SCREEN = "howto" as const;

/** The card posed face-down, and the face it is then given. */
const CARD = "#7D";
const CARD_COLUMN = 3;
const CARD_FACE_UP = true;

/** The waste posed, and the two sets it is then given, oldest first. */
const WASTE = ["2C", "9H", "4S", "7D", "JC"];
const WASTE_SETS = [2, 3];

/** Where the flyer is added, and the position and velocity it is then posed at. */
const FLYER_ADDED = { x: 10, y: 20, vx: 0, vy: 0 };
const FLYER_X = 444.5;
const FLYER_Y = 233.25;
const FLYER_VX = -137.5;
const FLYER_VY = 261.75;

/** The launch clock posed: neither the `0` a reset leaves nor a whole interval. */
const LAUNCH_CLOCK = 0.137;

/**
 * The tolerance on a posed number read straight back.
 *
 * Six decimal places, which is float noise rather than a rounding a build is
 * allowed: specs/instrumentation.md says the value is read back, so nothing here
 * gives a build room to store a figure at a coarser resolution than it was given.
 */
const EXACT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every posed value through snapshot", async () => {
  openTable(h);

  // ---- The screen --------------------------------------------------------

  h.debug.setScreen(SCREEN);

  // ---- A card's face -----------------------------------------------------

  const cardId = poseColumn(h, CARD_COLUMN, [CARD])[0];
  h.debug.setCardFaceUp(cardId, CARD_FACE_UP);

  // ---- The waste's sets --------------------------------------------------

  posePile(h, "waste", 0, WASTE);
  for (const count of WASTE_SETS) h.debug.addWasteSet(count);

  // ---- The four faculty gates --------------------------------------------

  h.debug.setAutoFlip(false);
  h.debug.setWinDetect(false);
  h.debug.setLaunching(false);
  h.debug.setTrailPainting(false);

  // ---- A flyer's position and velocity -----------------------------------

  h.debug.addFlyer(
    "spades",
    13,
    FLYER_ADDED.x,
    FLYER_ADDED.y,
    FLYER_ADDED.vx,
    FLYER_ADDED.vy,
  );
  const flyerId = lastFlyer(h.snapshot()).id;
  h.debug.setFlyerPosition(flyerId, FLYER_X, FLYER_Y);
  h.debug.setFlyerVelocity(flyerId, FLYER_VX, FLYER_VY);

  // ---- The launch clock --------------------------------------------------

  h.debug.setLaunchClock(LAUNCH_CLOCK);

  // The one reading, taken before any frame runs.
  const posed = h.snapshot();

  // The board each pose was applied to, drawn by the one frame this check runs.
  await h.advance(1);
  captureStill(h, "posed");

  // ---- What the snapshot must report -------------------------------------

  assertEqual(posed.screen, SCREEN, "setScreen");

  assertEqual(cardOf(posed, cardId).faceUp, CARD_FACE_UP, "setCardFaceUp");

  assertDeepEqual(posed.wasteSets, WASTE_SETS, "addWasteSet, oldest first");
  assertEqual(
    posed.wasteVisibleCount,
    WASTE_SETS[WASTE_SETS.length - 1],
    "wasteVisibleCount is the newest entry of wasteSets " +
      "(specs/instrumentation.md)",
  );

  assertEqual(posed.autoFlip, false, "setAutoFlip");
  assertEqual(posed.winDetect, false, "setWinDetect");
  assertEqual(posed.launching, false, "setLaunching");
  assertEqual(posed.trailPainting, false, "setTrailPainting");

  const flyer = flyerOf(posed, flyerId);
  assertCloseTo(flyer.x, FLYER_X, EXACT, "setFlyerPosition's x");
  assertCloseTo(flyer.y, FLYER_Y, EXACT, "setFlyerPosition's y");
  assertCloseTo(flyer.vx, FLYER_VX, EXACT, "setFlyerVelocity's vx");
  assertCloseTo(flyer.vy, FLYER_VY, EXACT, "setFlyerVelocity's vy");

  assertCloseTo(posed.launchClock, LAUNCH_CLOCK, EXACT, "setLaunchClock");
});

// instrumentation/poses-read-back — every pose the surface carries is reported
// back by the snapshot.
//
// THE RULE. specs/instrumentation.md fixes the shape of the surface: "Every
// field an operation can set is present, so every operation is verifiable by
// setting a value and reading it back." A pose that arranges the game but is
// not reported leaves every scenario built on it unreadable, so this point
// poses one value per field the specification names in the item and reads all
// of them out of a single snapshot.
//
// EVERY POSED VALUE IS A DISTINGUISHING ONE. Each is chosen so that a build
// which reports the wrong thing reports a DIFFERENT number rather than the
// right one by accident:
//
//   - the screen is posed to `howto`, which no other pose in this check can
//     reach and which is not the value `reset` restores;
//   - the card is posed face-DOWN and then turned face-up, so a build reporting
//     the face it was added with reads `false`;
//   - the waste's set is `2` over a waste holding `3` cards, so a build
//     reporting the cards on the waste reads `3` and one reporting the sets'
//     total reads `2` only because that IS the newest set;
//   - the four gates are posed to a MIXED pattern, two off and two on, so a
//     build reporting one field for all four, or reporting the default, reads
//     a different tuple;
//   - the flyer is added at one position and velocity and then MOVED to
//     another, so a build whose `setFlyerPosition` or `setFlyerVelocity` does
//     nothing reads the values it was added with;
//   - the launch clock is posed to `0.07`, which is neither `0` (its
//     title-screen value) nor `LAUNCH_INTERVAL` (the value entering a cascade
//     sets, specs/victory.md).
//
// NO FRAME IS ADVANCED between the poses and the reading, so nothing the game's
// own rules do can have moved a value before it is read: under this engine a
// pose acts on the live game at the moment of the call.
//
// TWO OPERATIONS ARE DELIBERATELY ABSENT FROM THE LIST. There is no
// `setAutoStep` under this engine, because the engine owns the clock, and there
// is no operation that sets `muted`, because the runtime owns muting
// (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  FOUR,
  KING,
  SIX,
  TWO,
  captureStill,
  card,
  cardById,
  createHarness,
  down,
  flyerById,
  openTable,
  poseCard,
  poseFlyer,
  poseWaste,
  type Harness,
} from "../harness";

/** The screen posed: not the title `reset` restores, and no other pose reaches it. */
const POSED_SCREEN = "howto";

/** The three cards the waste holds, and the one set posed over them. */
const WASTE_CARDS = [
  card("hearts", TWO),
  card("clubs", FOUR),
  card("spades", SIX),
];
const POSED_SET = 2;

/** The four gates, posed to a mixed pattern rather than all on or all off. */
const POSED_GATES = {
  autoFlip: false,
  winDetect: true,
  launching: false,
  trailPainting: true,
} as const;

/** Where the flyer is ADDED, and where it is then moved to. */
const ADDED_AT = { x: 200, y: 240, vx: 90, vy: -40 };
const MOVED_TO = { x: 640, y: 420, vx: -210, vy: 330 };

/** The column the face-down card is posed on and turned face-up. */
const TURNED_COLUMN = 0;

/** The seconds posed onto the launch clock: neither `0` nor `LAUNCH_INTERVAL`. */
const POSED_LAUNCH_CLOCK = 0.07;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the screen, a card's face, the waste's sets, the four gates, a flyer and the launch clock", async () => {
  openTable(h);

  // The card is posed face-DOWN on a column and then turned, so the reading
  // separates `setCardFaceUp` from the face `addCard` was given.
  const cardId = poseCard(
    h,
    "tableau",
    TURNED_COLUMN,
    down(card("diamonds", KING)),
  );
  h.debug.setCardFaceUp(cardId, true);

  // The waste's set memory, over cards the same pose put there.
  poseWaste(h, WASTE_CARDS, [POSED_SET]);

  // The four gates.
  h.debug.setAutoFlip(POSED_GATES.autoFlip);
  h.debug.setWinDetect(POSED_GATES.winDetect);
  h.debug.setLaunching(POSED_GATES.launching);
  h.debug.setTrailPainting(POSED_GATES.trailPainting);

  // One card in flight, added in one place and then moved to another.
  const flyerId = poseFlyer(
    h,
    card("clubs", KING),
    ADDED_AT.x,
    ADDED_AT.y,
    ADDED_AT.vx,
    ADDED_AT.vy,
  );
  h.debug.setFlyerPosition(flyerId, MOVED_TO.x, MOVED_TO.y);
  h.debug.setFlyerVelocity(flyerId, MOVED_TO.vx, MOVED_TO.vy);

  // The launch clock, and the screen last so nothing else can have moved it.
  h.debug.setLaunchClock(POSED_LAUNCH_CLOCK);
  h.debug.setScreen(POSED_SCREEN);

  const posed = h.snapshot();

  await h.advance(1);
  captureStill(h, "posed");

  assertEqual(
    posed.screen,
    POSED_SCREEN,
    "the screen setScreen posed (specs/instrumentation.md)",
  );

  assertEqual(
    cardById(posed, cardId)?.faceUp ?? null,
    true,
    "the face of the card setCardFaceUp turned, which addCard had put down " +
      "face-down (specs/instrumentation.md)",
  );

  assertDeepEqual(
    posed.wasteSets,
    [POSED_SET],
    `the waste's set memory after one addWasteSet(${POSED_SET}) over a waste ` +
      `holding ${WASTE_CARDS.length} cards (specs/instrumentation.md)`,
  );

  assertDeepEqual(
    {
      autoFlip: posed.autoFlip,
      winDetect: posed.winDetect,
      launching: posed.launching,
      trailPainting: posed.trailPainting,
    },
    POSED_GATES,
    "the four faculty gates, each posed on its own switch " +
      "(specs/instrumentation.md)",
  );

  const flyer = flyerById(posed, flyerId);
  assertDeepEqual(
    flyer === undefined
      ? null
      : { x: flyer.x, y: flyer.y, vx: flyer.vx, vy: flyer.vy },
    MOVED_TO,
    "the flyer's position and velocity, posed away from the ones addFlyer " +
      "was given (specs/instrumentation.md)",
  );

  assertEqual(
    posed.launchClock,
    POSED_LAUNCH_CLOCK,
    "the seconds setLaunchClock posed toward the next launch " +
      "(specs/instrumentation.md)",
  );
});

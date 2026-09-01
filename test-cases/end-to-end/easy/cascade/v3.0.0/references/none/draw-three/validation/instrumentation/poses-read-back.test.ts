// instrumentation/poses-read-back — every pose the surface carries is reported by
// `snapshot`, so each one is verifiable by setting a value and reading it back.
//
// THE RULE. `specs/instrumentation.md` states the one the whole surface is built
// to: "Every field an operation can set is present, so every operation is
// verifiable by setting a value and reading it back." That is what makes the rest
// of this suite mean anything — a scenario is only posed if the poses landed — so
// this point walks the poses one at a time and reads each one's own field.
//
// EVERY POSE IS READ WITH NO FRAME BETWEEN IT AND THE READING. The harness holds
// the game off the wall clock with `setAutoStep(false)`, so the game changes only
// when `advance` says so (`specs/instrumentation.md`, The clock) and nothing runs
// between a pose and the snapshot that checks it. That matters here: a frame
// would carry a flyer off the position it was just given and take the launch
// clock past the value it was just set to, and the check would be reading the
// update rather than the pose.
//
// EVERY BOOLEAN IS POSED BOTH WAYS. A field read back once could be a constant.
// Each of the four faculty gates and the card's face is set to one value, read,
// set to the other, and read again, so a snapshot that simply always answers
// `true` fails on the second reading. The screen is posed twice for the same
// reason, and neither value is the `playing` the table was opened on.
//
// TWO FIELDS ARE DELIBERATELY ABSENT. `muted` has no pose at all — "There is no
// operation that sets it: mute is reached the way a player reaches it, through
// the HUD's `SOUND` control" — so `screens/hud-sound-toggles` and
// `audio/mute-silences` decide it instead. `autoStep` is not a snapshot field and
// sets no game state, so there is nothing to read it back from.
//
// WHAT THIS DOES NOT DECIDE. What any posed value MEANS to the game. That a gate
// held off really stops its faculty is each gate's own point in this group; that
// a posed flyer then flies is `cascade/*`'s; that the waste's sets decide what it
// shows is `stock/*`'s. This point decides only that the pose landed.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  cards,
  createHarness,
  flyerById,
  openTable,
  poseColumn,
  poseFlyer,
  poseWaste,
  requireCard,
  type CascadeSnapshot,
  type Harness,
  type Screen,
} from "../harness";

/** The column the posed card sits on, and the card whose face is posed. */
const COLUMN = 2;
const CARD = "QD";

/** The waste this scenario lays, and the set posed onto its memory. */
const WASTE = ["3S", "4H", "5C"] as const;
const WASTE_SET = 2;

/** Where the posed flyer starts, before it is moved and steered away from there. */
const FLYER_START = { x: 200, y: 200, vx: 0, vy: 0 };

/**
 * The position and the velocity posed onto it.
 *
 * Neither is the value `addFlyer` left, and neither is a round zero, so a build
 * that ignores a pose reads back the value it already held rather than the one
 * asked for and the failure names the operation.
 */
const FLYER_X = 617;
const FLYER_Y = 313;
const FLYER_VX = -244;
const FLYER_VY = 189;

/** The launch clock posed, which is not the `0` `reset` left. */
const LAUNCH_CLOCK = 0.11;

/** The two screens posed, neither of them the `playing` the table was opened on. */
const SCREENS: readonly Screen[] = ["howto", "won"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports every posed field back through snapshot", async () => {
  await openTable(h);

  const [cardId] = await poseColumn(h, COLUMN, [card(CARD)]);
  await poseWaste(h, cards(...WASTE), []);
  const flyerId = await poseFlyer(h, FLYER_START);

  await h.advance(1);
  // Taken before the readings below, so a failing pose still leaves the picture
  // of the board it was applied to.
  await captureStill(h, "posed");

  /** Apply one pose and read its own field straight back off the snapshot. */
  const readsBack = async <T>(
    pose: () => Promise<unknown>,
    read: (s: CascadeSnapshot) => T,
    want: T,
    what: string,
  ): Promise<void> => {
    await pose();
    assertEqual(read(await h.snapshot()), want, what);
  };

  // ---- One card's face, both ways -----------------------------------------

  for (const faceUp of [false, true]) {
    await readsBack(
      () => h.debug.setCardFaceUp(cardId, faceUp),
      (s) => requireCard(s, cardId, "reading back a posed face").faceUp,
      faceUp,
      `snapshot()'s face for the card setCardFaceUp(${cardId}, ${faceUp}) named`,
    );
  }

  // ---- The waste's set memory ---------------------------------------------

  await h.debug.addWasteSet(WASTE_SET);
  assertDeepEqual(
    (await h.snapshot()).wasteSets,
    [WASTE_SET],
    `snapshot().wasteSets after addWasteSet(${WASTE_SET}) on an empty memory`,
  );

  // ---- The four faculty gates, each posed both ways ------------------------

  for (const enabled of [false, true]) {
    await readsBack(
      () => h.debug.setAutoFlip(enabled),
      (s) => s.autoFlip,
      enabled,
      `snapshot().autoFlip after setAutoFlip(${enabled})`,
    );
    await readsBack(
      () => h.debug.setWinDetect(enabled),
      (s) => s.winDetect,
      enabled,
      `snapshot().winDetect after setWinDetect(${enabled})`,
    );
    await readsBack(
      () => h.debug.setLaunching(enabled),
      (s) => s.launching,
      enabled,
      `snapshot().launching after setLaunching(${enabled})`,
    );
    await readsBack(
      () => h.debug.setTrailPainting(enabled),
      (s) => s.trailPainting,
      enabled,
      `snapshot().trailPainting after setTrailPainting(${enabled})`,
    );
  }

  // ---- One flyer's position and velocity ----------------------------------

  await h.debug.setFlyerPosition(flyerId, FLYER_X, FLYER_Y);
  const placed = flyerById(await h.snapshot(), flyerId);
  assertEqual(
    `${placed?.x},${placed?.y}`,
    `${FLYER_X},${FLYER_Y}`,
    `snapshot()'s top-left for flyer ${flyerId} after ` +
      `setFlyerPosition(${flyerId}, ${FLYER_X}, ${FLYER_Y})`,
  );

  await h.debug.setFlyerVelocity(flyerId, FLYER_VX, FLYER_VY);
  const steered = flyerById(await h.snapshot(), flyerId);
  assertEqual(
    `${steered?.vx},${steered?.vy}`,
    `${FLYER_VX},${FLYER_VY}`,
    `snapshot()'s velocity for flyer ${flyerId}, in logical units per second, ` +
      `after setFlyerVelocity(${flyerId}, ${FLYER_VX}, ${FLYER_VY})`,
  );

  // ---- The launch clock ----------------------------------------------------

  await readsBack(
    () => h.debug.setLaunchClock(LAUNCH_CLOCK),
    (s) => s.launchClock,
    LAUNCH_CLOCK,
    `snapshot().launchClock, in seconds, after ` +
      `setLaunchClock(${LAUNCH_CLOCK})`,
  );

  // ---- The screen ----------------------------------------------------------

  for (const screen of SCREENS) {
    await readsBack(
      () => h.debug.setScreen(screen),
      (s) => s.screen,
      screen,
      `snapshot().screen after setScreen(${JSON.stringify(screen)})`,
    );
  }
});

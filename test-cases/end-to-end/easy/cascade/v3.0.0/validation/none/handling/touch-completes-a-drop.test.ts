// handling/touch-completes-a-drop — a finger that lifts a run, travels past
// `DRAG_THRESHOLD` and lifts over a pile that accepts it applies the move,
// exactly as a mouse release does.
//
// THE RULE. `specs/controls.md`, How input reaches the game: "A mouse and a
// touchscreen stand on the same footing. A press is a mouse button going down or
// a finger touching down, a move is either one travelling, and a release is the
// button coming up or the finger lifting." The drop itself is that file's release
// rule: a release "Farther than `DRAG_THRESHOLD` from the press point" is "A
// drop", which "resolves to the pile whose drop rectangle contains the center of
// the run's leading card", and a pile that accepts the run takes it.
//
// SCOPED TO THIS ENGINE, because under the other two the engine has already
// resolved a finger into a press, a move and a release before the game sees it.
// Here the build owns the whole input path.
//
// THE WHOLE GESTURE IS A REAL CHROMIUM TOUCH on a context that reports a
// touchscreen — the contact lands, travels and lifts — so a build that listens
// for `mousedown`/`mousemove`/`mouseup` alone completes nothing here and passes
// every mouse point beside it.
//
// THE TRAVEL IS THE WHOLE WAY TO THE TARGET COLUMN, which is far more than
// `DRAG_THRESHOLD` (`5`): `specs/table.md` puts neighbouring columns `122` units
// apart, so the release cannot be read as a click. Where the threshold itself
// lies is `handling/short-gesture-is-a-click`'s and
// `handling/long-gesture-is-a-drop`'s.
//
// THE OFFSET IS THE BUILD'S OWN. `specs/controls.md` has the run keep "the offset
// between the press point and the leading card's top-left", so the contact is
// carried by however far the leading card's centre has to travel to reach the
// target's drop rectangle, measured from the run the build itself reported after
// the landing. A build that lifts a run at a different offset is still carried to
// the target this point named.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength, fail } from "../assert";
import {
  captureReplay,
  card,
  cardCenter,
  createHarness,
  dropRect,
  openTable,
  pileOf,
  pileTopLeft,
  poseColumn,
  rectCenter,
  touchGlide,
  touchPress,
  touchRelease,
  whereIs,
  type Harness,
} from "../harness";

/** The column the run is lifted from, and the column it is carried to. */
const SOURCE = 2;
const TARGET = 4;

/** The card carried, and the card waiting for it: a red six over a black five. */
const HELD = "5S";
const TARGET_CARD = "6H";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("applies the move the finger's lift resolved to", async () => {
  await openTable(h);
  const [heldId] = await poseColumn(h, SOURCE, [card(HELD)]);
  const [targetId] = await poseColumn(h, TARGET, [card(TARGET_CARD)]);

  // The target column holds one face-up card at the moment of the lift, so this
  // is the rectangle `specs/table.md` fixes for a column holding cards.
  const landing = rectCenter(dropRect("tableau", TARGET, [true]));
  const from = pileTopLeft("tableau", SOURCE);
  const press = cardCenter(from.x, from.y);

  await captureReplay(h, "dropped", async () => {
    await touchPress(h, press.x, press.y);
    const lifted = (await h.snapshot()).drag;
    if (lifted === null) {
      fail(
        `a touch contact landing on column ${SOURCE}'s card to lift a run — a ` +
          `press is a mouse button going down or a finger touching down ` +
          `(specs/controls.md)`,
        "nothing was in hand after the contact landed, so there was nothing " +
          "to carry",
      );
    }
    // The run keeps the offset between the press point and the leading card's
    // top-left, so the finger travels by however far that card's centre must.
    const centre = cardCenter(lifted.x, lifted.y);
    await touchGlide(
      h,
      press.x + (landing.x - centre.x),
      press.y + (landing.y - centre.y),
    );
    await touchRelease(h);
    await h.advance(SETTLE_FRAMES);
  });

  const after = await h.snapshot();

  assertDeepEqual(
    whereIs(after, heldId),
    { pile: "tableau", index: TARGET, row: 1 },
    `where the run the finger carried ended up — a drop resolves to the pile ` +
      `whose drop rectangle contains the centre of the run's leading card, and ` +
      `a pile that accepts the run takes it (specs/controls.md, ` +
      `specs/tableau.md)`,
  );
  assertDeepEqual(
    pileOf(after, "tableau", TARGET).map((c) => c.id),
    [targetId, heldId],
    "the target column after the finger lifted",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    0,
    "the cards the source column is left holding",
  );
  assertEqual(
    after.drag,
    null,
    "the run in hand once the contact lifted — a release ends the gesture " +
      "(specs/controls.md)",
  );
});

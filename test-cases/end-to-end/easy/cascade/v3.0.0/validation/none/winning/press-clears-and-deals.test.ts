// winning/press-clears-and-deals — a press during the cascade deals a fresh game.
//
// `specs/victory.md`, The end of the cascade: "A press anywhere, during the
// cascade or after it, deals a fresh game and moves to the `playing` screen. The
// deal clears the painted table, as `specs/deal.md` states." `specs/deal.md`
// states the clearing: "A new deal also clears the painted table, so a deal
// following a victory cascade leaves clean felt behind it."
//
// SO ONE GESTURE OWES THREE THINGS, and this check reads all three off the state
// the press left: the screen is `playing`, `trailStamps` is `0`, and a fresh
// fifty-two-card deal is on the table (`specs/deal.md`'s arrangement — twenty-
// eight cards in seven columns of one to seven, twenty-four in the stock, an
// empty waste with no sets, and four empty foundations).
//
// IT IS A PRESS, NOT A CLICK. `specs/victory.md` says a press, and
// `specs/controls.md` agrees — "on `won` a press deals a fresh game" — so the
// gesture driven here is `pointerDown` alone, with no release after it. A build
// that waits for the release deals nothing here and fails, which is the reading
// the specification asks for.
//
// THE CASCADE IS THE REAL ONE, AND IT HAS ALREADY PAINTED. `startCascade` wins
// the game through the game's own path, and the board is then advanced only until
// the painted layer has taken its first stamp — the requirement is that a press
// clears a painted table, not how much of it was painted, and a bounded sweep is
// what keeps a build that never paints from costing a long run. The stamp count
// going in is asserted, so the `0` read afterwards is a clearing rather than a
// layer that was never written.
//
// THE READING IS TAKEN BEFORE A FRAME RUNS. `specs/instrumentation.md` says the
// pointer operations take effect when they are called, so the state read straight
// after the press is what the press left; the still is captured on the frame
// after it, so a reviewer sees the felt the deal put down.
//
// WHERE THE PRESS LANDS DECIDES NOTHING. The centre of the stage is bare felt —
// `startCascade` leaves all seven columns empty and the HUD strip is at `y = 680`
// (`specs/table.md`) — so no control and no pile can be what answered it, and
// "anywhere" is read as the plainest point on the screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength, fail } from "../assert";
import {
  DEAL_STOCK_CARDS,
  DECK_SIZE,
  FOUNDATION_COUNT,
  STAGE_H,
  STAGE_W,
  TABLEAU_COLUMNS,
} from "../constants";
import {
  captureStill,
  createHarness,
  everyCard,
  framesFor,
  openTable,
  pileOf,
  startCascade,
  type Harness,
} from "../harness";

/** Where the press lands: the centre of the stage, which is bare felt here. */
const PRESS = { x: STAGE_W / 2, y: STAGE_H / 2 };

/**
 * How long the cascade is given to lay its first stamp, in frames.
 *
 * `specs/victory.md` holds the launch clock at `LAUNCH_INTERVAL` (`0.18`) when
 * the cascade begins, so the first card launches on the first frame and stamps
 * the layer on the next one. Half a second is nearly three launch intervals:
 * generous against any conformant build, and it bounds what a build that never
 * paints costs.
 */
const PAINT_FRAMES = framesFor(0.5);

/** One frame, so the still shows what the deal drew rather than the cascade. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("deals a fresh game onto clean felt when the cascade is pressed", async () => {
  await openTable(h);
  await startCascade(h);

  const painting = await h.until((state) => state.trailStamps > 0, {
    maxFrames: PAINT_FRAMES,
  });
  if (!painting.hit) {
    fail(
      "the running cascade to stamp the painted layer, so the press has a " +
        "painted table to clear (specs/victory.md)",
      `trailStamps was still ${painting.snapshot.trailStamps} after ${painting.frames} frames of cascade`,
    );
  }

  const before = await h.snapshot();
  assertEqual(before.screen, "won", "the screen the press is delivered on");
  assertGreaterThan(
    before.trailStamps,
    0,
    "stamps on the painted layer going into the press (specs/victory.md)",
  );

  await h.debug.pointerDown(PRESS.x, PRESS.y);
  // Read with no frame advanced, so this is the table the PRESS left.
  const after = await h.snapshot();

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "dealt");

  assertEqual(
    after.screen,
    "playing",
    `the screen a press at (${PRESS.x}, ${PRESS.y}) during the cascade ` +
      "reached — specs/victory.md: a press anywhere deals a fresh game and " +
      "moves to the playing screen",
  );
  assertEqual(
    after.trailStamps,
    0,
    `stamps on the painted layer after the press dealt over the ` +
      `${before.trailStamps} the cascade had laid — specs/deal.md: a new deal ` +
      "clears the painted table",
  );
  assertLength(
    everyCard(after),
    DECK_SIZE,
    "the cards the press dealt onto the table (specs/deal.md)",
  );
  for (let col = 0; col < TABLEAU_COLUMNS; col += 1) {
    assertLength(
      pileOf(after, "tableau", col),
      col + 1,
      `the cards dealt to column ${col} — specs/deal.md deals one to column 0, ` +
        "two to column 1, and so on to seven",
    );
  }
  assertLength(
    pileOf(after, "stock", 0),
    DEAL_STOCK_CARDS,
    "the cards left in the stock after the fresh deal (specs/deal.md)",
  );
  assertLength(
    pileOf(after, "waste", 0),
    0,
    "the cards on the waste after the fresh deal — specs/deal.md starts it empty",
  );
  assertLength(
    after.wasteSets,
    0,
    "the waste's set memory after the fresh deal — specs/deal.md starts it " +
      "with no sets",
  );
  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    assertLength(
      pileOf(after, "foundation", i),
      0,
      `the cards on foundation ${i} after the fresh deal — specs/deal.md ` +
        "starts all four empty",
    );
  }
});

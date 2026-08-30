// screens/won-press-deals — a press on the `won` screen deals a fresh game and
// moves to `playing`.
//
// `specs/victory.md`: "A press anywhere, during the cascade or after it, deals a
// fresh game and moves to the `playing` screen." `specs/screens.md` says the same
// of the screen: "A press deals a fresh game and returns to `playing`", and
// `specs/controls.md` sets the whole of what the pointer does there: "on `won` a
// press deals a fresh game".
//
// A PRESS, NOT A CLICK. The specification names the press edge in all three
// places, so the check delivers `pointerDown` alone and reads the answer before
// any release: a build that waits for the release has not answered the press.
// Nothing is released afterwards either, because the release would then land on a
// `playing` screen and belongs to no requirement this item decides.
//
// ANYWHERE, so the press is at the middle of the stage — a point that is inside
// no control rectangle `specs/controls.md` fixes and inside no drop rectangle
// `specs/table.md` fixes on the top row, so nothing but the `won` screen's own
// rule can answer it.
//
// THE ROUTE IS DIRECT. The screen is posed with `setScreen`, not reached by
// running the cascade, because this item is about what a press does on that
// screen and not about the cascade: a build whose cascade never ends must fail
// `screens/won-shows-message` and `cascade/cascade-completes`, and still be
// graded here on its own merits. The table is cleared first, so the fifty-two
// cards afterwards are the deal this press produced.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DECK_SIZE, STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  everyCard,
  type Harness,
} from "../harness";
import { openWon } from "./screens";

/** The middle of the stage: in no control's rectangle and on no pile's. */
const PRESS = { x: STAGE_W / 2, y: STAGE_H / 2 };

/** One frame, so the canvas carries the table the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deals a full deck and returns to play", async () => {
  await openWon(h);
  assertLength(
    everyCard(await h.snapshot()),
    0,
    "the cards on the table before the press",
  );

  await h.debug.pointerDown(PRESS.x, PRESS.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "dealt");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "playing",
    "the screen the press on the won screen reached (specs/victory.md)",
  );
  assertLength(
    everyCard(after),
    DECK_SIZE,
    "the cards the press put on the table (specs/deal.md)",
  );
});

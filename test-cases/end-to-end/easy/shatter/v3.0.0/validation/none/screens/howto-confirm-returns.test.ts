// Shatter — screens/howto-confirm-returns: confirming on the how-to screen returns
// to the title.
//
// THE RULE. `specs/ui.md`, on `howto`: "`howto` shows no menu of its own...
// Confirming leaves the screen as leaving it does, and both return to `title`".
// `specs/controls.md` binds `Space` and `Enter` to "Confirm the selection" and
// reads confirming as a press edge, "once per press".
//
// WHY IT IS A SEPARATE ITEM FROM `screens/howto-returns`. Confirming and leaving
// are two different keys reaching the same destination, and a build wires them in
// two different places. `howto` is the one screen with no entries to confirm, so
// it is exactly the screen a build is likeliest to leave with a dead confirm key —
// and a player who reads the instructions and presses the key every other screen
// accepts with is then stuck. Grading the two keys as one item would let a build
// lose both points, or neither, for one of the two mistakes.
//
// THE SCREEN IS POSED, THE CONFIRM IS DRIVEN. `setScreen("howto")` is the direct
// route to the screen this item leaves — how the screen is REACHED is
// `screens/howto-reachable`'s requirement — and the confirm has to be a real key,
// since `specs/instrumentation.md` carries no operation that confirms.
//
// THE KEY IS `Enter` rather than `Space`: `specs/controls.md` gives `Enter` one
// meaning and only one, so a build that resolved the key against the wrong screen
// cannot have read this press as a shot.
//
// WHAT THIS ITEM DOES NOT DECIDE. Which keys confirm (`controls/confirm-enter`,
// `controls/confirm-space`), that `Escape` leaves the screen too
// (`screens/howto-returns`), which entry the return highlights
// (`screens/howto-returns-to-its-entry`), or what the how-to draws
// (`screens/howto-shows-the-controls`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS_CONFIRM } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { SETTLE_TICKS, reachHowto } from "./screens";

/** `Enter`, the confirm key that carries no second meaning (specs/controls.md). */
const CONFIRM_KEY = KEYS_CONFIRM[1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when the how-to screen is confirmed", async () => {
  await reachHowto(h);

  await h.tap(CONFIRM_KEY);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen confirming on the how-to returned to (specs/ui.md)",
  );
});

// Wick — instrumentation/set-screen-unlisted-inert: `setScreen("chest")` from
// `playing`, `setScreen("levelup")` from `title`, and `setScreen("paused")`
// from `title` each leave the state exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Any row not listed, `chest` from anywhere or `levelup` from `title` among
// them, leaves the state as it was." The `paused` row lists `playing` alone as
// its source. The ninth screen is not among these three: the table carries an
// `almanac | any` row, so `setScreen("almanac")` is listed and enters. The
// comparison is exact equality of the documented snapshot across each call, and
// that snapshot spans every documented field, `almanacTab`, `almanacScroll` and
// `run.hurtFlash` included.
//
// WHY THE WORLD IS POSED AS IT IS. The `chest` call is made on an isolated
// run, the other two on the title the reset leaves; each is one of the rows
// the sentence names, and a screen change on any of them is plain to read. The
// run under the `chest` call is given a contact hit first, so the hurt flash is
// running across it and a call that quietly restarted the run would be read: a
// rat's radius is 12 and `PLAYER_RADIUS` is 12 (specs/enemies.md,
// specs/world.md), so one posed 20 units from the lamplighter's center overlaps
// and hits on the tick it stands there.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { type ScreenName } from "../constants";
import {
  captureStill,
  createHarness,
  posedState,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** How far from the lamplighter's center the rat is posed: 20, inside 12 + 12. */
const RAT_OFFSET = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Call `setScreen(name)` and read the snapshot untouched across it. */
async function requireInert(name: ScreenName): Promise<void> {
  const before = await h.snapshot();
  try {
    await h.debug.setScreen(name);
  } catch {
    // A refusal leaves the state as it was too; what is read is the state.
  }
  const after = await h.snapshot();
  assertEqual(
    after.screen,
    before.screen,
    `the screen after setScreen('${name}') from ${before.screen}`,
  );
  assertDeepEqual(
    posedState(after),
    posedState(before),
    `the snapshot across setScreen('${name}') from ${before.screen}`,
  );
}

it("leaves the state as it was on an unlisted row", async () => {
  await isolate(h, { on: ["enemyContact"] });
  await placeEnemyNear(h, "rat", RAT_OFFSET, 0);
  const wounded = await h.step(1);
  assertNotEqual(wounded.run.hurtFlash, 0, "the flash running across the call");
  await requireInert("chest");

  await h.debug.reset();
  await requireInert("levelup");
  await requireInert("paused");
  await captureStill(h, "inert");
});

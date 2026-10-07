// instrumentation/set-next-teleport-speed-poses-the-speed — the posed speed is the
// speed the next teleport gives the miner.
//
// `specs/instrumentation.md`, Posing the Quantum Teleporter:
// `setNextTeleportSpeed(speed)` sets "The downward speed, in units per second,
// the next Quantum Teleporter use gives the miner, from `150` to `700` as
// `specs/items.md` bounds the draw, or `null` to leave the speed to the draw",
// and the snapshot reports it as `nextTeleportSpeed`, "`null` while no outcome
// is posed".
//
// THE READ-BACK COMES FIRST. A pose is verified by setting a value and reading it
// back, so the speed is posed, read, cleared with `null` and read again before
// the teleporter is used at all. Then the speed is posed once more and the item
// is used from deep underground, and the miner's vertical velocity is read on the
// call itself, before any frame runs, so what is measured is the speed the item
// gave the miner rather than what gravity had added by the time it was looked at.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertNull } from "../assert";
import {
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";

/** The speed posed for the read-back, and the one the teleport is used with. */
const READ_BACK_SPEED = 250;
const POSED_SPEED = 420;

/** The floor the miner is teleported away from, well underground. */
const DEEP_COL = 10;
const DEEP_FLOOR_ROW = 30;

/** Frames the placed miner is left falling for, so the recording shows it. */
const SHOWN_FRAMES = 30;

/** Decimal places the speed is held to. */
const PLACES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the speed the next Quantum Teleporter use gives the miner", async () => {
  await openScene(h);
  await layFloor(h, 1);
  await layFloor(h, DEEP_FLOOR_ROW);
  await pinDrill(h);
  await h.debug.setItemCount("quantum-teleporter", 1);
  await standOn(h, DEEP_COL, DEEP_FLOOR_ROW);

  // Set, read back, clear, read back.
  await h.debug.setNextTeleportSpeed(READ_BACK_SPEED);
  assertEqual(
    (await h.snapshot()).nextTeleportSpeed,
    READ_BACK_SPEED,
    "nextTeleportSpeed after a pose",
  );
  await h.debug.setNextTeleportSpeed(null);
  assertNull(
    (await h.snapshot()).nextTeleportSpeed,
    "nextTeleportSpeed after setNextTeleportSpeed(null)",
  );

  // Pose it again and use the teleporter: the miner leaves at the posed speed.
  await h.debug.setNextTeleportSpeed(POSED_SPEED);
  const placed = await captureReplay(h, "posed-speed", async () => {
    await h.debug.useItem("quantum-teleporter");
    const { miner } = await h.snapshot();
    await h.advance(SHOWN_FRAMES);
    return miner;
  });

  assertCloseTo(
    placed.vy,
    POSED_SPEED,
    PLACES,
    "the downward speed the teleport gave the miner",
  );
});

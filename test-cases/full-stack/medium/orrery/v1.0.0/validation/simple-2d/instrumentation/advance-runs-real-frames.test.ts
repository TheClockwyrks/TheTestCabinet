// instrumentation/advance-runs-real-frames — an advanced frame is a whole frame:
// the state moves, and the canvas is redrawn from it.
//
// THE RULE. "Each is a real frame, the same update the loop runs followed by a
// render, so the game's own simulation, sigils, cues, and completion test produce
// the result and the canvas reflects it" (`specs/instrumentation.md`, The clock,
// under no engine). Under either engine the frame is the engine's own, which
// "advances the game frame by frame"; either way, the frame game time arrives on is
// a frame a player would have got.
//
// WHAT THE FAILURE LOOKS LIKE, AND HOW IT IS CAUGHT. A build is free to advance its
// simulation from a stepped clock without drawing anything: the state moves, every
// reading answers, and the canvas keeps whatever picture the loop last left on it.
// So the verdict is the two together, over ONE frame — the state moved, and the
// canvas moved with it. A frame that updated and did not render leaves the picture
// exactly as it was. A frame that rendered and did not update leaves the fraction
// exactly as it was.
//
// THE POSE is one arm sweeping one mote, mid-cycle. `rotate-cw` carries the held
// mote around the arm's base, so the hex the mote was drawn on is repainted WITHOUT
// it by any frame that genuinely rendered the state that frame produced. The hold
// is given with `setGrip`, "which takes hold with no `grab` ever running", and the
// field holds nothing else, so the one advanced frame is the whole of what happens
// between the two readings.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceFraction,
  captureStill,
  createHarness,
  differingShare,
  drawOps,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** The hex the carried mote starts on: the gripper of an arm at (0, 0), rotation 0. */
const GRIPPED = at(1, 0);

/** How much of the cycle the one advanced frame is worth. */
const FRACTION = 0.25;

/** How far the sweep must carry the mote for the reading to mean anything, in units. */
const MOVED_AT_LEAST = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the state and redraws the canvas in the one frame it advances", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  const [arm] = await partIds(h);
  const carried = await spawnMote(h, GRIPPED, "sol");
  await takeGrip(h, arm ?? -1, 0, carried);
  await h.advance(1);

  const before = await h.snapshot();
  const wasAt = moteById(before, carried);
  assertNotNull(wasAt, "the carried mote is on the field before the frame");
  const wasX = wasAt?.x ?? 0;
  const wasY = wasAt?.y ?? 0;
  const wasPicture = await h.pixelRect(
    wasX - HEX_PITCH / 2,
    wasY - HEX_PITCH / 2,
    HEX_PITCH,
    HEX_PITCH,
  );

  // Exactly one frame, worth a quarter of the cycle the arm is sweeping.
  await advanceFraction(h, FRACTION, 1);
  await captureStill(h, "rendered");
  const after = await h.snapshot();

  // The state moved.
  assertGreaterThan(
    (after.sim?.fraction ?? 0) - (before.sim?.fraction ?? 0),
    FRACTION_TOLERANCE,
    "the one advanced frame ran the update: the cycle's fraction advanced",
  );
  assertEqual(
    after.sim?.status,
    "running",
    "and it left the run running rather than faulting",
  );
  assertNull(after.sim?.fault ?? null, "with nothing raised against it");
  const nowAt = moteById(after, carried);
  assertNotNull(
    nowAt,
    "the carried mote is still on the field after the frame",
  );
  assertGreaterThan(
    Math.hypot((nowAt?.x ?? 0) - wasX, (nowAt?.y ?? 0) - wasY),
    MOVED_AT_LEAST,
    "and the sweep carried it, so the position it is drawn at moved with the fraction",
  );

  // And the canvas moved with it.
  assertGreaterThan(
    drawOps(await h.lastCalls()),
    0,
    "the same frame ran a render: the operations it issued are the last frame's",
  );
  const nowPicture = await h.pixelRect(
    wasX - HEX_PITCH / 2,
    wasY - HEX_PITCH / 2,
    HEX_PITCH,
    HEX_PITCH,
  );
  assertGreaterThan(
    differingShare(nowPicture, wasPicture),
    0,
    "and the canvas reflects the state the frame produced: the mote is no longer drawn where it was",
  );
});

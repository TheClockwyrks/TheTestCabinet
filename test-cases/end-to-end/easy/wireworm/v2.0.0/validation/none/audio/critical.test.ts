// audio/critical — a node reaching charge 3 sounds a cue on the frame it reaches
// it, and the steps that carried the worm there stay silent.
//
// `specs/ui.md`'s cue table: `critical` is played when "A node reaches charge
// `3`", and every cue "is played on the frame its event happens and at most once
// on that frame". `specs/nodes.md` fixes the only route a worm has to it: "A node
// gains one charge when the worm's head is blocked by it", `charge = min(
// CHARGE_MAX, charge + 1)`, "once per block rather than continuously".
//
// WHAT IS AND IS NOT OBSERVABLE HERE is set out in `audio/cues`: the sound and
// its frame can be read from outside an engineless build, the cue's NAME cannot.
//
// THE NODE IS POSED AT CHARGE `2`, WHICH IS THE DISTINGUISHING VALUE. The block
// lifts it to exactly `CHARGE_MAX` (`3`), so the event the item names happens on
// that one block and on no earlier one — a node posed inert would have needed
// three blocks and a node posed critical would already be there before the drive
// began.
//
// THE APPROACH IS THE CONTROL. The head is laid four tiles short of the node on a
// clear row, so the worm takes three ordinary steps down an empty row before the
// block. `specs/nodes.md` gives no cue to a step and `specs/worm.md` none to a
// wind, so those frames must be silent — which is where a build that blips per
// step, or per frame, fails. Only the head is posed (`length: 1`), so no trailing
// segment is anywhere on the board.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { CHARGE_MAX } from "../constants";
import {
  captureStill,
  chargeAt,
  createHarness,
  framesForSteps,
  poseWorm,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";
import { framesOtherThan, soundsOn } from "./cues";

/** The row the approach runs along, clear of the entry row and the player band. */
const ROW = 8;

/** Where the head starts, and the node it winds into four tiles along. */
const HEAD_C = 10;
const NODE_C = HEAD_C + 4;

/** The charge the node is posed at: one block short of critical. */
const POSED_CHARGE = CHARGE_MAX - 1;

/**
 * A ceiling on a build whose worm never reaches the node, not a tolerance on the
 * step it reaches it at.
 *
 * The block is the fourth step, so six steps of the level's own interval is
 * comfortably past it and still bounds a worm that never arrives.
 */
const NEVER_BLOCKED = framesForSteps(6);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the node reaches critical, and on no other frame", async () => {
  await startPlaying(h);
  await h.debug.setNode(NODE_C, ROW, POSED_CHARGE);
  await poseWorm(h, { c: HEAD_C, r: ROW, length: 1, dh: 1, dv: 1 });

  await h.armAudio();
  const played = watchCues(h);

  const armed = await h.until(
    (snapshot) => chargeAt(snapshot, NODE_C, ROW) === CHARGE_MAX,
    { maxFrames: NEVER_BLOCKED, poll: 1 },
  );
  // Read HERE, on the frame the node reached critical.
  const criticalFrame = h.frame();
  const heard = [...played];

  await captureStill(h, "critical");

  assertEqual(
    armed.hit,
    true,
    `the worm's block to lift the node from ${POSED_CHARGE} to ${CHARGE_MAX}`,
  );
  assertGreaterThan(
    soundsOn(heard, criticalFrame),
    0,
    `sounds emitted on frame ${criticalFrame}, the frame the node reached critical`,
  );
  assertDeepEqual(
    framesOtherThan(heard, criticalFrame),
    [],
    "the frames of every sound emitted away from the node arming",
  );
});

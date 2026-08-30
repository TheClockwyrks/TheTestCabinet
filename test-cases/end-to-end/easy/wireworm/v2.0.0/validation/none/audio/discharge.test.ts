// audio/discharge — a bolt into a critical node sounds a cue on the frame the
// chain runs, and the flight before it stays silent.
//
// `specs/ui.md`'s cue table: `discharge` is played when "A detonation's chain
// runs", and every cue "is played on the frame its event happens and at most once
// on that frame". `specs/nodes.md` fixes the event: a bolt into a node at charge
// `3` makes it detonate, "as `specs/discharge.md` states", and that file has the
// whole chain resolve "at the moment the bolt strikes, within the same update".
//
// WHAT IS AND IS NOT OBSERVABLE HERE is set out in `audio/cues`: the sound and
// its frame can be read from outside an engineless build, the cue's NAME cannot.
//
// THE WORLD THIS POSES. Two nodes on an otherwise empty board: a critical one on
// the tile the bolt climbs into, and a charged one two tiles away — a Chebyshev
// distance of exactly `DISCHARGE_RADIUS` (`2`), so the chain genuinely conducts
// a link rather than detonating a lone node, which is what makes the event the
// item's "chain-arc discharge". No worm and no foe stand anywhere near, so the
// frame the chain runs on cannot also be carrying a cut, a foe kill or a level
// clear.
//
// WHAT THE CHAIN DOES IS NOT READ HERE. Which nodes it reaches, how many arcs it
// reports and how long they live are `discharge/`'s requirements, and a build that
// gets them wrong must not be failed twice for it. The one reading this point
// takes off the board is that the struck node detonated at all, so the frame the
// sound is held against is the frame the detonation really happened on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { CHARGE_MAX, DISCHARGE_RADIUS } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  nodeAt,
  poseBolt,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";
import { framesOtherThan, soundsOn } from "./cues";

/** The critical node the bolt is fired into, clear of the entry row and the band. */
const STRUCK = { c: 12, r: 8 } as const;

/** The charged node the chain conducts to: exactly DISCHARGE_RADIUS away. */
const REACHED = { c: STRUCK.c + DISCHARGE_RADIUS, r: STRUCK.r } as const;

/** The charge it is posed at: charged, which is what a discharge arcs to. */
const REACHED_CHARGE = 1;

/** Quiet play driven before the bolt is put in flight, in frames. */
const QUIET_FRAMES = framesFor(0.3);

/** A ceiling on a build whose shot never resolves, not a tolerance on when it does. */
const NEVER_RESOLVED = framesFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the chain runs, and on no other frame", async () => {
  await startPlaying(h);
  await h.debug.setNode(STRUCK.c, STRUCK.r, CHARGE_MAX);
  await h.debug.setNode(REACHED.c, REACHED.r, REACHED_CHARGE);

  await h.armAudio();
  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  await poseBolt(h, STRUCK.c, STRUCK.r + 1);
  const fired = await h.until(
    (snapshot) => nodeAt(snapshot, STRUCK.c, STRUCK.r) === undefined,
    { maxFrames: NEVER_RESOLVED, poll: 1 },
  );
  // Read HERE, on the frame the struck node left the board.
  const chainFrame = h.frame();
  const heard = [...played];

  await captureStill(h, "discharge");

  assertEqual(fired.hit, true, "the bolt to detonate the critical node");
  assertGreaterThan(
    soundsOn(heard, chainFrame),
    0,
    `sounds emitted on frame ${chainFrame}, the frame the chain ran`,
  );
  assertDeepEqual(
    framesOtherThan(heard, chainFrame),
    [],
    "the frames of every sound emitted away from the discharge",
  );
});

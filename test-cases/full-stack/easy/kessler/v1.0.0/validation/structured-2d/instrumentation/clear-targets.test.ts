// instrumentation/clear-targets — one call empties all three rings, and nothing
// comes of it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md words `clearTargets`
// as "removes every target from all three rings" and then bounds what the call
// is NOT: "it is not a destruction and not a clearing: nothing scores, no pod
// draw is made, no cue plays, and the screen stays where it stands, so a field
// emptied this way plays on in `playing`".
//
// SO THERE ARE TWO HALVES TO READ. The first is the removal itself: after the
// call every ring's `targets` list is empty. The second is the absence of every
// outcome an emptied field could otherwise mean: the score stands, no pod
// appears, and — with `waveAdvance` left ON, deliberately — the clearing event
// does not fire, so ticks run on in `playing` over the empty field. A build
// that implements the clear as forty-eight destructions fails the score or the
// pod read; one that treats "zero live targets" as the clearing event fails the
// screen read.
//
// The field is the one a fresh session lays out, entered through the harness's
// own sequence of atomic poses, so the call is exercised against every slot of
// all three rings; the parked ball and the switches are left exactly as that
// entry posed them, because what the call must NOT do is the requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  openHarness,
  startFreshSession,
  type Harness,
} from "../harness";

/** Ticks the emptied field is watched for a clearing that must not come. */
const WATCH_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties the rings and plays on in playing", async () => {
  const laid = startFreshSession(h);
  const targetsLaid = laid.rings.reduce(
    (count, ring) => count + ring.targets.length,
    0,
  );
  assertGreaterThan(targetsLaid, 0, "targets on the fresh field");
  assertEqual(laid.waveAdvance, true, "the waveAdvance switch, left on");
  assertEqual(laid.podSpawn, true, "the podSpawn switch, left on");

  h.debug.clearTargets();

  const cleared = h.snapshot();
  assertLength(cleared.rings[0].targets, 0, "ring 1's targets after the call");
  assertLength(cleared.rings[1].targets, 0, "ring 2's targets after the call");
  assertLength(cleared.rings[2].targets, 0, "ring 3's targets after the call");
  assertEqual(cleared.score, laid.score, "the score after the call");
  assertLength(cleared.pods, 0, "pods after the call");
  assertEqual(cleared.screen, "playing", "the screen after the call");

  const later = await h.tick(WATCH_TICKS);
  captureStill(h, "emptied");
  assertEqual(later.screen, "playing", "the screen over the emptied field");
  assertEqual(later.wave, laid.wave, "the wave over the emptied field");
  assertEqual(later.score, laid.score, "the score over the emptied field");
  assertLength(later.pods, 0, "pods over the emptied field");
});

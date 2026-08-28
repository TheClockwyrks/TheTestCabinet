// lanternjaw/ink-shakes — ink shakes its fix at once.
//
// specs/predators/lanternjaw.md makes ink the one exception to the linger: "An ink
// cloud that the Lanternjaw stands in, or that lies on the line between it and the
// forager, drops the fix at once, with no linger, and the Lanternjaw wanders for as
// long as the cloud blinds it." specs/sensing.md says the same from the cloud's
// side: a blinded hunter "drops any fix it holds, takes no new one, and wanders
// until it is clear of the cloud or the cloud expires".
//
// So there are two readings, and both are taken: how long the fall back to wander
// takes, and whether a new fix is taken while the cloud still stands.
//
// THE CLOUD IS RELEASED BY THE PLAYER'S OWN KEY, not posed. specs/sensing.md has
// the cloud "appear centered on the forager", so every line from the hunter to the
// forager passes through the cloud's center whatever the separation — which is the
// blinding condition specs/sensing.md states, "the segment joining its center to
// the forager's center passes within `INK_RADIUS` of that cloud's center".
//
// THE STANDOFF IS WIDE ON PURPOSE. The hunter stands eight tiles off: inside the
// 320 units it reaches at `G = 1`, so it has a fix to lose, and far enough that a
// blinded hunter wandering at `DRIFTER_SPEED` (64) cannot cross the gap inside the
// cloud's whole life. A closer pair ends with the hunter blundering into a parked
// forager, which takes a life and re-dens the board mid-measurement.
//
// WHAT THIS DOES NOT DECIDE. That the key releases a cloud at all is
// `controls/ink-key`'s and `ink/cloud`'s; taking the fix in the first place is
// `lanternjaw/light-range`'s. A build that fails either stands this check down
// rather than being failed twice for one fault.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, LINGER_TIME } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNull,
  assertTrue,
} from "../assert";
import { poseInkStandoff } from "../fixtures";
import {
  captureReplay,
  createHarness,
  seconds,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  clearUnderfoot,
  denAll,
  failPrecondition,
  indexOfKind,
  parkForager,
  sceneGuard,
  sceneHeld,
} from "../scene";

/** The key specs/movement.md binds the `b` action — "releases an ink cloud" — to. */
const INK_KEY = BINDINGS.b[0];

/** How far the hunter waits down the corridor, in tiles. See the header. */
const GAP_TILES = 8;

/** The brightness the fix is earned at, which `setBrightness` holds steady. */
const BRIGHT_G = 1;

/**
 * How long the fix is given to be taken, in ticks.
 *
 * A tenth of a second, a hard bound. Whether it is taken at all is
 * `lanternjaw/light-range`'s verdict, so a miss stands this check down.
 */
const FIX_TICKS = ticksFor(0.1);

/**
 * How long the cloud is given to appear once the key is pressed, in ticks.
 *
 * A tenth of a second. Whether the key releases a cloud at all is
 * `controls/ink-key`'s verdict, so a miss stands this check down.
 */
const CLOUD_TICKS = ticksFor(0.1);

/**
 * The last tick the wander may arrive on, counted from the cloud appearing.
 *
 * The item's bound: "within a tenth of a second of the cloud appearing". A hard
 * deadline rather than an open wait, so a build that lingers instead FAILS here.
 */
const DROP_TICKS = ticksFor(0.1);

/**
 * How long the blinded hunter is watched for a fix it must not take, in ticks.
 *
 * A second and a fifth, comfortably inside the cloud's `INK_LIFE` (3 s) so the
 * whole watch runs while the cloud is still standing, which the check confirms
 * from the snapshot rather than assuming.
 */
const BLIND_TICKS = ticksFor(1.2);

/** How often the blinded watch reads the state, in ticks. */
const BLIND_POLL = 6;

/** Ticks run after every reading, purely so the clip shows the cloud standing. */
const TAIL_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Ink shakes its fix at once", async () => {
  startPlaying(h);
  const stand = await poseInkStandoff(h, { gap: GAP_TILES });
  const index = indexOfKind(h.snapshot(), "lanternjaw");
  if (index < 0) {
    failPrecondition(
      "a Lanternjaw on the roster to pose this scenario with",
      "the progression points",
      "no lanternjaw in snapshot().predators",
    );
  }
  const quiet = await denAll(h, [index]);
  h.debug.setPredatorTile(index, stand.pred.tx, stand.pred.ty);
  h.debug.setPredatorState(index, "wander");
  await parkForager(h, stand.ink);
  await clearUnderfoot(h);
  h.debug.setBrightness(BRIGHT_G);
  h.debug.setInkCooldown(0);
  const guard = await sceneGuard(h, quiet);

  const fixed = await h.until((s) => s.predators[index].state === "chase", {
    maxFrames: FIX_TICKS,
    poll: 1,
  });
  if (!fixed.hit) {
    failPrecondition(
      "the Lanternjaw to take a fix on a lit forager on a clear line, so there " +
        "is a fix for ink to break",
      "lanternjaw/light-range",
      fixed.snapshot.predators[index].state,
    );
  }

  const broke = await captureReplay(h, "shaken", async () => {
    const before = h.snapshot();
    await h.tap(INK_KEY);
    const released = await h.until(
      (s) => s.inkClouds.length > before.inkClouds.length,
      { maxFrames: CLOUD_TICKS, poll: 1 },
    );
    if (!released.hit) {
      failPrecondition(
        `pressing ${INK_KEY} with ink.ready posed true to release a cloud, so ` +
          "there is something on the line to blind the hunter",
        "controls/ink-key",
        `${released.snapshot.inkClouds.length} clouds in flight`,
      );
    }
    const dropped = await h.until(
      (s) => s.predators[index].state === "wander",
      {
        maxFrames: DROP_TICKS,
        poll: 1,
      },
    );
    const seen: string[] = [];
    for (let spent = 0; spent < BLIND_TICKS; spent += BLIND_POLL) {
      await h.advance(BLIND_POLL);
      seen.push(h.snapshot().predators[index].state);
    }
    const watched = h.snapshot();
    await h.advance(TAIL_TICKS);
    return { released, dropped, seen, watched, end: h.snapshot() };
  });

  assertNull(sceneHeld(broke.end, guard), "the scenario held to the end");

  assertEqual(
    broke.dropped.hit,
    true,
    `the Lanternjaw is wandering within ${seconds(DROP_TICKS).toFixed(2)} s of ` +
      `the cloud appearing, well short of LINGER_TIME (${LINGER_TIME} s) — it ` +
      `read ${broke.dropped.snapshot.predators[index].state} at the deadline`,
  );
  assertLessThanOrEqual(
    seconds(broke.dropped.frames),
    0.1,
    "the seconds from the cloud appearing to the fix being dropped, which ink " +
      "drops at once and with no linger (specs/predators/lanternjaw.md)",
  );
  // The watch below only says anything while the cloud is actually standing, so
  // the fixture's own claim is read off the snapshot rather than assumed.
  assertGreaterThan(
    broke.watched.inkClouds.length,
    0,
    `the clouds still standing after the ${seconds(BLIND_TICKS).toFixed(1)} s ` +
      "the hunter was watched for, which is what makes that watch a reading of " +
      "a blinded hunter",
  );
  assertTrue(
    broke.seen.every((state) => state !== "chase"),
    "the states the Lanternjaw reported while the cloud stood between it and " +
      `the forager — it read [${broke.seen.join(", ")}]`,
  );
});

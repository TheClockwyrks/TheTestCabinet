// lanternjaw/ink-shakes — ink shakes its fix at once.
//
// `specs/predators/lanternjaw.md` makes ink the one exception to the linger: "An
// ink cloud that the Lanternjaw stands in, or that lies on the line between it and
// the forager, drops the fix at once, with no linger, and the Lanternjaw wanders
// for as long as the cloud blinds it." `specs/sensing.md` says the same from the
// cloud's side: a blinded hunter "drops any fix it holds, takes no new one, and
// wanders until it is clear of the cloud or the cloud expires".
//
// So there are two readings, and both are taken: how long the fall back to wander
// takes, and whether a new fix is taken while the cloud still stands.
//
// THE CLOUD IS RELEASED BY THE PLAYER'S OWN KEY, not posed — and pressed through
// Chromium's own input pipeline, so what reaches the build is a browser-trusted
// key event on the real page. `specs/sensing.md` has the cloud "appear centered on
// the forager", so every line from the hunter to the forager passes through the
// cloud's center whatever the separation, which is the blinding condition
// `specs/sensing.md` states: "the segment joining its center to the forager's
// center passes within `INK_RADIUS` of that cloud's center".
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
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNull,
  assertTrue,
} from "../assert";
import { BINDINGS, LINGER_TIME } from "../constants";
import { poseInkStandoff, predatorIndex } from "../fixtures";
import {
  captureReplay,
  createHarness,
  seconds,
  ticks,
  type Harness,
} from "../harness";
import {
  clearUnderfoot,
  denAllExcept,
  parkForager,
  sceneGuard,
  sceneHeld,
  startPlaying,
} from "../scene";

/** The key `specs/movement.md` binds the `b` action — "releases an ink cloud" — to. */
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
const FIX_TICKS = ticks(0.1);

/**
 * How long the cloud is given to appear once the key is pressed, in ticks.
 *
 * A tenth of a second. Whether the key releases a cloud at all is
 * `controls/ink-key`'s verdict, so a miss stands this check down.
 */
const CLOUD_TICKS = ticks(0.1);

/**
 * The last tick the wander may arrive on, counted from the cloud appearing.
 *
 * The item's bound: "within a tenth of a second of the cloud appearing". A hard
 * deadline rather than an open wait, so a build that lingers instead FAILS here.
 */
const DROP_TICKS = ticks(0.1);

/**
 * How long the blinded hunter is watched for a fix it must not take, in ticks.
 *
 * A second and a fifth, comfortably inside the cloud's `INK_LIFE` (3 s) so the
 * whole watch runs while the cloud is still standing, which the check confirms
 * from the snapshot rather than assuming.
 */
const BLIND_TICKS = ticks(1.2);

/** How often the blinded watch reads the state, in ticks. */
const BLIND_POLL = 6;

/** Ticks run after every reading, purely so the clip shows the cloud standing. */
const TAIL_TICKS = 36;

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("Ink shakes its fix at once", async () => {
  await startPlaying(h);
  const stand = await poseInkStandoff(h, { gap: GAP_TILES });
  const index = predatorIndex(await h.snapshot(), "lanternjaw");
  if (index === null) {
    h.unmet(
      "the roster carries no Lanternjaw, so this scenario has nothing to pose — " +
        "what the roster holds is the progression checks' verdict, not this one's",
    );
  }
  const quiet = await denAllExcept(h, [index]);
  await h.debug.setPredatorTile(index, stand.pred.tx, stand.pred.ty);
  await h.debug.setPredatorState(index, "wander");
  await parkForager(h, stand.ink);
  await clearUnderfoot(h);
  await h.debug.setBrightness(BRIGHT_G);
  await h.debug.setInkCooldown(0);
  const guard = await sceneGuard(h, quiet);

  const fixed = await h.until((s) => s.predators[index].state === "chase", {
    maxTicks: FIX_TICKS,
    poll: 1,
  });
  if (!fixed.hit) {
    h.unmet(
      "the Lanternjaw took no fix on a lit forager on a clear line, so there was " +
        "no fix for ink to break — whether it senses the forager at all is " +
        "lanternjaw/light-range's verdict, not this one's",
    );
  }

  const broke = await captureReplay(h, "shaken", async () => {
    const before = await h.snapshot();
    await h.tap(INK_KEY);
    const released = await h.until(
      (s) => s.inkClouds.length > before.inkClouds.length,
      { maxTicks: CLOUD_TICKS, poll: 1 },
    );
    if (!released.hit) {
      h.unmet(
        `pressing ${INK_KEY} released no cloud with ink.ready posed true, so ` +
          "there was nothing on the line to blind the hunter — whether the key " +
          "releases ink is controls/ink-key's verdict, not this one's",
      );
    }
    const dropped = await h.until(
      (s) => s.predators[index].state === "wander",
      {
        maxTicks: DROP_TICKS,
        poll: 1,
      },
    );
    const seen: string[] = [];
    for (let spent = 0; spent < BLIND_TICKS; spent += BLIND_POLL) {
      await h.advance(BLIND_POLL);
      seen.push((await h.snapshot()).predators[index].state);
    }
    const watched = await h.snapshot();
    await h.advance(TAIL_TICKS);
    return { released, dropped, seen, watched, end: await h.snapshot() };
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
    seconds(broke.dropped.ticks),
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

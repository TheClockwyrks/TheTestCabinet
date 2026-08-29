// alert/flarefish — the Flarefish fires the alert on a fresh fix.
//
// `specs/predators.md`: "The moment a Gloamfin or a Flarefish acquires a fix it was
// not already chasing on, it fires a detection alert. For `ALERT_TIME` (`0.5 s`)
// from that moment the snapshot reports `alert` as true for that predator, and the
// predator is drawn lit for that whole window, wherever it stands and whatever the
// fog would otherwise hide of it."
//
// `specs/predators/flarefish.md` gives the Flarefish TWO ways to acquire, and both
// are exercised here because a build can wire the alert into one and forget the
// other. Its light sense "runs whatever the Flarefish is doing and owes nothing to
// the flare", and its bloom "takes a fix on the forager's current tile, fires the
// detection alert, and chases from that moment".
//
// BOTH HUNTERS STAND BEYOND THE FORAGER'S LIGHT. `lit` is true whenever a
// predator's body is drawn, and the forager's own light is one of the things that
// draws it (`specs/predators.md`), so a Flarefish inside the light pocket would
// report `lit` true whether or not it fired anything. Each phase therefore stands
// it further off than the light radius the build itself reports, and the check
// reads that separation at every sample rather than assuming it.
//
// THE FLARE PHASE POSES A HUNTER THAT CANNOT MOVE. `specs/movement.md`: "a body
// standing on a tile whose neighbors are all closed to it stays where it stands".
// A single corridor tile walled on all four sides holds the Flarefish exactly five
// tiles from the forager for the whole wait, so the bloom happens at a distance
// inside `FLARE_RADIUS` (192) rather than wherever a patrol had wandered to, and a
// hunter that locks on cannot then cross to the forager and end the measurement.
// Its own mind runs throughout: nothing about the flare is posed.
//
// THE WAIT FOR THAT FLARE IS SKIPPED RATHER THAN ADVANCED, so the seconds spent
// standing still cost the recorded clip nothing; what the clip shows is the
// light-sense acquisition, which is the shorter and more legible of the two.
//
// EACH HALF POSES ITS OWN WORLD, holding the forager and one Flarefish. Both
// fixtures empty the board first, so nothing else senses, flares or is eaten
// while either window is watched — and the second half spawns its Flarefish
// afresh, because posing a fixture takes the first one off the board with
// everything else.
//
// AND BOTH ACQUISITIONS HAVE TO HAPPEN. An alert fires on a fix, so a build whose
// Flarefish never takes one — by its light sense, or through the bloom — leaves
// this point nothing to read and the check FAILS.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  ALERT_TIME,
  BRIGHT_HOLD,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  LANTERN_RANGE_BASE,
} from "../constants";
import { poseMaze, poseSightLine, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  seconds,
  ticks,
  type FathomSnapshot,
  type Harness,
  startPlaying,
} from "../harness";
import {
  parkForager,
  requireSceneHeld,
  sceneGuard,
  type SceneGuard,
} from "../scene";

/**
 * How far apart the light-sense pair stands, in tiles.
 *
 * Nine is 288 units: inside the 320 a Flarefish reaches at `G = 1`, and far
 * outside the 160 its light pocket reaches at the same brightness, so the hunter
 * is out of the light for the whole window even as it closes.
 */
const LIGHT_GAP_TILES = 9;

/**
 * How far the boxed Flarefish stands from the forager, in tiles.
 *
 * Five is 160 units: inside `FLARE_RADIUS` (192), so the bloom locks on; outside
 * the 128 the light sense reaches at `G = 0`, so the lock is the flare's doing and
 * not the ordinary sense's; and outside the 96 the light pocket reaches at that
 * brightness, so nothing but the alert is drawing it.
 */
const FLARE_GAP_TILES = 5;

/**
 * How long each acquisition is given, in ticks.
 *
 * A fifth of a second, a hard bound: the light sense holds "on any step where all
 * three of these hold at once", so a conforming build acquires at once.
 */
const FIX_TICKS = ticks(0.2);

/** How long the alert is given to rise once the fix is taken, in ticks. */
const FIRE_TICKS = ticks(0.1);

/**
 * How long the flare is waited for, in ticks.
 *
 * Two whole `FLARE_INTERVAL`s plus a charge, a bloom and a second of slack.
 * `specs/predators/flarefish.md` fixes the interval between flares and leaves what
 * the timer opens at to the build, so the budget covers a first flare arriving as
 * late as a full interval into the wait and a second one after it. A hard bound
 * even so: a build that never flares stands the check down here rather than
 * running the suite out.
 */
const FLARE_WAIT_TICKS = ticks(
  2 * FLARE_INTERVAL + FLARE_CHARGE + FLARE_BLOOM + 1,
);

/** How often the flare wait reads, in ticks. */
const FLARE_POLL = 6;

/**
 * The item's tolerance on where the window's edges fall, in seconds.
 *
 * "for `ALERT_TIME` (0.5 s) within a tenth of a second" — so the last reading
 * inside the window is taken that far short of its end, and the reading that must
 * find it over is taken that far past it. The window really opens on the step the
 * fix was taken, so a sample at exactly `ALERT_TIME` could land a tick past its
 * expiry on a build keeping the rule perfectly.
 */
const GRACE = 0.1;

/** The whole window, and the tolerance either side of it, in ticks. */
const WINDOW_TICKS = ticks(ALERT_TIME);
const GRACE_TICKS = ticks(GRACE);

/** How many readings are taken inside the window. */
const INSIDE_COUNT = 5;

/**
 * Where inside the window they are taken, in ticks from the tick the alert first
 * read true: evenly spaced from the moment it opened to a tenth of a second short
 * of its end. Built as ticks rather than as seconds so the run is whole-numbered
 * and rising however long the window is.
 */
const INSIDE_TICKS: readonly number[] = Array.from(
  { length: INSIDE_COUNT },
  (_unused, i) =>
    Math.round((i * (WINDOW_TICKS - GRACE_TICKS)) / (INSIDE_COUNT - 1)),
);

/**
 * When the alert must have fallen, in ticks from the same anchor.
 *
 * A hard deadline, so a build whose alert never ends FAILS here rather than being
 * waited for.
 */
const AFTER_TICKS = WINDOW_TICKS + GRACE_TICKS;

/** Ticks run after the readings, purely so the clip carries a tail. */
const CLIP_TICKS = 36;

/** One reading of the alert window. */
interface AlertSample {
  t: number;
  alert: boolean;
  lit: boolean;
  gap: number;
  vision: number;
}

/** The distance between the forager's center and one predator's, in units. */
function gapAt(snapshot: FathomSnapshot, index: number): number {
  const p = snapshot.predators[index];
  return Math.hypot(p.x - snapshot.forager.x, p.y - snapshot.forager.y);
}

/**
 * Watch one alert window from the tick it opens: the samples inside it, and the
 * reading a tenth of a second past its end.
 */
async function watchWindow(
  h: Harness,
  index: number,
): Promise<{ inside: AlertSample[]; after: FathomSnapshot }> {
  let spent = 0;
  const at = async (target: number): Promise<FathomSnapshot> => {
    await h.advance(target - spent);
    spent = target;
    return h.snapshot();
  };
  const inside: AlertSample[] = [];
  for (const tick of INSIDE_TICKS) {
    const s = await at(tick);
    const p = s.predators[index];
    inside.push({
      t: seconds(tick),
      alert: p.alert,
      lit: p.lit,
      gap: gapAt(s, index),
      vision: s.visionRadius,
    });
  }
  return { inside, after: await at(AFTER_TICKS) };
}

/** Assert one watched window against the item's bounds. */
function assertWindow(
  how: string,
  index: number,
  window: { inside: AlertSample[]; after: FathomSnapshot },
): void {
  for (const sample of window.inside) {
    assertGreaterThan(
      sample.gap,
      sample.vision,
      `the units between the two centers ${sample.t.toFixed(2)} s into the ` +
        `${how} alert, against the light radius V the build reports ` +
        `(${sample.vision.toFixed(0)}) — the hunter is outside the light, so what ` +
        "draws it is its own alert",
    );
    assertEqual(
      sample.alert,
      true,
      `the alert ${sample.t.toFixed(2)} s into the ${how} window, inside the ` +
        `${ALERT_TIME} s it runs for`,
    );
    assertEqual(
      sample.lit,
      true,
      `whether the Flarefish's body is drawn ${sample.t.toFixed(2)} s into the ` +
        `${how} window, which the alert draws wherever it stands and whatever ` +
        "the fog would otherwise hide of it",
    );
  }
  assertEqual(
    window.after.predators[index].alert,
    false,
    `the ${how} alert ${seconds(AFTER_TICKS).toFixed(2)} s in — ALERT_TIME ` +
      `(${ALERT_TIME} s) and the item's tenth of a second past it`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Flarefish fires the alert on a fresh fix", async () => {
  await startPlaying(h);

  /* ---- By its light sense -------------------------------------------------- */

  const line = await poseSightLine(h, LIGHT_GAP_TILES, { lead: 1, tail: 2 });
  let index = await spawnPredator(h, "flarefish", line.pred, {
    state: "wander",
  });
  await parkForager(h, line.forager);
  await h.debug.setBrightness(1);
  await h.debug.setBrightHold(BRIGHT_HOLD);
  let guard: SceneGuard = await sceneGuard(h);

  const lit = await captureReplay(h, "alert", async () => {
    const acquired = await h.until(
      (s) => s.predators[index].state === "chase",
      {
        maxTicks: FIX_TICKS,
        poll: 1,
      },
    );
    const fired = await h.until((s) => s.predators[index].alert === true, {
      maxTicks: FIRE_TICKS,
      poll: 1,
    });
    const window = await watchWindow(h, index);
    await h.advance(CLIP_TICKS);
    return { acquired, fired, window, end: await h.snapshot() };
  });

  requireSceneHeld(lit.end, guard);
  assertEqual(
    lit.acquired.hit,
    true,
    `the Flarefish took a fix on a fully lit forager ${LIGHT_GAP_TILES} tiles ` +
      "away on a clear line, which is the acquisition an alert fires on",
  );
  assertEqual(
    lit.fired.hit,
    true,
    "the Flarefish reports alert true within a tenth of a second of its light " +
      "sense taking a fix (specs/predators.md)",
  );
  assertWindow("light-sense", index, lit.window);

  /* ---- By a flare lock ----------------------------------------------------- */

  // A room for the forager and, five rows below it, one corridor tile walled on
  // every side. Nothing joins the two, so the bloom is the only thing that ever
  // crosses between them.
  const board = await poseMaze(h, [
    "F..",
    ...Array.from({ length: FLARE_GAP_TILES - 1 }, () => ""),
    "B",
  ]);
  const home = board.mark("F");
  const boxed = board.mark("B");
  // Posing a fixture empties the board, so the Flarefish of the first half is
  // gone with everything else and this half spawns its own.
  index = await spawnPredator(h, "flarefish", boxed, { state: "wander" });
  await parkForager(h, home);
  // Left dark, so the ordinary light sense reaches 128 units and cannot account
  // for a lock at 160.
  await h.debug.setBrightness(0);
  guard = await sceneGuard(h);

  const posed = await h.snapshot();
  const flareGap = gapAt(posed, index);

  const charging = await h.skipUntil(
    (s) => s.predators[index].flareCharging === true,
    { maxTicks: FLARE_WAIT_TICKS, poll: FLARE_POLL },
  );
  assertEqual(
    charging.hit,
    true,
    `a wandering Flarefish charged a flare inside ` +
      `${seconds(FLARE_WAIT_TICKS).toFixed(1)} s, which is the bloom this half ` +
      "reads the lock off",
  );
  const locked = await h.until((s) => s.predators[index].alert === true, {
    maxTicks: ticks(FLARE_CHARGE + FLARE_BLOOM + 0.2),
    poll: 1,
  });
  assertEqual(
    locked.hit,
    true,
    `the bloom of a Flarefish ${flareGap.toFixed(0)} units from the forager, ` +
      `inside FLARE_RADIUS (${FLARE_RADIUS}), took a fix, which is the ` +
      "acquisition an alert fires on",
  );
  const flare = await watchWindow(h, index);

  requireSceneHeld(flare.after, guard);
  // The fixture's own geometry, against the figures the specification fixes.
  assertLessThanOrEqual(
    flareGap,
    FLARE_RADIUS,
    `the units between the two centers against FLARE_RADIUS (${FLARE_RADIUS}), ` +
      "the reach a bloom locks on within",
  );
  assertGreaterThan(
    flareGap,
    LANTERN_RANGE_BASE,
    "the units between the two centers against R at G 0 (LANTERN_RANGE_BASE, " +
      `${LANTERN_RANGE_BASE}), the reach the ordinary light sense has while the ` +
      "forager is dark — so what took this fix is the bloom and not that sense",
  );
  assertWindow("flare-lock", index, flare);
});

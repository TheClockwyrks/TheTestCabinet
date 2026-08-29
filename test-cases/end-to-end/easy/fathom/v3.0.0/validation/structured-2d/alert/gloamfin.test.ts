// alert/gloamfin — the Gloamfin fires the alert on a fresh fix.
//
// specs/predators.md: "The moment a Gloamfin or a Flarefish acquires a fix it was
// not already chasing on, it fires a detection alert. For `ALERT_TIME` (`0.5 s`)
// from that moment the snapshot reports `alert` as true for that predator, and the
// predator is drawn lit for that whole window, wherever it stands and whatever the
// fog would otherwise hide of it. Refreshing a fix a predator is already chasing on
// is not an acquisition and fires nothing."
//
// Three readings, then, and the scenario is built so that each of them says
// something: how long `alert` runs, that `lit` runs with it, and that a fix held
// and refreshed step after step fires nothing more.
//
// THE HUNTER STANDS WHERE NOTHING ELSE COULD LIGHT IT. `lit` is true whenever a
// predator's body is drawn — by the forager's light, by a sonar mark, by a flare,
// or by its own alert (specs/predators.md) — so a Gloamfin standing in the
// forager's own light pocket would report `lit` true whether or not it fired
// anything, and the second reading would say nothing at all. Close hearing is the
// one sense that reaches "in the dark, through rock, and through ink"
// (specs/predators/gloamfin.md), so the pair is posed on two corridors with a
// solid band of rock between them: two tiles apart, which is `GLOAMFIN_HEAR` (64),
// and with no line between them the forager's light can travel down. The check
// confirms that from the snapshot — the hunter's tile reads `u`, never revealed —
// rather than assuming it.
//
// AND THE TWO ARE SEALED FROM EACH OTHER, so a hunter that acquires cannot cross to
// the forager and end the measurement with a lost life. A posed board may do what a
// generated one may not (specs/instrumentation.md).
//
// WHAT THIS DOES NOT DECIDE. That close hearing takes a fix at all is
// `gloamfin/fix-and-alert`'s, so a build whose Gloamfin never acquires stands this
// check down rather than being failed twice for one fault.

import { afterEach, beforeEach, it } from "vitest";
import { ALERT_TIME, GLOAMFIN_HEAR } from "../../src/constants";
import {
  assertEqual,
  assertLessThanOrEqual,
  assertTrue,
  fail,
} from "../assert";
import { poseOccludedPair, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  seconds,
  startPlaying,
  ticksFor,
  visibilityAt,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";

/**
 * How far apart the pair stands, in tiles.
 *
 * Two, which is `GLOAMFIN_HEAR` (64) exactly — specs/predators/gloamfin.md gives
 * the reach as "at most `GLOAMFIN_HEAR` (`64`), 2 tiles" — and the closest two
 * tiles can stand with a full band of rock between them.
 */
const GAP_TILES = 2;

/** How much corridor each of them stands on, in tiles. */
const RUN_TILES = 4;

/**
 * How long the acquisition is given, in ticks.
 *
 * A fifth of a second, a hard bound. Close hearing holds while the two centers are
 * within reach, so a conforming build acquires on the first step; whether it
 * acquires at all is `gloamfin/fix-and-alert`'s verdict, so a miss stands this
 * check down.
 */
const FIX_TICKS = ticksFor(0.2);

/** How long the alert is given to rise once the fix is taken, in ticks. */
const FIRE_TICKS = ticksFor(0.1);

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
const WINDOW_TICKS = ticksFor(ALERT_TIME);
const GRACE_TICKS = ticksFor(GRACE);

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

/**
 * How long the refresh is watched, in ticks, once the first window has closed.
 *
 * Eight tenths of a second, longer than a whole `ALERT_TIME`, with the hunter still
 * inside hearing and its fix therefore refreshed on every step of it. A build that
 * treats each refresh as an acquisition fires again inside that stretch.
 */
const REFRESH_TICKS = ticksFor(0.8);

/** How often the refresh watch reads, in ticks. */
const REFRESH_POLL = 3;

/** Ticks run after the readings, purely so the clip carries a tail. */
const CLIP_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Gloamfin fires the alert on a fresh fix", async () => {
  startPlaying(h);
  const pair = await poseOccludedPair(h, { tiles: GAP_TILES, len: RUN_TILES });
  const index = await spawnPredator(h, "gloamfin", pair.pred);
  await parkForager(h, pair.forager);
  // Its own pellet settled and `G` back to the zero a dive opens on, so the light
  // pocket is the narrowest it ever is and nothing widens it under the
  // measurement.
  const guard = await sceneGuard(h);

  const posed = h.snapshot();
  const posedGap = Math.hypot(
    posed.predators[index].x - posed.forager.x,
    posed.predators[index].y - posed.forager.y,
  );

  const read = await captureReplay(h, "alert", async () => {
    const acquired = await h.until(
      (s) => s.predators[index].state === "chase",
      {
        maxFrames: FIX_TICKS,
        poll: 1,
      },
    );
    if (!acquired.hit) {
      fail(
        `the Gloamfin to take a fix on a forager ${posedGap.toFixed(0)} units ` +
          `away, inside GLOAMFIN_HEAR (${GLOAMFIN_HEAR}), so there is a fresh ` +
          "acquisition for an alert to fire on",
        acquired.snapshot.predators[index].state,
      );
    }
    const fired = await h.until((s) => s.predators[index].alert === true, {
      maxFrames: FIRE_TICKS,
      poll: 1,
    });

    // Everything below is dated from the tick the alert first read true.
    let spent = 0;
    const at = async (target: number) => {
      await h.advance(target - spent);
      spent = target;
      return h.snapshot();
    };
    const inside: {
      t: number;
      alert: boolean;
      lit: boolean;
      visibility: string | undefined;
    }[] = [];
    for (const tick of INSIDE_TICKS) {
      const s = await at(tick);
      const p = s.predators[index];
      inside.push({
        t: seconds(tick),
        alert: p.alert,
        lit: p.lit,
        visibility: visibilityAt(s, { tx: p.tx, ty: p.ty }),
      });
    }
    const after = await at(AFTER_TICKS);

    const refreshed: { t: number; alert: boolean; state: string }[] = [];
    for (let step = 0; step < REFRESH_TICKS; step += REFRESH_POLL) {
      await h.advance(REFRESH_POLL);
      spent += REFRESH_POLL;
      const p = h.snapshot().predators[index];
      refreshed.push({ t: seconds(spent), alert: p.alert, state: p.state });
    }
    await h.advance(CLIP_TICKS);
    return { acquired, fired, inside, after, refreshed, end: h.snapshot() };
  });

  requireSceneHeld(read.end, guard);

  // The fixture's own geometry, and the fact that makes `lit` mean something.
  assertLessThanOrEqual(
    posedGap,
    GLOAMFIN_HEAR,
    `the units between the two centers against GLOAMFIN_HEAR (${GLOAMFIN_HEAR}), ` +
      "the reach close hearing works within",
  );

  assertEqual(
    read.fired.hit,
    true,
    "the Gloamfin reports alert true within a tenth of a second of taking a " +
      "fix it was not already chasing on (specs/predators.md)",
  );
  for (const sample of read.inside) {
    assertEqual(
      sample.alert,
      true,
      `the alert ${sample.t.toFixed(2)} s in, inside the ${ALERT_TIME} s ` +
        "window it runs for",
    );
    // What draws the body has to be the ALERT and nothing else, so the tile it
    // stands on has to be dark. This scenario puts it behind rock and casts no
    // pulse, so a build that lights that tile has light that does not stop at
    // rock — fog/light-line-of-sight's verdict — and the reading below would be
    // of that light rather than of the alert.
    if (sample.visibility !== "u") {
      fail(
        "the tile the Gloamfin stands on to be unrevealed while the alert runs, " +
          "so what draws its body is the alert and nothing else; no light, pulse " +
          "or flare of this scenario reaches it, and specs/sensing.md has the " +
          "light travel straight and stop at the rock it lands on",
        `it reported "${sample.visibility}" ${sample.t.toFixed(2)} s in`,
      );
    }
    assertEqual(
      sample.lit,
      true,
      `whether the Gloamfin's body is drawn ${sample.t.toFixed(2)} s in, which ` +
        "the alert draws wherever it stands and whatever the fog would " +
        "otherwise hide of it",
    );
  }
  assertEqual(
    read.after.predators[index].alert,
    false,
    `the alert ${seconds(AFTER_TICKS).toFixed(2)} s in — ALERT_TIME (${ALERT_TIME} s) ` +
      "and the item's tenth of a second past it",
  );

  // And the refresh: the fix is held and re-taken step after step, and nothing
  // fires for it.
  assertTrue(
    read.refreshed.every((one) => one.state === "chase"),
    "the Gloamfin held its fix throughout the refresh watch, so what was " +
      "watched is a fix being refreshed rather than one being dropped — it read " +
      `[${[...new Set(read.refreshed.map((one) => one.state))].join(", ")}]`,
  );
  const again = read.refreshed.filter((one) => one.alert);
  assertTrue(
    again.length === 0,
    `every reading of the alert across the ${seconds(REFRESH_TICKS).toFixed(2)} s ` +
      "the Gloamfin spent refreshing a fix it was already chasing on is false — " +
      `it read true at ${again.map((one) => `${one.t.toFixed(2)} s`).join(", ") || "no sample"}`,
  );
});

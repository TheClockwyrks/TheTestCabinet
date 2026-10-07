// alert/refresh-fires-nothing — a refreshed fix fires no second alert.
//
// specs/predators.md: "The moment a Gloamfin or a Flarefish acquires a fix it was
// not already chasing on, it fires a detection alert ... Refreshing a fix a
// predator is already chasing on is not an acquisition and fires nothing, while a
// predator that gives up a fix and later finds the forager again fires the alert
// afresh."
//
// SO THE ALERT MARKS AN ACQUISITION RATHER THAN A CHASE, and that is the whole of
// this point. A build that re-fires on every step of a chase turns the tell the
// alert exists to give — "it has just found you" — into a light that never goes
// out, and a player who has been seen once can no longer read the difference.
//
// BOTH HUNTERS THAT FIRE THE ALERT ARE READ, because the rule names the two of
// them together and each senses differently: the Gloamfin by close hearing, which
// reaches through rock and holds while the forager is inside `GLOAMFIN_HEAR`
// (`64`), and the Flarefish by light, which holds while the forager is inside its
// own detection range with a clear line between them. Each is posed at its own
// sense's reach so the fix is genuinely REFRESHED step after step rather than
// dropped and retaken — which the check confirms by reading `state` on every
// sample, since a hunter that lapsed and re-acquired would be entitled to fire.
//
// EACH HUNTER'S TRAVEL IS HELD, and its mind is left running
// (specs/instrumentation.md): the sense is what this point is about and the
// journey is not, so the hunter senses, fixes and alerts from the tile the fixture
// stood it on, and cannot cross the corridor and end the watch with a lost life.
//
// THE FIRST WINDOW IS WAITED OUT FIRST. The acquisition that opens the chase does
// fire, legitimately, so the sampling starts only once that window has closed —
// `ALERT_TIME` (`0.5 s`) and a tenth of a second past it — and then runs for
// another whole window, which is longer than any second alert could hide inside.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertTrue } from "../assert";
import { ALERT_TIME, GLOAMFIN_HEAR } from "../constants";
import { poseSightLine, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  seconds,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { ticks } from "../harness";

/**
 * How far each hunter stands from the forager, in tiles.
 *
 * The Gloamfin at two, which is `GLOAMFIN_HEAR` (`64`) exactly — the reach
 * specs/predators/gloamfin.md gives close hearing. The Flarefish at three
 * (`96`), inside the `LANTERN_RANGE_BASE` (`128`) its light sense reaches at the
 * `G = 0` a dive opens on, with the whole corridor between them clear.
 */
const CASES = [
  { kind: "gloamfin", gap: 2 },
  { kind: "flarefish", gap: 3 },
] as const;

/**
 * How long the acquisition is given, in ticks.
 *
 * Half a second, a hard bound. Both senses hold continuously at the reaches
 * posed, so a conforming build acquires within a step or two; WHETHER each
 * acquires at all is `gloamfin.fix-and-alert`'s and `flarefish.light-sense`'s,
 * so a miss stands this check down rather than being waited for.
 */
const FIX_TICKS = ticks(0.5);

/** How long the first alert is given to rise once the fix is taken, in ticks. */
const FIRE_TICKS = ticks(0.1);

/**
 * The tolerance on the window's end, in seconds.
 *
 * The same tenth of a second the two alert points state: the window opens on the
 * step the fix was taken, so a sample at exactly `ALERT_TIME` could land a tick
 * short of its expiry on a build keeping the rule perfectly.
 */
const GRACE = 0.1;

/** Ticks from the first alert to the moment its own window is certainly over. */
const SETTLE_TICKS = ticks(ALERT_TIME + GRACE);

/**
 * How long the refreshed fix is watched, in ticks.
 *
 * A whole `ALERT_TIME` and the same grace again, so a build that treats each
 * refresh as an acquisition has a full window inside the watch to fire in.
 */
const REFRESH_TICKS = ticks(ALERT_TIME + GRACE);

/** How often the refresh watch reads, in ticks. */
const REFRESH_POLL = 3;

/** Ticks run after the readings, purely so a clip carries a tail. */
const CLIP_TICKS = 36;

/** One sample of the refreshed chase. */
interface Sample {
  t: number;
  alert: boolean;
  state: string;
}

/** What one hunter's refresh watch found. */
interface Watch {
  acquired: boolean;
  fired: boolean;
  settled: boolean;
  samples: Sample[];
}

/**
 * Pose one hunter at its own sense's reach, earn it a fix, wait its first alert
 * out, and sample the chase it then holds.
 */
async function watchRefresh(
  harness: Harness,
  kind: string,
  gap: number,
): Promise<Watch> {
  await startPlaying(harness);
  const line = await poseSightLine(harness, gap);
  const index = await spawnPredator(harness, kind, line.pred, {
    state: "wander",
    travel: false,
  });
  await parkForager(harness, line.forager);
  const guard = await sceneGuard(harness);

  const acquired = await harness.until(
    (s) => s.predators[index].state === "chase",
    { maxFrames: FIX_TICKS, poll: 1 },
  );
  const fired = await harness.until((s) => s.predators[index].alert === true, {
    maxFrames: FIRE_TICKS,
    poll: 1,
  });

  // The acquisition's own window, waited out: what follows is a fix being
  // refreshed rather than one being taken.
  await harness.advance(SETTLE_TICKS);
  const settled = harness.snapshot().predators[index].alert === false;

  const samples: Sample[] = [];
  for (let spent = 0; spent < REFRESH_TICKS; spent += REFRESH_POLL) {
    await harness.advance(REFRESH_POLL);
    const hunter = harness.snapshot().predators[index];
    samples.push({
      t: seconds(spent + REFRESH_POLL),
      alert: hunter.alert,
      state: hunter.state,
    });
  }
  await harness.advance(CLIP_TICKS);
  requireSceneHeld(harness.snapshot(), guard);

  return { acquired: acquired.hit, fired: fired.hit, settled, samples };
}

/** Every reading of one watch, as one verdict. */
function assertRefreshedQuietly(kind: string, watch: Watch): void {
  assertEqual(
    watch.acquired,
    true,
    `the ${kind} took a fix at its own sense's reach, which is the ` +
      "acquisition the alert fires on (specs/predators.md)",
  );
  assertEqual(
    watch.fired,
    true,
    `the ${kind} fired the alert on that first acquisition, so what follows ` +
      "is a refresh rather than a first fix (specs/predators.md)",
  );
  assertEqual(
    watch.settled,
    true,
    `the ${kind}'s first alert had ended before the refresh was watched — ` +
      `ALERT_TIME (${String(ALERT_TIME)} s) and ${String(GRACE)} s past it`,
  );
  assertTrue(
    watch.samples.every((one) => one.state === "chase"),
    `the ${kind} held its fix throughout the watch, so what was watched is a ` +
      "fix being refreshed rather than one being dropped and retaken — it " +
      `read [${[...new Set(watch.samples.map((one) => one.state))].join(", ")}]`,
  );
  const again = watch.samples.filter((one) => one.alert);
  assertTrue(
    again.length === 0,
    `every reading of the ${kind}'s alert across the ` +
      `${seconds(REFRESH_TICKS).toFixed(2)} s it spent refreshing a fix it was ` +
      "already chasing on is false — it read true at " +
      `${again.map((one) => `${one.t.toFixed(2)} s`).join(", ") || "no sample"}`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires nothing while a fix is refreshed, for the Gloamfin and the Flarefish", async () => {
  // The Gloamfin's watch is the one kept as evidence, because its sense reaches
  // through rock and its chase is the one a player meets most often; the
  // Flarefish's runs on the same reading with no second clip to keep.
  const heard = await captureReplay(h, "refresh", () =>
    watchRefresh(h, CASES[0].kind, CASES[0].gap),
  );
  assertRefreshedQuietly(CASES[0].kind, heard);
  // The reach the Gloamfin's half was posed at, named so a failure above can be
  // read against the figure specs/predators/gloamfin.md gives close hearing.
  assertEqual(
    CASES[0].gap * 32,
    GLOAMFIN_HEAR,
    "the units between the two centers against GLOAMFIN_HEAR, the reach close " +
      "hearing works within",
  );

  const seen = await watchRefresh(h, CASES[1].kind, CASES[1].gap);
  assertRefreshedQuietly(CASES[1].kind, seen);
});

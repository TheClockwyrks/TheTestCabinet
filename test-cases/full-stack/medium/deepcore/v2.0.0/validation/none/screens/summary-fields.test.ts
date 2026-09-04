// screens/summary-fields — the summary reports what the expedition actually did.
//
// specs/gameplay.md: "The game keeps no running total. The Victory and Game Over
// screens summarize the expedition: the deepest depth reached in meters, the
// total Credits earned, the elapsed time, the mode, the number of rocket
// components installed and, on a Game Over, how the miner died."
//
// EVERY FIGURE IS MADE TRUE BEFORE IT IS READ, and each from the specification
// rather than from the summary itself:
//
//   - the depth, from specs/world.md's own formula — a miner whose feet rest at
//     the top of row `r` is at `METERS_PER_ROW * (r - 1)` meters;
//   - the Credits earned, from specs/mining.md's ore values — four units of
//     Ferron sold at the Ore Market;
//   - the elapsed time, from the game time this check itself advanced;
//   - the mode and the size, from the choices the expedition was started with;
//   - the components, from the count posed onto the checklist;
//   - the death cause, from the death that was driven.
//
// WHY THE EXPEDITION IS STARTED THROUGH THE SIZE CHOICE. The elapsed time is the
// EXPEDITION'S, and specs/gameplay.md has an expedition begin when a size is
// chosen; there is no operation that starts one, so the two menu steps from the
// mode choice are the only way to give that clock a beginning. The mode choice
// itself is reached directly through the surface, so nothing here depends on the
// title menu.
//
// ISOLATION. One expedition, with the miner's body gated so it holds the depth it
// was taken to and its drill gated so nothing is cut or banked behind the
// reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertNotNull } from "../assert";
import {
  METERS_PER_ROW,
  MODE_ITEMS,
  ORES,
  SIZE_ITEMS,
  type Ore,
} from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  minerXOn,
  minerYOn,
  pinDrill,
  pinMiner,
  stageCargo,
  type Harness,
} from "../harness";
import { driveDeath } from "../save/expedition";

/** The expedition's settings, neither of them a session default. */
const MODE = "hardcore" as const;
const MODE_ENTRY = "HARDCORE" as const;
const SIZE_ENTRY = "STANDARD" as const;

/** The cargo that is sold, and what specs/mining.md says it is worth. */
const SOLD_ORE: Ore = "ferron";
const SOLD_UNITS = 4;
const EARNED = SOLD_UNITS * ORES[SOLD_ORE].value;

/** The row the miner is taken to, and the depth specs/world.md gives its top. */
const DEEP_COL = 12;
const DEEP_ROW = 120;
const DEEPEST_METERS = METERS_PER_ROW * (DEEP_ROW - 1);

/** The rocket components installed before the run ends. */
const COMPONENTS = 3;

/** The game time the expedition runs for before the death. */
const ELAPSED_SECONDS = 20;
const ELAPSED_FRAMES = 40;

/**
 * How much longer than that the summary's elapsed time may read.
 *
 * How long a build plays a death out before it shows the summary is the build's,
 * and this check drives the game on until the screen changes; the ceiling covers
 * that stretch with room to spare.
 */
const ELAPSED_SLACK = 12;

/** Half a meter: the depth is an exact expression of the miner's feet. */
const DEPTH_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the depth, the Credits earned, the time, the mode, the rocket and the death", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.clearSave();
  await h.debug.reset();

  await h.debug.setScreen("mode-select");
  await h.debug.setMenuIndex(MODE_ITEMS.indexOf(MODE_ENTRY));
  await h.tap(ACTION_KEY.activate);
  await h.debug.setMenuIndex(SIZE_ITEMS.indexOf(SIZE_ENTRY));
  await h.tap(ACTION_KEY.activate);
  assertEqual(
    (await h.snapshot()).screen,
    "in-mine",
    "specs/ui.md: choosing a size begins the expedition",
  );

  await pinMiner(h);
  await pinDrill(h);

  await stageCargo(h, { [SOLD_ORE]: SOLD_UNITS });
  await h.debug.sell();
  await h.debug.setRocketInstalled(COMPONENTS);
  await h.debug.setMinerPosition(minerXOn(DEEP_COL), minerYOn(DEEP_ROW));
  await h.debug.setMinerVelocity(0, 0);
  await h.advanceSeconds(ELAPSED_SECONDS, ELAPSED_FRAMES);

  const over = await driveDeath(h, "hull-destroyed");
  await captureStill(h, "summary");

  assertNotNull(
    over.summary,
    "specs/ui.md: the Game Over screen shows the expedition summary",
  );
  const summary = over.summary;
  if (summary === null) return;

  assertBetween(
    summary.deepestDepthMeters,
    DEEPEST_METERS - DEPTH_TOLERANCE,
    DEEPEST_METERS + DEPTH_TOLERANCE,
    "specs/gameplay.md: the summary reports the deepest depth reached in meters",
  );
  assertEqual(
    summary.creditsEarned,
    EARNED,
    `specs/gameplay.md: the summary reports the total Credits earned, ${SOLD_UNITS} ${SOLD_ORE} at ${ORES[SOLD_ORE].value}`,
  );
  assertBetween(
    summary.elapsedSeconds,
    ELAPSED_SECONDS,
    ELAPSED_SECONDS + ELAPSED_SLACK,
    "specs/gameplay.md: the summary reports the elapsed time",
  );
  assertEqual(
    summary.mode,
    MODE,
    "specs/gameplay.md: the summary reports the mode the expedition was played in",
  );
  assertEqual(
    summary.componentsInstalled,
    COMPONENTS,
    "specs/gameplay.md: the summary reports the number of rocket components installed",
  );
  assertEqual(
    summary.deathCause,
    "hull-destroyed",
    "specs/gameplay.md: the summary reports how the miner died",
  );
});

// campaign/finale-invincible — the Overload Dynamo cannot be killed.
//
// specs/enemies.md: "It cannot be killed. It carries no depleting health bar, and
// every point of damage dealt to it, direct hits and burn ticks alike, is
// tallied into the run's Maze Rating instead of removing health. Its health
// never falls." specs/campaign.md says the same of the finale's Dynamo and adds
// what the flag reads as: specs/instrumentation.md reports `invincible` on it.
//
// So the heaviest fire in the game is put on it and its health is read
// afterwards. The yard carries a Rupture Node and an Aurora Lance at the top of
// their tracks — `1805` and `2020` a shot — and a Tesla-Prime Rectifier, whose
// `220` hit sets a burn of `110` a second: between them, direct hits and burn
// ticks, far past anything else in the game. Every point of it must leave the
// health where it was.
//
// The Dynamo is reached through `spawnUnit`, which specs/instrumentation.md
// makes the direct route to it — the phase reads `finale` and the driver's hold
// applies — rather than by playing a run to its last wave, because a build with a
// broken last clear and a correct Dynamo must fail that check and pass this one.
// Its travel is held and nothing else about it is, so it stands inside every
// tower's reach for the whole reading while its statuses, its targetability and
// its health all run as they would.
//
// The towers' own tallies are read alongside it, because a Dynamo that took no
// fire at all would otherwise pass this check without proving anything.
//
// TEN SECONDS, NOT TWELVE HUNDRED FRAMES. The sample is the span — many cadences
// of all three towers and several burn durations — and not the number of frames
// it was divided into, so the span is kept and the window runs on `RUN_HZ`, the
// rate `campaign/runs.ts` already fires this project's Capacitor at while it
// reads a bounty off a kill. specs/instrumentation.md guarantees that "an
// interval of simulation time reaches the same state however it was divided into
// frames", and `instrumentation/frame-division-projectile` is the point that
// decides that guarantee for a shot in flight — it covers a fifth of a second in
// ONE frame, eight times the step taken here.
//
// A NOTE ON THE STEP AND THE HIT RADIUS. `PROJECTILE_SPEED` (`520`) against
// `PROJECTILE_HIT_R` (`6`) puts a shot's travel inside its hit radius only below
// a frame of `11.5` ms, which is `87` Hz — so no frame size worth taking makes
// that the bound, and the bound relied on is the specification's own guarantee
// above rather than the arithmetic of one build's integration. Nothing positional
// is read across the window in any case: what is read is a health figure, a
// damage tally and a kill count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  openYard,
  parkUnit,
  standCombo,
  standComponent,
  structureById,
  unitById,
  type Harness,
} from "../harness";
import { createRunHarness, RUN_HZ } from "./runs";

/** The heaviest fire the game holds, all of it in reach of one point. */
const RUPTURE = { col: 10, row: 10 };
const LANCE = { col: 16, row: 10 };
const RECTIFIER = { col: 13, row: 14 };
const TARGET = { x: 280, y: 320 };

/** Ten seconds: many cadences of all three, and several burn durations. */
const WINDOW = 10 * RUN_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createRunHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the Overload Dynamo's health where it was under the heaviest fire", async () => {
  openYard(h);
  const rupture = standCombo(h, "rupturenode", RUPTURE.col, RUPTURE.row, 3);
  const lance = standCombo(h, "auroralance", LANCE.col, LANCE.row, 3);
  const rectifier = standComponent(
    h,
    "rectifier",
    5,
    RECTIFIER.col,
    RECTIFIER.row,
  );
  const id = parkUnit(h, "overload", TARGET);

  const opening = h.snapshot();
  const before = unitById(opening, id);
  assertEqual(
    before.invincible,
    true,
    "the Overload Dynamo reports that it cannot be killed",
  );
  assertEqual(
    opening.phase,
    "finale",
    "releasing an Overload Dynamo puts the run into the finale",
  );

  await captureReplay(h, "invincible", () => h.advance(WINDOW));

  const after = h.snapshot();
  const survived = unitById(after, id);
  assertEqual(
    survived.hp,
    before.hp,
    "its health after ten seconds of the heaviest fire in the game",
  );
  assertEqual(survived.maxHp, before.maxHp, "its maximum health is untouched");
  assertEqual(
    survived.invincible,
    true,
    "it still reports that it cannot be killed",
  );

  const dealt =
    structureById(after, rupture).damageDealt +
    structureById(after, lance).damageDealt +
    structureById(after, rectifier).damageDealt;
  assertGreaterThan(
    dealt,
    0,
    "the three structures did fire at it, so the health above was held " +
      "against real damage",
  );
  assertEqual(
    structureById(after, rupture).kills +
      structureById(after, lance).kills +
      structureById(after, rectifier).kills,
    0,
    "nothing killed it",
  );
});

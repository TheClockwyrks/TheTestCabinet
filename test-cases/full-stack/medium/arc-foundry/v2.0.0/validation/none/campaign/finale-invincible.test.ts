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

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standCombo,
  standComponent,
  structureById,
  unitById,
  type Harness,
} from "../harness";

/** The heaviest fire the game holds, all of it in reach of one point. */
const RUPTURE = { col: 10, row: 10 };
const LANCE = { col: 16, row: 10 };
const RECTIFIER = { col: 13, row: 14 };
const TARGET = { x: 280, y: 320 };

/** Ten seconds: many cadences of all three, and several burn durations. */
const WINDOW = 10 * 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the Overload Dynamo's health where it was under the heaviest fire", async () => {
  await openYard(h);
  const rupture = await standCombo(
    h,
    "rupturenode",
    RUPTURE.col,
    RUPTURE.row,
    3,
  );
  const lance = await standCombo(h, "auroralance", LANCE.col, LANCE.row, 3);
  const rectifier = await standComponent(
    h,
    "rectifier",
    5,
    RECTIFIER.col,
    RECTIFIER.row,
  );
  const id = await parkUnit(h, "overload", TARGET);

  const opening = await h.snapshot();
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

  const after = await h.snapshot();
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

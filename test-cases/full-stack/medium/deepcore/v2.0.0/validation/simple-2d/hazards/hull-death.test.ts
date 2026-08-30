// hazards/hull-death — an empty hull is the end of the expedition.
//
// `specs/character.md` states the rule and its reach: "Hull standing at `0`
// destroys the miner, whatever emptied it, and is checked continuously rather
// than only at the blow that emptied it. That is a death. An empty hull is never
// a state the expedition continues from." `specs/modes.md` gives that death its
// id, `hull-destroyed`.
//
// "Continuously rather than only at the blow" is what this point is about, so
// what empties the hull here is the slowest thing in the game that can: the lava
// contact drain, which takes a thin hull down over a span of frames with no
// single blow at the end of it. A build that only checked for death where damage
// is dealt would leave the miner alive at zero hull.
//
// Both faculties are gated so the drain is the only thing acting: the miner
// neither climbs out of the lava nor cuts its way out of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { LAVA_CONTACT_DPS } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";
import { bandRow, HAZARD_COL, soakIn } from "./scene";

/** A hull the bare drain empties in well under a second. */
const HULL = 10;

/**
 * Game time the death is given to reach the Game Over screen, and the frames it
 * is run in.
 *
 * `specs/modes.md` fixes that a death ends the expedition at the Game Over
 * screen and fixes nothing about how long whatever a build plays on the way
 * takes, so the check gives it a generous bounded span.
 */
const DEATH_SECONDS = 15;
const DEATH_FRAMES = 150;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the expedition with hull-destroyed once the drain empties the hull", async () => {
  openScene(h);
  pinMiner(h);
  pinDrill(h);
  h.debug.setTier("radiator", 1);
  h.debug.setHull(HULL);
  const row = bandRow(h.snapshot(), "deepstone");
  h.debug.setTile(HAZARD_COL, row, "lava");
  soakIn(h, HAZARD_COL, row);

  const dead = await captureReplay(h, "death", async () => {
    await h.advanceSeconds(DEATH_SECONDS, DEATH_FRAMES);
    return h.snapshot();
  });

  assertEqual(dead.screen, "game-over", "specs/modes.md");
  assertEqual(dead.summary?.deathCause, "hull-destroyed", "specs/modes.md");
  assertLessThanOrEqual(
    dead.miner.hull,
    0,
    "specs/character.md, an empty hull is never continued from",
  );
  // The hull the drain had to get through was smaller than a second of it, so
  // what ended the expedition was the drain reaching zero rather than a blow.
  assertLessThanOrEqual(HULL, LAVA_CONTACT_DPS, "specs/hazards.md");
});

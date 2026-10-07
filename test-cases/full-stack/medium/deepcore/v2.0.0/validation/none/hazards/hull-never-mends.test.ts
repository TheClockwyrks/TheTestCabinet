// hazards/hull-never-mends — damage is paid for, never waited out.
//
// `specs/character.md` closes the hull rules with one line: "Hull never mends on
// its own", and `specs/expedition.md` names the two things that do mend it, the
// Fuel Depot's repair and, in `specs/items.md`, Regenerative Nanobots. So a
// damaged miner is stood still for a long span in each of the two places a
// player waits — the camp, where every other resource is bought back, and a
// tunnel underground — and the hull is read back where the last hazard left it.
//
// Arriving at the surface is the case worth naming, because `specs/expedition.md`
// says what it does not do: "Arriving at the surface refuels and repairs
// nothing: fuel and hull are exactly what the miner climbed out with."
//
// The drill is gated so an idle miner cannot cut into anything; travel is not,
// because standing still on solid ground is exactly what the point is about and
// a build whose miner drifts or falls should not be hidden by a gate.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  standOn,
  type Harness,
} from "../harness";
import { bandRow, HAZARD_COL } from "./scene";

/** The hull the miner is left with, well clear of both the maximum and zero. */
const HULL = 40;

/**
 * The span the miner stands still for, and the frames it is run in.
 *
 * The frame count is not free here, and it is the one place in this category
 * where it is not. The miner is standing on solid ground with its body running,
 * so each frame the game applies `GRAVITY` to it and its own collision puts it
 * back; `specs/hazards.md` then bills a landing above `IMPACT_SAFE_SPEED`. At a
 * sixth of a second a frame the speed that builds inside one frame is 250, well
 * inside the safe speed, so the standing miner is billed nothing and the hull
 * that is read is the hull the specification is about. A span divided so coarsely
 * that one frame of gravity outran the safe speed would be measuring the
 * division rather than the rule.
 */
const SECONDS = 30;
const FRAMES = 180;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a damaged hull where it stood, at the camp and underground", async () => {
  await openScene(h);
  await pinDrill(h);
  await layCamp(h);
  await standAtCamp(h);
  await h.debug.setHull(HULL);

  const waited = await captureReplay(h, "scar", async () => {
    await h.advanceSeconds(SECONDS, FRAMES);
    const surface = await h.snapshot();

    // And the same span underground, on a floor of its own.
    const row = bandRow(surface, "topsoil");
    await h.debug.setTile(HAZARD_COL, row, "rock");
    await standOn(h, HAZARD_COL, row);
    await h.debug.setHull(HULL);
    await h.advanceSeconds(SECONDS, FRAMES);
    return { surface, below: await h.snapshot() };
  });

  assertEqual(
    waited.surface.miner.hull,
    HULL,
    `specs/character.md, ${SECONDS} seconds standing at the camp`,
  );
  assertEqual(
    waited.below.miner.hull,
    HULL,
    `specs/character.md, ${SECONDS} seconds standing underground`,
  );
  // The maximum is well above what the miner held, so a hull that mended would
  // have had somewhere to mend to.
  assertGreaterThan(waited.below.miner.maxHull, HULL, "specs/upgrades.md");
});

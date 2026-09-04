// movement/terminal-speed-loaded — a loaded fall reaches a higher terminal speed.
//
// `specs/character.md`: "Terminal speed rises with the load. It is
// `FALL_TERMINAL_EMPTY + (FALL_TERMINAL_LOADED - FALL_TERMINAL_EMPTY) * min(1, load)`,
// where `load` is the load fraction", with `FALL_TERMINAL_EMPTY` `950`,
// `FALL_TERMINAL_LOADED` `1600`, and `load = loadKg / liftLimitKg`. A full haul
// therefore drops at `1600` and a half-full one at `1275`: descending with a
// heavy bay is faster, and lands harder, than descending empty.
//
// TWO LOADS ARE READ, because the rule is a line rather than a pair of cases and
// one point does not fix a line: the lift limit, where `min(1, load)` saturates,
// and half of it, in the middle of the ramp. The expected speed is computed from
// the load fraction the game itself reports, since the bay is filled in whole
// units of one ore and the unit that crosses a fraction lands just past it.
//
// THE TOLERANCE. One percent, as for the empty cap: the figure is a clamp rather
// than an asymptote, and the percent covers the frame the clamp is applied on.
//
// The jetpack sits at tier `1` throughout, so `liftLimitKg` is the tier's own and
// the fraction means what `specs/upgrades.md` says it means. The mine is open for
// the whole drop, no key is held, and the drill is gated.

import { afterEach, beforeEach, it } from "vitest";
import { FALL_TERMINAL_EMPTY, FALL_TERMINAL_LOADED } from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  loadFraction,
  loadToFraction,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  placeAt,
  TICK_HZ,
  type Harness,
} from "../harness";

const COL = 6;
const ROW = 3;

/** Long enough for the heavier of the two falls to reach its cap and hold it. */
const FALL_FRAMES = 3 * TICK_HZ;
const TOLERANCE = 0.01;

/** Terminal fall speed at load fraction `load`, as `specs/character.md` states it. */
function fallTerminalAt(load: number): number {
  return (
    FALL_TERMINAL_EMPTY +
    (FALL_TERMINAL_LOADED - FALL_TERMINAL_EMPTY) * Math.min(1, load)
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the terminal speed with the load, to 1600 at the lift limit", async () => {
  openScene(h);
  pinDrill(h);

  // The full haul, which is the case the replay is kept of: it is the one the
  // rule saturates at and the one a player meets climbing out of a rich dig.
  const heavy = await captureReplay(h, "heavy", () => drop(1));
  read(heavy);

  // And half of the lift limit, in the middle of the ramp, which a build that
  // only knows the two ends of the line fails.
  read(await drop(0.5));
});

/** What one drop at a posed load fraction reached. */
interface Drop {
  fraction: number;
  vy: number;
  grounded: boolean;
}

/** Fill the bay to `wanted`, drop the miner, and report what the fall reached. */
async function drop(wanted: number): Promise<Drop> {
  placeAt(h, minerXOn(COL), minerYOn(ROW));
  loadToFraction(h, wanted);
  const fraction = loadFraction(h.snapshot());
  await h.advance(FALL_FRAMES);
  const settled = h.snapshot();
  return { fraction, vy: settled.miner.vy, grounded: settled.miner.grounded };
}

/** Hold one drop against the terminal speed the specification states for its load. */
function read(fall: Drop): void {
  const at = `at a load fraction of ${fall.fraction.toFixed(3)}`;
  const stated = fallTerminalAt(fall.fraction);
  assertEqual(fall.grounded, false, `the miner in open space ${at}`);
  assertBetween(
    fall.vy,
    stated * (1 - TOLERANCE),
    stated * (1 + TOLERANCE),
    `the terminal speed ${at}`,
  );
}

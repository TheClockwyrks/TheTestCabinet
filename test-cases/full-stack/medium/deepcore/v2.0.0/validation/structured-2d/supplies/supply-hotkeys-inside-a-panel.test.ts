// supplies/supply-hotkeys-inside-a-panel — a hotkey works with a panel open.
//
// `specs/items.md`, Using: "The hotkeys `1` through `6`, which act throughout the
// mine, with a building panel or the inventory overlay open exactly as with the
// mine clear", and the two paths — the hotkey and the inventory's own `USE`
// control — "run the same logic". `specs/controls.md` lists `supply1` through
// `supply6` in the in-mine table without qualification, and qualifies only the
// `pause` row for a panel.
//
// So a panel is not a state the hotkeys stop working in, and the overlay listing
// the supplies is the state a player is most likely to press one from. The
// mapping of key to supply belongs to `supplies/supply-hotkeys`; what this point
// decides is only that the key still acts, and it uses one supply to decide it.
//
// BOTH PANELS ARE READ, because `specs/items.md` names both: the inventory
// overlay and a building panel. They are the same requirement in the same
// direction, so they share this validator rather than splitting into two.
//
// ISOLATION. An empty mine, the miner's body and drill both held, and a hull
// spent by more than one repair so the supply has real work to do — a supply
// "that would change nothing" is a no-op the specification does not consume.

import { afterEach, beforeEach, it } from "vitest";
import { HULL_TIERS, NANOBOT_HULL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type OpenPanel,
  type Harness,
} from "../harness";

/** The supply the key is read on, and the key `specs/controls.md` binds to it. */
const SUPPLY = "nanobots";
const KEY = "Digit5";

/** More than one held, so a count taken to zero cannot be mistaken for the rule. */
const HELD = 2;

/** A hull two repairs short of the tier-1 maximum, so a repair always acts. */
const POSED_HULL = HULL_TIERS[0] - 2 * NANOBOT_HULL;

/** The panels the key is struck inside, both of them named by specs/items.md. */
const PANELS: readonly OpenPanel[] = ["inventory", "fuel-depot"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("uses the supply from inside the inventory and from inside a building panel", async () => {
  openScene(h);
  pinMiner(h);
  pinDrill(h);

  const run = await captureReplay(h, "hotkey", async () => {
    const readings: { panel: OpenPanel; held: number; hull: number }[] = [];
    for (const panel of PANELS) {
      h.debug.setItemCount(SUPPLY, HELD);
      h.debug.setHull(POSED_HULL);
      h.debug.setPanel(panel);
      await h.advance(1);
      await h.tap(KEY);
      const after = h.snapshot();
      readings.push({
        panel: after.panel,
        held: after.items[SUPPLY],
        hull: after.miner.hull,
      });
    }
    h.debug.setPanel(null);
    await h.advance(30);
    return readings;
  });

  for (const [index, reading] of run.entries()) {
    const at = `with the ${String(PANELS[index])} panel open`;
    assertEqual(
      reading.panel,
      PANELS[index],
      `the panel was still open when the key was struck, ${at}`,
    );
    assertEqual(
      reading.held,
      HELD - 1,
      `specs/items.md: using one consumes one, ${at}`,
    );
    assertEqual(
      reading.hull,
      POSED_HULL + NANOBOT_HULL,
      `specs/items.md: Regenerative Nanobots repair NANOBOT_HULL, ${at}`,
    );
  }
});

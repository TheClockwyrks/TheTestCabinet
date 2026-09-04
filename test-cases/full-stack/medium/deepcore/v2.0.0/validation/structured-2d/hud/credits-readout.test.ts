// hud/credits-readout — the bar states the Credits balance.
//
// `specs/ui.md`: the status bar shows the Credits. `specs/gameplay.md` makes them
// the one currency, so the figure on the bar is what a player checks a sale
// against. A balance is a number, so it is drawn as a number, and the frame's own
// text runs anchored inside the band are read back and searched for it.
//
// Two balances are posed rather than one, so a bar that draws a fixed figure —
// the `0` a fresh expedition opens on, say — cannot pass. `numbersOf` reads a run
// both as its digit groups and with every separator stripped, so `4,207` and
// `4207` both state the same balance.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";
import { barText, numbersOf } from "./bar";

/** Two balances, neither one a figure the bar shows for another reason. */
const BALANCES = [4207, 39] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("states each posed balance on the bar", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  standAtCamp(h);

  const stated: string[] = [];
  for (const balance of BALANCES) {
    h.debug.setCredits(balance);
    stated.push(`${balance}: ${numbersOf(await barText(h)).has(balance)}`);
  }
  captureStill(h, "credits");

  assertEqual(
    stated.join(", "),
    BALANCES.map((balance) => `${balance}: true`).join(", "),
    "specs/ui.md",
  );
});

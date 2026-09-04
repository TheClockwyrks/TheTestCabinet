// Deepcore — rocket/fabrication-deducts-credits: each component costs what the
// table says.
//
// `specs/rocket.md` fixes the five prices — `4000`, `7500`, `3000`, `6000`,
// `5000` — says fabricating "deducts the Credits", and names their sum:
// "`ROCKET_TOTAL_CREDITS` is `25500`."
//
// So the whole rocket is built in one pass from one known balance, with the
// materials the two middle components consume and the Sample the last one
// consumes posed alongside, and each fabrication is read on the call: the balance
// down by exactly that component's price. The five together must have taken
// `ROCKET_TOTAL_CREDITS`, which is the sum stated as a figure of its own.
//
// The materials are posed rather than mined because this check decides the price
// and nothing else; what a component consumes from the satchel is decided by its
// own validator.

import { afterEach, beforeEach, it } from "vitest";
import { ROCKET_COMPONENTS, ROCKET_TOTAL_CREDITS } from "../constants";
import { assertEqual, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openPadScene } from "./pad-scene";

/** Comfortably more than the five together cost. */
const BALANCE = 40_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deducts each component's price, and ROCKET_TOTAL_CREDITS over the five", async () => {
  openPadScene(h);
  h.debug.setCredits(BALANCE);
  h.debug.setMaterial("resonite", 1);
  h.debug.setMaterial("cryenite", 1);
  h.debug.setCoreCarried(true);

  for (const component of ROCKET_COMPONENTS) {
    const before = h.snapshot();
    assertEqual(
      before.rocket.nextComponent,
      component.id,
      "the component the pad offers next",
    );

    h.debug.fabricate();
    const after = h.snapshot();

    assertEqual(
      before.credits - after.credits,
      component.credits,
      `Credits the ${component.id} cost`,
    );
  }

  await h.advance(2);
  captureStill(h, "pay");

  const end = h.snapshot();
  assertLength(
    end.rocket.installed,
    ROCKET_COMPONENTS.length,
    "components installed after the pass",
  );
  assertEqual(
    BALANCE - end.credits,
    ROCKET_TOTAL_CREDITS,
    "Credits the five components cost together",
  );
});

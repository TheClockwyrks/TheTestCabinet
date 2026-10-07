// Deepcore — core-run/components-survive-a-detonation: the rocket keeps what is
// already bolted to it.
//
// `specs/hazards.md`: "The Sample is destroyed either way, and by any death while
// it is held. Every component already installed on the rocket stays installed."
// `specs/rocket.md` states the rule in general: "Installed components are
// permanent. They survive a death in either mode."
//
// Three components are posed installed, a carried Sample is run out, and the
// checklist is read at the Game Over screen: the same three, in the same order,
// and the summary agreeing on the count. The death cause is read too, so what is
// being survived is really the detonation.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { ROCKET_COMPONENT_IDS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCampScene, runUntilOver } from "./core-scene";

/** How many components stand on the pad when the Sample goes off. */
const INSTALLED = 3;

/** Short enough to run out inside the drive. */
const SHORT_TIMER = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every installed component installed through a detonation", async () => {
  await openCampScene(h);
  await h.debug.setRocketInstalled(INSTALLED);
  await h.debug.setCoreCarried(true);
  await h.debug.setCoreTimer(SHORT_TIMER);

  const over = await runUntilOver(h);
  await captureStill(h, "rocket");

  assertEqual(
    over.screen,
    "game-over",
    "the screen the detonation left the game on",
  );
  assertEqual(
    over.summary?.deathCause,
    "core-detonation",
    "the cause the summary reports",
  );
  assertDeepEqual(
    over.rocket.installed,
    ROCKET_COMPONENT_IDS.slice(0, INSTALLED),
    "the checklist after the detonation",
  );
  assertEqual(
    over.summary?.componentsInstalled,
    INSTALLED,
    "components the summary counts",
  );
});

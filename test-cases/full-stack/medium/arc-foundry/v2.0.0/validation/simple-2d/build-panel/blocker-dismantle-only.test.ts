// build-panel/blocker-dismantle-only — a blocker offers DISMANTLE and no stats.
//
// `specs/hud.md`: a blocker's inspector reads "that it is inert, with no stats",
// and "a blocker offers `DISMANTLE` alone". `specs/scrap-press.md` calls a
// blocker "an inert wall. It has no type, no quality, no range, no head, and no
// targeting", and `specs/instrumentation.md` has it report `type: null` and zero
// `damage` and `range`.
//
// "No stats" is decided against a control rather than against a word no
// specification fixes: the same yard, the same anchor, first a Capacitor at
// Charged, whose damage and range `specs/components.md` fixes at `54` and `116`,
// and then a blocker. The component's figures have to be on the panel while it is
// selected and off it while the blocker is, so a panel that carries stats for a
// wall fails. The two are stood one at a time, so each reading is of a yard
// holding only what it is about.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  figures,
  type Harness,
  openYard,
  PANEL,
  standBlocker,
  standComponent,
  structureById,
} from "../harness";
import { componentDamage, componentRange } from "../constants";

const TYPE = "capacitor";
const TIER = 3;
const DAMAGE = componentDamage(TYPE, TIER);
const RANGE = componentRange(TYPE, TIER);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports dismantle alone for a blocker, and draws it no stats", async () => {
  openYard(h);

  // The control: a firing component's stats really are on the panel.
  const component = standComponent(h, TYPE, TIER, 10, 10);
  h.debug.select(component);
  const withStats = figures(await h.frameCalls(), PANEL);
  assertContains(
    withStats,
    DAMAGE,
    "the panel's figures with a Charged Capacitor selected",
  );
  assertContains(
    withStats,
    RANGE,
    "the panel's figures with a Charged Capacitor selected",
  );
  h.debug.dismantle(component);

  const blocker = standBlocker(h, 10, 10);
  h.debug.select(blocker);

  const buttons = h.debug.panelButtons();
  // Every reading this point makes is taken through the surface, which under
  // an engine runs no frame, so the still is of the frame this one draws.
  await h.advance(1);
  captureStill(h, "panel");
  assertLength(
    buttons.map((b) => b.action),
    1,
    "the actions a selected blocker offers",
  );
  assertEqual(
    buttons[0]?.action,
    "dismantle",
    "the one action a selected blocker offers",
  );

  const inert = structureById(h.snapshot(), blocker);
  assertNull(inert.type, "the type a blocker reports");
  assertEqual(inert.damage, 0, "the damage a blocker reports");
  assertEqual(inert.range, 0, "the range a blocker reports");
  assertNull(inert.targeting, "the targeting priority a blocker reports");

  const inertPanel = figures(await h.frameCalls(), PANEL);
  assertEqual(
    inertPanel.includes(DAMAGE),
    false,
    `whether the panel draws a damage stat for a blocker; it drew ${inertPanel.join(", ")}`,
  );
  assertEqual(
    inertPanel.includes(RANGE),
    false,
    `whether the panel draws a range stat for a blocker; it drew ${inertPanel.join(", ")}`,
  );
});

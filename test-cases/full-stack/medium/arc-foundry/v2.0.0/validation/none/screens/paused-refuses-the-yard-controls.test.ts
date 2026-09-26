// screens/paused-refuses-the-yard-controls — the pause menu takes the input.
//
// `specs/controls.md`: "An action not listed as available on a screen does nothing
// there. On `paused` the pause menu's own choices and the mute action are the
// whole of what the player operates: every other action, every status bar control,
// and every build panel control is inert, whether it is pressed with the pointer
// or fired from the keyboard." That is a rule on the PLAYER'S ROUTE, and it is
// the route this drives: `specs/instrumentation.md` makes a debug operation
// unconditional, so `keep`, `downgrade`, `combine` and `dismantle` on the surface
// each commit their own transaction from wherever the game stands and could not
// decide this. Both halves of the route are taken — the key each act is bound to,
// and a pointer press at whatever the build panel still draws.
//
// SO THE PAUSE MENU IS A GATE, NOT A PICTURE. `specs/ui.md` shows the yard
// "visible and frozen behind it", and a build that freezes the clock but leaves
// the acts wired lets a player harvest, fold and dismantle from inside the pause
// menu — taking the level's whole decision with the game stopped, which is the one
// thing the build phase's untimed pressure is built on.
//
// `press/build-phase-only-actions` decides the other gate, the live wave. This one
// poses a build phase, where all four acts WOULD be available, and pauses.
//
// FOUR ACTS, ONE READING. A candidate stands alone on the yard with a matching
// partner beside it, so a keep, a downgrade, a combine and a dismantle are each
// available on the playing screen and each would change the yard. The pause menu
// opens, all four are committed, and the yard is read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  clickControl,
  createHarness,
  openYard,
  pressAction,
  standCandidate,
  structureById,
  type Harness,
} from "../harness";

/** Two anchors clear of the Substation's chain, its entry and its collector. */
const CANDIDATE = { col: 10, row: 0 };
const PARTNER = { col: 14, row: 0 };

/** The four yard acts the pause menu must take the input away from. */
const ACTS = ["keep", "downgrade", "combine", "dismantle"] as const;

/** The roll both rocks carry, so a combine has a partner to fold with. */
const TYPE = "capacitor";
const QUALITY = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("commits no keep, downgrade, combine or dismantle from the pause menu", async () => {
  await openYard(h);
  const candidate = await standCandidate(
    h,
    TYPE,
    QUALITY,
    CANDIDATE.col,
    CANDIDATE.row,
  );
  const partner = await standCandidate(
    h,
    TYPE,
    QUALITY,
    PARTNER.col,
    PARTNER.row,
  );
  await h.debug.select(candidate);

  const before = await h.snapshot();
  assertEqual(before.phase, "build", "the phase the four acts are offered in");

  await h.debug.setScreen("paused");
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the screen the pause menu is shown on (specs/ui.md)",
  );

  // The keyboard half: each act fired from the key `specs/controls.md` binds it to.
  for (const act of ACTS) await pressAction(h, act);
  // And the pointer half: a press at the center of whatever the panel still draws
  // for those four acts, which is the other way a player reaches them.
  for (const control of await h.debug.panelButtons()) {
    if ((ACTS as readonly string[]).includes(control.action)) {
      await clickControl(h, control);
    }
  }
  await captureStill(h, "refused");

  const after = await h.snapshot();
  assertLength(
    after.structures,
    before.structures.length,
    "the yard's structures after four acts from inside the pause menu",
  );
  assertEqual(
    structureById(after, candidate).kind,
    "candidate",
    "the candidate no keep harvested and no combine folded (specs/controls.md)",
  );
  assertEqual(
    structureById(after, candidate).quality,
    QUALITY,
    "the candidate's tier, which no downgrade lowered",
  );
  assertEqual(
    structureById(after, partner).kind,
    "candidate",
    "the partner no dismantle removed and no combine consumed",
  );
  assertEqual(
    after.wave,
    before.wave,
    "the wave number, which no harvest sent",
  );
  assertEqual(after.phase, before.phase, "the phase, which no harvest ended");
});

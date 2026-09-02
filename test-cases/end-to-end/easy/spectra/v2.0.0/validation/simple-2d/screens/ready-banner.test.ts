// Spectra — screens/ready-banner: the ready hold is announced over the field.
//
// THE RULE. `specs/ui.md`, on `inWave`: "It runs in the `live` and `ready` phases.
// During the `ready` phase it draws `READY_TEXT` (`READY`) over the field."
// `specs/progression.md` says what that phase is — the beat after a life is lost,
// during which the ship is off the field.
//
// BOTH HALVES OF ONE REQUIREMENT. The banner is what tells a player the wave is
// holding, so a banner drawn during live play announces nothing. This point therefore
// reads the same posed field in both phases: the banner is required in `ready` and
// forbidden in `live`. A build that draws it in neither and a build that draws it in
// both each fail, on the assertion that names what they did.
//
// OVER THE FIELD, which `specs/field.md` fixes as `y` in
// `[FIELD_TOP, FIELD_BOTTOM]` — the region between the two HUD strips. The banner's
// anchor has to land in it, because a `READY` drawn into a HUD strip is not drawn over
// the field. Nothing about where in the field, at what size, or in what colour is
// asserted: `specs/ui.md` fixes none of it.
//
// THE PHASE IS POSED, NOT PLAYED INTO. `setPhase` and `setPhaseTimer` are what
// `specs/instrumentation.md` provides, so no life has to be lost to read this and a
// build whose contact rules are broken still gets a fair reading here. The hold is
// posed full so the phase cannot end underneath the reading; how long it really lasts
// is the `progression` group's.
//
// THE FIELD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// three world gates, so nothing a wave does can draw a `READY` of its own or end the
// phase mid-reading.

import { afterEach, beforeEach, it } from "vitest";
import { READY_HOLD, READY_TEXT } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnTextSpans,
  drewText,
  startPosed,
  type Harness,
} from "../harness";
import { PLAY_FIELD, insideBand, runCarrying } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws READY over the field during the ready phase and not during live play", async () => {
  startPosed(h);

  // Live play first: the control the banner is read against.
  const live = await drawFrame(h);
  assertEqual(
    h.snapshot().phase,
    "live",
    "the posed wave is running its live phase",
  );
  assertEqual(
    drewText(live, READY_TEXT),
    false,
    `no READY_TEXT (${READY_TEXT}) drawn during the live phase — specs/ui.md ` +
      "draws it during the READY phase, so a banner drawn always announces " +
      "nothing",
  );

  h.debug.setPhase("ready");
  h.debug.setPhaseTimer(READY_HOLD);
  await h.advance(1);
  assertEqual(
    h.snapshot().phase,
    "ready",
    "the wave is in its ready phase (specs/instrumentation.md)",
  );

  const ready = await drawFrame(h);
  captureStill(h, "ready");

  assertTrue(
    drewText(ready, READY_TEXT),
    `the ready phase drawing READY_TEXT (${READY_TEXT}) (specs/ui.md)`,
  );

  const banner = runCarrying(drawnTextSpans(h, ready), READY_TEXT);
  assertTrue(
    banner !== undefined && insideBand(PLAY_FIELD, banner.y),
    "the READY banner drawn OVER THE FIELD, whose y specs/field.md fixes at " +
      `[${String(PLAY_FIELD.y)}, ${String(PLAY_FIELD.y + PLAY_FIELD.h)}] — it ` +
      "was drawn at y " +
      `${banner === undefined ? "nowhere readable" : banner.y.toFixed(0)}`,
  );
});

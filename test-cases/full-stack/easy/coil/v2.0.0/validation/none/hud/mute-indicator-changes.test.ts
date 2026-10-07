// hud/mute-indicator-changes — the HUD says which state the sound is in.
//
// specs/ui.md: "A mute indicator sits in the band as well. It reads the current
// sound state unambiguously, either as a marker present only while muted or as a
// readout naming both states, and the muted and unmuted HUDs are told apart from
// the board alone. It changes on the frame `mute` is read."
//
// Both presentations the specification allows are the same reading from outside:
// the band drawn while muted differs from the band drawn while unmuted. So the
// same posed board is rendered in both states and the two bands compared point by
// point, and what is required is that at least one point CHANGED. How far it
// moved and what colour it moved to are the build's, and the presentation
// domain's aesthetic rating is what judges them; a band that came back identical
// is a HUD that says nothing about the sound state.
//
// `muted` is not a posable field: specs/instrumentation.md keeps it honest by
// mirroring the runtime's mute bit rather than by an operation, so the state is
// changed the way a player changes it, with the key `specs/controls.md` binds. The
// chain is held still and the board is left without a pellet, so nothing but the
// mute changes between the two frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { KEY } from "../constants";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { bandDifferences, readBand } from "./band";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a band while muted that differs from the unmuted one", async () => {
  const live = await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
    score: 320,
    best: 640,
  });
  assertEqual(live.muted, false, "the sound state the first frame is drawn in");

  await h.advance(1);
  const unmuted = await readBand(h);
  await captureStill(h, "unmuted");

  await h.tap(KEY.mute);
  const flipped = await h.snapshot();
  assertEqual(flipped.muted, true, "the sound state after mute is read");

  const muted = await readBand(h);
  await captureStill(h, "muted");

  assertGreaterThan(
    bandDifferences(unmuted, muted),
    0,
    "points of the HUD band the mute indicator changed",
  );
});

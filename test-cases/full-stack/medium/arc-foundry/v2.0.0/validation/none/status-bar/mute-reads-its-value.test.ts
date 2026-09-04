// status-bar/mute-reads-its-value — the mute control draws the mute bit, by either route.
//
// `specs/hud.md`: the mute control reads its own current value, and "muting from
// the bar or from the keyboard changes what the bar draws".
// `specs/instrumentation.md` adds that "toggling mute changes both the reported
// value and the pixels inside the reported rectangle".
//
// So the control's own rectangle is sampled unmuted, then muted by pressing the
// control, then unmuted again, then muted by the `mute` action's key — and each
// muted reading has to be told apart from the unmuted one it started from. The
// snapshot's `muted` is held alongside, so a route that never reached the mute
// bit fails here rather than passing as "the pixels did not move".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  DISTINCT,
  type Harness,
  lattice,
  maxDistance,
  openYard,
  pressAction,
  pressStatus,
  sample,
  statusControl,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the mute control differently muted, from the bar and from the key", async () => {
  await openYard(h);

  const control = await statusControl(h, "mute");
  const inside = lattice(control, 1);
  const open = await sample(h, inside);
  assertEqual(
    (await h.snapshot()).muted,
    false,
    "snapshot().muted on a page that has muted nothing",
  );

  await pressStatus(h, "mute");
  const byBar = await sample(h, inside);
  await captureStill(h, "mute");
  assertEqual(
    (await h.snapshot()).muted,
    true,
    "snapshot().muted after pressing the bar's mute control",
  );
  assertGreaterThan(
    maxDistance(open, byBar),
    DISTINCT,
    "how far the mute control's pixels move when it is muted from the bar, in " +
      "RGB distance",
  );

  await pressStatus(h, "mute");
  assertEqual(
    (await h.snapshot()).muted,
    false,
    "snapshot().muted after pressing the bar's mute control a second time",
  );

  await pressAction(h, "mute");
  const byKey = await sample(h, inside);
  assertEqual(
    (await h.snapshot()).muted,
    true,
    "snapshot().muted after firing the mute action from the keyboard",
  );
  assertGreaterThan(
    maxDistance(open, byKey),
    DISTINCT,
    "how far the mute control's pixels move when it is muted from the " +
      "keyboard, in RGB distance",
  );
});

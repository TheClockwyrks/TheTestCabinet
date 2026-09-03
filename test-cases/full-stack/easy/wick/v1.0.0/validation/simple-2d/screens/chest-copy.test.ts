// screens/chest-copy — the chest overlay draws its heading.
//
// WHAT THIS DECIDES. One thing: the chest frame carries `CHEST_TEXT` over the
// world the collecting tick left behind. What the overlay shows BELOW the
// heading is one point per result kind.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`chest`): "An overlay over the held world, opened as
//   `specs/progression.md` states. It shows `CHEST_TEXT` (`A CHEST OPENS`) and
//   the result in `chestResult`".
//   specs/progression.md ("The chest overlay"): "On the tick it is collected
//   the tick runs to completion, the chest's result is applied ...
//   `chestResult` records it, and `screen` becomes `chest` with `menuIndex` `0`."
//   specs/instrumentation.md (`setScreen`): "The chest overlay is reached
//   through `spawnPickup("chest", x, y)` at the lamplighter's center and one
//   tick, which is the real collection path."
//
// THE DRIVE. An isolated `playing` run, a chest placed at the lamplighter's
// center, and the one tick that collects it, which is the only path the
// specification gives to this screen. One frame is then drawn and its runs of
// text are read.
//
// THE TOLERANCE. The heading is matched as words in order through
// `drewPhrase`, which admits any font, wrap, or shadow; nothing about its
// colour or place is read, since specs/ui.md fixes no styling for any screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CHEST_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drewPhrase,
  isolate,
  openChest,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws A CHEST OPENS over the held world", async () => {
  isolate(h);
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the collected chest opened");

  const { calls } = await h.frameDraw();
  captureStill(h, "chest");

  assertEqual(
    drewPhrase(calls, CHEST_TEXT),
    true,
    `the chest overlay's frame draws ${CHEST_TEXT}`,
  );
});

// Refract — screens/playable-while-muted: a trace drawn on the board while the
// game is muted leaves that channel's beam carrying the traced cells exactly as
// it does with sound on.
//
// specs/ui.md "Audio": "The game stays fully playable with sound muted." The
// failure this decides is a build that gates its input path behind the mute
// bit, which leaves a player who turned the sound off with a game that no
// longer accepts a beam.
//
// Muting is posed through the real `mute` action, because the engine owns the
// mute bit and the surface carries no operation for it
// (specs/instrumentation.md). The flag is read first and the action fired only
// if the game is not already muted, so what this file needs — muted true — is
// reached whatever the bit rested at.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  tapAction,
  traceRoute,
  type Harness,
} from "../harness";

/** The route drawn while muted: one segment along the triangle channel. */
const ROUTE = [
  [0, 0],
  [1, 1],
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a trace with the sound off", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);
  if (!h.snapshot().muted) await tapAction(h, "mute");
  assertEqual(
    h.snapshot().muted,
    true,
    "posing: the game is muted before the trace",
  );

  traceRoute(h, ROUTE);
  await h.advance(1);
  captureStill(h, "muted");

  assertEqual(
    h.snapshot().muted,
    true,
    "the game is still muted after the trace",
  );
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    ROUTE.map(([col, row]) => ({ col, row })),
    "the traced cells are on the channel's beam (specs/ui.md: fully playable " +
      "with sound muted)",
  );
});

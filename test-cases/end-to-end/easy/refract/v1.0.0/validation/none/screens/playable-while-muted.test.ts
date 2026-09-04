// Refract — screens/playable-while-muted: a trace drawn on the board while the
// game is muted leaves that channel's beam carrying the traced cells exactly as
// it does with sound on.
//
// specs/ui.md "Audio": "The game stays fully playable with sound muted." The
// failure this decides is a build that gates its input path behind the mute
// bit, which leaves a player who turned the sound off with a game that no
// longer accepts a beam.
//
// Muting is posed through the real `mute` action, because the runtime owns the
// mute bit and the surface carries no operation for it
// (specs/instrumentation.md). The flag is read first and the action fired only
// if the game is not already muted, so what this file needs — muted true — is
// reached whatever the bit rested at.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { R3_REDRAW } from "../fixtures";
import {
  captureStill,
  createHarness,
  fireAction,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";

/** The route drawn while muted: one segment along the triangle channel. */
const ROUTE = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes a trace with the sound off", async () => {
  await loadBoard(h, R3_REDRAW);
  if (!(await h.snapshot()).muted) await fireAction(h, "mute");
  assertEqual(
    (await h.snapshot()).muted,
    true,
    "posing: the game is muted before the trace",
  );

  await traceCells(h, [...ROUTE]);
  await h.advance(1);
  await captureStill(h, "muted");

  const played = await h.snapshot();
  assertEqual(played.muted, true, "the game is still muted after the trace");
  assertDeepEqual(
    played.beams.triangle?.cells,
    ROUTE.map(({ col, row }) => ({ col, row })),
    "the traced cells are on the channel's beam (specs/ui.md: fully playable " +
      "with sound muted)",
  );
});

// Cascade — draw-three/deal-mode-reported: the build reports the deal mode it plays.
//
// specs/stock.md fixes three figures for this variant — `DEAL_MODE`
// (`draw-three`), `TURN_COUNT` (`3`) and `DEAL_MODE_LABEL` (`DRAW THREE`) — and
// specs/instrumentation.md states that `dealMode`, `turnCount` and
// `dealModeLabel` are built at the call from exactly those figures.
//
// THIS IS THE ITEM EVERY COMMON CHECK LEANS ON. A common scenario that has to
// size itself to the deal mode reads `snapshot().turnCount` rather than
// hard-coding a figure, which keeps one suite honest across both variants but
// leaves the figure itself undecided. This point is where the reported figure is
// held against the specification, so a build that reports `draw-one` and turns
// one card fails here rather than passing the whole common suite.
//
// It decides the REPORT and nothing else. What a turn actually moves is
// `draw-three/turn-count`'s, and the literal the two screens draw is
// `draw-three/mode-label-title`'s and `draw-three/mode-label-hud`'s; the label is
// therefore not read here, so a build with a correct report and a mistyped label
// misses one requirement rather than two.
//
// The reading is taken on an empty table in play, because it is a report of the
// build's own configuration and depends on nothing the table holds. Nothing is
// dealt: a deal that threw would fail this point for another point's fault.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";
import { DEAL_MODE, TURN_COUNT } from "./constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports draw-three and a turn count of three", async () => {
  openTable(h);

  await h.drawFrame();
  captureStill(h, "mode");

  const snapshot = h.snapshot();
  assertEqual(snapshot.dealMode, DEAL_MODE, "the reported dealMode");
  assertEqual(snapshot.turnCount, TURN_COUNT, "the reported turnCount");
});

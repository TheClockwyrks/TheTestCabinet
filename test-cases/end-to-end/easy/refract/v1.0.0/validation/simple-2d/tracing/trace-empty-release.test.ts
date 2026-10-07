// Refract — tracing/trace-empty-release: a trace that added nothing leaves
// the beam empty.
//
// specs/controls.md "Releasing": a trace that added no segment leaves its
// channel's beam carrying none, so a later press on either of that channel's
// emitters starts the beam afresh — the first grab row matches again, at
// whichever emitter is pressed.
//
// The board is R9_UNIQUE (fixtures.ts), whose triangle emitters sit at (0,0)
// and (3,2). The trace is begun at (0,0) and released without a move; the
// press that must then start afresh is taken at the OTHER emitter first — the
// stronger half of the claim — and then back at the original one.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { R9_UNIQUE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the beam with no cells, and either emitter starts it afresh", async () => {
  await resetTo(h);
  await loadBoard(h, R9_UNIQUE);
  const at = (col: number, row: number): { x: number; y: number } =>
    nodeCenter(col, row, 4, 3);

  // Press an emitter and release without extending.
  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  assertNotNull(h.snapshot().tracing, "the press begins a trace");
  h.debug.pointerUp();
  assertEqual(
    h.snapshot().beams.triangle?.cells.length,
    0,
    "a trace that added no segment leaves its channel's beam carrying no " +
      "cells (specs/controls.md, Releasing)",
  );

  // The OTHER emitter starts the beam afresh.
  h.debug.pointerDown(at(3, 2).x, at(3, 2).y);
  await h.advance(1);
  captureStill(h, "restarted");

  const restarted = h.snapshot();
  assertEqual(
    restarted.tracing?.channel,
    "triangle",
    "a later press on the channel's other emitter starts the beam afresh",
  );
  assertDeepEqual(
    restarted.beams.triangle?.cells,
    [{ col: 3, row: 2 }],
    "the fresh beam starts at the pressed emitter",
  );
  h.debug.pointerUp();

  // And the original emitter does too.
  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [{ col: 0, row: 0 }],
    "the original emitter equally starts the beam afresh",
  );
  h.debug.pointerUp();
});

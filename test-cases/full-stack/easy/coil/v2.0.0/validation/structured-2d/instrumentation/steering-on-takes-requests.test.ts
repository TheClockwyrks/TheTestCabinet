// instrumentation/steering-on-takes-requests — the switch turned back on takes
// requests again.
//
// specs/instrumentation.md: "Turning a switch back on resumes that faculty from
// wherever the game stands, with no catching up for the ticks it was off." For
// `steering` that means the next request lands in the buffer and the following
// tick applies it — which is a claim about turning the switch ON, and so a point
// of its own beside the two that read it off.
//
// WHAT THE SWITCHES ARE FOR. specs/instrumentation.md gives the driver three
// switches rather than one, "because a scenario holds one faculty still while it
// watches another". A switch that also held the other faculty would be a
// different switch, so each half of what one promises is its own point.
//
// THE REQUESTS ARE REAL KEY PRESSES because a steering request has no other
// source: the surface carries no operation that buffers one, so the keyboard is
// what a request arrives on. What is decided here is what the switch does with
// them, not the bindings, which the `controls` points own.
//
// THE BRACKET AROUND THE RECORDING runs the scene up before the behaviour and
// settles after it, so what a reviewer watches is the chain already travelling
// when the moment arrives and still there afterwards, rather than a single tick
// cut out of the middle.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { KEY, type Cell } from "../constants";
import {
  arrangeStep,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** Where the chain is posed: row 8 with a long clear run to its right. */
const HEAD: Cell = { col: 8, row: 8 };

/** Ticks of travel before the switch comes back on, and after the turn lands. */
const RUN_UP = 3;
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("buffers the next request and turns on the tick after it", async () => {
  const posed = arrangeStep(h, {
    head: HEAD,
    dir: "right",
    length: 3,
    steering: false,
  });
  assertEqual(posed.snapshot.steering, false, "the switch the scene posed");

  const resumed = await captureReplay(h, "resumed", async () => {
    // Travelling with the switch off, and a request that goes nowhere.
    await h.tick(RUN_UP);
    await h.tap(KEY.up);
    assertDeepEqual(
      h.snapshot().turns,
      [],
      "turns while the switch was still off",
    );

    h.debug.setSnakeSteering(true);
    await h.tap(KEY.up);
    const taken = h.snapshot();
    const turned = await h.tick();
    await h.tick(SETTLE);
    return { taken, turned };
  });

  assertDeepEqual(resumed.taken.turns, ["up"], "turns with steering back on");
  assertEqual(resumed.turned.dir, "up", "dir on the tick after the request");
});

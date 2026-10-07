// instructions/wheel-rule-takes-precedence — the wheel rule outranks every other
// fetch fault.
//
// THE RULE, stated as a precedence in the cycle's first step: "A non-blank cell
// the part cannot perform raises the fault named for it under Faults. The wheel
// rule takes precedence: a wheel given anything but `rotate-cw` or `rotate-ccw`
// faults as `impossible` whatever else would apply" (`specs/simulation.md`,
// Cycles and the clock).
//
// THE CONFIGURATION, chosen so that something else WOULD apply. One wheel at the
// origin with `advance` in its only cell, and no track anywhere on the machine.
// Two rules reach that cell at once:
//
//   * "`unmounted` — `advance` or `recede` on a part not on a track", and the
//     wheel stands on no track — "An arm or wheel whose anchor hex is a cell of a
//     track is mounted on that track" (`specs/parts.md`), and there is no track
//     for its anchor to be a cell of;
//   * "`impossible` — ... any non-blank instruction but `rotate-cw` or
//     `rotate-ccw` on a wheel", and `advance` is neither rotation.
//
// The precedence sentence decides between them. The wheel is the only part
// placed and the field is empty, so nothing else can be what faulted.
//
// THE VERDICT. `sim.fault.kind` is `impossible`, not `unmounted`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partsOfKind,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("faults an unmounted wheel given advance as impossible rather than as unmounted", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("wheel", ORIGIN.q, ORIGIN.r, 0, 1, ["advance"]),
    ]),
  });

  const posed = await h.snapshot();
  assertLength(
    partsOfKind(posed, "track"),
    0,
    "no track is placed, so the wheel stands on none and the unmounted rule reaches its cell too",
  );

  await captureReplay(h, "precedence", async () => {
    await advanceCycles(h, 1);
    await h.advance(1);
  });

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the fault");
  assertEqual(
    sim?.status,
    "faulted",
    "the cycle faults rather than running to its boundary",
  );
  assertEqual(
    sim?.fault?.kind,
    "impossible",
    "the wheel rule takes precedence: a wheel given anything but rotate-cw or rotate-ccw faults impossible whatever else would apply",
  );
});

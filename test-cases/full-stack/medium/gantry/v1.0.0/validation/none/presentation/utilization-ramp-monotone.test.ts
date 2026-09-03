// presentation/utilization-ramp-monotone — members are coloured along one ramp
// that climbs with utilization.
//
// `specs/overview.md` § Visual design: "While the tape runs, EACH MEMBER'S COLOR
// READS ITS UTILIZATION ON A MONOTONE RAMP from slack to its limit …". Monotone
// is a fact about the ORDER two colours stand in and not about either one, so
// this compares members against each other and never against a value.
//
// THE RAMP'S DIRECTION IS THE BUILD'S. A ramp that climbs from cool to hot and
// one that climbs the other way both satisfy "monotone", so the check reads the
// direction off the two ends it found and then asks that every member in between
// keeps to it. What it refuses is a colouring that doubles back — a member
// carrying more than another and drawn nearer the slack end.
//
// WHAT IT COMPARES IS HEAT, `r - (g + b) / 2`: it is linear in the channels, so
// it orders any ramp that climbs toward red, which is what "from slack to its
// limit" describes without fixing a palette.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  colourHeat,
  createHarness,
  entriesOf,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A move that keeps the run running and moves nothing (`specs/rigging.md`). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** Ticks driven so the solve has utilizations to colour by. */
const WARMUP = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("colours members along one ramp that climbs with utilization", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  const snapshot = await runTicks(h, WARMUP);

  const forces = new Map(
    snapshot.run.forces.map((f) => [f.id, f.utilization]),
  );
  const members = entriesOf(await h.drawn(), "member").filter(
    (entry) => entry.id !== null && forces.has(entry.id),
  );

  await h.capture("ramp", "The crane coloured by utilization");

  assertTrue(
    members.length >= 2,
    "at least two intact members drawn and solved, so a ramp can be read " +
      `— the frame drew ${members.length} of them`,
  );

  const ordered = [...members].sort(
    (a, b) => forces.get(a.id!)! - forces.get(b.id!)!,
  );
  const first = colourHeat(ordered[0]!.color);
  const last = colourHeat(ordered[ordered.length - 1]!.color);
  // A crane whose members all carry the same share has nothing to order, and
  // that is not a failure of the colouring.
  const spread = Math.abs(
    forces.get(ordered[ordered.length - 1]!.id!)! - forces.get(ordered[0]!.id!)!,
  );
  if (spread < 1e-6 || Math.abs(last - first) < 1e-6) return;

  const rising = last > first;
  for (let i = 1; i < ordered.length; i += 1) {
    const before = ordered[i - 1]!;
    const after = ordered[i]!;
    if (forces.get(after.id!)! - forces.get(before.id!)! < 1e-6) continue;
    const step = colourHeat(after.color) - colourHeat(before.color);
    assertTrue(
      rising ? step >= -1 : step <= 1,
      `the ramp to keep one direction: member ${before.id} carries ` +
        `${forces.get(before.id!)!.toFixed(3)} and member ${after.id} carries ` +
        `${forces.get(after.id!)!.toFixed(3)}, and the colouring turned back ` +
        "on itself between them (specs/overview.md)",
    );
  }
});

// parts/rotation-names-the-first-spoke — a part's spoke set is relative to its
// rotation, not fixed from `0`.
//
// THE RULE. "The part's rotation names its first spoke, and the variant names the
// rest" (`specs/parts.md`, Arms), and the variant table then writes every spoke
// set as an offset FROM the rotation: "Spokes, relative to `rotation`", with the
// triarm's row reading "`rotation`, `rotation + 2`, `rotation + 4`".
// `specs/field.md` fixes the arithmetic: "Rotating a direction index clockwise
// adds `1` modulo `6`". So the same triarm at rotation `1` grips spokes `1`, `3`
// and `5` where at rotation `0` it grips `0`, `2` and `4` — the shape turns with
// the part rather than standing still.
//
// HOW A SPOKE SET IS OBSERVED. `grab` closes every gripper, "A gripper over a
// mote takes hold of that mote's constellation" (`specs/instructions.md`), and
// `sim.grips` reports `{ part, spoke, mote }` per holding gripper
// (`specs/instrumentation.md`). Each triarm below is ringed with a mote on all six
// of its neighbor hexes, so every gripper it has is over a mote and the grips name
// exactly which spokes exist.
//
// THE CONFIGURATION. TWO triarms in one world, identical but for their rotation:
// one at `(-2, 0)` rotation `0` and one at `(2, 0)` rotation `1`, both length `1`,
// both tape `["grab"]`. Four hexes apart, so no ring reaches the other's, and the
// two rings share no hex. Posing both at once is what makes the comparison a
// comparison: one build, one cycle, one difference. Nothing moves — "`grab`,
// `drop`, blank — None" (`specs/simulation.md`) — and every mote is at least one
// hex, `HEX_PITCH` (`48`), from every other, clear of `2 * MOTE_COLLIDE_R` (`38`).
//
// THE VERDICT. Each triarm holds three motes; the one at rotation `0` holds them
// on spokes `0`, `2`, `4` and the one at rotation `1` on spokes `1`, `3`, `5`; and
// each held mote is the one resting on that spoke's own `base + 1 * DIRS[d]`. The
// two sets are disjoint, so a build that ignored rotation could not satisfy both.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull, assertNull } from "../assert";
import { at, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import { gripperHex, spokesOf } from "../parts";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
  openBareRun,
  partIds,
  poseOf,
  spawnMote,
  type Harness,
} from "../harness";

/** The same triarm twice, differing in rotation alone. */
const UNTURNED: { base: Hex; rotation: number } = { base: at(-2, 0), rotation: 0 };
const TURNED: { base: Hex; rotation: number } = { base: at(2, 0), rotation: 1 };
const LENGTH = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("grips spokes 0, 2, 4 at rotation 0 and spokes 1, 3, 5 at rotation 1", async () => {
  assertEqual(
    spokesOf("triarm", UNTURNED.rotation).join(","),
    "0,2,4",
    "a triarm at rotation 0 carries spokes rotation, rotation + 2 and rotation + 4",
  );
  assertEqual(
    spokesOf("triarm", TURNED.rotation).join(","),
    "1,3,5",
    "the same triarm at rotation 1 carries the three spokes one step round",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart(
        "triarm",
        UNTURNED.base.q,
        UNTURNED.base.r,
        UNTURNED.rotation,
        LENGTH,
        ["grab"],
      ),
      armPart(
        "triarm",
        TURNED.base.q,
        TURNED.base.r,
        TURNED.rotation,
        LENGTH,
        ["grab"],
      ),
    ]),
  });
  const ids = await partIds(h);

  const rings: number[][] = [];
  for (const arm of [UNTURNED, TURNED]) {
    const ring: number[] = [];
    for (const d of [0, 1, 2, 3, 4, 5]) {
      ring.push(await spawnMote(h, gripperHex(arm.base, d, LENGTH), "dust"));
    }
    rings.push(ring);
  }

  await advanceCycles(h, 1);
  const snapshot = await h.snapshot();
  await captureStill(h, "turned");

  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle that grabbed");
  assertEqual(sim?.status, "running", "the grab cycle reaches its boundary");
  assertNull(sim?.fault ?? null, "no fault was raised by the grab");
  assertEqual(sim?.cycle, 1, "the cycle ran to its boundary rather than freezing");

  for (const [index, arm] of [UNTURNED, TURNED].entries()) {
    const part = ids[index] ?? -1;
    const spokes = spokesOf("triarm", arm.rotation);
    const ring = rings[index] ?? [];
    assertEqual(
      poseOf(snapshot, part)?.rotation,
      arm.rotation,
      `the triarm at (${arm.base.q}, ${arm.base.r}) runs the cycle at rotation ${arm.rotation}`,
    );
    assertLength(
      gripsOf(snapshot, part),
      3,
      `the triarm at rotation ${arm.rotation} holds three of its six ringed motes`,
    );
    for (const d of [0, 1, 2, 3, 4, 5]) {
      assertEqual(
        heldBy(snapshot, part, d),
        spokes.includes(d) ? (ring[d] ?? -1) : null,
        spokes.includes(d)
          ? `rotation ${arm.rotation}, spoke ${d}: a gripper stands here and holds the mote on base + DIRS[${d}]`
          : `rotation ${arm.rotation}, spoke ${d}: no gripper stands here, so the ringed mote is untouched`,
      );
    }
  }
});

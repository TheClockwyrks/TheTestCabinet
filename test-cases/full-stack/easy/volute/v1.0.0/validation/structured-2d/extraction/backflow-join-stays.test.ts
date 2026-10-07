// extraction/backflow-join-stays — a run of three that BACKFLOW packs together is
// left on the channel.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "Runs": "A maximal run of at
// least 3 cores is extracted by the two events below, and a run that reaches 3
// cores by any other means stays on the channel." Backflow is one of those other
// means. specs/machinery.md — "Backflow" — describes the whole of what it does:
// "every core on the channel moves toward the inlet at BACKFLOW_SPEED, in place
// of the advance it would otherwise make... Each core stops at the channel
// spacing ahead of the core behind it, and the tail core stops at arc position
// `0`, so the train packs against the inlet and holds there for the remainder of
// the duration." Cores closing onto one another until they stand one spacing
// apart, and not one word about a removal.
//
// THAT "IN PLACE OF THE ADVANCE" IS WHAT SETTLES IT. specs/channel.md's merge is
// an event of the advance — "A segment merges with the segment ahead of it when
// its head reaches the arc position SPACING behind that segment's tail. On the
// tick its advance would carry its head past that position" — and under backflow
// there is no advance to carry anything anywhere. The train closes up from the
// BACK, each core stopping behind the core it caught, which is the opposite
// motion. So a same-charge run that the packing leaves standing is not a merge
// and is not extracted.
//
// WHY THIS IS ITS OWN POINT. instrumentation/pose-decides-nothing grades a run
// the game never assembled and recoil-join-stays grades one a removal's aftermath
// pushed together. This grades the third way the specification lets a run appear,
// and it is the one a build is most likely to special-case: backflow is where a
// build rewrites every arc position on the channel at once, and a build that
// follows that rewrite with a sweep for runs empties the hall it was told to pack.
//
// THE POSE. Two segments of cobalt on the straight top run, the inlet held
// (specs/instrumentation.md — `setEmission`) so it delivers nothing, pressure 0,
// and
// backflow granted (specs/instrumentation.md's `grantMachinery`, which
// specs/machinery.md makes "the active machinery... starting its full duration
// afresh"): a pair at 90 and 62, and one core at 30 a clear 32 units behind them.
// Two segments, because 32 is not the spacing.
//
// WHAT THE PACKING DOES, TICK BY TICK. BACKFLOW_SPEED is 60 units/s, so a core
// travels one unit a tick. The single core reaches the inlet on the 30th tick and
// stops there; the pair keeps coming until, on the 34th, the second of them
// stands at 28 — the spacing ahead of the core behind it — and the first at 56.
// Three cobalt, one spacing apart, one segment, and a maximal run of three that
// the game itself assembled. The check watches 40 ticks, comfortably past the
// 34th and comfortably inside the 5 s specs/machinery.md gives backflow.
//
// THE TOLERANCE on the packed spacing is the standing ARC_TOL of half a unit,
// against a rule that fixes the gap at exactly the spacing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNear,
} from "../assert";
import { ARC_TOL, SPACING } from "../constants";
import {
  arcPositions,
  captureReplay,
  charges,
  coreCount,
  createHarness,
  poseHall,
  spacedRun,
  type Harness,
} from "../harness";

/** The pair the packing brings down onto the core behind them. */
const PAIR = ["cobalt", "cobalt"] as const;

/** The pair's head, on specs/channel.md's first leg. */
const PAIR_HEAD_S = 90;

/** The core the pair packs onto, far enough back to be a segment of its own. */
const LONE = ["cobalt"] as const;

/** The lone core's arc position: 32 units behind the pair's tail, so not spaced. */
const LONE_HEAD_S = 30;

/** Every core the hall opens with. */
const POSED_CORES = PAIR.length + LONE.length;

/**
 * How long the packing is watched for.
 *
 * The pack completes on the 34th tick at BACKFLOW_SPEED's one unit a tick, and
 * backflow itself runs for 5 s (300 ticks), so 40 sits clear of both.
 */
const PACK_TICKS = 40;

/** The arc positions a packed train of three holds: the inlet and two spacings. */
const PACKED = [SPACING * 2, SPACING, 0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a run of three that backflow packed together on the channel", async () => {
  await poseHall(h, {
    cores: [...spacedRun(PAIR_HEAD_S, PAIR), ...spacedRun(LONE_HEAD_S, LONE)],
    machinery: "backflow",
  });

  const posed = h.snapshot();
  assertEqual(coreCount(posed), POSED_CORES, "the posed cores");
  assertLength(posed.segments, 2, "segments the pose left standing apart");

  const packed = await captureReplay(h, "packed", async () =>
    h.step(PACK_TICKS),
  );

  // The packing did what specs/machinery.md says it does: the train stands
  // against the inlet, one spacing between each core, as one segment.
  assertEqual(
    coreCount(packed),
    POSED_CORES,
    "cores left once the train packed",
  );
  assertLength(packed.segments, 1, "the one segment the packing left");
  const positions = arcPositions(packed);
  for (let i = 0; i < PACKED.length; i += 1) {
    assertNear(
      positions[i],
      PACKED[i],
      ARC_TOL,
      "a packed core's arc position",
    );
  }

  // THE VERDICT. The maximal run the packing assembled is three cobalt, and all
  // three are still on the channel with nothing scored.
  assertDeepEqual(charges(packed), ["cobalt", "cobalt", "cobalt"]);
  assertEqual(packed.score, posed.score);
  assertEqual(packed.screen, "playing", "the hall still in play");
});

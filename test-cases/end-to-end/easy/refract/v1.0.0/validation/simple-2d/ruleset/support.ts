// ruleset/support — the one assertion every refusal suite in this category
// repeats. PRIVATE to ruleset/: the shared harness owns arrangement, and this
// file owns nothing but the wording of one check.
//
// specs/beams.md (Enforcement) states what a refused move leaves behind: "the
// beam is unchanged and the trace stays live." The beam half is a plain
// `assertDeepEqual` over `snapshot.beams` in each suite; this helper is the
// trace half, asserting the trace is still live, still on its channel, and
// still ending where it ended before the refused move.

import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import type { CellRef, RefractSnapshot } from "../harness";

/**
 * The trace is live on `channel` with its live end at `live`
 * (specs/instrumentation.md: `tracing` is null whenever no trace is live, and
 * `tracing.live` names the cell of the live end).
 */
export function assertLiveTrace(
  snapshot: RefractSnapshot,
  channel: string,
  live: CellRef,
  context: string,
): void {
  assertNotNull(snapshot.tracing, context);
  assertEqual(
    snapshot.tracing?.channel,
    channel,
    `${context}: the live trace's channel`,
  );
  assertDeepEqual(
    snapshot.tracing?.live,
    live,
    `${context}: the live end's cell`,
  );
}

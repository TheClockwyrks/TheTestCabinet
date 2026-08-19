import type { InProgressRun } from "./types";

// Map a backend job state to the console's coarser in-progress *phase*.
//
// The console deliberately shows fewer states than the queue tracks. `dispatched`
// (claimed, the driver pod being created) and `starting` (the pod up, running
// pre-run setup) are one waiting-to-begin phase to a viewer; only the queue cares
// which. A held-back run reads as "pending", a free-but-unclaimed one as "queued".
//
// Terminal states map to `null` rather than to a phase: a finished run is not
// in-progress at all, and every caller has something better to do with it than
// display a phase (drop it from the list, or — for the active-run listing, which a
// terminal job never appears in — fall back).
//
// This lives in the client layer because both sides of the console need it and
// neither owns it: the transport maps `GET /jobs/active` rows through it, and the
// notifications layer maps the run-lifecycle events that keep that same list current
// between fetches. Two copies would be two chances for the list to disagree with
// itself depending on which source last touched a row.
export function runPhase(state: string): InProgressRun["state"] | null {
  switch (state) {
    case "queued":
      return "queued";
    case "pending":
      return "pending";
    case "dispatched":
    case "starting":
      return "starting";
    case "running":
      return "running";
    default:
      return null;
  }
}

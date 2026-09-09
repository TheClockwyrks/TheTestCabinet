// instrumentation — reading one named entity off a snapshot, or failing for it.
//
// The shared harness answers `bearById`, `vehicleById`, `floeById` and `laneAt`
// with `undefined` where nothing carries the id, and says so deliberately: what
// a missing entry MEANS is the check's to state. Almost every check in this
// group states the same thing — the entity was posed a moment earlier through an
// operation `specs/instrumentation.md` says appends it to its roster, so a
// roster that no longer carries it is the build's fault and not the scenario's —
// so that one sentence is written once here rather than twenty-four times over.
//
// Each of these is a READING that fails, never a pose: it asserts through
// `fail`, so the message the runner extracts names the operation the missing
// entity was owed to. Nothing here carries a tolerance or a threshold.
//
// Local to this group rather than on the shared harness because the shared
// harness deliberately hands back `undefined`, and other groups are free to read
// that differently.

import { fail } from "../assert";
import {
  bearById,
  floeById,
  laneAt,
  vehicleById,
  type BearSnapshot,
  type FloeItemSnapshot,
  type FloeSnapshot,
  type LaneSnapshot,
  type VehicleSnapshot,
} from "../harness";

/** The bear carrying `id`, or a failure naming the roster that lost it. */
export function requireBear(
  snapshot: FloeSnapshot,
  id: number,
  what = "the posed bear",
): BearSnapshot {
  const bear = bearById(snapshot, id);
  if (bear === undefined) {
    fail(
      `${what}, id ${id}, on the strait — addBear appends a bear to the ` +
        `roster and it keeps its id for as long as it is there ` +
        `(specs/instrumentation.md)`,
      `the bears carry ids ${JSON.stringify(snapshot.bears.map((b) => b.id))}`,
    );
  }
  return bear;
}

/** The vehicle carrying `id`, or a failure naming the roster that lost it. */
export function requireVehicle(
  snapshot: FloeSnapshot,
  id: number,
  what = "the posed vehicle",
): VehicleSnapshot {
  const item = vehicleById(snapshot, id);
  if (item === undefined) {
    fail(
      `${what}, id ${id}, on the ice band — addVehicle appends a vehicle to ` +
        `the roster and it keeps its id for as long as it is there ` +
        `(specs/instrumentation.md)`,
      `the vehicles carry ids ` +
        `${JSON.stringify(snapshot.vehicles.map((v) => v.id))}`,
    );
  }
  return item;
}

/** The floe carrying `id`, or a failure naming the roster that lost it. */
export function requireFloe(
  snapshot: FloeSnapshot,
  id: number,
  what = "the posed floe",
): FloeItemSnapshot {
  const item = floeById(snapshot, id);
  if (item === undefined) {
    fail(
      `${what}, id ${id}, on the water band — addFloe appends a floe to the ` +
        `roster and it keeps its id for as long as it is there ` +
        `(specs/instrumentation.md)`,
      `the floes carry ids ${JSON.stringify(snapshot.floes.map((f) => f.id))}`,
    );
  }
  return item;
}

/** The lane on strait `row`, or a failure naming the band that has no such row. */
export function requireLane(snapshot: FloeSnapshot, row: number): LaneSnapshot {
  const lane = laneAt(snapshot, row);
  if (lane === undefined) {
    fail(
      `a lane reported for strait row ${row} — snapshot reports the eight ice ` +
        `lanes and the eight water lanes (specs/instrumentation.md)`,
      `the reported lanes sit on rows ` +
        `${JSON.stringify([...snapshot.iceLanes, ...snapshot.waterLanes].map((l) => l.row))}`,
    );
  }
  return lane;
}

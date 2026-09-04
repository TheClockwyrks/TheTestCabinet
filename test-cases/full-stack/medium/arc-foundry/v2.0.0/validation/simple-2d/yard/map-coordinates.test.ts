// yard/map-coordinates — the three maps are chosen rather than generated, so each
// reports the entry, the six ordered waypoints, and the collector at exactly the
// tiles `specs/yard.md` pins for it.
//
// EVERY MAP-FACING FIGURE IN THE GAME IS DOWNSTREAM OF THIS. The maze length is
// the route through this chain, a unit's `waypointIndex` counts along it, and
// `first` and `last` order the Load by progress toward its end. A map whose
// waypoints are anywhere else is a map whose every route figure is a different
// number, and no other point in this project could say why.
//
// THE ORDER IS PART OF THE COORDINATE. `WP1` through `WP6` are the numbers drawn
// on the yard and the sequence a unit walks, so a build that lays the right six
// tiles down in the wrong order fails here as squarely as one that puts them
// somewhere else.

import { afterEach, beforeEach, it } from "vitest";

import { MAPS } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports each map's entry, ordered waypoints and collector", async () => {
  for (const map of MAPS) {
    openYard(h, { map: map.id });
    const s = h.snapshot();
    assertEqual(s.map, map.id, "the map the run opened on");

    if (map.id === MAPS[0]!.id) {
      await h.advance(1);
      captureStill(h, "substation");
    }

    assertEqual(s.entry.col, map.entry.col, `${map.name}: the entry's col`);
    assertEqual(s.entry.row, map.entry.row, `${map.name}: the entry's row`);
    assertEqual(
      s.collector.col,
      map.collector.col,
      `${map.name}: the collector's col`,
    );
    assertEqual(
      s.collector.row,
      map.collector.row,
      `${map.name}: the collector's row`,
    );

    assertLength(
      s.waypoints,
      map.waypoints.length,
      `${map.name}: the waypoints of its chain`,
    );
    for (const [at, waypoint] of map.waypoints.entries()) {
      const reported = s.waypoints[at]!;
      const where = `${map.name}: WP${at + 1}`;
      assertEqual(reported.index, at + 1, `${where}: its order number`);
      assertEqual(reported.col, waypoint.col, `${where}: its col`);
      assertEqual(reported.row, waypoint.row, `${where}: its row`);
    }
  }
});

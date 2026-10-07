// Tests for the design model's file boundary: reading a committed scenario and
// writing one back.
//
// The property that matters most is the ROUND TRIP. This tool can overwrite the
// scenarios the case is graded on, so opening one and saving it unedited must
// reproduce the file byte for byte — anything else is a silent diff in the scored
// set, and (if it touched the layout or the schedule) a silently different answer
// key. These run against the real committed files rather than fixtures, so a change
// to either side is caught here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  beltTierLabel,
  defaultTimeline,
  exportJson,
  fromScenario,
  timelineError,
  type Timeline,
} from "./model";

const CASES_DIR = fileURLToPath(
  new URL(
    "../../../test-cases/performance/hard/lattice/v1.0.0/cases",
    import.meta.url,
  ),
);

const SCORED = ["small", "medium", "large"] as const;

function scenarioText(name: string): string {
  return readFileSync(join(CASES_DIR, `${name}.json`), "utf8");
}

describe("round-tripping a committed scenario", () => {
  it.each(SCORED)("re-writes %s byte for byte", (name) => {
    const text = scenarioText(name);
    const { design, timeline } = fromScenario(JSON.parse(text));
    expect(exportJson(design, timeline)).toBe(text);
  });

  it("keeps the scored snapshot schedule instead of regenerating one", () => {
    const { timeline } = fromScenario(JSON.parse(scenarioText("medium")));
    // The two playback-window checkpoints are not derivable from the run length;
    // only carrying the file's own schedule preserves them.
    expect(timeline.snapshots).toContain(1250);
    expect(timeline.snapshots).toContain(2500);
    expect(defaultTimeline(timeline.ticks).snapshots).not.toContain(1250);
  });

  it("preserves placement order, which the canonical state is keyed on", () => {
    const parsed: { entities: { type: string }[] } = JSON.parse(
      scenarioText("large"),
    );
    const { design } = fromScenario(parsed);
    expect(design.entities.map((e) => e.type)).toEqual(
      parsed.entities.map((e) => e.type),
    );
  });
});

describe("rejecting a scenario it cannot read", () => {
  const base = {
    version: 1,
    grid: { width: 4, height: 4 },
    ticks: 10,
    snapshots: [10],
    entities: [],
  };

  it("refuses another wire version", () => {
    expect(() => fromScenario({ ...base, version: 2 })).toThrow(/version 2/);
  });

  it("names the entity index that failed", () => {
    const entities = [
      { type: "belt", x: 0, y: 0, dir: "E", tier: "fast" },
      { type: "belt", x: 1, y: 0, dir: "E", tier: "hyper" },
    ];
    expect(() => fromScenario({ ...base, entities })).toThrow(/entities\[1\]/);
  });

  it("refuses an unknown entity type rather than dropping it", () => {
    const entities = [{ type: "conveyor", x: 0, y: 0, dir: "E" }];
    expect(() => fromScenario({ ...base, entities })).toThrow(/conveyor/);
  });

  it("refuses a recipe the machine cannot run", () => {
    // Smelting on an assembler is a validation error in the engine too.
    const entities = [{ type: "assembler", x: 0, y: 0, recipe: "iron-plate" }];
    expect(() => fromScenario({ ...base, entities })).toThrow(/recipe/);
  });
});

describe("timeline validation", () => {
  const ok = (timeline: Timeline) => timelineError(timeline);

  it("accepts a scored schedule", () => {
    expect(
      ok({ ticks: 300000, snapshots: [1250, 2500, 75000, 150000, 300000] }),
    ).toBeNull();
  });

  it("catches a snapshot past the end", () => {
    expect(ok({ ticks: 1000, snapshots: [500, 2000] })).toMatch(/past the run/);
  });

  it("catches a schedule that does not ascend", () => {
    expect(ok({ ticks: 1000, snapshots: [500, 500] })).toMatch(/ascend/);
  });

  it("catches an empty schedule", () => {
    expect(ok({ ticks: 1000, snapshots: [] })).toMatch(/at least one snapshot/);
  });
});

describe("belt tier labels", () => {
  it("states each tier's speed and how long a tile takes", () => {
    expect(beltTierLabel("slow")).toBe("slow — 32 u/tick, 8 ticks/tile");
    expect(beltTierLabel("fast")).toBe("fast — 64 u/tick, 4 ticks/tile");
    expect(beltTierLabel("express")).toBe(
      "express — 96 u/tick, ~2.7 ticks/tile",
    );
  });
});

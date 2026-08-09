import { describe, expect, it } from "vitest";
import type { RunRecord } from "@test-cabinet/run-record";
import type { ReviewItem } from "../../../../client/types";
import {
  autoVerdictMap,
  overriddenAutoVerdictIds,
  type VerdictDraft,
} from "./autoVerdicts";

// A run whose validation decided three verdicts: a whole item, and both sub-items
// of a sub-divided one. Only the fields the helpers read are populated.
function run(
  verdicts: { id: string; pass: boolean }[] = [
    { id: "loop", pass: true },
    { id: "controls.kb", pass: false },
    { id: "controls.mouse", pass: true },
  ],
): RunRecord {
  return {
    validation: {
      debugScripts: [
        {
          verdicts: verdicts.map((v) => ({ ...v, assertions: [] })),
        },
      ],
    },
  } as unknown as RunRecord;
}

const items: ReviewItem[] = [
  { id: "loop", title: "Has a game loop", text: "", weight: 2 },
  {
    id: "controls",
    title: "Controls work",
    text: "",
    weight: 3,
    subItems: [
      { id: "kb", title: "Keyboard" },
      { id: "mouse", title: "Mouse" },
    ],
  },
  // Subjective: validation decides nothing here.
  { id: "feel", title: "Feels good to play", text: "", weight: 1 },
];

function drafts(
  statuses: Record<string, VerdictDraft["status"]>,
): Record<string, VerdictDraft> {
  const out: Record<string, VerdictDraft> = {};
  for (const [id, status] of Object.entries(statuses))
    out[id] = { status, note: "" };
  return out;
}

describe("autoVerdictMap", () => {
  it("keys each script verdict by its verdict id, with no note", () => {
    const map = autoVerdictMap(run());
    expect(map.get("loop")).toEqual({ status: "pass", note: "" });
    expect(map.get("controls.kb")).toEqual({ status: "fail", note: "" });
    expect(map.get("controls.mouse")).toEqual({ status: "pass", note: "" });
    expect(map.size).toBe(3);
  });

  it("is empty for a run with no automated validation", () => {
    expect(
      autoVerdictMap({ validation: {} } as unknown as RunRecord).size,
    ).toBe(0);
  });
});

describe("overriddenAutoVerdictIds", () => {
  const auto = autoVerdictMap(run());

  it("reports nothing when every answer matches what validation decided", () => {
    const verdicts = drafts({
      loop: "pass",
      "controls.kb": "fail",
      "controls.mouse": "pass",
      feel: "pass",
    });
    expect(overriddenAutoVerdictIds(items, auto, verdicts)).toEqual([]);
  });

  it("reports the points the reviewer answered differently", () => {
    const verdicts = drafts({
      loop: "fail",
      "controls.kb": "pass",
      "controls.mouse": "pass",
      feel: "fail",
    });
    expect(overriddenAutoVerdictIds(items, auto, verdicts)).toEqual([
      "loop",
      "controls.kb",
    ]);
  });

  it("counts an unanswered point as overriding its automated verdict", () => {
    const verdicts = drafts({
      "controls.kb": "fail",
      "controls.mouse": "pass",
    });
    expect(overriddenAutoVerdictIds(items, auto, verdicts)).toEqual(["loop"]);
  });

  it("never reports a point validation left to the reviewer", () => {
    // `feel` carries no automated verdict, so no answer to it can be an override —
    // there is nothing to restore it to.
    const verdicts = drafts({
      loop: "pass",
      "controls.kb": "fail",
      "controls.mouse": "pass",
      feel: "fail",
    });
    expect(overriddenAutoVerdictIds(items, auto, verdicts)).toEqual([]);
  });

  it("ignores an automated verdict for a point the case no longer declares", () => {
    const stale = autoVerdictMap(run([{ id: "retired-item", pass: true }]));
    expect(overriddenAutoVerdictIds(items, stale, {})).toEqual([]);
  });

  it("does not treat a reviewer's note as an override", () => {
    const verdicts: Record<string, VerdictDraft> = {
      loop: { status: "pass", note: "barely, but it loops" },
      "controls.kb": { status: "fail", note: "" },
      "controls.mouse": { status: "pass", note: "" },
    };
    expect(overriddenAutoVerdictIds(items, auto, verdicts)).toEqual([]);
  });
});

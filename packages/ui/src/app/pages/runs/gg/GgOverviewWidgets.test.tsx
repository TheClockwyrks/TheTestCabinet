// The Errors widget, which is the only place a gg run's failed CALLS are read.
//
// The turn record it leads with has been on the page since the error fold existed. What is
// pinned here is the second reading below it, and every one of these assertions is about a
// distinction that looks fine on screen when it is wrong:
//
//   - the two rankings count different populations (turns, then calls) against different
//     denominators, so a widget that merged them, or that let one of them stand in for the
//     other when it had nothing to show, would report a number nobody could state the
//     meaning of;
//   - a call that failed inside a program that carried on is NOT an errored turn, so
//     "no errors to rank" over a long call ranking is a correct reading rather than a
//     contradiction, and it has to be reachable;
//   - which of the two call records is shown depends on how the instance answered its
//     turns, and the caption has to name the one it drew from — a responses-as-code agent
//     is read on what its programs were thrown, a tool-calling agent on what gg dispatched,
//     and neither caption may read as the other.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorsWidget } from "./GgOverviewWidgets";
import { emptyErrorTally, type GgErrorTally } from "./useGgRunState";

/** A tally with the figures a case cares about, and the fold's own zeros elsewhere. */
function tally(over: Partial<GgErrorTally>): GgErrorTally {
  return { ...emptyErrorTally(), ...over };
}

/** The rendered ranking rows, as `label` → `count`, under one group caption. */
function rankingUnder(caption: string): Record<string, string> {
  // The caption and its list are siblings under the group, and the CSS modules these
  // components style with are stubbed under test — so the group is reached through the
  // caption's own parent rather than by class.
  const group = screen.getByText(caption).parentElement;
  expect(group).not.toBeNull();
  const rows: Record<string, string> = {};
  for (const row of Array.from(group?.querySelectorAll("li") ?? [])) {
    const cells = Array.from(row.children).map(
      (cell) => cell.textContent ?? "",
    );
    rows[cells[0] ?? ""] = cells[cells.length - 1] ?? "";
  }
  return rows;
}

describe("the Errors widget's failed-call ranking", () => {
  it("reads a responses-as-code instance on the calls its programs were thrown", () => {
    // The reading the whole feature exists for: this instance spent forty calls fighting
    // one `not-found`. The execution record beside it holds a different class entirely,
    // and showing that instead would answer a question nobody asked of this panel.
    render(
      <ErrorsWidget
        errors={tally({
          turns: 12,
          apiFailures: { "not-found": 40, unavailable: 3 },
          toolFailures: { "io-error": 5 },
        })}
        executionMode="responses_as_code"
      />,
    );

    expect(rankingUnder("Failed API calls")).toEqual({
      "not found": "40",
      unavailable: "3",
    });
    // Not "Failed calls": the two records are disjoint populations and neither is the
    // run's total, so the caption is the only thing that says what the figures counted.
    expect(screen.queryByText("Failed tool calls")).toBeNull();
    expect(screen.queryByText("I/O error")).toBeNull();
  });

  it("reads a tool-calling instance on what gg dispatched", () => {
    // It has no API surface at all, so there is nothing to choose between — but the
    // caption still names the record, because the same widget says something different
    // one panel over.
    render(
      <ErrorsWidget
        errors={tally({ turns: 4, toolFailures: { "invalid-argument": 2 } })}
        executionMode="tool_calling"
      />,
    );

    expect(rankingUnder("Failed tool calls")).toEqual({
      "invalid argument": "2",
    });
    expect(screen.queryByText("Failed API calls")).toBeNull();
  });

  it("falls back to the evidence for an instance that reported no surface", () => {
    // A scope read before its `agent_surface` arrived. Only a responses-as-code agent can
    // have recorded an API failure, so one that did is read as the surface it must have had
    // rather than as the execution record it also has.
    render(
      <ErrorsWidget
        errors={tally({
          turns: 2,
          apiFailures: { refused: 1 },
          toolFailures: { "not-found": 9 },
        })}
      />,
    );

    expect(rankingUnder("Failed API calls")).toEqual({ refused: "1" });
  });

  it("ranks failed calls on a scope whose turns all succeeded", () => {
    // The two populations, as far apart as they go: every turn carried out its declared
    // work, and the model still fought thirty calls to get there. A widget that gated the
    // call ranking on the turn record — or that folded these into it — would report a
    // clean instance.
    render(
      <ErrorsWidget
        errors={tally({
          turns: 30,
          errors: 0,
          apiFailures: { "not-found": 30 },
        })}
        executionMode="responses_as_code"
      />,
    );

    expect(screen.getByText("no errors to rank")).toBeInTheDocument();
    expect(rankingUnder("Failed API calls")).toEqual({ "not found": "30" });
  });

  it("names only the top three classes", () => {
    render(
      <ErrorsWidget
        errors={tally({
          turns: 9,
          toolFailures: {
            "not-found": 9,
            conflict: 7,
            "invalid-argument": 5,
            "io-error": 3,
          },
        })}
        executionMode="tool_calling"
      />,
    );

    expect(Object.keys(rankingUnder("Failed tool calls"))).toEqual([
      "not found",
      "conflict",
      "invalid argument",
    ]);
  });

  it("says nothing was recorded rather than that nothing failed", () => {
    // There is no count of CALLS in this tally, so an empty record is equally a scope whose
    // calls all succeeded and one that made none. The line says which of those it can
    // support: neither.
    render(
      <ErrorsWidget
        errors={tally({ turns: 3 })}
        executionMode="tool_calling"
      />,
    );

    expect(screen.getByText("no failed calls recorded")).toBeInTheDocument();
  });
});

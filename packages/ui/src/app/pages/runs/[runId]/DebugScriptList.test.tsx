import type { DebugScriptResult } from "@test-cabinet/run-record";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DebugScriptList } from "./DebugScriptList";

// A per-item driver result. `categoryTitle` is the review item that owns the
// script; `itemId` keys its category group.
function script(over: Partial<DebugScriptResult>): DebugScriptResult {
  return {
    itemId: "gameplay",
    subItemId: "scoring",
    title: "Scores when a ball crosses a goal",
    categoryTitle: "Gameplay",
    script: "validation/gameplay/scoring.mjs",
    ran: true,
    detail: null,
    verdicts: [
      {
        id: "gameplay.scoring",
        pass: true,
        assertions: [
          {
            label: "player one scores when the ball exits the right goal",
            pass: true,
          },
        ],
      },
    ],
    outputs: [],
    ...over,
  } as DebugScriptResult;
}

describe("DebugScriptList", () => {
  const scripts = [
    script({}),
    script({
      subItemId: "match-win",
      title: "Match win at 11, lead by 2",
      script: "validation/gameplay/match-win.mjs",
      ran: true,
      detail: "Ended at 11-9 but reported the wrong winner.",
      verdicts: [
        {
          id: "gameplay.match-win",
          pass: false,
          assertions: [
            { label: "match ends at 11-9", pass: true },
            { label: "winner is player one", pass: false },
          ],
        },
      ],
    }),
    script({
      itemId: "spin",
      subItemId: "stationary",
      title: "No spin from a stationary paddle",
      categoryTitle: "Spin",
      script: "validation/spin/stationary.mjs",
      ran: false,
      detail: "The debug handle was never installed.",
      verdicts: [],
    }),
  ];

  it("groups scripts into one table per category with Item / Path / Pass columns", () => {
    render(
      <DebugScriptList scripts={scripts} heading="Automated validation" />,
    );

    // One heading per category.
    expect(
      screen.getByRole("heading", { name: "Gameplay" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spin" })).toBeInTheDocument();

    // Column headers (one set per category table), no legacy "Ran"/"Detail".
    expect(screen.getAllByRole("columnheader", { name: "Item" })).toHaveLength(
      2,
    );
    expect(screen.getAllByRole("columnheader", { name: "Path" })).toHaveLength(
      2,
    );
    expect(screen.getAllByRole("columnheader", { name: "Pass" })).toHaveLength(
      2,
    );
    expect(screen.queryByRole("columnheader", { name: "Ran" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Detail" })).toBeNull();

    // The row title carries no "Category — " prefix, and the path shows in its column.
    expect(
      screen.getByRole("rowheader", {
        name: "Scores when a ball crosses a goal",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("validation/gameplay/scoring.mjs"),
    ).toBeInTheDocument();
  });

  // The outcome is a glyph, so it is addressed by its accessible name rather than
  // its text — the name is what carries "Pass" / "Fail" / "Did not run" now.
  it("shows Pass / Fail / Did not run per outcome", () => {
    render(<DebugScriptList scripts={scripts} />);
    const passRow = screen
      .getByRole("rowheader", { name: "Scores when a ball crosses a goal" })
      .closest("tr")!;
    expect(within(passRow).getByRole("img", { name: "Pass" })).toHaveTextContent(
      "✔",
    );

    const failRow = screen
      .getByRole("rowheader", { name: "Match win at 11, lead by 2" })
      .closest("tr")!;
    expect(within(failRow).getByRole("img", { name: "Fail" })).toHaveTextContent(
      "✘",
    );

    const notRunRow = screen
      .getByRole("rowheader", { name: "No spin from a stationary paddle" })
      .closest("tr")!;
    expect(
      within(notRunRow).getByRole("img", { name: "Did not run" }),
    ).toHaveTextContent("—");
  });

  it("expands a row on click to reveal its detail and verdict assertions", () => {
    render(<DebugScriptList scripts={scripts} />);
    const detail = "Ended at 11-9 but reported the wrong winner.";
    expect(screen.queryByText(detail)).toBeNull();

    const row = screen
      .getByRole("rowheader", { name: "Match win at 11, lead by 2" })
      .closest("tr")!;
    fireEvent.click(row);
    expect(screen.getByText(detail)).toBeInTheDocument();
    // Both the passing and the failing assertions show as proof.
    expect(screen.getByText("match ends at 11-9")).toBeInTheDocument();
    expect(screen.getByText("winner is player one")).toBeInTheDocument();

    // Clicking again collapses it.
    fireEvent.click(row);
    expect(screen.queryByText(detail)).toBeNull();
  });

  it("narrows to failed scripts when failedOnly is set", () => {
    render(<DebugScriptList scripts={scripts} failedOnly />);
    // Only the script that never ran remains; the passing one is gone.
    expect(screen.getByRole("heading", { name: "Spin" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Gameplay" })).toBeNull();
  });
});

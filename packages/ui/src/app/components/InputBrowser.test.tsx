import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InputBrowser, type InputBrowserGroup } from "./InputBrowser";

// A two-group tree plus one deliberately empty group, so the rail's grouping,
// counts, and empty-group omission are all exercised by one fixture.
function groups(): InputBrowserGroup[] {
  return [
    {
      label: "Specs",
      items: [
        {
          id: "spec:brief.md",
          label: "brief.md",
          tag: "Spec",
          render: () => <p>The brief.</p>,
        },
        {
          id: "spec:build.py",
          label: "build.py",
          tag: "Script",
          render: () => <p>The script.</p>,
        },
      ],
    },
    { label: "Workspace", items: [] },
    {
      label: "Reference",
      items: [
        {
          id: "reference:board",
          label: "reference/board.png",
          tag: "Reference",
          render: () => <p>The board.</p>,
        },
      ],
    },
  ];
}

describe("InputBrowser", () => {
  it("lists every item under its group heading with a count, omitting empty groups", () => {
    render(<InputBrowser groups={groups()} emptyLabel="Nothing here." />);

    // Populated groups head their items with the entry count beside the label…
    expect(screen.getByText("Specs")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Reference")).toBeInTheDocument();
    // …and a group with nothing in it is left out of the rail entirely.
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();

    // Every row is a real button named by its item label.
    expect(
      screen.getByRole("button", { name: "brief.md" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "build.py" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "reference/board.png" }),
    ).toBeInTheDocument();
  });

  it("selects the first item by default and stages only its body", () => {
    render(<InputBrowser groups={groups()} emptyLabel="Nothing here." />);

    expect(screen.getByRole("button", { name: "brief.md" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText("The brief.")).toBeInTheDocument();
    // The viewer header carries the selected item's tag chip.
    expect(screen.getByText("Spec")).toBeInTheDocument();
    // The other bodies are not rendered at all — that is what makes a body
    // fetching on mount naturally lazy.
    expect(screen.queryByText("The script.")).not.toBeInTheDocument();
    expect(screen.queryByText("The board.")).not.toBeInTheDocument();
  });

  it("starts on initialSelectedId when it names an item", () => {
    render(
      <InputBrowser
        groups={groups()}
        initialSelectedId="reference:board"
        emptyLabel="Nothing here."
      />,
    );

    expect(
      screen.getByRole("button", { name: "reference/board.png" }),
    ).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("The board.")).toBeInTheDocument();
    expect(screen.queryByText("The brief.")).not.toBeInTheDocument();
  });

  it("falls back to the first item when initialSelectedId names none", () => {
    render(
      <InputBrowser
        groups={groups()}
        initialSelectedId="spec:missing"
        emptyLabel="Nothing here."
      />,
    );

    expect(screen.getByRole("button", { name: "brief.md" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText("The brief.")).toBeInTheDocument();
  });

  it("swaps the stage to a clicked row", () => {
    render(<InputBrowser groups={groups()} emptyLabel="Nothing here." />);

    fireEvent.click(screen.getByRole("button", { name: "build.py" }));

    expect(screen.getByRole("button", { name: "build.py" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "brief.md" }),
    ).not.toHaveAttribute("aria-current");
    expect(screen.getByText("The script.")).toBeInTheDocument();
    expect(screen.queryByText("The brief.")).not.toBeInTheDocument();
  });

  it("shows the empty label when no group has any item", () => {
    render(
      <InputBrowser
        groups={[{ label: "Specs", items: [] }]}
        emptyLabel="Nothing here."
      />,
    );

    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

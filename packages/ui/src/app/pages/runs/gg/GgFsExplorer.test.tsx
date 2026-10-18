import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { FsExplorer, FsFileRow } from "./GgFsExplorer";

/** A two-file explorer whose detail pane names the selected file. */
function TwoFiles() {
  const [selected, setSelected] = useState("activity");
  return (
    <FsExplorer
      sidebarLabel="Agents"
      tree={["activity", "context"].map((name) => (
        <FsFileRow
          key={name}
          depth={0}
          name={name}
          ariaLabel={`root ${name}`}
          selected={selected === name}
          onSelect={() => setSelected(name)}
        />
      ))}
    >
      <p>showing {selected}</p>
    </FsExplorer>
  );
}

describe("FsExplorer", () => {
  it("names the selected file on the tree's toggle", () => {
    render(<TwoFiles />);
    const toggle = screen.getByRole("button", { name: /Agents/ });
    expect(toggle).toHaveTextContent("root activity");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The toggle controls the tree it folds away.
    const tree = screen.getByRole("navigation", { name: "Agents" });
    expect(toggle).toHaveAttribute("aria-controls", tree.id);
  });

  it("folds the tree away again once a file is chosen", () => {
    const { container } = render(<TwoFiles />);
    const toggle = screen.getByRole("button", { name: /Agents/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(container.firstElementChild).toHaveAttribute("data-tree-open");

    fireEvent.click(screen.getByRole("button", { name: "root context" }));
    expect(screen.getByText("showing context")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(container.firstElementChild).not.toHaveAttribute("data-tree-open");
    expect(toggle).toHaveTextContent("root context");
  });
});

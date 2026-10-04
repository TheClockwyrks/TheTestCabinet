import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  useResizableColumns,
  type ResizableColumn,
} from "./useResizableColumns";

const COLUMNS: ResizableColumn[] = [
  { id: "caret", default: "1.2rem", min: 20, resizable: false },
  { id: "name", default: "1fr", min: 96 },
  { id: "size", default: "5rem", min: 56 },
];

function Table({ storageKey }: { storageKey: string }) {
  const { containerRef } = useResizableColumns({
    storageKey,
    columns: COLUMNS,
  });
  return <div ref={containerRef} data-testid="table" />;
}

describe("useResizableColumns", () => {
  beforeEach(() => localStorage.clear());

  it("floors a flexible track at its min and keeps a fixed track as is", () => {
    const { getByTestId } = render(<Table storageKey="t:widths" />);
    expect(getByTestId("table").style.getPropertyValue("--ttc-cols")).toBe(
      "1.2rem minmax(96px, 1fr) 5rem",
    );
  });

  it("uses a pinned width in place of the default", () => {
    localStorage.setItem("t:widths", JSON.stringify({ name: 240 }));
    const { getByTestId } = render(<Table storageKey="t:widths" />);
    expect(getByTestId("table").style.getPropertyValue("--ttc-cols")).toBe(
      "1.2rem 240px 5rem",
    );
  });
});

// The field browser.
//
// *Not polish.* A text language shows an operator nothing about the corpus, so without a
// browser listing what is actually in it the redesign is a downgrade for the first five
// minutes of use — and it is the surface where a **sparse** field becomes visible rather
// than inferred from an empty result.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GgFieldCatalog } from "@clockwyrks/run-record/gg-query";
import { GgFieldSidebar } from "./GgFieldSidebar";

const CATALOG: GgFieldCatalog = {
  documents: 400,
  fields: [
    { name: "case", kind: "string", documents: 400, topValues: [{ value: "carom", count: 400 }] },
    {
      name: "cap.compaction",
      kind: "boolean",
      documents: 400,
      topValues: [
        { value: true, count: 240 },
        { value: false, count: 160 },
      ],
    },
    { name: "cap.compaction.summaryHeadroom", kind: "number", documents: 240 },
    { name: "cap.speculative-execution", kind: "boolean", documents: 400 },
    { name: "metric.cost", kind: "number", documents: 380 },
    // Sparse on purpose: the tool universe is per-run, so there is no honest closed
    // catalog to write `false` over.
    { name: "tool.editFile", kind: "boolean", documents: 12 },
  ],
};

function mount(onInsert = vi.fn()) {
  render(<GgFieldSidebar catalog={CATALOG} onInsert={onInsert} />);
  return onInsert;
}

/** The row a field's name button sits in. */
function fieldRow(name: string): HTMLElement {
  return screen.getByRole("button", { name }).closest("li") as HTMLElement;
}

describe("what it shows", () => {
  it("shows every field's document count, sparse ones included", () => {
    // 12 of 400 is the number that stops "never offered this tool" from looking like a
    // broken query.
    mount();
    expect(within(fieldRow("tool.editFile")).getByText("12")).toBeInTheDocument();
    expect(within(fieldRow("metric.cost")).getByText("380")).toBeInTheDocument();
    expect(screen.getByText("400 runs")).toBeInTheDocument();
  });

  it("shows each field's kind, so a number is not mistaken for a label", () => {
    mount();
    expect(within(fieldRow("metric.cost")).getByText("number")).toBeInTheDocument();
    expect(within(fieldRow("cap.compaction")).getByText("boolean")).toBeInTheDocument();
  });

  it("groups by namespace, run-level fields first", () => {
    mount();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe("Run");
    expect(headings).toContain("Capabilities");
    expect(headings).toContain("Tools");
  });
});

describe("finding a field", () => {
  it("filters on the whole dotted name, so a capability's params are reachable", () => {
    // The params are exactly the fields nobody knows exist — `cap.compaction` is
    // guessable, `cap.compaction.summaryHeadroom` is not.
    mount();
    fireEvent.change(screen.getByLabelText("Filter fields"), {
      target: { value: "headroom" },
    });
    expect(screen.getByRole("button", { name: "cap.compaction.summaryHeadroom" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "metric.cost" })).not.toBeInTheDocument();
  });

  it("says so when nothing matches", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Filter fields"), {
      target: { value: "nothing-like-this" },
    });
    expect(screen.getByText("No field matches that.")).toBeInTheDocument();
  });
});

describe("click to insert", () => {
  it("inserts the field name, quoting only the segments that need it", () => {
    const onInsert = mount();
    fireEvent.click(screen.getByRole("button", { name: "cap.compaction" }));
    expect(onInsert).toHaveBeenCalledWith("cap.compaction");
  });

  it("inserts a whole predicate when an observed value is picked", () => {
    // A value is only ever interesting as a filter on the field it came from.
    const onInsert = mount();
    fireEvent.click(screen.getByRole("button", { name: "Show values of cap.compaction" }));
    fireEvent.click(screen.getByRole("button", { name: /^false/ }));
    expect(onInsert).toHaveBeenCalledWith("cap.compaction:false");
  });

  it("shows both values of a total capability field, with their counts", () => {
    // `cap.*` is total: an explicit `false` is stored for every capability a run did not
    // enable, which is what makes `avg(cap.compaction)` an honest enablement rate — and
    // what an operator has to be able to *see* to trust it.
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Show values of cap.compaction" }));
    const values = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
      .filter((text) => /^(true|false)\d/.test(text));
    expect(values).toEqual(["true240", "false160"]);
  });
});

// The query editor.
//
// These are the assertions the whole step turns on. Replacing a widget builder with a text
// box is a **discoverability regression** unless the box teaches the language while it is
// being typed in, so what is asserted here is not that the component renders — it is that
// an operator who has never seen TCQ can find a capability field, see how many runs carry
// it, and discover that a capability a run never mentioned still stores `false`.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  GgFieldCatalog,
  GgInterval,
} from "@test-cabinet/run-record/gg-query";
import { parseQuery } from "../query";
import { QueryEditor } from "./QueryEditor";

/** A small corpus catalog: two **total** capability fields (so both `true` and `false` are
 *  observed), one deliberately sparse tool field, and a couple of ordinary ones. */
const CATALOG: GgFieldCatalog = {
  documents: 400,
  fields: [
    {
      name: "cap.compaction",
      kind: "boolean",
      documents: 400,
      topValues: [
        { value: true, count: 240 },
        { value: false, count: 160 },
      ],
    },
    {
      name: "cap.subagents",
      kind: "boolean",
      documents: 400,
      topValues: [
        { value: true, count: 90 },
        { value: false, count: 310 },
      ],
    },
    {
      name: "model",
      kind: "string",
      documents: 400,
      topValues: [{ value: "anthropic/claude-a", count: 300 }],
    },
    { name: "started", kind: "date", documents: 400 },
    {
      name: "tool.editFile",
      kind: "boolean",
      documents: 12,
      topValues: [{ value: true, count: 12 }],
    },
  ],
};

const DAY: GgInterval = { count: 1, unit: "day" };

/** Mount the editor around a controlled value, and expose the last text it asked for. */
function mount(initial = "", onSubmit = vi.fn()) {
  let text = initial;
  const onChange = vi.fn((next: string) => {
    text = next;
  });
  const view = render(
    <QueryEditor
      value={initial}
      onChange={onChange}
      onSubmit={onSubmit}
      parse={parseQuery(initial)}
      catalog={CATALOG}
      interval={DAY}
    />,
  );
  const rerender = (next: string) =>
    view.rerender(
      <QueryEditor
        value={next}
        onChange={onChange}
        onSubmit={onSubmit}
        parse={parseQuery(next)}
        catalog={CATALOG}
        interval={DAY}
      />,
    );
  return { onChange, onSubmit, rerender, text: () => text };
}

/** Type `value` into the editor and let the caret land at its end. */
function type(value: string) {
  const box = screen.getByRole("combobox", {
    name: "Query",
  }) as HTMLTextAreaElement;
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value, selectionStart: value.length } });
  return box;
}

/** The suggestion rows currently offered, as `label` / `count` pairs. */
function suggestions(): Array<{ label: string; count: string | null }> {
  return screen.queryAllByRole("option").map((option) => {
    const parts = within(option)
      .getAllByText(/.+/)
      .map((node) => node.textContent ?? "");
    return { label: parts[0] ?? "", count: parts[parts.length - 1] ?? null };
  });
}

describe("field discovery", () => {
  it("suggests the capability fields with their document counts", () => {
    // The headline: `cap.` is how an operator finds out which capabilities the corpus
    // even has, and the counts are how they find out how much of it carries them.
    const editor = mount();
    type("cap.");
    editor.rerender("cap.");
    const offered = suggestions();
    expect(offered.map((s) => s.label)).toEqual([
      "cap.compaction",
      "cap.subagents",
    ]);
    expect(offered.map((s) => s.count)).toEqual(["400", "400"]);
  });

  it("shows the count that makes a sparse field visible before it is queried", () => {
    // `tool.*` is deliberately sparse — there is no honest closed catalog to write `false`
    // over — so "12 of 400" is the only thing standing between an operator and an empty
    // result they cannot explain.
    const editor = mount();
    type("tool");
    editor.rerender("tool");
    const tool = suggestions().find((s) => s.label === "tool.editFile");
    expect(tool).toBeDefined();
    expect(tool?.count).toBe("12");
  });
});

describe("value discovery", () => {
  it("offers both true and false for a total capability field, with non-zero counts", () => {
    // The `cap.*` namespace is total: the document builder writes an explicit `false` for
    // every capability a run did not enable. A completer that only offered values observed
    // as `true` would hide exactly the half a query comparing two configurations is looking
    // for — and the counts prove the `false` half is real data rather than an offered guess.
    const editor = mount();
    type("cap.compaction:");
    editor.rerender("cap.compaction:");
    const offered = suggestions();
    expect(offered.map((s) => s.label)).toEqual(["true", "false"]);
    expect(offered.map((s) => s.count)).toEqual(["240", "160"]);
    for (const value of offered) {
      expect(Number(value.count)).toBeGreaterThan(0);
    }
  });
});

describe("accepting a suggestion", () => {
  it("replaces the partial word rather than appending to it", () => {
    const editor = mount();
    type("cap.comp");
    editor.rerender("cap.comp");
    fireEvent.mouseDown(screen.getAllByRole("option")[0]!);
    expect(editor.text()).toBe("cap.compaction");
  });

  it("takes the highlighted suggestion on Enter, and runs the query otherwise", () => {
    const editor = mount();
    const box = type("cap.comp");
    editor.rerender("cap.comp");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(editor.text()).toBe("cap.compaction");
    expect(editor.onSubmit).not.toHaveBeenCalled();

    // With the popup closed, Enter is what runs it — a newline is never meaningful in a
    // one-line language.
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(editor.onSubmit).toHaveBeenCalled();
  });

  it("moves the highlight with the arrow keys", () => {
    const editor = mount();
    const box = type("cap.");
    editor.rerender("cap.");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(editor.text()).toBe("cap.subagents");
  });
});

describe("live validation", () => {
  it("reports what it could not read, without refusing to run", () => {
    const editor = mount('model:"unterminated');
    // The parser is error-tolerant by design, so the surface stays usable: the message is
    // listed, and the Run control is not disabled.
    expect(screen.getByText(/Unterminated string/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(editor.onSubmit).toHaveBeenCalled();
  });

  it("says nothing about a query that parses", () => {
    mount("not state:completed | stats count() by preset");
    expect(
      screen.queryByText(/Unexpected|Unterminated/),
    ).not.toBeInTheDocument();
  });
});

describe("the example menu", () => {
  it("shows worked queries and inserts the one that is picked", () => {
    // The question autocomplete cannot answer: what does a whole query look like?
    const editor = mount();
    fireEvent.click(screen.getByRole("button", { name: "Examples" }));
    const example = screen.getByText(
      "Context overflow with compaction off, per model",
    );
    fireEvent.click(example);
    expect(editor.text()).toContain("cap.compaction:false");
    expect(editor.text()).toContain("| stats avg(summary.ranOutOfContext)");
  });

  it("buckets its histogram example at the range's own interval", () => {
    // There is no `auto` interval anywhere in TCQ — it has no representation in a compiled
    // query — so the range's explicit interval is what the example carries.
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Examples" }));
    expect(
      screen.getByText("| stats count() by bucket(started, 1d)"),
    ).toBeInTheDocument();
  });

  it("offers only queries that parse", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Examples" }));
    for (const code of screen.getAllByText(/^(\||[a-z])/)) {
      if (!code.textContent || code.tagName !== "CODE") continue;
      expect(parseQuery(code.textContent).diagnostics).toEqual([]);
    }
  });
});

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PromptHeader } from "./PromptHeader";

// The header every top-level page renders, and the two slots a page hangs its controls
// in. Both are structural rather than cosmetic: a page that lays its own row around the
// header instead gets a header whose second line is only as wide as the column that row
// gave it, which is what pushed the runs section's stop cluster onto a row of its own.
// So the contract is that the header owns both of its rows, and this is what says so.

function renderHeader(props: Partial<Parameters<typeof PromptHeader>[0]> = {}) {
  render(
    <PromptHeader
      command="--runs"
      comment={<>// every result the cabinet has produced</>}
      {...props}
    />,
  );
  return screen.getByText("// every result the cabinet has produced");
}

describe("PromptHeader", () => {
  it("puts the page's own actions on the prompt line", () => {
    const comment = renderHeader({
      titleActions: <button type="button">+ New run</button>,
    });
    const header = comment.closest("header")!;
    const action = screen.getByRole("button", { name: "+ New run" });
    // The prompt and the actions are one row, and that row is the header's own child —
    // so the row runs the full width of the page rather than a column of it.
    const titleRow = action.parentElement!.parentElement!;
    expect(titleRow.parentElement).toBe(header);
    expect(titleRow).toHaveTextContent("the-test-cabinet --runs");
    // The comment is still a row of its own beneath it.
    expect(comment.parentElement).toBe(header);
  });

  it("puts trailing controls on the comment line, beside the comment", () => {
    const comment = renderHeader({
      actions: <button type="button">Clear pending</button>,
    });
    const header = comment.closest("header")!;
    const action = screen.getByRole("button", { name: "Clear pending" });
    const commentRow = comment.parentElement!;
    expect(commentRow.parentElement).toBe(header);
    expect(within(commentRow).getByRole("button")).toBe(action);
  });

  it("carries both rows at once, each the header's own child", () => {
    const comment = renderHeader({
      titleActions: <button type="button">+ New run</button>,
      actions: <button type="button">Clear pending</button>,
    });
    const header = comment.closest("header")!;
    expect(header.children).toHaveLength(2);
    // The two clusters end on the same edge, which is the whole point of the header
    // owning both rows: they are laid out by the same element at the same width.
    const title = screen.getByRole("button", { name: "+ New run" });
    const stop = screen.getByRole("button", { name: "Clear pending" });
    expect(title.parentElement!.parentElement!.parentElement).toBe(header);
    expect(stop.parentElement!.parentElement!.parentElement).toBe(header);
  });

  it("wraps nothing around a row it has no controls for", () => {
    // A header given neither slot is the prompt and the comment, straight in it: an
    // empty flex wrapper around either would still lay that row out for a cluster that
    // never arrives.
    const comment = renderHeader();
    const header = comment.closest("header")!;
    expect(comment.parentElement).toBe(header);
    expect(header.children).toHaveLength(2);
    expect(header.firstElementChild?.tagName).toBe("P");
    expect(header.lastElementChild?.tagName).toBe("P");
  });
});

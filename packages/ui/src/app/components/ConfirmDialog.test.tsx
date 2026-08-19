import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfirmDialogProvider, useConfirm } from "./ConfirmDialog";
import type { ConfirmOptions } from "./ConfirmDialog";

// A button that asks the given question and records the answer, so a test can
// drive the whole promise round-trip the way a real destructive control does.
function Asker({ options }: { options: ConfirmOptions }) {
  const { confirm } = useConfirm();
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const answer = await confirm(options);
          document.title = answer ? "confirmed" : "canceled";
        }}
      >
        Act
      </button>
      <input aria-label="behind" />
    </>
  );
}

function ask(options: ConfirmOptions) {
  document.title = "unanswered";
  render(
    <ConfirmDialogProvider>
      <Asker options={options} />
    </ConfirmDialogProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Act" }));
}

const QUESTION: ConfirmOptions = {
  title: "Delete run",
  message: "This cannot be undone.",
  confirmLabel: "Delete run",
};

describe("ConfirmDialogProvider", () => {
  it("raises a themed modal instead of the browser's own dialog", async () => {
    ask(QUESTION);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Delete run");
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("resolves true when the affirmative is taken, and closes", async () => {
    ask(QUESTION);
    fireEvent.click(await screen.findByRole("button", { name: "Delete run" }));
    await waitFor(() => expect(document.title).toBe("confirmed"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves false on Cancel", async () => {
    ask(QUESTION);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.title).toBe("canceled"));
  });

  it("resolves false on Escape", async () => {
    ask(QUESTION);
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.title).toBe("canceled"));
  });

  it("opens focused on the safe answer, so Enter cannot confirm by accident", async () => {
    ask(QUESTION);
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("renders the caller's detail of what the action would change", async () => {
    ask({
      ...QUESTION,
      details: (
        <ul>
          <li>Has a game loop — Fail → Pass</li>
          <li>Controls work › Keyboard — Pass → Fail</li>
        </ul>
      ),
    });
    await screen.findByRole("dialog");
    expect(
      screen.getByText("Has a game loop — Fail → Pass"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Controls work › Keyboard — Pass → Fail"),
    ).toBeInTheDocument();
  });

  it("stops the page behind scrolling while it is open, and restores it after", async () => {
    ask(QUESTION);
    await screen.findByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(document.body.style.overflow).not.toBe("hidden"),
    );
  });
});

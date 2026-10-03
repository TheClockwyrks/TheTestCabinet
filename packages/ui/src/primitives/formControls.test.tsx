import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, buttonClass } from "./Button";
import { ControlRow } from "./ControlRow";
import { Input } from "./Input";
import { Select } from "./Select";
import { Textarea } from "./Textarea";

describe("form primitives", () => {
  it("Input carries the caller's class beside its own and marks an invalid value", () => {
    render(<Input aria-label="Name" className="mine" invalid />);
    const input = screen.getByLabelText("Name");
    expect(input).toHaveClass("mine");
    expect(input.className.split(" ").length).toBeGreaterThan(1);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("Input leaves a valid value unmarked", () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });

  it("Textarea and Select render their native elements with the caller's props", () => {
    render(
      <>
        <Textarea aria-label="Notes" rows={2} invalid />
        <Select aria-label="Kind" defaultValue="b">
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>
      </>,
    );
    const notes = screen.getByLabelText("Notes");
    expect(notes.tagName).toBe("TEXTAREA");
    expect(notes).toHaveAttribute("rows", "2");
    expect(notes).toHaveAttribute("aria-invalid", "true");
    const kind = screen.getByLabelText("Kind");
    expect(kind.tagName).toBe("SELECT");
    expect(kind).toHaveValue("b");
  });

  // A button inside a form submits it unless it says otherwise, and most of a
  // form's buttons (fetch, add a row, remove) must not.
  it("Button is type=button unless told otherwise", () => {
    render(
      <>
        <Button>Plain</Button>
        <Button type="submit">Save</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Plain" })).toHaveAttribute(
      "type",
      "button",
    );
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("Button wears the classes buttonClass gives a link of the same variant", () => {
    render(
      <>
        <Button variant="danger" size="small" className="mine">
          Delete
        </Button>
        <a href="/x" className={buttonClass("danger", "small", "mine")}>
          Delete link
        </a>
      </>,
    );
    expect(screen.getByRole("button", { name: "Delete" }).className).toBe(
      screen.getByRole("link", { name: "Delete link" }).className,
    );
  });

  it("ControlRow is a div carrying the caller's class", () => {
    render(
      <ControlRow className="mine" data-testid="row">
        <Input aria-label="URL" />
        <Button>Fetch</Button>
      </ControlRow>,
    );
    const row = screen.getByTestId("row");
    expect(row.tagName).toBe("DIV");
    expect(row).toHaveClass("mine");
    expect(row.children).toHaveLength(2);
  });
});

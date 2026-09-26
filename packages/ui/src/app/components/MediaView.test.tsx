import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MediaView } from "./MediaView";

/**
 * How a piece of reference or proof media is put on screen.
 *
 * The property under test is the second look at a picture. A produced image is
 * immutable and the browser already holds its bytes, so returning to a view that
 * shows it — and every tab of a run's detail page is its own route, so returning
 * means remounting — must put it back up immediately. `loading="lazy"` is right the
 * first time a long page of references scrolls past and wrong on the way back:
 * deferring a picture already in hand shows the reviewer an empty box while an
 * intersection observer catches up.
 */

const PICTURE = "https://example.test/runs/r1/proof/frame-01.png";

describe("showing a picture", () => {
  it("defers a picture the session has not shown before", () => {
    render(<MediaView kind="image" url={PICTURE} alt="Frame 1" />);
    const image = screen.getByAltText("Frame 1");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
  });

  it("shows a picture it has already painted immediately, on remount", () => {
    const first = render(
      <MediaView kind="image" url={PICTURE} alt="Frame 1" />,
    );
    // The browser reports the picture as loaded, which is what this remembers.
    fireEvent.load(screen.getByAltText("Frame 1"));
    first.unmount();

    render(<MediaView kind="image" url={PICTURE} alt="Frame 1" />);
    const again = screen.getByAltText("Frame 1");
    expect(again).toHaveAttribute("loading", "eager");
    expect(again).toHaveAttribute("decoding", "sync");
  });

  it("still defers a picture it has never painted", () => {
    render(
      <MediaView
        kind="image"
        url="https://example.test/runs/r1/proof/frame-99.png"
        alt="Frame 99"
      />,
    );
    expect(screen.getByAltText("Frame 99")).toHaveAttribute("loading", "lazy");
  });

  it("says so for a kind this build does not know", () => {
    render(
      <MediaView
        kind={"hologram" as never}
        url={PICTURE}
        alt="Something new"
      />,
    );
    expect(screen.getByText(/cannot show hologram media/)).toBeInTheDocument();
  });
});

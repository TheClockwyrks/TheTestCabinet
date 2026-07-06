import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AudioResultView } from "../../../data/galleryContext";
import { AudioResultSection } from "./AudioResultSection";

function view(overrides: Partial<AudioResultView> = {}): AudioResultView {
  return {
    clipUrl: "clip.wav",
    midiUrl: null,
    previewUrl: "preview.png",
    sampleRate: 44100,
    channels: 2,
    durationMs: 1500,
    detail: null,
    ...overrides,
  };
}

describe("AudioResultSection", () => {
  it("plays the clip and shows the waveform preview and format", () => {
    render(<AudioResultSection view={view()} />);
    const audio = screen.getByLabelText("Audio clip") as HTMLAudioElement;
    expect(audio).toHaveAttribute("src", "clip.wav");
    expect(screen.getByAltText("Waveform and spectrogram")).toHaveAttribute(
      "src",
      "preview.png",
    );
    expect(screen.getByText(/44.1 kHz/)).toBeInTheDocument();
    expect(screen.getByText(/stereo/)).toBeInTheDocument();
  });

  it("surfaces the MIDI score only for a music run", () => {
    const { rerender } = render(<AudioResultSection view={view()} />);
    expect(screen.queryByRole("link", { name: "clip.mid" })).toBeNull();
    rerender(<AudioResultSection view={view({ midiUrl: "score.mid" })} />);
    expect(
      screen.getByRole("link", { name: "clip.mid" }),
    ).toHaveAttribute("href", "score.mid");
  });

  it("notes when the clip could not be served", () => {
    render(<AudioResultSection view={view({ clipUrl: null })} />);
    expect(screen.queryByLabelText("Audio clip")).toBeNull();
    expect(screen.getByText(/could not be served/)).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SuiteAssetPreview } from "./suite-asset-preview";
import { previewedFiles } from "../data/suite-asset-files";

/**
 * How a test suite's bundled asset is played.
 *
 * The property under test is the resolution from a manifest's declared file list
 * to the viewer that covers it, because that is the whole of what this component
 * adds to the viewers themselves: a picture is staged as a picture, a score as
 * something to listen to, and a file no viewer covers is not staged at all — the
 * surface around it lists it instead, and it needs to be told when.
 */

const url = (file: string) => `/api/files/assets/thing/${file}`;

describe("resolving a kind's files to its viewer", () => {
  it("stages a sprite's declared images", () => {
    render(
      <SuiteAssetPreview
        kind="sprite"
        name="Player Ship"
        files={["player-ship.png", "notes.txt"]}
        urlFor={url}
      />,
    );

    expect(
      screen.getByAltText("Player Ship — player-ship.png"),
    ).toHaveAttribute("src", "/api/files/assets/thing/player-ship.png");
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("stages a score as something to listen to", () => {
    render(
      <SuiteAssetPreview
        kind="music"
        name="Theme"
        files={["theme.wav"]}
        urlFor={url}
      />,
    );

    const audio = screen.getByLabelText("Theme — theme.wav");
    expect(audio).toHaveAttribute("src", "/api/files/assets/thing/theme.wav");
    expect(audio).toHaveAttribute("controls");
  });

  it("stages nothing for files no viewer covers", () => {
    const { container } = render(
      <SuiteAssetPreview
        kind="blender"
        name="Table"
        files={["table.py"]}
        urlFor={url}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(previewedFiles("blender", ["table.py"])).toEqual([]);
  });

  it("stages nothing for a declared file the folder does not hold", () => {
    const { container } = render(
      <SuiteAssetPreview
        kind="sprite"
        name="Player Ship"
        files={["player-ship.png"]}
        urlFor={() => null}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("covers each kind by the files its runtime reads", () => {
    expect(previewedFiles("sprite-sheet", ["walk.png"])).toEqual(["walk.png"]);
    expect(previewedFiles("voxel", ["mesh.glb", "voxels.json"])).toEqual([
      "mesh.glb",
    ]);
    expect(previewedFiles("blender", ["character.glb"])).toEqual([
      "character.glb",
    ]);
    expect(previewedFiles("particle", ["system.json"])).toEqual([
      "system.json",
    ]);
    expect(previewedFiles("audio-fx", ["bounce.wav"])).toEqual(["bounce.wav"]);
  });
});

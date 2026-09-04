// One 3D recording, drawn at one frame.
//
// Default export so it can be `React.lazy`-loaded — `three`, the glTF loader
// and the scene drawer then land in their own chunk instead of the entry
// bundle, and a run page whose replays are all 2D never fetches it. The
// pattern, and the reason for it, is `[runId]/VoxelViewer.tsx`'s.
//
// Two canvases in one box: the WebGL one carries the 3D picture, and a 2D one
// over it carries the HUD. They are the same size and the same box, so a HUD
// draw lands exactly where the build put it, and keeping them apart leaves the
// WebGL canvas readable as the 3D picture alone.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { drawFrame3d, type Replay3dResources } from "./drawFrame3d";
import type { Recording3d } from "./format3d";
import { ThreeSceneDrawer } from "./threeSceneDrawer";
import styles from "./ReplayPlayer.module.scss";

/** What a browser that will not give the player a 3D surface is told. */
const NO_CONTEXT =
  "This browser did not give the player a WebGL2 context to draw into.";

/** What a browser that took the context away again is told. */
const CONTEXT_LOST =
  "This browser took the player's WebGL2 context away, so this frame is not drawn.";

/** The renderer and drawer held for one canvas, rebuilt when the canvas changes. */
interface Held {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly drawer: ThreeSceneDrawer;
}

export default function Replay3dCanvas({
  recording,
  resources,
  frame,
  label,
}: {
  recording: Recording3d;
  /** What `prepareRecording3d` returned for THIS recording. */
  resources: Replay3dResources;
  frame: number;
  /** Accessible label for the canvas (what is being replayed). */
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const heldRef = useRef<Held | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const shown = Math.max(0, Math.min(frame, recording.frames.length - 1));

  // Freeing the renderer is the unmount's job rather than the draw's: a run
  // page mounts a pane per output, and a WebGL context left behind is one of
  // the handful a browser will give the tab at all.
  useEffect(() => {
    return () => {
      heldRef.current?.drawer.dispose();
      heldRef.current?.renderer.dispose();
      heldRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const onLost = (event: Event): void => {
      // Preventing the default is what lets the browser hand a restored
      // context back; the held renderer is dropped so the next frame builds
      // one against whatever the canvas has then.
      event.preventDefault();
      heldRef.current = null;
      setLost(true);
    };
    const onRestored = (): void => setLost(false);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const shot = recording.frames[shown];
    if (shot === undefined) return;
    if (lost) {
      setNote(CONTEXT_LOST);
      return;
    }
    // A recording taken before the canvas was ever laid out carries a
    // zero-sized surface; the logical design size is the only other size it
    // states, and `drawFrame3d` letterboxes against the same fallback.
    const width = shot.surface.width > 0 ? shot.surface.width : recording.width;
    const height =
      shot.surface.height > 0 ? shot.surface.height : recording.height;

    const hudCanvas = hudRef.current;
    if (hudCanvas !== null) {
      if (hudCanvas.width !== width) hudCanvas.width = width;
      if (hudCanvas.height !== height) hudCanvas.height = height;
    }

    let held = heldRef.current;
    if (held === null || held.canvas !== canvas) {
      held?.drawer.dispose();
      held?.renderer.dispose();
      const context = canvas.getContext("webgl2", {
        alpha: true,
        antialias: true,
        // A reviewer's screenshot of the pane, and any read-back, wants the
        // frame still there after the browser has composited it.
        preserveDrawingBuffer: true,
      });
      if (context === null) {
        heldRef.current = null;
        setNote(NO_CONTEXT);
        return;
      }
      const renderer = new THREE.WebGLRenderer({ canvas, context });
      // The backing store is sized from the recording, never from the device
      // pixel ratio: the operations are in the recorded surface's pixels.
      renderer.setPixelRatio(1);
      // One drawer for the canvas's whole life, not one per frame: it holds
      // the GPU objects the frame it drew made, and frees them when the next
      // frame opens.
      held = {
        canvas,
        renderer,
        drawer: new ThreeSceneDrawer({
          renderer,
          hud: hudCanvas?.getContext("2d") ?? null,
        }),
      };
      heldRef.current = held;
    }

    // Assigning either dimension reallocates and clears, so it is done only
    // when the size actually changed.
    if (canvas.width !== width || canvas.height !== height) {
      held.renderer.setSize(width, height, false);
    }

    const report = drawFrame3d(held.drawer, recording, resources, shown);
    setNote(
      report.skipped === 0
        ? null
        : `${report.skipped} ${report.skipped === 1 ? "part" : "parts"} of this frame could not be reproduced (${report.unreproducible.join(", ")}).`,
    );
  }, [recording, resources, shown, lost]);

  return (
    <>
      <div className={styles.stack}>
        <canvas
          ref={canvasRef}
          className={styles.stackCanvas}
          // The intrinsic size until the first frame is drawn, so the pane
          // reserves the right shape rather than collapsing and then jumping.
          width={recording.width}
          height={recording.height}
          aria-label={label}
          role="img"
        />
        <canvas
          ref={hudRef}
          className={styles.hudCanvas}
          width={recording.width}
          height={recording.height}
          // The HUD is part of the picture the canvas beside it is labelled
          // as, so it is not a second thing for a screen reader to find.
          aria-hidden="true"
        />
      </div>
      {note !== null && <p className={styles.note}>{note}</p>}
    </>
  );
}

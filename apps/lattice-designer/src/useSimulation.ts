// React glue for the `Simulation`: create it once against the canvas, push design
// edits into it (debounced, so a drag of many belts rebuilds the window once the
// drag settles rather than per tile), and mirror play/pause + speed.

import { useEffect, useRef, useState } from "react";
import { Simulation, type SimStatus } from "./sim";
import type { Design } from "./model";

// How long after the last edit before the window is rebuilt. Long enough that a
// drag-paint or a slider drag coalesces into one replay, short enough to feel live.
const REBUILD_DEBOUNCE_MS = 90;

/**
 * Wire a `Simulation` to `canvasRef`. Returns whether the engine + sheet have
 * finished loading (until then the canvas is blank). Design changes replay the
 * window; `playing`/`speed` are applied live without a rebuild.
 */
export function useSimulation(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  design: Design,
  playing: boolean,
  speed: number,
  onStatus: (status: SimStatus) => void,
): boolean {
  const simRef = useRef<Simulation | null>(null);
  const [ready, setReady] = useState(false);

  // Latest design / callback held in refs so the create-once effect never needs
  // them in its dependency list (which would tear the engine down on every edit).
  const designRef = useRef(design);
  designRef.current = design;
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  // Create the simulation once, when the canvas mounts.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    let cancelled = false;
    let sim: Simulation | null = null;
    void Simulation.create(ctx, (s) => statusRef.current(s)).then((created) => {
      if (cancelled) {
        created.stop();
        return;
      }
      sim = created;
      simRef.current = created;
      created.playing = playing;
      created.speed = speed;
      created.start();
      created.setDesign(designRef.current);
      setReady(true);
    });

    return () => {
      cancelled = true;
      sim?.stop();
      simRef.current = null;
      setReady(false);
    };
    // Runs once for the lifetime of the canvas element; play/speed are seeded from
    // their first values and thereafter driven by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);

  // Replay the window when the design changes.
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(
      () => simRef.current?.setDesign(design),
      REBUILD_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [design, ready]);

  useEffect(() => {
    if (simRef.current) simRef.current.playing = playing;
  }, [playing]);

  useEffect(() => {
    if (simRef.current) simRef.current.speed = speed;
  }, [speed]);

  return ready;
}

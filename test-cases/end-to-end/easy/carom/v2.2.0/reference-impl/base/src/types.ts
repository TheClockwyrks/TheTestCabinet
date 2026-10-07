// Shared types for Carom.

// Top-level state machine. `countdown` and `playing` both render the live
// field; the others are menu / overlay screens.
export type AppState =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "matchover";

export type Mode = "solo" | "versus";

// Which side a paddle / player is on. Player one is always on the left.
export type Side = "left" | "right";

// A single ball-position sample recorded for the motion trail.
export interface TrailSample {
  x: number;
  y: number;
  t: number; // simulation time (seconds) at which it was recorded
}

// Events emitted by one physics step, used to trigger audio.
export interface StepEvents {
  paddle: boolean;
  wall: boolean;
  obstacle: boolean;
}

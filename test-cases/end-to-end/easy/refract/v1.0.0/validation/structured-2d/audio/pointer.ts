// Refract — audio/pointer: raising a pointer event the way a PLAYER raises it.
//
// The shared harness poses the pointer through the debug surface (`pressCell`,
// `moveToCell`, `traceCells`), which specs/instrumentation.md says resolves
// "against the live state before the call returns rather than deferred to the
// next frame". That is exactly right for arranging a board, and wrong for
// pinning a CUE: specs/ui.md fixes each cue as played "on the frame its event
// happens", by the code that raised it, and an event resolved between frames
// has no frame to be played on. A build that plays nothing for a debug-posed
// segment is conformant.
//
// So every audio check raises its own event the way the player does. For this
// engine that is a real pointer sample: the engine's input system listens for
// `pointerdown`/`pointermove`/`pointerup` on the target the surface hands it
// (the engine's `engine/` docs), lists the samples it received, and the game's
// player controller reads that list inside its update. The helpers re-exported
// below dispatch those events and then run the ONE frame that delivers them, so
// the frame a cue must play on is the frame the helper advanced — and nothing
// about the game's own resolution is bypassed: the hit radius, the grab rules,
// and every limit run as they do for a player.
//
// They live in the shared harness rather than here because the tracing checks
// need the same path for a different reason: specs/controls.md phrases
// extending and retracting about the pointer a PLAYER holds. This file is the
// name this category has always imported them under.

export {
  playerDraw,
  playerMoveTo,
  playerMoveToPoint,
  playerPress,
  playerRelease,
} from "../harness";

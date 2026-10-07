// audio/beds — the two music beds, by the cue name each loops under.
// CASE-PROVIDED.
//
// specs/assets.md fixes the produced files `assets/audio/music-title.wav` and
// `assets/audio/music-play.wav` and has the build bind its sounds to the
// engine's cue bus and run the beds through the world's `audio.loop` and
// `audio.stop`. The bus names a sound by the cue name it was bound under, and
// each bed's name is its file's basename, exactly as the thirteen one-shot
// cues are named — which is the name the harness's `looping` reads.

/** The bed specs/assets.md loops on `title` and `howto`. */
export const BED_TITLE = "music-title";

/** The bed specs/assets.md loops on `playing`, `waveclear`, and `paused`. */
export const BED_PLAY = "music-play";

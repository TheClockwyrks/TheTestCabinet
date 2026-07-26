## Audio checks arm the build with a real gesture

The four audio validation scripts (`audio/paddle-hit`, `audio/wall-bounce`,
`audio/obstacle-bounce`, `audio/scoring`) confirm a cue by reading the Web Audio
sources the build actually starts. They first arm audio, because the game must
not autoplay before the player interacts. That arming now delivers a genuine,
browser-trusted key press rather than a debug-API `press`.

A build is free to feed the debug API through a purely logical input path and to
create or resume its `AudioContext` only from a real DOM interaction — both are
conformant. For such a build, arming through the debug API never unlocked audio,
so no cue was ever scheduled and every audio check failed even though the build
played its cues correctly for a real player. Arming with a real gesture fixes the
false negative. No specs, prompt, or deliverables changed — a validation-only fix,
hence the patch bump.

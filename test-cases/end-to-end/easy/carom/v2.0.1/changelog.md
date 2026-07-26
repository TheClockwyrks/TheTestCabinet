## Common gyre checks pin the obstacles upright

In the gyre variant the obstacles sway and rotate, so no mid-field lane stays
clear and no obstacle face stays axis-aligned. Several common (non-gyre-specific)
checks nonetheless drove the ball as if the field were still: the straight rally
and the goal drives ride the `y=360` lane "clear of both obstacles", the per-face
bank shots aim at an obstacle's base-x face, a couple of ball checks fire at
obstacle A's base face or pose a short flight beside it, and the Solo AI
scenarios send a shot across the mid-field to the opponent. Under gyre a swaying
obstacle reaches into `y=360` (and into the AI shot lanes), and a rotating one
shifts its face off its base x, so a moving obstacle could deflect the rally
(leaving it short of the ceiling and its per-hit ratios wrong), knock a bank shot
a pixel onto the wrong side of the face, stray into a posed flight, or intercept
a shot meant to test the AI.

The reference happens to freeze its obstacle clock at 0 (upright) whenever a
control operation holds the paddles, so it read cleanly — but the spec pins the
frozen pose there only via `setObstacleClock`, not by default, so a conformant
build that freezes at a swayed, tilted pose failed these checks for a field
geometry they never meant to test. The shared helpers (and the two inline `ball`
checks) now call a new `pinObstaclesUpright` before the drive, which poses the
obstacle clock to 0 so obstacle A sits upright at `(490, 220)` and B at
`(790, 500)` — both clear of the `y=360` lane, each face vertical at its base x.
It probes for `setObstacleClock` and is a no-op in base and multi, which have no
obstacle clock, and a no-op for a build already upright there. The gyre-specific
items (`obstacles-sway`, `obstacles-spin`, `oriented-bounce`) drive the clock
themselves and are untouched.

## The moving-AI spin check reads spin against the AI's own motion

`spin/moving-solo-ai` confirms the AI paddle imparts spin as it strikes. It
required an absolute `spin > 400`, a magnitude only a near-top-speed swing
reaches (spin is `paddleVy * 0.85`, so `> 400` needs `vy > ~470`). But the AI is
deliberately slower than the human (560 vs 720 px/s) and eases off as it nears
the ball, so its contact speed — and thus its spin — is whatever its own chase
produces; the reference happens to swing hard enough, but the spec does not
require it. A conformant, gentler AI that applies the spin mechanic correctly
struck with a lower velocity and failed. The check now reads the spin against the
paddle's actual velocity (`spin ≈ vy * 0.85`), so it is robust to how fast the AI
happens to be moving while still catching a build that imparts no — or wrong —
spin.

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

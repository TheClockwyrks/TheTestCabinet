## Scoring, contact and spin clips open before the event, not on it

The clip a reviewer watches is an item's `act` phase, so where `act` starts is
where the footage starts. Several items began theirs on — or just after — the very
moment they exist to demonstrate, leaving the event itself to be inferred from its
aftermath. The checks were right; only what they filmed was too tight.

The two goal checks (`gameplay/scoring-p1`, `scoring-p2`) ran until play left the
field, which is the same instant the point lands, so the clip cut away before the
scoreboard could be read. Both now hold for a further 0.9 s on the post-point
countdown, where the incremented score sits beside the re-held ball.

The paddle-contact drives (`paddles/hit-center`, `hit-edge`, and the spin checks
`stationary`, `at-bound`, `moving-solo-player`, `moving-versus-p1`,
`moving-versus-p2`) posed the ball about ten pixels off the paddle face, so the
bounce landed within a couple of ticks and the clip opened on a return already in
flight — showing where the ball went, never that it went there because it struck a
paddle. `arrangePaddleHit` now takes a `leadTicks` run-up: the ball starts half a
second of flight further out and, because a posed `vy` persists across steps, a
swinging paddle starts the matching distance upstream so it arrives at the same
contact. The rebound the assertions read is the same one the real physics produces;
only the footage in front of it is new.

The swinging contacts needed room for that. A paddle sweeping at 720 px/s covers
360 px over the run-up and its center y is clamped to `[55, 665]`, so a contact
aimed at mid-field would have to begin off the field, where the clamp pins the
paddle still and it imparts no spin at all. The three moving-paddle contacts — and
the free-paddle control inside `at-bound` — now meet the ball at `y=500` for a
downward swing and `y=220` for an upward one, lanes clear of both obstacles over
the stretch the ball crosses (`at-bound`'s two assertion labels say "clear of the
bound" rather than "mid-field" to match). The bound-pinned contact leads the ball
alone: leading its paddle would unpin it and hand back the very velocity that check
exists to deny.

## The no-tunnel clip plays its three probes as three shots

`ball/no-tunnel` fires the ball at the 980 px/s ceiling at an obstacle, a paddle
and a wall, and read the three rebounds back to back with barely any run-up and no
follow-through — about a second of footage for all three. The ball appeared to jump
around the field between contacts, which reads as exactly the tunnelling the item
disproves. Each probe now gets roughly half a second of approach, its contact, and
a tail travelling away from what it struck, with the ball posed still for 0.2 s in
between so each shot reads as its own. Every tail is sized to keep the ball on the
field, so nothing scores mid-clip. The three rebounds the assertions read, and the
assertions themselves, are unchanged.

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

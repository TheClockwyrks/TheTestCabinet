# Carom

> Placeholder copy. This is real Markdown the site renders today; the wording
> will be refined later.

**Carom** is a neon, top-down paddle duel for the browser, and the simplest case
in The Test Cabinet's catalog. Two paddles face each other across a dark field
while a ball ricochets between them, bouncing off the top and bottom walls and
off a pair of fixed obstacles planted in the middle of the arena. A point is
scored whenever the ball slips past the far edge behind an opponent's paddle.

Although the rules read like the oldest arcade game there is, Carom is its own
game. Its defining mechanic is **spin**: the motion of a paddle at the instant it
strikes the ball curves the ball's path afterward, so good play is about *shaping*
a shot rather than merely blocking it. The two fixed obstacles turn the open field
into a bank-shot puzzle, rewarding players who can read angles a couple of bounces
ahead.

## Why it is a benchmark

Carom looks trivial and is deliberately so on the surface — but building a version
a person would actually *enjoy* is not. A strong implementation has to deliver
smooth real-time rendering, a believable physics loop with spin, a competent AI
opponent, a local two-player mode, and the menus and state transitions that tie a
title screen, live gameplay, and a game-over screen together. That makes it a
clean low-end anchor for the suite: the kind of task a capable model and harness
should largely nail, against which the harder cases can be measured.

## What a model is given

A run receives the self-contained specification and the rendered reference
screenshots that act as visual targets — the title screen, gameplay, and the
game-over screen. The reference *source* mockups are withheld, so the look has to
be rebuilt from the specification rather than copied. There are no assets to
provide: Carom's visuals are simple enough to draw entirely in code.

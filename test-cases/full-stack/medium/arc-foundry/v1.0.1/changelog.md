## A unit's maximum HP is a whole number

`specs/enemies.md` derived a unit's HP on wave `w` from `baseHP × baseMult ×
[ (1 + k × (w − 1)) + c × (r^(w − 1) − 1) ]` and left the result a real number.
Every figure it produced was fractional — a Wave-1 Medium Filament came out at
`74 × 0.22 = 16.28` — so two builds that both implemented the formula correctly
could report different HP for the same unit depending on whether, and how, they
rounded it. Nothing in the specs said which was right.

The formula now rounds: `HP(w) = round( baseHP × baseMult × [ … ] )`, to the
nearest whole number with an exact half rounding up, and the spec states that a
unit's maximum HP is an integer. One derivation is spelled out in both rounding
directions — a Medium Mote's `9.68` is `10` HP, a Filament's `16.28` is `16`.
The rule is scoped to maximum HP; damage in flight, including a burn's
per-tick loss, is unchanged. `specs/modes.md` and `specs/gameplay.md`, which
both restate the formula, round with it.

The underlying balance is untouched: no roster value, difficulty constant, or
wave count moved, and the figures a build now reports are the ones the reference
implementation already produced.

## Medium's HP-scaling constants agree across the specs

`specs/gameplay.md` restated Medium's surcharge constants as `c = 0.18` and
`r = 1.13`, against the `c = 0.28` and `r = 1.145` given in both
`specs/modes.md` and `specs/enemies.md`. A build reading all three could not
satisfy them at once. The two outlying values are corrected to match the
difficulty table.

Introduced.

- **A lane splitter (unzipper), distinct from the plain splitter.** It takes a
  single belt input — on the top (anchor) cell, grid-aligned so a belt butts up flush,
  with the bottom cell's West closed off by the housing — and unzips it into two
  outputs. Instead of a flat lid hiding a side-to-side balancing shuttle, this machine
  carries a lengthwise East-West splitting ridge down its centre and two spreader
  heads that ride outward toward the outer lanes, so it reads as splitting the one
  input's two lanes apart — routing each lane out to the outer lane of its own output
  — rather than balancing two belts.
- **The mechanism is a separate layer over a continuous belt bed.** The housing,
  output arrow, splitting ridge, and moving spreader heads are drawn on a registered
  `mechanism` layer, and the transport-belt surface runs unbroken beneath it
  (including under the machine) instead of stopping at the mouths. So an item rides
  the belt and passes _under_ the mechanism, which the renderer can composite over
  items rather than fading them out at the machine.

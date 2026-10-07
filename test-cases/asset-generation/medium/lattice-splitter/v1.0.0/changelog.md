Introduced.

- **The mechanism is now a separate layer over a continuous belt bed.** The housing,
  output arrow, and moving sort/split part are drawn on a registered `mechanism`
  layer, and the transport-belt surface runs unbroken beneath it (including under the
  machine) instead of stopping at the mouths. So an item rides the belt and passes
  _under_ the mechanism, which the renderer can composite over items rather than
  fading them out at the machine.

Introduced.

## Overload drones show a per-drone charge telegraph

In Overload, each drone that has taken a mismatched (wrong-band) shot must now
display a **charge telegraph** on the drone itself — a row of three pips above
its body that advances one pip per mismatched hit and **empties** when the drone
reaches full charge and overloads. Previously the charge counter that drives the
overload was described but not shown, so the "+1 per wrong-band hit, overload at
3" buildup could not be observed on the field. The telegraph is now mandated in
`specs/mode-overload.md`, and the `overload-feeds` review item (and its
`charges`, `flux`, and `prism` sub-items) grade against the visible tell.

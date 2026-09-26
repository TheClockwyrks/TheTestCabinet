# Deepcore — The escape rocket

This file defines the win condition: fabricating and installing the five
components of the escape rocket at the Launch Pad, then launching. Every figure
below carries the name this specification gives it.

## The five components

The Launch Pad panel shows the rocket as a checklist of five components, built in
order. Each becomes available once the one before it is installed.

| Order | Component         | Id           | Credits | Material        |
| ----- | ----------------- | ------------ | ------- | --------------- |
| 1     | Hull Frame        | `hull-frame` | `4000`  | —               |
| 2     | Fuel Cells        | `fuel-cells` | `7500`  | —               |
| 3     | Guidance Unit     | `guidance`   | `3000`  | one Resonite    |
| 4     | Thruster Assembly | `thruster`   | `6000`  | one Cryenite    |
| 5     | Ignition Core     | `ignition`   | `5000`  | one Core Sample |

`ROCKET_TOTAL_CREDITS` is `25500`, the sum of the five prices.

Two components need Credits alone. Two consume an exotic material that must be
held in the satchel. The fifth consumes the Core Sample, whose destabilization
timer is already running, so fabricating it is a race against that timer.

The two material nodes and the Core are immune to explosives, so a blast can never
destroy the only source of a component.

## Fabricating

The Launch Pad panel shows the next uninstalled component with its price, its
material requirement and whether it is met, and a `FABRICATE` action. The action
is enabled only while the Credits are affordable and the material is held.
Fabricating:

1. deducts the Credits and consumes the material from the satchel;
2. installs the component, ticking it off the checklist and visibly adding that
   part to the rocket on the pad;
3. stops the Core Sample timer, for the Ignition Core.

Installed components are permanent. They survive a death in either mode and cannot
be un-fabricated or refunded.

## Launching

With all five components installed the Launch Pad shows `LAUNCH`. Launching plays
the rocket lifting off the pad, with the produced launch-exhaust effect and the
launch cue, and takes the game to the Victory screen. The miner boards the rocket,
so once the launch begins only the rocket is drawn rising and the miner is no
longer on the pad.

Launching is the only way to win. There is no other ending.

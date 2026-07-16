# The escape rocket — the win condition

This file defines how you **win** Deepcore: by fabricating and installing the five
components of the **escape rocket** at the **Launch Pad** (`specs/world.md`), then
launching. It refers to Credits and the economy (`specs/flow.md`), the exotic
materials (`specs/mining.md`), the unstable Core Sample (`specs/hazards.md`), and the
produced rocket art (`specs/assets.md`). The numeric values here are **fixed**;
implement them exactly.

The rocket is why you dig. Two of its components are bought with **Credits alone**, so
the surface economy must be working; two need an **exotic material** mined from a
specific depth band, so you must **delve**; and the last needs the **Core Sample**
from the very bottom, so you must make the **core run**. Because the deep parts cannot
be bought at any price, **you cannot win by strip-mining the shallows** — the rocket
forces the full descent.

## The five components

The Launch Pad panel shows the rocket as a **checklist** of five components, built in
order (each becomes available once the one before it is installed). Fabricating a
component **deducts its Credits and consumes its material** (if any) and installs it
on the rocket — visibly adding that part to the rocket on the pad (`specs/assets.md`).

| # | Component | Credits | Material needed | What it proves |
| --- | --- | --- | --- | --- |
| 1 | **Hull Frame** | `800` | — | the surface economy works |
| 2 | **Fuel Cells** | `1500` | — | the surface economy works |
| 3 | **Guidance Unit** | `600` | `1x` **Resonite** (rockbed) | you can delve to the mid band |
| 4 | **Thruster Assembly** | `1200` | `1x` **Cryenite** (deepstone) | you can delve to the deep band |
| 5 | **Ignition Core** | `1000` | `1x` **Core Sample** (Core chamber) | the climactic core run |

- Components **1** and **2** need only Credits — early goals you can fabricate as soon
  as ore sales have banked enough, proving the economy loop.
- Components **3** and **4** each also consume one exotic material you must have mined
  and be carrying in the satchel (`specs/mining.md`). You cannot fabricate the
  Guidance Unit without Resonite in hand, nor the Thruster Assembly without Cryenite.
- Component **5**, the **Ignition Core**, consumes the **Core Sample** — and the Core
  Sample is **unstable** (`specs/hazards.md`): its 90-second timer is running from the
  moment you extracted it, so the fabrication of the Ignition Core is a **race** — get
  to the pad and fabricate before it detonates. Installing it **stops the timer** (the
  Sample is now safely spent in the rocket).

Total Credits across all five is `5100`, alongside the upgrade spending
(`specs/upgrades.md`) — the two together are the sink the whole ore economy funds.

## Fabricating

At the Launch Pad, the next uninstalled component shows its cost, its material
requirement (met / not met), and a **FABRICATE** action, enabled only when you can
afford the Credits **and** hold the required material. Fabricating:

1. deducts the Credits and consumes the material from the satchel;
2. installs the component — the checklist ticks it off and the rocket on the pad gains
   that part (`specs/assets.md`);
3. for the Ignition Core, **stops the Core Sample timer**.

Installed components are **permanent** and survive death (`specs/modes.md`) — the
checklist is your durable save state. You cannot un-fabricate or refund a component.

## Launch — victory

Once **all five** components are installed, the Launch Pad shows **LAUNCH**. Launching
plays the rocket lifting off the pad — a produced launch-exhaust VFX and a launch
roar (`specs/assets.md`) — and takes the game to the **Victory** state
(`specs/flow.md`): the miner has escaped Vhera Deep. The Victory screen shows the run
summary (deepest depth reached, Credits earned, time, mode) with **PLAY AGAIN** (a
fresh expedition in the same mode) and **MENU**.

Launching is the **only** win condition. There is no boss and no other ending; the
whole game is the drive to get these five parts onto the rocket and lift off.

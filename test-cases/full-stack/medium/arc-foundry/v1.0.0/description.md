**Arc Foundry** is an electro-industrial tower-defense game. A runaway surge of
conductive scrap — **the Load** — spills from a blown feeder vent and crawls across a
derelict substation yard toward a grounding **collector**; you pick a **map** at the
start and defend it by feeding scrap into a **scrap-press** that stamps salvaged
electrical components — capacitors, coils, emitters, arc-nodes, discharge rigs, slowing
chokes, burning rectifiers, and non-firing support regulators — into automated turrets.
Every stamped component is *also* a physical **wall**, so you build a maze of scrap that
the Load must crawl around, buying your turrets time to burn it down before it grounds
out.

Its defining idea — and it is a faithful **GemTD** at heart — is what happens at the
press. You do **not** buy the component you want: you place a **rock** that **rolls a
random component type at a random quality tier the moment it lands**, weighted low. Each
level you place **five** such rocks and **keep exactly one** as a firing tower; every
rock you do not keep or combine hardens into an inert **blocker** that walls the yard but
never fires. To keep more than one roll's worth of firepower you **combine** — an
immediate action, done at will (even mid-wave) — folding matched rolls up the five-rung
**quality ladder** (**Scrap -> Tuned -> Charged -> Primed -> Tesla-Prime**) or a whole
recipe into a **combination tower**. Charge is scarce (thin bounties, no interest), spent
on stamps, **UPGRADE QUALITY** to bias the press, and **upgrading** your combos. Base
towers are deliberately weak feedstock: the payoff is assembling **combination towers** —
specific recipes of base components at specific qualities that fold into unique, far
stronger turrets with exotic abilities (chain, splash, slow, burn, crit, multishot, aura)
that land weak and are upgraded — so **which roll to keep, the maze you wall from the rest,
the quality climb, and the combos you build, is the strategic heart of the game**. After
the final wave, an **invincible Overload Dynamo** walks the maze once and the total damage
you deal it is your **Maze Rating** — the run's only score. The
Load follows an **ordered chain of waypoints** — each a 4-tile **platform** you cannot
build on — and takes the shortest **open** route around your walls between each pair; a
never-seal rule forbids fully blocking any segment or encircling a waypoint, and a
**Filament** flyer appears every fourth wave to bypass the maze. Three maps — an
edge-hugging serpentine, a center-crossing star, and one split by fixed transformer
housings — pose three different mazing problems, and an in-game Easy/Medium/Hard menu
changes only the wave count and how tough the Load grows.

Arc Foundry is also a **full-stack** case: the model under test must **produce the
game's own assets during the run** — the component sprites across all five quality
tiers, the Load and boss animations, and above all the **produced electrical particle
VFX** (arcs, spark showers, chain-lightning leaping between coils, expanding discharge
rings) that carry the presentation — with the six asset-generation tools on the run
image's `PATH`, and then build the game around them. It is a reskin of the classic
random-build maze defense, given an original name, an electro-industrial look, and its
own component roster, Load, and produced VFX.

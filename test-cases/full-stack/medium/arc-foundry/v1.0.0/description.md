**Arc Foundry** is an electro-industrial tower-defense game. A runaway surge of
conductive scrap — **the Load** — spills from a blown feeder vent and crawls across a
derelict substation yard toward a grounding **collector**; you pick a **map** at the
start and defend it by feeding scrap into a **scrap-press** that stamps salvaged
electrical components — capacitors, coils, emitters, arc-nodes, discharge rigs — into
automated turrets. Every stamped component is *also* a physical **wall**, so you build a
maze of scrap that the Load must crawl around, buying your turrets time to burn it down
before it grounds out.

Its defining idea — and it is a **GemTD** at heart — is what happens at the press. You
do **not** buy the component you want: each pull stamps a **random component type at a
random quality tier**, weighted low, and you decide its fate on the board — **keep** it
firing, **slag** it into an inert wall, or **combine** it with a match to climb a
five-rung **quality ladder** (**Scrap -> Tuned -> Charged -> Primed -> Tesla-Prime**).
Combining two matching components (same type and quality) folds them into one a tier
higher, freeing a footprint as it climbs, so the **keep-vs-slag-vs-combine decision, and
which builds you keep as permanent obstacles, is the strategic heart of the game**. The
Load follows an **ordered chain of waypoints** and takes the shortest **open** route
around your walls between each pair, and a never-seal rule forbids fully blocking any
segment. Three maps — an edge-hugging serpentine, a center-crossing star, and one split
by fixed transformer housings — pose three different mazing problems, and an in-game
Easy/Medium/Hard menu changes only the wave count and how tough the Load grows.

Arc Foundry is also a **full-stack** case: the model under test must **produce the
game's own assets during the run** — the component sprites across all five quality
tiers, the Load and boss animations, and above all the **produced electrical particle
VFX** (arcs, spark showers, chain-lightning leaping between coils, expanding discharge
rings) that carry the presentation — with the six asset-generation tools on the run
image's `PATH`, and then build the game around them. It is a reskin of the classic
random-build maze defense, given an original name, an electro-industrial look, and its
own component roster, Load, and produced VFX.

**Caldera** is a real-time strategy **tower-defense** for the browser, played over a
procedurally generated **hexagonal** volcanic basin rendered in real-time 3D from a
tilted RTS camera. You are the **Holdfast**, defending a single fixed **Core** at the
heart of the caldera against the **Slag** — an obsidian corruption that wells up from
two low breaches in the crater rim and grinds inward in escalating **waves**. Clear the
final wave with the Core standing and the caldera **holds**; let the Core fall and you
are **overrun**.

You do not control a soldier. From the overhead camera you spend **funds** (produced by
the Core, which you can upgrade for more income) to build a defense across the terrain:
a two-fluid supply chain that draws **water** from rivers and lakes, pumps it uphill to
**boilers** built on geothermal **vents** to raise **steam**, and pipes that steam to
**towers** that only fire while supplied. Cutting a water main starves the steam and
darkens the towers it fed, so the network is a defended asset, not set-and-forget.

The terrain is the star. Its discrete **elevation** connects by **terraces** where cells
differ by one level and impassable **cliffs** where they differ by more; **rivers** flow
strictly downhill and slow the Slag that wade them; **deep water** is a wall; **vents**
sit high while water sits low, so the elevation-aware flow makes reaching them a real
puzzle. Terraces, cliffs, and rivers shape where pipes can run, where the Slag can path,
and where towers command the ground.

Caldera is a hard build: a procedurally generated hex-mesh world with terraced
elevation, carved rivers, and animated water; a flow-network fluid simulation with
elevation-aware flow, brownouts, and severable lines; a build/economy layer; four
towers and a four-archetype Slag roster that 3D-pathfinds across the terrain from two
breaches; a discrete curve-driven wave loop with a win and a loss; and multiple states.
It is inspired by network-management and tower-defense games but is its own game, with
an original name, factions, world, and rosters.

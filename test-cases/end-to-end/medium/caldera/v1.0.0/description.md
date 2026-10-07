**Caldera** is a real-time strategy tower-defense for the browser, played over a
procedurally generated hexagonal volcanic basin rendered in real-time 3D from a
tilted RTS camera. You are the Holdfast, defending a single fixed Core at the
heart of the caldera against the Slag, an obsidian corruption that wells up from
two low breaches in the crater rim and grinds inward in escalating waves. Clear
the final wave with the Core standing and the caldera holds; let the Core fall
and you are overrun.

There is no soldier to control. From the overhead camera you spend funds,
produced by the Core and raised by upgrading it, to build a defense across the
terrain: a two-fluid supply chain that draws water from rivers and lakes, pumps
it uphill to boilers built on geothermal vents to raise steam, and pipes that
steam to towers that only fire while supplied. Cutting a water main starves the
steam and darkens the towers it fed, so the network is an asset to be defended.

The terrain sets the rules of a match, and terraces, cliffs, and rivers shape
where pipes can run, where the Slag can path, and where towers command the
ground:

- Discrete elevation connects by terraces where cells differ by one level, and
  by impassable cliffs where they differ by more.
- Rivers flow strictly downhill and slow the Slag that wade them.
- Deep water is a wall.
- Vents sit high while water sits low, so the elevation-aware flow makes
  reaching them a real puzzle.

Caldera is inspired by network-management and tower-defense games but is its own
game, with an original name, factions, world, and rosters. It is a
medium-difficulty build spanning:

- A procedurally generated hex-mesh world with terraced elevation, carved
  rivers, and animated water.
- A flow-network fluid simulation with elevation-aware flow, brownouts, and
  severable lines.
- A build and economy layer.
- Four towers and a four-archetype Slag roster that 3D-pathfinds across the
  terrain from two breaches.
- A discrete curve-driven wave loop with a win and a loss, and multiple states.

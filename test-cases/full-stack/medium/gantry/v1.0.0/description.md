Gantry is a 3D crane-building puzzle. Each site sets out anchor points, a
handful of loads, and the pads they must be delivered to. The player rigs a
tower crane from struts, cables, and rails on a lattice, mounts a slew ring
and a trolley track, then writes an instruction tape for the crane's four
axes: slew, trolley, hoist, and grip. Running the tape plays the lift out.

The crane is simulated as a real structure. Every tick, a direct-stiffness
solve computes the force in every member from the crane's weight, the hanging
load, and the inertia of the programmed motion. Slewing faster means
centrifugal load, cables carry tension only, long struts buckle, and a member
past its capacity breaks, sometimes taking the rest of the crane with it. The
load itself swings on its cable as a damped pendulum, so a briskly driven lift
arrives swinging and must settle before it can be set down inside the
placement tolerances. Cost and time are the score, and speed is bought with
steel.

Gantry is a full-stack case with a 3D asset contract. The build produces its
own voxel models with the asset tools: the ring, trolley, hook, counterweight,
and mounts, plus the crate, container, and drum load classes. It produces all
of its audio the same way and wires both into the 3D scene it renders.

The simulation is exact. Programmed motion gives closed-form accelerations,
the solve has a unique answer, and the pendulum is specified to the tick, so a
structure and tape replay identically every time and small canonical trusses
can be checked against textbook member forces.

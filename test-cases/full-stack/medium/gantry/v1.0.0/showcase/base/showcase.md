Gantry is a crane-building puzzle played in a 3D construction yard. A site
gives you anchor points on the ground, a build envelope, a budget, and one or
two loads that have to end up on their pads — and nothing else. You rig the
crane yourself: struts, cables and rails placed node by node on a two-unit
lattice, the slew ring the arm turns on, a run of rail for the trolley to drive
out along, and counterweights hung off the back until the thing balances.

Then you write the tape. It is an ordered program for the crane's four axes —
slew, trolley, hoist and grip — each step naming an axis, a target and a rate,
with two actions, attach and release, that take a load onto the hook and set it
down. You steer nothing while it plays. You press run, turn the camera, and
watch what you wrote happen.

What it happens to is a real structure. Sixty times a second the whole truss is
solved at the geometry of that tick, and every member comes back carrying a
computed force from the crane's own weight, the hanging load, and the inertia of
the motion you programmed. Cables pull and never push, long struts buckle sooner
than short ones, and the arm's reactions cross the slew ring corner by corner
onto the tower. Members color by how hard they are working, from slack up to
their limit; one at breaking point pulses white, and one past it is gone for the
rest of the run, sometimes taking the crane with it. The load hangs on a real
pendulum, so a briskly slewed lift arrives swinging, and a swinging load can
miss its pad, strike an obstacle, or snap the cable.

Cost and time are the score, and that is the whole tension of the game: a cheap
crane driven briskly beats an overbuilt one driven timidly, but driving briskly
loads the structure harder and swings the load wider. Speed is bought with
steel.

The clip is a run of site three, Over the Wall, played by the reference
implementation. It opens on the finished crane — eighty-seven members, two
counterweights, checked and standing inside its budget — and then plays the
whole lift at watch speed, uncut: a crate is hooked on the far side of a wall
it cannot go through, hoisted to the jib, drawn in to the mast, swung a hundred
and sixty degrees around the tower, then paid down and run out onto its pad,
thirty-eight seconds of run clock later and two seconds inside par. The members
shift color as the load comes onto them, and the yard turns under a camera being
dragged around as it goes — the only thing a player's hands still have to do
once the tape is running.

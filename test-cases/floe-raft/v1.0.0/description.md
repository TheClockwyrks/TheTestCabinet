**Floe Raft** is the long, solid drifting ice floe of the Floe arctic-crossing game
— the big raft the player rides across the open water, a single continuous slab
rather than a row of separate small pans. Because the game wants floes of more than
one length as solid pieces, it is its own asset-generation case: a model draws
it as
a **sprite sheet** of 2 frames on a shared 128×32 canvas, one operation at a
time —
a **three-tile** floe filling the left three tiles (frame 0) and a **four-tile**
floe
filling all four (frame 1), each one continuous rounded slab with a snow-dusted
top,
a ringed ice edge, and a waterline so it reads as one long pan floating on
water. It
is flat ice on full transparency, composited onto the dark water by the game. The
recorded operations are regenerated into each frame, which a reviewer judges against
the brief: the read as a single solid long floe (not several pans butted together),
the two clean lengths, and the pale ice palette are what they weigh.

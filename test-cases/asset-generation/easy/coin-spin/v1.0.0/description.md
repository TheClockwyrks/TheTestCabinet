**Spinning Coin Pickup** is a generic, reusable collectible: a shiny gold coin
spinning about its vertical axis, drawn as a **sprite sheet** of 6 separate 32×32
frames, one operation at a time. Across the frames the coin makes one continuous
turn — a full round face, a narrowing ellipse, a thin edge-on sliver, a widening
ellipse, and back toward the face — a seamless loop, with a bright white glint
sweeping across the face as it catches the light. It is a coin on full
transparency, composited onto any scene as a points pickup. The recorded operations
are regenerated into each frame, which a reviewer judges against the brief: whether
the six frames read as one continuous rotation, whether the `spin` sequence loops
cleanly, and whether it reads as a valuable gold coin in the warm gold palette on
transparency. The named `spin` sequence plays back as a live animation in the
review UI.

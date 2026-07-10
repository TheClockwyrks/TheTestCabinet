**Caldera Pipe Span** is one straight run of heavy Holdfast pipework — a single
riveted, bolted tube that carries water or steam from one cell to the next. This
asset-generation case asks a model to sculpt it as a 12×12×34 opaque-voxel model
using only the `voxel` tool, one operation at a time: a cylindrical tube running the
length of the volume along z, a raised flange collar bolted at each end, and a course
of bolt heads clamping each collar.

There is no target model — the model sculpts toward a written brief. The piece is
**modular**: on the Caldera map the build orients this span, stretches it between two
adjacent cell centers, and repeats it hundreds of times, so both ends terminate in a
collar flush with a face of the volume and two spans butt together into one
continuous pipeline.

The whole tube is the **accent region**: it is sculpted in one reserved neutral color
that the game finds and repaints to the network's fluid color — blue for water, teal
for steam — so one span serves both networks, while the iron collars and bolts are
never repainted and keep it reading as a real, bolted pipe. The recorded operations
are regenerated into a 3D model the frontend renders rotating, and a reviewer judges
it against the brief: that it reads as heavy bolted pipework, tiles cleanly
end-to-end, keeps the palette disciplined, and fills the volume.

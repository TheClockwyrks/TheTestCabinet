**Caldera Pipe Hub** is one pipe junction of the Holdfast network — a squat, bolted
drum where up to six pipe runs meet. This asset-generation case asks a model to sculpt
it as a 16×16×16 opaque-voxel model using only the `voxel` tool, one operation at a
time: a squat central drum, a raised flange socket facing outward on each of its six
sides, a course of bolt heads ringing each socket, and a bolted cap plate on top.

There is no target model — the model sculpts toward a written brief. On the Caldera
map each hex cell has six neighbors, so the hub sits at a pipe cell and the build
chooses at run time which of the six sockets a span plugs into. Every one of the six
sockets must therefore be **identical and interchangeable**, so any span can bolt into
any of them the same way.

The whole drum body is the **accent region**: it is sculpted in one reserved neutral
color that the game finds and repaints to the network's fluid color — blue for water,
teal for steam — so one hub serves both networks, while the iron sockets, bolts, and
cap plate are never repainted and keep it reading as a real bolted junction box. The
recorded operations are regenerated into a 3D model the frontend renders rotating, and
a reviewer judges it against the brief: that it reads as a bolted junction, carries six
identical sockets, keeps the palette disciplined, and fills the volume.

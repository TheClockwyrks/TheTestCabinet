**Sunfront Solar Extractor** is a Duneforged sunlight harvester: a fanned rank of
angled solar-collector panels splayed off a canted spine on a low faceted
pedestal, drinking the sun into a glowing stored-sol core. It is an economy
structure that banks the legion's currency and produces no units, so it must read
as a passive collector.

This asset-generation case asks a model to sculpt and rig it as an 84×72×72
opaque-voxel model using only the `voxel-anim` tool, one operation at a time. The
model paints discrete opaque cells to build a low faceted brass pedestal as the
fixed body, a canted iron spine leaning off it, a wide fan of amber-glowing
collector panels splayed across the top, and a solar-hot stored-sol core housed at
its heart. The case fixes only the three self-playing animations the model must
author, and leaves the parts, joints, and articulation that realize them to the
model. `panel_track` sweeps the fan to follow the sun, `collector_bloom` spreads
and closes the splayed panels, and `sol_charge` brightens and swells the core as
it banks light.

The test measures whether a model can work out how to split the harvester into a
fixed body and its moving pieces, attach them where they belong, and animate them
convincingly. There is no target model: the model sculpts and rigs toward a
written brief, and may add its own extra parts and animations on top.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the fan tracking, blooming, and the core charging on their
self-playing animations. A reviewer judges it against the brief: that it reads as
a solar-sunlight harvester rather than a factory, the panels track and bloom and
the core charges on clean axes without detaching, its silhouette is
non-rectangular, and the pedestal stays fixed while only the moving pieces move.

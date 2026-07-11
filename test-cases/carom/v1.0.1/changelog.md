This release switches the rally video proof to WebM and adds an authored
reference implementation of the base variant.

## Rally proof captured as WebM

The rally video proof is now captured as WebM (`proof/rally.webm`) instead of
MP4. WebM is the format the Playwright recorder produces natively via
`recordVideo`, so a build no longer has to transcode the clip itself before
committing it — one less step to get wrong, and no format conversion in the
finished task. The public gallery transcodes the clip to MP4 for playback. The
switch is threaded through the prompt (`prompt.hbs`), the `specs/proof.md`
proof table and notes, and the `rally` proof `dest` in `test-case.toml`, whose
extension-inferred media kind still resolves `.webm` to a video.

## Base variant gains a reference implementation

`variants/base.toml` now declares `reference_implementation =
"reference-impl/base"`, pointing at an authored, *correct* static build of the
base variant that ships under `reference-impl/base/`. It is the case-variant
analogue of a run's `links.playableBuild`: a buildable web project built
out-of-band with the case's `[build]` commands, deployed like a published run
build via `tcab publish-reference`, and shown on the case's "Reference" tab. It
is never seeded into a run — handing a model the finished game would defeat the
test — so it takes no part in the variant's seed set.

## The rally proof is captured as WebM

The rally clip is now `proof/rally.webm` rather than `proof/rally.mp4`. WebM is
what the Playwright recorder produces natively through `recordVideo`, so a build
no longer has to transcode the clip before committing it; the public gallery
transcodes it for playback instead. The switch is threaded through `prompt.hbs`,
the proof table and notes in `specs/proof.md`, and the `rally` proof `dest`,
whose extension-inferred media kind still resolves `.webm` to a video.

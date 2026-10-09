//! Layout: the names of the files and directories a run tree, a case version and
//! the test-cases catalog are made of, and the bounds on what a showcase may hold.
//!
//! Each is read on more than one side: by the run that writes the tree, by the
//! validator that reads it back, by the backend and the snapshot builder that serve
//! and publish it, and by the content digest that decides whether it changed. One
//! definition here keeps them agreeing. `test_cabinet_core` re-exports each at the
//! name and module it was first defined under (the crate root for the showcase
//! bounds, `playable` and `validator` for the build outputs, `validator` for the
//! validation names, `reference_lock` for the lock file).

// --- showcase bounds ---------------------------------------------------------

/// The largest showcase description, in bytes. The description is a store-page
/// blurb; this cap keeps a pathological one from bloating every store downstream.
/// The run-side capture truncates a longer one on a char boundary with a trailing
/// marker; the case-side resolution (an authored, committed showcase — see
/// `test_case::Variant::showcase`) hard-fails instead. Public because the bound is
/// shared by all three showcases, the suite's
/// included (`test_suite::ShowcaseManifest`), and The Spec Cabinet enforces it on
/// the one it authors.
pub const MAX_SHOWCASE_DESCRIPTION_BYTES: usize = 64 * 1024;

/// The most media entries a showcase carousel may hold. The run-side capture
/// drops the excess with a warning — the carousel is a highlight reel, not an
/// archive — while the case-side resolution hard-fails on it. Public for the
/// reason [`MAX_SHOWCASE_DESCRIPTION_BYTES`] is: the bound is shared by all three
/// showcases, the suite's included.
pub const MAX_SHOWCASE_MEDIA_ENTRIES: usize = 10;

/// The largest media file a showcase carousel entry may name, in bytes. An entry
/// naming a larger file is dropped with a warning, since the file travels the
/// per-run media path and a pathological one would bloat every store downstream.
/// Public because the driver's backend-store mirror applies the same cap to the
/// directory it uploads, so a file the capture refused never ships either.
pub const MAX_SHOWCASE_MEDIA_FILE_BYTES: u64 = 25 * 1024 * 1024;

// --- build outputs -----------------------------------------------------------

/// Candidate static build-output directory names a run's implementation may
/// produce, in priority order. The validator builds into whichever a project's
/// tooling is configured for; `dist` is Vite's default. Shared so the publish
/// path (which deploys the build) and the local-serving path agree on what a
/// build output is.
///
/// Public also because the code analyzer (`test_cabinet_code_analysis`) removes
/// exactly these names from the tree it measures, and the two must agree: a
/// directory the validator will serve a build out of is, by definition, build output
/// rather than code the model wrote. One list, read from every side, so adding a
/// fourth cannot silently start counting it.
pub const BUILD_OUTPUTS: [&str; 3] = ["dist", "build", "out"];

// --- reference builds --------------------------------------------------------

/// The filename, relative to the test-cases catalog root, the CLI writes and the
/// backend reads. It lives beside the catalog (not under a version folder) because
/// its entries span every case, version, and environment.
pub const REFERENCE_LOCK_FILENAME: &str = "reference-builds.lock.json";

// --- validation media and scripts --------------------------------------------

/// The run-root-relative directory synthesized *actual* validation media is
/// collected under, so it travels with the published implementation and is served
/// by `test_cabinet_core::playable::serve_validation_file`.
pub const VALIDATION_MEDIA_DIR: &str = ".vendor/validation";

/// The directory a case version's **baseline** validation media lives under, one
/// sub-directory per engine and variant: `validation-baseline/<engine>/<variant>/`.
/// Synthesized once at capture-baselines time from the reference implementation and
/// committed to the cold-storage submodule beneath the version's mirrored path (see
/// [`crate::ColdStorage::validation_baseline_dir`]). Ingest copies it into the stored
/// version under this same name, and the backend serves it case-scoped from there —
/// the invariant counterpart to the per-run `VALIDATION_MEDIA_DIR` *actual* media.
///
/// The engine comes first because it is what makes two captures of the same variant
/// different media: a variant has one reference implementation PER ENGINE, and the
/// two draw the same game through different runtimes, so their recordings are not
/// interchangeable. A reviewer comparing a `simple-2d` run against an engineless
/// build's frames would be shown a difference between two runtimes and read it as a
/// difference in the build.
pub const VALIDATION_BASELINE_DIR: &str = "validation-baseline";

/// The version-folder-relative directory a case's reporter-side automated-validation
/// debug scripts live under (`validation/<item>.mjs`, plus any shared modules those
/// scripts import — e.g. `validation/_helpers.mjs`). Reporter-side and **never**
/// seeded into the model's run container; the whole directory is materialized into a
/// backend-driven run's definition store (see `test_cabinet_core::materialize_version`) so a
/// script's sibling imports resolve when the validator runs it.
pub const VALIDATION_SCRIPT_DIR: &str = "validation";

/// The prefix every file of a recording's **shared image store** carries:
/// `img.<id>.png` for a bitmap and `img.<id>.bin` for a raw RGBA pixel buffer, where
/// `<id>` is derived from the bytes themselves. Only the first is written today —
/// see [`is_validation_image_name`].
///
/// A draw-command recording's images are the bulk of its weight — PNG payloads that
/// gzip cannot compress — and the same sprite is drawn by dozens of a run's
/// recordings. So the harness writes each *unique* image once as a flat file beside
/// the recordings and the entry inside the document names that file instead of
/// carrying base64 of it. The producer is `@clockwyrks/case-harness`'s
/// `replay/store.ts`, which mirrors this constant as `IMAGE_STORE_PREFIX`; the two
/// spellings must agree, and there is no negotiation between them — a name that does
/// not match here simply does not travel.
///
/// A store file deliberately shares the flat namespace of
/// `validation_media_name`'s `<verdict>__<output>.<ext>`, and can never collide
/// with one: a declared output's name always carries `__`, and a store file's never
/// does. That is what lets it route through the one-segment `/validation/{file}`
/// endpoints, publish through the media paths, and resolve in every console through
/// the very resolver the recording it belongs to came from — with no new route, key
/// shape, or lookup anywhere.
pub const VALIDATION_IMAGE_PREFIX: &str = "img.";

/// Whether `file` names a file of a recording's shared image store rather than a
/// declared output.
///
/// Both publish paths — the driver's mirror into the backend store and the snapshot
/// builder's upload — are driven off the run record's *declared* outputs. A store
/// file is on no record: it backs no verdict and is named by its own bytes, so it
/// has to be recognized off the directory instead, and this is the one place that
/// judgement is written down.
///
/// The extension is part of the check and not decoration. The namespace admits
/// exactly two shapes of bytes — a PNG bitmap and a headerless RGBA buffer — so a
/// name carrying neither extension is not something this side of the contract knows
/// how to serve a content type for, and it is left where it is rather than published
/// as an unlabelled blob. Today only the first is ever written: the harness leaves a
/// pixel buffer inline, where the recording's own gzip compresses raw RGBA far
/// better than a flat file could be served. `.bin` is recognized here because the
/// recording format admits a stored buffer and a player resolves one, so the day
/// that becomes worth writing it travels without this side changing.
pub fn is_validation_image_name(file: &str) -> bool {
    file.starts_with(VALIDATION_IMAGE_PREFIX) && (file.ends_with(".png") || file.ends_with(".bin"))
}

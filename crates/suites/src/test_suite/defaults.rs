//! The tables the [test suite](super) format leaves out.
//!
//! An asset-producing [test case
//! definition](https://docs.testcabinet.ai/test-suites/test-case-definition/)
//! names an asset and the one flag its type carries, and an `asset.toml` carries
//! only identity, kind, specification and files. Asset-generation resolution needs
//! more than that: a `[canvas]`, `[tool]` and `[output]` for a sprite kind, a
//! `[sheet]` for a sprite sheet, a `[voxel]` for a voxel or Blender kind, a
//! `[model]` for an animated voxel, a `[particle]` for a particle kind, and an
//! `[audio]` for an audio kind.
//!
//! Every one of those values is held here, in one table, with each default stated
//! next to the kind it serves — together with the asset dimension, the audio packs
//! and the scoring domain the format likewise declares nothing about. This is the
//! seam the format will grow through: when a definition gains a key for one of
//! these, the key replaces the default in this one file rather than in a lowering
//! spread across the module.

use crate::test_case::{
    AnimationSpec, AssetDimension, AssetKind, AudioSpec, CanvasSpec, DEFAULT_AUDIO_PACKS, Domain,
    ModelSpec, OutputSpec, ParticleSpec, SheetSequence, SheetSpec, ToolSpec, VoxelSpec,
};

/// The run image every suite-defined test case executes in.
///
/// The suite format declares no dimension, and every offered type is either a 2D
/// asset kind or a code-producing type whose image the type alone selects, so the
/// 2D full-stack image serves all of them.
pub(crate) const SUITE_ASSET_DIMENSION: AssetDimension = AssetDimension::TwoD;

/// The edge of the square canvas a sprite kind draws on, in pixels.
const SPRITE_CANVAS_EXTENT: u32 = 96;
/// The number of frames a sprite sheet declares.
const SHEET_FRAME_COUNT: u32 = 6;
/// The playback rate of a sprite sheet's one sequence.
const SHEET_FPS: f64 = 10.0;
/// The slug of a sprite sheet's one sequence.
const SHEET_SEQUENCE_SLUG: &str = "default";
/// The edge of the cube a voxel or Blender kind sculpts in, in voxels.
const VOXEL_EXTENT: u32 = 32;
/// The edge of the square field a particle effect plays in.
const PARTICLE_EXTENT: u32 = 128;
/// The length of a particle effect, in milliseconds.
const PARTICLE_DURATION_MS: u32 = 1500;
/// The playback rate of a particle effect.
const PARTICLE_FPS: f64 = 60.0;
/// The sample rate every audio kind renders at, in Hz.
const AUDIO_SAMPLE_RATE: u32 = 44100;
/// The cap on a sound effect's rendered clip, in milliseconds.
const SFX_MAX_DURATION_MS: u32 = 3000;
/// The cap on a musical score's rendered clip, in milliseconds.
const MUSIC_MAX_DURATION_MS: u32 = 30000;
/// The one instrument bank a musical score is sequenced over. Asset-generation
/// resolution requires a `music` case to declare exactly one pack, and seeding pins
/// the first entry as the `music` binary's instrument bank, so this must be a single
/// `instrument-bank` ref rather than the full default pack set.
const MUSIC_INSTRUMENT_BANK: &str = "gm-lite@0.1.0";
/// The animation an animated cube model is required to author. A `[model]` must fix
/// at least one animation — that required set is the whole of the rig contract a
/// case fixes — so a suite-defined animated voxel asks for a self-playing idle and
/// leaves the parts, joints and F-curves that realize it to the model.
const VOXEL_IDLE_ANIMATION: &str = "idle";

/// The clear colour behind every rendered preview. A produced asset is composited
/// over whatever the consuming build draws behind it, so nothing is assumed.
const TRANSPARENT: &str = "transparent";

/// The tables one asset kind needs and the suite format does not declare.
///
/// Every field is the resolved shape [`crate::test_case::TestCaseVersion`] carries,
/// so lowering copies these across rather than translating them.
#[derive(Debug, Clone)]
pub(crate) struct AssetDefaults {
    /// The `[canvas]` a 2D painted kind draws on.
    pub canvas: Option<CanvasSpec>,
    /// The `[tool]`: the binary the model drives and the preview it re-renders.
    /// Present for every asset kind — every one of them is authored through a tool.
    pub tool: ToolSpec,
    /// The `[output]`: where the recorded action log is collected. Present for
    /// every asset kind, for the same reason.
    pub output: OutputSpec,
    /// The `[sheet]` frame grid and sequences of a sprite sheet.
    pub sheet: Option<SheetSpec>,
    /// The `[voxel]` bounding volume of a voxel-family or Blender kind.
    pub voxel: Option<VoxelSpec>,
    /// The `[model]` rig an animated voxel kind must produce.
    pub model: Option<ModelSpec>,
    /// The `[particle]` field and timing of a particle kind.
    pub particle: Option<ParticleSpec>,
    /// The `[audio]` output format of an audio kind.
    pub audio: Option<AudioSpec>,
    /// The audio packs a run is staged with, in order.
    pub audio_packs: Vec<String>,
}

/// The tool and output pair shared by every kind whose authoring writes one file.
fn single_file_tool(binary: &str, preview: &str) -> (ToolSpec, OutputSpec) {
    (
        ToolSpec {
            binary: binary.to_string(),
            preview: preview.into(),
        },
        OutputSpec {
            actions: "actions.json".into(),
        },
    )
}

/// The tables the suite format leaves out for `kind`.
///
/// One `match` over the kinds a definition type can resolve to, each arm stating
/// the whole set that kind needs. A kind no definition type maps to gets the
/// single-sprite shape, which is the resolved default of
/// [`AssetKind`] itself.
pub(crate) fn asset_defaults(kind: AssetKind) -> AssetDefaults {
    let canvas = || CanvasSpec {
        width: SPRITE_CANVAS_EXTENT,
        height: SPRITE_CANVAS_EXTENT,
        background: TRANSPARENT.to_string(),
    };
    let volume = || VoxelSpec {
        width: VOXEL_EXTENT,
        height: VOXEL_EXTENT,
        depth: VOXEL_EXTENT,
        background: TRANSPARENT.to_string(),
    };
    match kind {
        // A sprite sheet is one canvas drawn once per frame, so its preview and its
        // action log are `{frame}` templates and it declares the grid the frames are
        // sliced out of: one sequence playing every frame in order, which is the
        // shape a single-entity sheet has.
        AssetKind::SpriteSheet => {
            let frames: Vec<u32> = (0..SHEET_FRAME_COUNT).collect();
            AssetDefaults {
                canvas: Some(canvas()),
                tool: ToolSpec {
                    binary: "draw-sheet".to_string(),
                    preview: "frames/{frame}.png".into(),
                },
                output: OutputSpec {
                    actions: "frames/{frame}.actions.json".into(),
                },
                sheet: Some(SheetSpec {
                    frame_width: SPRITE_CANVAS_EXTENT,
                    frame_height: SPRITE_CANVAS_EXTENT,
                    frames: frames.clone(),
                    sequences: vec![SheetSequence {
                        slug: SHEET_SEQUENCE_SLUG.to_string(),
                        name: "Default".to_string(),
                        frames,
                        fps: SHEET_FPS,
                    }],
                }),
                voxel: None,
                model: None,
                particle: None,
                audio: None,
                audio_packs: Vec::new(),
            }
        }
        // A static cube model: one volume, one preview, one action log.
        AssetKind::VoxelModel => {
            let (tool, output) = single_file_tool("voxel", "model.png");
            AssetDefaults {
                canvas: None,
                tool,
                output,
                sheet: None,
                voxel: Some(volume()),
                model: None,
                particle: None,
                audio: None,
                audio_packs: Vec::new(),
            }
        }
        // An animated cube model is authored one part at a time, so its preview and
        // action log are `{part}` templates. The rig contract is the required
        // animation set and nothing else: the model invents the parts, the joints and
        // the F-curves, but it must author the one animation named here, because a
        // `[model]` declaring none is refused and would otherwise resolve to a case
        // asking for no animation at all.
        AssetKind::VoxelAnimation => AssetDefaults {
            canvas: None,
            tool: ToolSpec {
                binary: "voxel-anim".to_string(),
                preview: "parts/{part}.png".into(),
            },
            output: OutputSpec {
                actions: "parts/{part}.actions.json".into(),
            },
            sheet: None,
            voxel: Some(volume()),
            model: Some(ModelSpec {
                parts: Vec::new(),
                joints: Vec::new(),
                animations: vec![AnimationSpec {
                    name: VOXEL_IDLE_ANIMATION.to_string(),
                    // The period and the driven joints are the model's to choose, so a
                    // required declaration carries a placeholder period and no joints
                    // and no tracks, exactly as authored resolution produces.
                    period_ms: 0,
                    looping: true,
                    auto_play: true,
                    joints: Vec::new(),
                    tracks: Vec::new(),
                }],
            }),
            particle: None,
            audio: None,
            audio_packs: Vec::new(),
        },
        // A Blender prop is a `build.py` run by `tcab-blend`: the script is the
        // recorded trace, and the `[voxel]` table is reused as the bounding box.
        AssetKind::BlenderProp => AssetDefaults {
            canvas: None,
            tool: ToolSpec {
                binary: "tcab-blend".to_string(),
                preview: "model.png".into(),
            },
            output: OutputSpec {
                actions: "build.py".into(),
            },
            sheet: None,
            voxel: Some(volume()),
            model: None,
            particle: None,
            audio: None,
            audio_packs: Vec::new(),
        },
        // A 2D particle effect plays in a planar field and loops, which is the
        // steady-state shape a game's effect is authored in.
        AssetKind::Particle2d => {
            let (tool, output) = single_file_tool("particle-2d", "effect.gif");
            AssetDefaults {
                canvas: None,
                tool,
                output,
                sheet: None,
                voxel: None,
                model: None,
                particle: Some(ParticleSpec {
                    width: PARTICLE_EXTENT,
                    height: PARTICLE_EXTENT,
                    depth: None,
                    duration_ms: PARTICLE_DURATION_MS,
                    fps: PARTICLE_FPS,
                    looping: true,
                    background: TRANSPARENT.to_string(),
                }),
                audio: None,
                audio_packs: Vec::new(),
            }
        }
        // A synthesized sound effect is short and mono, and reaches no instrument
        // bank: `sfx-synth` makes its sound from oscillators alone.
        AssetKind::SfxSynth => {
            let (tool, output) = single_file_tool("sfx-synth", "waveform.png");
            AssetDefaults {
                canvas: None,
                tool,
                output,
                sheet: None,
                voxel: None,
                model: None,
                particle: None,
                audio: Some(AudioSpec {
                    sample_rate: AUDIO_SAMPLE_RATE,
                    channels: "mono".to_string(),
                    max_duration_ms: SFX_MAX_DURATION_MS,
                }),
                audio_packs: Vec::new(),
            }
        }
        // A musical score is longer, stereo, and sequenced over one instrument bank —
        // exactly one, which is what asset-generation resolution requires of a `music`
        // case and what the `music` binary loads as its instrument bank. The
        // general-purpose bank serves a score whose instrumentation the suite does not
        // declare.
        AssetKind::Music => {
            let (tool, output) = single_file_tool("music", "waveform.png");
            AssetDefaults {
                canvas: None,
                tool,
                output,
                sheet: None,
                voxel: None,
                model: None,
                particle: None,
                audio: Some(AudioSpec {
                    sample_rate: AUDIO_SAMPLE_RATE,
                    channels: "stereo".to_string(),
                    max_duration_ms: MUSIC_MAX_DURATION_MS,
                }),
                audio_packs: vec![MUSIC_INSTRUMENT_BANK.to_string()],
            }
        }
        // A single sprite, and the fallback for any kind no definition type maps to.
        _ => {
            let (tool, output) = single_file_tool("draw", "canvas.png");
            AssetDefaults {
                canvas: Some(canvas()),
                tool,
                output,
                sheet: None,
                voxel: None,
                model: None,
                particle: None,
                audio: None,
                audio_packs: Vec::new(),
            }
        }
    }
}

/// The audio packs a run producing sound is staged with: the pinned default set,
/// which is what a case declaring no `[audio]` table receives.
pub(crate) fn default_audio_packs() -> Vec<String> {
    DEFAULT_AUDIO_PACKS.iter().map(|&s| s.to_string()).collect()
}

/// The single scoring domain every suite-defined test case is rated on.
///
/// The suite format declares no domains, and a suite-defined case is
/// [validator-rated](crate::test_case::TestCaseVersion::validator_rated): its
/// requirements are decided by the suite's validators, so what a reviewer rates is
/// the build as a whole. A resolved version always carries at least one domain, so
/// this is it.
pub(crate) fn default_domain() -> Domain {
    Domain {
        id: "overall".to_string(),
        name: "Overall".to_string(),
        description: "How good the result is overall — judged as a whole against the \
                      specifications the test case covers: how well it works, how well it is \
                      made, and how faithfully it matches what was asked for."
            .to_string(),
    }
}

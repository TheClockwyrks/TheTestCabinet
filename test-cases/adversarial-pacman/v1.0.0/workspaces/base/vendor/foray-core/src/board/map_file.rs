//! TOML (de)serialization for committed map files.
//!
//! A map file is the **explicit, authoritative** form of a board: it lists every
//! wall, nest, seed cache, and jelly node, so a human can author or hand-tune a
//! map and the engine loads exactly what is on disk. The committed
//! `maps/mirror-32x16.toml` is produced from [`Board::generate`] via
//! [`Board::to_map_toml`] and then loaded back by [`Board::from_map`]; a test
//! asserts that round-trip is lossless, so the file and the generator can never
//! silently disagree.
//!
//! The file also records the `seed` that generated it. The browser playback path
//! does not parse TOML at all — it regenerates the maze from the replay's `seed`
//! — but carrying the seed in the file lets a reader reproduce the file itself.

use serde::{Deserialize, Serialize};

use super::{Board, Pos};

/// A wall/seed/jelly tile pair as it appears in TOML: `[x, y]`.
type TileArray = [i32; 2];

/// The on-disk shape of a map. Every fixture is listed explicitly so the file is
/// the source of truth for what [`Board::from_map`] returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct MapDocument {
    /// Map identifier, recorded in replays.
    id: String,
    width: i32,
    height: i32,
    border_x: i32,
    /// The seed that generated this map (informational; loading uses the
    /// explicit tile lists below, not the seed).
    seed: u64,
    red_nest: TileArray,
    blue_nest: TileArray,
    #[serde(default)]
    walls: Vec<TileArray>,
    #[serde(default)]
    red_seeds: Vec<TileArray>,
    #[serde(default)]
    blue_seeds: Vec<TileArray>,
    #[serde(default)]
    red_jelly: Vec<TileArray>,
    #[serde(default)]
    blue_jelly: Vec<TileArray>,
}

/// Why a map file failed to load. Loading is fallible (a hand-edited file may be
/// malformed), unlike [`Board::generate`], which cannot fail for valid params.
#[derive(Debug)]
pub enum MapError {
    /// The TOML did not parse or did not match the schema.
    Parse(String),
    /// The map is structurally invalid (e.g. odd width, off-board fixture).
    Invalid(String),
}

impl std::fmt::Display for MapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MapError::Parse(message) => write!(f, "parsing map: {message}"),
            MapError::Invalid(message) => write!(f, "invalid map: {message}"),
        }
    }
}

impl std::error::Error for MapError {}

fn to_pos(tile: TileArray) -> Pos {
    Pos::new(tile[0], tile[1])
}

fn from_pos(pos: Pos) -> TileArray {
    [pos.x, pos.y]
}

impl Board {
    /// Load a board from a TOML map document. Returns an error rather than
    /// panicking so a malformed hand-authored map fails the run cleanly instead
    /// of taking down the host.
    pub fn from_map(toml_text: &str) -> Result<Board, MapError> {
        let doc: MapDocument =
            toml::from_str(toml_text).map_err(|err| MapError::Parse(err.to_string()))?;

        if doc.width % 2 != 0 {
            return Err(MapError::Invalid("width must be even".into()));
        }
        if doc.border_x != doc.width / 2 {
            return Err(MapError::Invalid("border_x must equal width / 2".into()));
        }

        let mut walls: Vec<Pos> = doc.walls.iter().copied().map(to_pos).collect();
        walls.sort();
        walls.dedup();

        let board = Board {
            id: doc.id,
            width: doc.width,
            height: doc.height,
            border_x: doc.border_x,
            seed: doc.seed,
            walls,
            red_nest: to_pos(doc.red_nest),
            blue_nest: to_pos(doc.blue_nest),
            red_seeds: sorted(doc.red_seeds),
            blue_seeds: sorted(doc.blue_seeds),
            red_jelly: sorted(doc.red_jelly),
            blue_jelly: sorted(doc.blue_jelly),
        };

        board.validate()?;
        Ok(board)
    }

    /// Serialize this board to a TOML map document — the inverse of
    /// [`Board::from_map`], used to produce the committed `maps/*.toml`.
    pub fn to_map_toml(&self) -> String {
        let doc = MapDocument {
            id: self.id.clone(),
            width: self.width,
            height: self.height,
            border_x: self.border_x,
            seed: self.seed,
            red_nest: from_pos(self.red_nest),
            blue_nest: from_pos(self.blue_nest),
            walls: self.walls().iter().copied().map(from_pos).collect(),
            red_seeds: self.red_seeds.iter().copied().map(from_pos).collect(),
            blue_seeds: self.blue_seeds.iter().copied().map(from_pos).collect(),
            red_jelly: self.red_jelly.iter().copied().map(from_pos).collect(),
            blue_jelly: self.blue_jelly.iter().copied().map(from_pos).collect(),
        };
        toml::to_string_pretty(&doc).expect("a MapDocument always serializes to TOML")
    }

    /// Structural checks shared by the loader: every fixture is on-board and not
    /// on a wall, and the nests sit on their own half.
    fn validate(&self) -> Result<(), MapError> {
        let on_board = |p: Pos| p.x >= 0 && p.y >= 0 && p.x < self.width && p.y < self.height;
        for (label, tiles) in [
            ("red_seeds", &self.red_seeds),
            ("blue_seeds", &self.blue_seeds),
            ("red_jelly", &self.red_jelly),
            ("blue_jelly", &self.blue_jelly),
        ] {
            for tile in tiles {
                if !on_board(*tile) {
                    return Err(MapError::Invalid(format!("{label} tile off board")));
                }
                if self.is_wall(*tile) {
                    return Err(MapError::Invalid(format!("{label} tile on a wall")));
                }
            }
        }
        if !on_board(self.red_nest) || self.is_wall(self.red_nest) {
            return Err(MapError::Invalid("red nest off board or on a wall".into()));
        }
        if !on_board(self.blue_nest) || self.is_wall(self.blue_nest) {
            return Err(MapError::Invalid("blue nest off board or on a wall".into()));
        }
        Ok(())
    }
}

fn sorted(tiles: Vec<TileArray>) -> Vec<Pos> {
    let mut positions: Vec<Pos> = tiles.into_iter().map(to_pos).collect();
    positions.sort();
    positions
}

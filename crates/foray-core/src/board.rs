//! The board: a tile-locked, mirror-symmetric maze and the fixtures laid on it.
//!
//! A [`Board`] is static for the whole match — walls, nests, the border column,
//! and the *initial* seed-cache and royal-jelly placements never change after
//! construction (the live, mutable counts of seeds and jelly live in
//! [`crate::state`], not here). The board can be produced two ways that yield the
//! *same* structure for a given `(seed, dimensions)`:
//!
//! - [`Board::generate`] — the deterministic generator. It builds **one half**
//!   and mirrors every wall, nest, seed, and jelly across the centre line, so
//!   neither colony ever starts with a structural advantage (the core promise of
//!   the [overview](../../../apps/docs/.../overview.md)).
//! - [`Board::from_map`] — the TOML map loader, for human-authored or committed
//!   maps. A loaded map records its `seed` so a replay that names the map id can
//!   regenerate the identical maze in the browser without shipping the file.
//!
//! Mirroring uses the reflection `x -> width - 1 - x`, which fixes the border:
//! Red's column `border_x - 1` mirrors to Blue's column `border_x`, so the
//! contested seam is symmetric and the two halves are exact reflections.

use serde::{Deserialize, Serialize};

use crate::rng::SplitMix64;

/// Which colony a tile or agent belongs to. Red holds the west half, Blue the
/// east; an agent's *role* (soldier vs. raider) is derived from the half it
/// stands on, not from the colony it belongs to — see [`crate::state`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum Team {
    /// The west colony (lower columns).
    Red,
    /// The east colony (higher columns).
    Blue,
}

impl Team {
    /// The opposing colony.
    pub fn opponent(self) -> Team {
        match self {
            Team::Red => Team::Blue,
            Team::Blue => Team::Red,
        }
    }
}

/// A tile coordinate. Stored as `i32` so off-board candidates produced during
/// movement can be represented and then clamped, rather than wrapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct Pos {
    /// Column, `0` at the west wall.
    pub x: i32,
    /// Row, `0` at the top.
    pub y: i32,
}

impl Pos {
    /// Construct a position.
    pub const fn new(x: i32, y: i32) -> Pos {
        Pos { x, y }
    }
}

/// The static maze and fixtures. Cheap to clone (a few small vectors), which the
/// reconstruct path relies on to start each replay from a pristine copy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Board {
    /// Identifier recorded in replays (e.g. `"mirror-32x16"`).
    pub id: String,
    /// Board width in tiles.
    pub width: i32,
    /// Board height in tiles.
    pub height: i32,
    /// The first column belonging to Blue's half. Columns `0..border_x` are
    /// Red's half; `border_x..width` are Blue's. The reflection axis sits exactly
    /// between `border_x - 1` and `border_x`.
    pub border_x: i32,
    /// The seed that produced this maze (for generated boards; carried so a
    /// replay can regenerate the maze from the id + seed alone).
    pub seed: u64,
    /// Blocked tiles, sorted for deterministic serialization and fast lookup.
    walls: Vec<Pos>,
    /// Per-team spawn/respawn nest tile.
    red_nest: Pos,
    blue_nest: Pos,
    /// Initial seed-cache tiles (Red's caches sit on Red's half; Blue's on
    /// Blue's). These are the *starting* placements — the live caches (including
    /// dropped ones) live in [`crate::state::MatchState`].
    red_seeds: Vec<Pos>,
    blue_seeds: Vec<Pos>,
    /// Initial royal-jelly node tiles, one list per half.
    red_jelly: Vec<Pos>,
    blue_jelly: Vec<Pos>,
    /// Initial **large** seed tiles — the spawn (and recall) home of each large
    /// seed, one list per half. A large seed is worth [`Rules::large_seed_value`]
    /// ordinary seeds and drifts toward the border in play; these are only its
    /// starting tiles. Placed deep in the half, so drifting it out is a journey.
    ///
    /// [`Rules::large_seed_value`]: crate::config::Rules::large_seed_value
    red_large_seeds: Vec<Pos>,
    blue_large_seeds: Vec<Pos>,
}

impl Board {
    /// The half a column belongs to. The border column itself is the first
    /// Blue-half column, matching `border_x`.
    pub fn team_of_column(&self, x: i32) -> Team {
        if x < self.border_x {
            Team::Red
        } else {
            Team::Blue
        }
    }

    /// Whether `pos` is inside the board and not a wall — the only tiles an agent
    /// may occupy. Movement clamps any move whose target fails this to `Stop`.
    pub fn is_passable(&self, pos: Pos) -> bool {
        self.in_bounds(pos) && !self.is_wall(pos)
    }

    /// Whether `pos` lies within the board rectangle.
    pub fn in_bounds(&self, pos: Pos) -> bool {
        pos.x >= 0 && pos.y >= 0 && pos.x < self.width && pos.y < self.height
    }

    /// Whether `pos` is a wall tile.
    pub fn is_wall(&self, pos: Pos) -> bool {
        self.walls.binary_search(&pos).is_ok()
    }

    /// The static wall tiles, sorted.
    pub fn walls(&self) -> &[Pos] {
        &self.walls
    }

    /// The spawn/respawn nest for `team`.
    pub fn nest(&self, team: Team) -> Pos {
        match team {
            Team::Red => self.red_nest,
            Team::Blue => self.blue_nest,
        }
    }

    /// The initial seed caches a *raider* of the opposing team eats — i.e. the
    /// caches on `team`'s home half, which the opponent raids.
    pub fn initial_seeds(&self, team: Team) -> &[Pos] {
        match team {
            Team::Red => &self.red_seeds,
            Team::Blue => &self.blue_seeds,
        }
    }

    /// The initial (spawn/recall home) tiles of the large seeds on `team`'s half —
    /// the ones the opposing team raids.
    pub fn initial_large_seeds(&self, team: Team) -> &[Pos] {
        match team {
            Team::Red => &self.red_large_seeds,
            Team::Blue => &self.blue_large_seeds,
        }
    }

    /// The column a drifting large seed of `team` comes to rest on: the **last column
    /// of its own half**, hard against the border. Red's is `border_x - 1`, Blue's is
    /// `border_x`.
    ///
    /// Nothing but the border stops a large seed. It is not held back at some tuned
    /// distance — it walks until it physically cannot go further without crossing,
    /// and there it sits, on the seam, one step from an enemy raider who can take it
    /// and bank it by stepping straight home. That is the whole pressure of the
    /// mechanic: a seed you ignore does not merely become *reachable*, it becomes
    /// nearly free. What it never does is cross on its own — a seed is stolen by a
    /// raid, never conceded by the clock.
    pub fn stop_column(&self, team: Team) -> i32 {
        match team {
            Team::Red => self.border_x - 1,
            Team::Blue => self.border_x,
        }
    }

    /// The tile a large seed born at `home` drifts toward — its own **lane** on the
    /// border column.
    ///
    /// Each seed gets a distinct destination rather than "any tile in the column".
    /// Targeting the column alone was subtly wrong: a shortest path finds whichever
    /// tile of that column is nearest, so two seeds on one half funnel down the same
    /// tunnel and come to rest side by side — two objectives collapsing into one
    /// cluster that a single defender covers. Picking the reachable tile closest to
    /// the seed's own spawn row keeps them in separate lanes, and `taken` stops two
    /// seeds claiming the same one.
    ///
    /// Returns `None` when walls cut the border column off from this spawn; the seed
    /// then simply never drifts, which is inert rather than a panic.
    pub fn drift_target(&self, home: Pos, team: Team, taken: &[Pos]) -> Option<Pos> {
        let stop_x = self.stop_column(team);
        let reachable = self.home_distances(home, team);
        let mut lanes: Vec<Pos> = (0..self.height)
            .map(|y| Pos::new(stop_x, y))
            .filter(|p| reachable.contains_key(p) && !taken.contains(p))
            .collect();
        // Nearest to the seed's own spawn row, ties broken by row for determinism.
        lanes.sort_by_key(|p| ((p.y - home.y).abs(), p.y));
        lanes.first().copied()
    }

    /// The shortest path through the maze from `from` to `to`, staying on `team`'s
    /// half, **excluding** `from`. Used one step at a time as a large seed drifts, so
    /// a seed knocked off its route (dropped by a tagged raider) simply re-paths from
    /// wherever it landed.
    ///
    /// Neighbours are expanded in a fixed N/S/E/W order over a FIFO queue, so the path
    /// is a deterministic function of the board — which it must be: the engine is
    /// re-simulated from the input log on playback, and a path that varied between
    /// runs would desync every replay.
    pub fn path_to(&self, from: Pos, to: Pos, team: Team) -> Vec<Pos> {
        if from == to || !self.is_passable(from) || !self.is_passable(to) {
            return Vec::new();
        }
        let mut came_from: std::collections::HashMap<Pos, Pos> = std::collections::HashMap::new();
        let mut seen: std::collections::HashSet<Pos> = std::collections::HashSet::new();
        let mut queue: std::collections::VecDeque<Pos> = std::collections::VecDeque::new();
        seen.insert(from);
        queue.push_back(from);

        let mut found = false;
        while let Some(cur) = queue.pop_front() {
            if cur == to {
                found = true;
                break;
            }
            for next in [
                Pos::new(cur.x, cur.y - 1),
                Pos::new(cur.x, cur.y + 1),
                Pos::new(cur.x + 1, cur.y),
                Pos::new(cur.x - 1, cur.y),
            ] {
                if !self.is_passable(next)
                    || self.team_of_column(next.x) != team
                    || !seen.insert(next)
                {
                    continue;
                }
                came_from.insert(next, cur);
                queue.push_back(next);
            }
        }
        if !found {
            return Vec::new();
        }

        // Walk the parent chain back, then flip it. `from` is dropped: the path is the
        // tiles the seed *moves to*, one per drift step.
        let mut path = Vec::new();
        let mut cur = to;
        while cur != from {
            path.push(cur);
            cur = came_from[&cur];
        }
        path.reverse();
        path
    }

    /// Maze distance from `home` to every reachable tile on `team`'s half. Used to
    /// decide whether a large seed has drifted far enough from its spawn to be
    /// recalled — a lookup, not a search, because it is read every tick.
    ///
    /// Keyed on the seed's *home* rather than its path so a seed that was dropped
    /// somewhere unexpected (a raider carrying it was tagged mid-maze) still gets a
    /// sensible answer, instead of one derived from a path it is no longer on.
    pub fn home_distances(&self, home: Pos, team: Team) -> std::collections::BTreeMap<Pos, u32> {
        let mut dist = std::collections::BTreeMap::new();
        if !self.is_passable(home) {
            return dist;
        }
        let mut queue = std::collections::VecDeque::new();
        dist.insert(home, 0u32);
        queue.push_back(home);
        while let Some(cur) = queue.pop_front() {
            let d = dist[&cur];
            for next in [
                Pos::new(cur.x, cur.y - 1),
                Pos::new(cur.x, cur.y + 1),
                Pos::new(cur.x + 1, cur.y),
                Pos::new(cur.x - 1, cur.y),
            ] {
                if !self.is_passable(next)
                    || self.team_of_column(next.x) != team
                    || dist.contains_key(&next)
                {
                    continue;
                }
                dist.insert(next, d + 1);
                queue.push_back(next);
            }
        }
        dist
    }

    /// The initial royal-jelly nodes on `team`'s half.
    pub fn initial_jelly(&self, team: Team) -> &[Pos] {
        match team {
            Team::Red => &self.red_jelly,
            Team::Blue => &self.blue_jelly,
        }
    }

    /// The reflection of `pos` across the vertical centre line. Used by the
    /// generator and asserted by tests: a mirrored maze must satisfy
    /// `is_wall(p) == is_wall(mirror(p))` for every tile.
    pub fn mirror(&self, pos: Pos) -> Pos {
        Pos::new(self.width - 1 - pos.x, pos.y)
    }
}

/// Tunable knobs the generator works from. Kept as data (not hard-coded
/// constants) so the manifest/specs can retune the board without touching the
/// engine — board geometry is explicitly *not* load-bearing (lead decision 5).
#[derive(Debug, Clone, Copy)]
pub struct BoardParams {
    /// Total width in tiles. Must be even so the mirror axis falls between two
    /// columns and `border_x == width / 2`.
    pub width: i32,
    /// Total height in tiles.
    pub height: i32,
    /// Ordinary seed caches to place per half.
    pub seeds_per_half: usize,
    /// Large seeds to place per half. Each is worth
    /// [`Rules::large_seed_value`](crate::config::Rules::large_seed_value) ordinary
    /// seeds and is **carved out of** the half's total, not added on top: the shipped
    /// numbers are 14 ordinary + 2 large x 3 = 20, exactly the value a half held
    /// before large seeds existed. Adding them on top would have raised the sweep bar
    /// and pushed more matches to the time limit — the opposite of the intent.
    pub large_seeds_per_half: usize,
    /// Royal-jelly nodes to place per half.
    pub jelly_per_half: usize,
    /// Out of every 10 interior floor tiles, roughly how many to turn into wall
    /// pillars before the connectivity repair pass. Higher is denser.
    pub wall_density_tenths: u32,
}

impl Default for BoardParams {
    /// The shipped `mirror-32x16` defaults (lead decision 5): 32x16, 2 jelly nodes
    /// per half, and a half worth 20 points — now split as 14 ordinary caches plus
    /// 2 large seeds at 3 apiece.
    fn default() -> BoardParams {
        BoardParams {
            width: 32,
            height: 16,
            seeds_per_half: 14,
            large_seeds_per_half: 2,
            jelly_per_half: 2,
            wall_density_tenths: 3,
        }
    }
}

impl Board {
    /// Deterministically generate a mirror-symmetric maze from `seed`.
    ///
    /// Strategy: carve walls only on the **left half** (`0..border_x`), repair
    /// connectivity on that half, then mirror every wall, nest, seed, and jelly
    /// to the right half. Mirroring after the repair guarantees both halves are
    /// exact reflections *and* both are fully connected, since connectivity is a
    /// property of the half's shape and the reflection preserves it. The two
    /// near-border columns are kept floor so an agent can always cross.
    pub fn generate(id: impl Into<String>, params: BoardParams, seed: u64) -> Board {
        assert!(params.width % 2 == 0, "board width must be even to mirror");
        assert!(params.width >= 8 && params.height >= 4, "board too small");

        let width = params.width;
        let height = params.height;
        let border_x = width / 2;
        let mut rng = SplitMix64::new(seed);

        // 1. Lay wall pillars on the interior of the left half. The outer frame
        //    (top/bottom rows, west wall) is always wall; the two columns nearest
        //    the border stay floor so crossing is never blocked.
        let mut left_walls: Vec<Pos> = Vec::new();
        let crossing_lane = border_x - 1; // keep this column (and the border col) open
        for y in 0..height {
            for x in 0..border_x {
                let pos = Pos::new(x, y);
                let frame = y == 0 || y == height - 1 || x == 0;
                let near_border = x >= crossing_lane;
                if frame {
                    if !near_border {
                        left_walls.push(pos);
                    }
                } else if !near_border && rng.chance(params.wall_density_tenths, 10) {
                    left_walls.push(pos);
                }
            }
        }
        left_walls.sort();
        left_walls.dedup();

        // 2. Repair connectivity on the left half: every floor tile must reach
        //    the nest. Any floor tile that cannot is acceptable to leave (it is
        //    just unreachable space), but we must guarantee the *nest*, the
        //    *seeds*, and the *jelly* we place later sit in the connected region.
        //    Easiest robust guarantee: knock down any wall that fully isolates a
        //    floor region from the main one. We do this by flood-filling from the
        //    nest and removing walls bordering an unreached floor tile until the
        //    whole left half's floor is one connected region.
        let nest = Pos::new(1, height / 2);
        left_walls.retain(|w| *w != nest); // never wall the nest
        connect_left_half(&mut left_walls, border_x, height, nest);

        // 3. Place seeds and jelly on connected left-half floor tiles, away from
        //    the nest and the crossing lane (so fixtures are reachable and not
        //    sitting on the border seam).
        let reachable = reachable_floor(&left_walls, border_x, height, nest);
        let mut candidates: Vec<Pos> = reachable
            .into_iter()
            .filter(|p| *p != nest && p.x < crossing_lane && p.x > 0)
            .collect();
        candidates.sort();
        // Shuffle deterministically (Fisher–Yates) so placements are spread.
        for i in (1..candidates.len()).rev() {
            let j = rng.below(i + 1);
            candidates.swap(i, j);
        }

        let mut left_seeds: Vec<Pos> = Vec::new();
        let mut left_jelly: Vec<Pos> = Vec::new();
        let mut taken = std::collections::HashSet::new();
        for pos in &candidates {
            if left_jelly.len() < params.jelly_per_half {
                left_jelly.push(*pos);
                taken.insert(*pos);
            } else {
                break;
            }
        }
        for pos in &candidates {
            if taken.contains(pos) {
                continue;
            }
            if left_seeds.len() < params.seeds_per_half {
                left_seeds.push(*pos);
                taken.insert(*pos);
            } else {
                break;
            }
        }

        // Large seeds go DEEP: of the tiles still free, take the ones furthest from
        // the border (smallest `x` on the left half), breaking ties by `y` for a
        // stable pick. Depth is the whole point — a large seed's drift toward the
        // border has to be a real journey, and a raider coming for one has to commit
        // to crossing the defender's territory rather than snatching it off the seam.
        //
        // This pass draws no randomness and runs *after* the jelly and cache passes,
        // so it cannot perturb the RNG stream that placed them: the maze, the jelly,
        // and the first `seeds_per_half` caches are bit-for-bit what they were.
        let mut deep: Vec<Pos> = candidates
            .iter()
            .copied()
            .filter(|p| !taken.contains(p))
            .collect();
        deep.sort_by_key(|p| (p.x, p.y));

        // Take the deepest tiles, but keep them APART. Depth alone puts them in the
        // same back column on adjacent rows, and two large seeds that start together
        // drift together — they converge on one rest tile and collapse into a single
        // object a raider scoops up in one step. Spreading them makes each a separate
        // problem for the defence, which is the entire point of having two.
        let min_separation = (height / 3).max(2);
        let mut left_large: Vec<Pos> = Vec::new();
        for pos in &deep {
            if left_large.len() >= params.large_seeds_per_half {
                break;
            }
            let far_enough = left_large.iter().all(|other: &Pos| {
                (pos.x - other.x).abs() + (pos.y - other.y).abs() >= min_separation
            });
            if far_enough {
                left_large.push(*pos);
            }
        }
        // A cramped maze may not offer that much room; rather than place fewer seeds
        // than asked for, fall back to the deepest tiles left.
        for pos in &deep {
            if left_large.len() >= params.large_seeds_per_half {
                break;
            }
            if !left_large.contains(pos) {
                left_large.push(*pos);
            }
        }

        left_seeds.sort();
        left_jelly.sort();
        left_large.sort();

        // 4. Mirror everything to the right half.
        let mirror = |p: Pos| Pos::new(width - 1 - p.x, p.y);
        let mut walls = left_walls.clone();
        walls.extend(left_walls.iter().map(|p| mirror(*p)));
        walls.sort();
        walls.dedup();

        // Keep every fixture list sorted so a generated board is byte-identical
        // to one round-tripped through the TOML loader (which sorts on read).
        let red_seeds = left_seeds.clone();
        let mut blue_seeds: Vec<Pos> = left_seeds.iter().map(|p| mirror(*p)).collect();
        blue_seeds.sort();
        let red_jelly = left_jelly.clone();
        let mut blue_jelly: Vec<Pos> = left_jelly.iter().map(|p| mirror(*p)).collect();
        blue_jelly.sort();
        let red_large_seeds = left_large.clone();
        let mut blue_large_seeds: Vec<Pos> = left_large.iter().map(|p| mirror(*p)).collect();
        blue_large_seeds.sort();

        Board {
            id: id.into(),
            width,
            height,
            border_x,
            seed,
            walls,
            red_nest: nest,
            blue_nest: mirror(nest),
            red_seeds,
            blue_seeds,
            red_jelly,
            blue_jelly,
            red_large_seeds,
            blue_large_seeds,
        }
    }
}

/// Knock down walls until every floor tile on the left half that *can* be made
/// reachable from `nest` is reachable. We repeatedly flood-fill from the nest and,
/// if any floor tile is still unreached, remove one wall that separates it from
/// the reached region; we stop when a full pass adds no walls to remove (the
/// region is connected as much as the frame allows).
fn connect_left_half(walls: &mut Vec<Pos>, border_x: i32, height: i32, nest: Pos) {
    use std::collections::HashSet;
    loop {
        let wall_set: HashSet<Pos> = walls.iter().copied().collect();
        let reached = flood(&wall_set, border_x, height, nest);
        // Find an unreached floor tile adjacent (4-neighbour) to a reached tile
        // through a single wall — i.e. a wall whose removal connects new floor.
        let mut removed = None;
        'scan: for y in 0..height {
            for x in 0..border_x {
                let pos = Pos::new(x, y);
                if !wall_set.contains(&pos) || x == 0 || y == 0 || y == height - 1 {
                    continue; // skip floor and the protected frame
                }
                // A removable wall is one with a reached neighbour and an
                // unreached floor neighbour — removing it grows the region.
                let neighbours = [
                    Pos::new(x - 1, y),
                    Pos::new(x + 1, y),
                    Pos::new(x, y - 1),
                    Pos::new(x, y + 1),
                ];
                let touches_reached = neighbours.iter().any(|n| reached.contains(n));
                let touches_unreached_floor = neighbours.iter().any(|n| {
                    n.x >= 0
                        && n.x < border_x
                        && n.y >= 0
                        && n.y < height
                        && !wall_set.contains(n)
                        && !reached.contains(n)
                });
                if touches_reached && touches_unreached_floor {
                    removed = Some(pos);
                    break 'scan;
                }
            }
        }
        match removed {
            Some(pos) => walls.retain(|w| *w != pos),
            None => break,
        }
    }
    walls.sort();
}

/// Flood-fill the connected floor region containing `start` on the left half.
fn flood(
    walls: &std::collections::HashSet<Pos>,
    border_x: i32,
    height: i32,
    start: Pos,
) -> std::collections::HashSet<Pos> {
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    let mut stack = vec![start];
    while let Some(pos) = stack.pop() {
        if pos.x < 0 || pos.y < 0 || pos.x >= border_x || pos.y >= height {
            continue;
        }
        if walls.contains(&pos) || !seen.insert(pos) {
            continue;
        }
        stack.push(Pos::new(pos.x - 1, pos.y));
        stack.push(Pos::new(pos.x + 1, pos.y));
        stack.push(Pos::new(pos.x, pos.y - 1));
        stack.push(Pos::new(pos.x, pos.y + 1));
    }
    seen
}

/// The set of left-half floor tiles reachable from `nest`.
fn reachable_floor(
    walls: &[Pos],
    border_x: i32,
    height: i32,
    nest: Pos,
) -> std::collections::HashSet<Pos> {
    let wall_set: std::collections::HashSet<Pos> = walls.iter().copied().collect();
    flood(&wall_set, border_x, height, nest)
}

#[cfg(feature = "map-toml")]
mod map_file;
#[cfg(feature = "map-toml")]
pub use map_file::MapError;

//! A passability grid and a breadth-first pathfinder over the maze.
//!
//! The reference controllers that actually navigate (`greedy-raider`,
//! `border-soldier`) need to answer one question repeatedly: *from tile A, which
//! cardinal step starts a shortest path to tile B, avoiding walls?* This module
//! answers exactly that with a BFS over the board, built once per tick from the
//! observation's static [`BoardView`](foray_core::contract::BoardView). The board
//! is small (a few hundred tiles), so a fresh BFS per query is comfortably within
//! the controller's fuel budget and keeps the controllers stateless and easy to
//! read.

use std::collections::{HashSet, VecDeque};

use foray_core::contract::BoardView;
use foray_core::{Dir, World};

/// A static passability grid for one match tick: board dimensions, the border
/// column, and the wall set. Cheap to build from a [`World`] and reused for every
/// pathfinding query a controller makes that tick.
pub struct Grid {
    width: i32,
    height: i32,
    /// First column belonging to Blue's half (mirrors the engine's `border_x`).
    border_x: i32,
    walls: HashSet<(i32, i32)>,
}

impl Grid {
    /// Build the grid from a team's observation.
    pub fn from_world(world: &World) -> Grid {
        Grid::from_board(&world.board)
    }

    /// Build the grid directly from the board view.
    pub fn from_board(board: &BoardView) -> Grid {
        Grid {
            width: board.width,
            height: board.height,
            border_x: board.border_x,
            walls: board.walls.iter().map(|w| (w[0], w[1])).collect(),
        }
    }

    /// Board width in tiles.
    pub fn width(&self) -> i32 {
        self.width
    }

    /// Board height in tiles.
    pub fn height(&self) -> i32 {
        self.height
    }

    /// The first column belonging to Blue's half. Columns `0..border_x` are Red's
    /// half; `border_x..width` are Blue's.
    pub fn border_x(&self) -> i32 {
        self.border_x
    }

    /// Whether `(x, y)` is on the board and not a wall — a tile an agent may stand
    /// on. Matches [`foray_core::Board::is_passable`].
    pub fn is_passable(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.width && y < self.height && !self.walls.contains(&(x, y))
    }

    /// The four cardinal neighbours of `(x, y)` that are passable, each tagged with
    /// the [`Dir`] that reaches it.
    fn passable_neighbours(&self, x: i32, y: i32) -> impl Iterator<Item = (Dir, i32, i32)> + '_ {
        const STEPS: [(Dir, i32, i32); 4] = [
            (Dir::N, 0, -1),
            (Dir::S, 0, 1),
            (Dir::E, 1, 0),
            (Dir::W, -1, 0),
        ];
        STEPS.into_iter().filter_map(move |(dir, dx, dy)| {
            let (nx, ny) = (x + dx, y + dy);
            self.is_passable(nx, ny).then_some((dir, nx, ny))
        })
    }

    /// The first step of a shortest path from `(sx, sy)` to any tile satisfying
    /// `goal`, or `None` if no passable path reaches one (or the start already is a
    /// goal — there is no step to take).
    ///
    /// A BFS from the start: the first time the frontier touches a goal tile, the
    /// direction stored for that frontier traces back to the *initial* step taken
    /// from the start, which is what a controller needs to move one tile this tick.
    /// Ties are broken by the fixed N/S/E/W neighbour order, so paths are
    /// deterministic across ticks (no flip-flopping between equal-length routes).
    pub fn step_toward(&self, sx: i32, sy: i32, goal: impl Fn(i32, i32) -> bool) -> Option<Dir> {
        if goal(sx, sy) {
            return None;
        }
        let mut visited: HashSet<(i32, i32)> = HashSet::new();
        visited.insert((sx, sy));
        // Each queued tile carries the first step that began the path reaching it.
        let mut queue: VecDeque<(i32, i32, Dir)> = VecDeque::new();
        for (dir, nx, ny) in self.passable_neighbours(sx, sy) {
            if visited.insert((nx, ny)) {
                if goal(nx, ny) {
                    return Some(dir);
                }
                queue.push_back((nx, ny, dir));
            }
        }
        while let Some((x, y, first)) = queue.pop_front() {
            for (_, nx, ny) in self.passable_neighbours(x, y) {
                if visited.insert((nx, ny)) {
                    if goal(nx, ny) {
                        return Some(first);
                    }
                    queue.push_back((nx, ny, first));
                }
            }
        }
        None
    }

    /// The shortest-path *distance* in tiles from `(sx, sy)` to the nearest tile
    /// satisfying `goal`, or `None` if none is reachable. Used to pick the nearest
    /// of several targets by true maze distance rather than straight-line guesses.
    pub fn distance_to(&self, sx: i32, sy: i32, goal: impl Fn(i32, i32) -> bool) -> Option<u32> {
        if goal(sx, sy) {
            return Some(0);
        }
        let mut visited: HashSet<(i32, i32)> = HashSet::new();
        visited.insert((sx, sy));
        let mut queue: VecDeque<(i32, i32, u32)> = VecDeque::new();
        queue.push_back((sx, sy, 0));
        while let Some((x, y, dist)) = queue.pop_front() {
            for (_, nx, ny) in self.passable_neighbours(x, y) {
                if visited.insert((nx, ny)) {
                    if goal(nx, ny) {
                        return Some(dist + 1);
                    }
                    queue.push_back((nx, ny, dist + 1));
                }
            }
        }
        None
    }

    /// Which half column `x` belongs to relative to `team`'s home: `true` when `x`
    /// is on `team`'s **own** half (where the agent is a soldier), `false` on the
    /// enemy half (where it is a raider). Mirrors the engine's `team_of_column`.
    pub fn is_own_half(&self, team: foray_core::Team, x: i32) -> bool {
        let column_team = if x < self.border_x {
            foray_core::Team::Red
        } else {
            foray_core::Team::Blue
        };
        column_team == team
    }

    /// The set of legal directions an agent at `(x, y)` may step (those whose
    /// target is passable). `Stop` is always legal and is appended last, so a
    /// caller that wants "a legal move, preferring to actually move" can take the
    /// first entry after shuffling the movers.
    pub fn legal_dirs(&self, x: i32, y: i32) -> Vec<Dir> {
        let mut dirs: Vec<Dir> = self
            .passable_neighbours(x, y)
            .map(|(dir, _, _)| dir)
            .collect();
        dirs.push(Dir::Stop);
        dirs
    }
}

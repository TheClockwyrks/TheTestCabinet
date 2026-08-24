# Refract — The campaign boards

This file gives the layout of every board the campaign is played on:
`CAMPAIGN_LENGTH` (`24`) boards, numbered `1` through `24` in the order they are
played. It is authoritative for all of them. Build every board exactly as written
here, with the same dimensions and the same character in every cell.

The notation is defined in `specs/board.md`, and the rules a beam obeys on every
one of these boards are in `specs/beams.md`.

<!-- cspell:ignoreRegExp /^[.TSD123tsd]+$/gm -->

Each heading gives a board's number and its size as `cols x rows`, so a board of
`5 x 4` is five columns wide and four rows tall and the block below it carries
four lines of five characters each.

The boards fall into four sets of six, Set A through Set D, in play order. A set
is a grouping the player is shown; it carries no rule of its own, and the
sentences that head each set below describe what the boards in it hold.

## Set A: boards 1 to 6

The smallest boards, each carrying a single channel and no crystals. One beam
runs between the channel's two emitters and threads every lens on the board.

### Board 1 (3 x 3)

```
.t.
.tT
T..
```

### Board 2 (3 x 3)

```
.T.
t.T
tt.
```

### Board 3 (4 x 3)

```
tT..
t.tT
.t..
```

### Board 4 (4 x 3)

```
.t..
t.tT
.tTt
```

### Board 5 (4 x 4)

```
..t.
.tt.
.tTt
T..t
```

### Board 6 (4 x 4)

```
.t.T
t.t.
tt..
tTt.
```

## Set B: boards 7 to 12

A second channel joins the bench, and the first crystals appear. One board in
this set stands a single crystal in front of one channel on its own, and the
crystal there takes a single crossing; the crystals after it take two.

### Board 7 (4 x 4)

```
...S
tTs.
t.Ss
.tTs
```

### Board 8 (5 x 4)

```
..t..
tt.t.
TS.Ts
..ssS
```

### Board 9 (4 x 4)

```
T...
t.T.
.t1t
...t
```

### Board 10 (5 x 4)

```
Tt...
Sstt.
..2.T
.Ss..
```

### Board 11 (5 x 4)

```
.Tt2S
ttst.
Ss.T.
s....
```

### Board 12 (5 x 5)

```
.Tttt
s2St.
.st..
..sT.
..S..
```

## Set C: boards 13 to 18

Wider boards, reaching `6 x 6`. A third channel appears on several of them, and
several carry more than one crystal at once, so a beam has more than one crossing
to place.

### Board 13 (5 x 5)

```
.sS..
2S.T.
ss..t
.tttt
..T.t
```

### Board 14 (6 x 5)

```
..tt2t
.tTt.t
Ts....
.2S...
sssS..
```

### Board 15 (5 x 5)

```
Sssdd
s.2Sd
.t.DD
Tt...
tttT.
```

### Board 16 (6 x 5)

```
..dd..
.T.Dd.
ttT2dS
2.sDs.
tt.ssS
```

### Board 17 (6 x 5)

```
..Tss.
.ts..S
t.t2s.
2t.Ts.
tt..sS
```

### Board 18 (6 x 6)

```
t2Tt.D
.tttd.
..Tdd2
.SsdsS
...sDs
....s.
```

## Set D: boards 19 to 24

The largest boards, reaching the full `GRID_MAX_COLS` by `GRID_MAX_ROWS`
(`7 x 6`). Most carry all three channels at once, crystals crowd the bench up to
five at a time, and two boards stand a crystal at the full `MAX_CHARGES` (`3`).

### Board 19 (6 x 6)

```
ssddd.
s2Sd.d
.2..Dd
..SttD
.T.tt.
.tttTt
```

### Board 20 (7 x 5)

```
.D2dt.t
Sd2DTtt
2s..Tt.
s2...tt
.Ss...t
```

### Board 21 (7 x 6)

```
....Tss
t..t.sS
22t.s..
t3t..ss
Tt...S2
.....ss
```

### Board 22 (7 x 6)

```
Ss..Dd.
ss.DdTt
s2s2..t
..s2d.t
.S.Tdt2
....t2t
```

### Board 23 (7 x 6)

```
Tss.S..
ts.s.Dd
t.ss.dS
.t.322T
tD2d2.t
tt.d...
```

### Board 24 (7 x 6)

```
S2ss.S.
Ts2.s.d
ssD2ddd
ssTt.d2
tt.tDd.
t2t....
```

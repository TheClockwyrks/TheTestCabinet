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
sentences that head each set below describe what the boards in it hold. The
course climbs without pause: each set asks more of the player than the one
before it, and the last boards ask more than anything else in the game.

## Set A: boards 1 to 6

The smallest boards, each carrying a single channel and no crystals. One beam
runs between the channel's two emitters and threads every lens on the board.
Even here no board has only one answer: each admits at least two completed
pictures, and the crowded grids leave real choices from the first move.

### Board 1 (3 x 3)

```
.Tt
ttT
.tt
```

### Board 2 (3 x 3)

```
.tt
TtT
tt.
```

### Board 3 (4 x 3)

```
tTtt
ttTt
ttt.
```

### Board 4 (4 x 3)

```
Tt.t
tTtt
.ttt
```

### Board 5 (4 x 4)

```
.tTt
.ttt
ttTt
tttt
```

### Board 6 (4 x 4)

```
tttT
ttt.
t.tt
ttTt
```

## Set B: boards 7 to 12

A second channel joins the bench, and the first crystals appear. Board 9
stands the first crystal, two charges one channel must spend alone; from
board 10 on the crystals sit between the channels, open to either, and by the
end of the set two at once are in play.

### Board 7 (4 x 4)

```
STtt
sstt
ssTt
Sss.
```

### Board 8 (5 x 4)

```
Sst..
stTtt
ssttt
SsstT
```

### Board 9 (4 x 4)

```
tSss
2tss
Ttss
tTS.
```

### Board 10 (5 x 4)

```
Tt.T.
ttt..
t2sSs
tSsss
```

### Board 11 (5 x 4)

```
..t.s
ttT2s
ttS2S
t.Tss
```

### Board 12 (5 x 4)

```
Tttt.
ttsSt
.22t.
ssST.
```

## Set C: boards 13 to 18

A third channel joins from board 13, and the crystals multiply: two to five
per board, shared ever more widely. Board 17 stands the first crystal at the
full `MAX_CHARGES` (`3`), and board 18 stands two of them.

### Board 13 (4 x 5)

```
.Ddd
tTdD
t22.
tsSs
T.S.
```

### Board 14 (5 x 5)

```
..tT.
t2dD.
T2t.s
d2sss
DSssS
```

### Board 15 (5 x 5)

```
.T.2t
sDttt
sS2Td
ss22D
.S.d.
```

### Board 16 (5 x 5)

```
..ttt
.S2tt
DsTsT
d22d.
SddD.
```

### Board 17 (6 x 5)

```
...ttd
S2Ttdd
t32Ddd
Tss2d.
sS.dD.
```

### Board 18 (6 x 5)

```
T.....
ttDsss
dd3222
.dt3Ss
DddTSs
```

## Set D: boards 19 to 24

The summit. The boards grow to the full `GRID_MAX_COLS` by `GRID_MAX_ROWS`
(`7 x 6`) while staying dense: four to eight crystals crowd every bench, open
to two or three channels at once, and the final board leaves more open than
any board before it.

### Board 19 (5 x 5)

```
.Dttt
.dd3t
.d2TT
S2s2D
.sSss
```

### Board 20 (6 x 5)

```
.S.tT.
s2ttDd
s2T2.d
s22d3.
ssSddD
```

### Board 21 (6 x 5)

```
S2D..T
d2ssts
.D3S3s
.dT32t
.d2tt.
```

### Board 22 (6 x 6)

```
.tt2d.
.t2t2d
t1DdSd
2.S3dD
TT2sd.
.ssss.
```

### Board 23 (7 x 6)

```
s2SST..
2232.t.
stTsttt
..t.t.t
d22ttdD
dD2dddd
```

### Board 24 (7 x 6)

```
ssdd.d.
2S.dd2d
ssD..d.
t2ttTdd
.t323Dd
ttT2sS.
```

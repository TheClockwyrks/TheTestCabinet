# shellcheck shell=bash disable=SC2034
# Facet — shared gem-drawing library for the `draw` / `draw-sheet` generators.
#
# Sourced by gen-sprites.sh and gen-sheets.sh. It owns the two things both
# generators must agree on exactly: the PALETTE (one hue per kind, plus the
# shades a faceted stone is built from) and the SILHOUETTE of each kind.
#
# specs/board.md fixes the geometry these obey:
#   * a gem's drawn form fits inside GEM_R (30) of its cell center, and
#   * the seven kinds are told apart by silhouette and facet pattern, not hue
#     alone (so the game stays readable to a color-blind player).
#
# Every sprite is a 64x64 straight-alpha canvas whose gem is centered on the
# boundary between column 31 and column 32 — the axis `mirror-horizontal` uses —
# so left/right symmetric art stays exactly symmetric. RY (26) and RX (25) are
# the silhouette's half-height and half-width in pixels; every shape below is
# authored in normalized units and scaled by those, chosen so that no kind's
# outline ever reaches further than 30px from the center.

CANVAS=64      # sprite edge, in pixels
SHAPE_SX=1     # horizontal foreshortening; only the prism's idle turn moves it
CX=32          # the mirror axis: the gem is centered on the 31|32 boundary
RY=26          # silhouette half-height, in pixels
RX=25          # silhouette half-width, in pixels

# The seven kinds, in GEM_KINDS order (specs/board.md).
KINDS=(ruby amber citrine jade beryl sapphire amethyst)

# --- palette ------------------------------------------------------------------
# One saturated hue per kind. `base` is the stone's body, `light` its lit crown
# facet, `dark` its outline and shaded rim, `hi` the specular glint.
kind_base()  { case "$1" in
  ruby) echo '#d8203f';; amber) echo '#ef8a17';; citrine) echo '#eccb17';;
  jade) echo '#14a862';; beryl) echo '#12c3c0';; sapphire) echo '#2f5fe0';;
  amethyst) echo '#9b3fdc';; prism) echo '#dfe8ff';; esac; }
kind_dark()  { case "$1" in
  ruby) echo '#5c0a1c';; amber) echo '#6f3403';; citrine) echo '#6d5602';;
  jade) echo '#04492c';; beryl) echo '#034e52';; sapphire) echo '#0f1f66';;
  amethyst) echo '#3d0f6b';; prism) echo '#3a4470';; esac; }
kind_light() { case "$1" in
  ruby) echo '#ff6d80';; amber) echo '#ffbe5e';; citrine) echo '#fff07a';;
  jade) echo '#54e39c';; beryl) echo '#66f3ef';; sapphire) echo '#7ea4ff';;
  amethyst) echo '#cd8bff';; prism) echo '#ffffff';; esac; }
kind_hi()    { case "$1" in
  ruby) echo '#ffdde3';; amber) echo '#fff0d2';; citrine) echo '#fffce0';;
  jade) echo '#d6ffed';; beryl) echo '#dcfffe';; sapphire) echo '#e2ebff';;
  amethyst) echo '#f4e2ff';; prism) echo '#ffffff';; esac; }

# The colors strain is drawn in: bright fracture lines, their shadow, and the
# dull gray a flawed stone's body is pulled toward.
CRACK='#f4f8ff'    # a fresh fracture catching the light
CRACK_D='#1c2130'  # the shadow the fracture casts into the stone
BRUISE='#241b28'   # a spalled, clouded patch
DULL='#39404f'     # what a strained body is mixed toward

# mix <hex-a> <hex-b> <t-percent> — blend two `#rrggbb` colors, t% of b.
# (Hex is decoded by hand: `mawk`, the awk this image ships, has no `strtonum`.)
mix() {
  awk -v a="$1" -v b="$2" -v t="$3" '
    function hex2(s,   i, c, v, d) {
      v = 0;
      for (i = 1; i <= 2; i++) {
        c = tolower(substr(s, i, 1));
        d = index("0123456789abcdef", c) - 1;
        v = v * 16 + d;
      }
      return v;
    }
    BEGIN {
      ar = hex2(substr(a, 2, 2)); ag = hex2(substr(a, 4, 2)); ab = hex2(substr(a, 6, 2));
      br = hex2(substr(b, 2, 2)); bg = hex2(substr(b, 4, 2)); bb = hex2(substr(b, 6, 2));
      f = t / 100;
      printf "#%02x%02x%02x", ar + (br - ar) * f + 0.5, ag + (bg - ag) * f + 0.5, ab + (bb - ab) * f + 0.5;
    }'
}

# --- silhouettes ---------------------------------------------------------------
# shape_rows <kind> <scale> <dx> <dy>
#   Emits one `<y> <left> <width>` line per occupied scanline of the kind's
#   silhouette, scaled about the gem center and shifted by (dx, dy). Scaling is
#   how the concentric passes that give a stone its volume are drawn: the same
#   outline at 1.00, 0.94, 0.88 … each a little smaller than the last.
#
# The normalized half-width w(u), u running -1 (top) to +1 (bottom):
#   ruby      round brilliant   a circle
#   amber     pear              a spike into a round lower lobe
#   citrine   cushion           a squircle, near-square with soft corners
#   jade      hexagon           flat top and bottom, points left and right
#   beryl     trilliant         a triangle, apex up
#   sapphire  marquise          a narrow lens, pointed top and bottom
#   amethyst  emerald cut       an octagon, corners chamfered
#   prism     kite              a tall crystal, no kind's shape
shape_rows() {
  awk -v kind="$1" -v s="${2:-1}" -v dx="${3:-0}" -v dy="${4:-0}" -v sx="$SHAPE_SX" \
      -v cx="$CX" -v ry="$RY" -v rx="$RX" -v n="$CANVAS" '
    function abs(v) { return v < 0 ? -v : v }
    function hw(k, u,   t, c, a) {
      a = abs(u);
      if (k == "ruby") { return sqrt(1 - u * u) }
      if (k == "amber") {
        t = 0; if (u <= 0.20) { t = 0.80 * (u + 1) / 1.20 }
        c = 0.64 - (u - 0.20) * (u - 0.20); c = c > 0 ? sqrt(c) : 0;
        return t > c ? t : c;
      }
      if (k == "citrine") { return exp(log(1 - exp(3.5 * log(a + 1e-9))) / 3.5) }
      if (k == "jade") { return 1 - 0.5 * a }
      if (k == "beryl") {
        if (u < -0.92 || u > 0.86) { return 0 }
        return 0.78 * (u + 0.92) / 1.78;
      }
      if (k == "sapphire") { return 0.62 * exp(0.62 * log(1 - u * u + 1e-9)) }
      if (k == "amethyst") {
        if (a <= 0.68) { return 0.76 }
        return 0.76 - (a - 0.68) / 0.32 * 0.34;
      }
      if (k == "prism") {
        if (u <= -0.12) { return 0.92 * (u + 1) / 0.88 }
        return 0.92 * (1 - u) / 1.12;
      }
      return 0;
    }
    BEGIN {
      for (y = 0; y < n; y++) {
        u = (y + 0.5 - cx - dy) / (ry * s);
        if (u < -1 || u > 1) continue;
        w = hw(kind, u) * rx * sx * s;
        r = int(w + 0.5);
        if (r < 1) continue;
        left = cx - r + dx;
        wid = 2 * r;
        if (left < 0) { wid += left; left = 0 }
        if (left + wid > n) wid = n - left;
        if (wid > 0) print y, left, wid;
      }
    }'
}

# shape_hw <kind> — emits `<y> <halfwidth>` for the full-size silhouette, used
# to keep hand-authored detail (fracture lines, spalls) inside the stone.
shape_hw() {
  shape_rows "$1" 1 0 0 | awk '{ print $1, $3 / 2 }'
}

# --- drawing ------------------------------------------------------------------
# The generators set these before calling anything below:
#   GEM_TOOL   the binary to drive (`draw` or `draw-sheet`)
#   GEM_EXTRA  the per-call target (`()` for a canvas, `(--frame 3)` for a sheet
#              frame, `(--layer shard1)` for a sheet-wide layer)
#   CFG        the tool's config JSON
GEM_TOOL=draw
GEM_EXTRA=()

# gdraw <operation> [flags...] — one recorded drawing operation.
gdraw() {
  local op="$1"; shift
  "$GEM_TOOL" "$op" "${GEM_EXTRA[@]}" "$@" --config "$CFG" >/dev/null
}

# fill_shape <kind> <scale> <dx> <dy> <color> — fill a whole silhouette.
fill_shape() {
  local kind="$1" s="$2" dx="$3" dy="$4" color="$5" y left w
  while read -r y left w; do
    gdraw fill-rect --x "$left" --y "$y" --width "$w" --height 1 --color "$color"
  done < <(shape_rows "$kind" "$s" "$dx" "$dy")
}

# fill_shape_bands <kind> <scale> <dx> <dy> <color...> — fill a silhouette with
# vertical color bands. The prism's many-colored cut is built from this: it is
# the one stone that carries no single hue.
fill_shape_bands() {
  local kind="$1" s="$2" dx="$3" dy="$4"; shift 4
  local bands=("$@") n=$# y left w i seg x0 x1
  while read -r y left w; do
    for ((i = 0; i < n; i++)); do
      x0=$((left + w * i / n))
      x1=$((left + w * (i + 1) / n))
      seg=$((x1 - x0))
      [ "$seg" -gt 0 ] || continue
      gdraw fill-rect --x "$x0" --y "$y" --width "$seg" --height 1 --color "${bands[$i]}"
    done
  done < <(shape_rows "$kind" "$s" "$dx" "$dy")
}

# facet_lines <kind> — emit `<x0> <y0> <x1> <y1>` for the kind's facet pattern,
# already in canvas pixels and already carrying the lit body's (-1, -2) offset.
# The pattern is the second thing (after silhouette) that tells the kinds apart,
# so each is the cut its stone is named for rather than a generic sparkle.
facet_lines() {
  awk -v kind="$1" -v cx="$CX" -v ry="$RY" -v rx="$RX" -v sx="$SHAPE_SX" '
    function px(nx) { return int(cx - 0.5 - 1 + nx * rx * sx * 0.87 + 0.5) }
    function py(ny) { return int(cx - 0.5 - 2 + ny * ry * 0.87 + 0.5) }
    function seg(x0, y0, x1, y1) { print px(x0), py(y0), px(x1), py(y1) }
    BEGIN {
      pi = 3.14159265358979;
      if (kind == "ruby") {
        for (i = 0; i < 8; i++) {
          t = (22.5 + 45 * i) * pi / 180;
          seg(cos(t) * 0.50, sin(t) * 0.50, cos(t) * 0.92, sin(t) * 0.92);
        }
      } else if (kind == "amber") {
        seg(0, -0.80, 0, 0.58);
        seg(-0.50, 0.30, 0, 0.04); seg(0, 0.04, 0.50, 0.30);
        seg(-0.40, 0.62, 0, 0.36);  seg(0, 0.36, 0.40, 0.62);
        seg(0, -0.86, -0.28, -0.12); seg(0, -0.86, 0.28, -0.12);
      } else if (kind == "citrine") {
        seg(-0.50, -0.50, 0.50, -0.50); seg(0.50, -0.50, 0.50, 0.50);
        seg(0.50, 0.50, -0.50, 0.50);   seg(-0.50, 0.50, -0.50, -0.50);
        seg(-0.50, -0.50, -0.80, -0.80); seg(0.50, -0.50, 0.80, -0.80);
        seg(-0.50, 0.50, -0.80, 0.80);   seg(0.50, 0.50, 0.80, 0.80);
      } else if (kind == "jade") {
        vx[0] = 1;    vy[0] = 0;   vx[1] = 0.5;  vy[1] = -1;
        vx[2] = -0.5; vy[2] = -1;  vx[3] = -1;   vy[3] = 0;
        vx[4] = -0.5; vy[4] = 1;   vx[5] = 0.5;  vy[5] = 1;
        for (i = 0; i < 6; i++) seg(vx[i] * 0.34, vy[i] * 0.34, vx[i] * 0.88, vy[i] * 0.88);
      } else if (kind == "beryl") {
        seg(-0.34, 0.30, 0.34, 0.30); seg(0.34, 0.30, 0, -0.36); seg(0, -0.36, -0.34, 0.30);
        seg(0, -0.36, 0, -0.86);
        seg(-0.34, 0.30, -0.68, 0.78); seg(0.34, 0.30, 0.68, 0.78);
        seg(-0.60, 0.80, 0.60, 0.80);
      } else if (kind == "sapphire") {
        seg(0, -0.92, 0, 0.92);
        seg(0, -0.90, -0.56, 0.02); seg(0, -0.90, 0.56, 0.02);
        seg(0, 0.90, -0.56, 0.02);  seg(0, 0.90, 0.56, 0.02);
      } else if (kind == "amethyst") {
        seg(-0.66, -0.44, 0.66, -0.44); seg(-0.72, 0, 0.72, 0); seg(-0.66, 0.44, 0.66, 0.44);
        seg(-0.68, -0.62, -0.40, -0.94); seg(0.68, -0.62, 0.40, -0.94);
        seg(-0.68, 0.62, -0.40, 0.94);   seg(0.68, 0.62, 0.40, 0.94);
      } else if (kind == "prism") {
        seg(0, -0.94, -0.84, -0.10); seg(0, -0.94, 0.84, -0.10);
        seg(0, 0.94, -0.84, -0.10);  seg(0, 0.94, 0.84, -0.10);
        seg(-0.84, -0.10, 0.84, -0.10);
        seg(0, -0.94, 0, 0.94);
      }
    }'
}

# crack_pixels <kind> <strain> — emit `<x> <y>` for every pixel of the fracture
# network at that strain, clipped to the stone. specs/board.md asks the four
# strain states to read as damage deepening from clean to flawed, so the paths
# accumulate: strain 1 opens one fissure, strain 2 branches it, strain 3 runs it
# right through the stone.
crack_pixels() {
  { shape_hw "$1"; echo '--'; } | awk -v strain="$2" -v cx="$CX" -v ry="$RY" -v rx="$RX" '
    function emit(nx, ny,   x, y, h) {
      x = int(cx - 0.5 + nx * rx + 0.5); y = int(cx - 0.5 + ny * ry + 0.5);
      if (!(y in hwv)) return;
      h = hwv[y];
      if (x < cx - h + 1.5 || x > cx + h - 2.5) return;
      key = x " " y;
      if (key in seen) return;
      seen[key] = 1; print key;
    }
    function walk(x0, y0, x1, y1,   n, i) {
      n = int(((x1 - x0) * rx > 0 ? (x1 - x0) * rx : -(x1 - x0) * rx) + ((y1 - y0) * ry > 0 ? (y1 - y0) * ry : -(y1 - y0) * ry)) + 1;
      for (i = 0; i <= n; i++) emit(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
    }
    function path(nseg,   i) { for (i = 1; i < nseg; i++) walk(ax[i], ay[i], ax[i + 1], ay[i + 1]) }
    /^--$/ { done = 1; next }
    !done { hwv[$1] = $2; next }
    END {
      # A: the primary fissure, top to bottom. Strain 1 opens only its top half.
      ax[1] = -0.05; ay[1] = -0.78; ax[2] = 0.14; ay[2] = -0.34; ax[3] = -0.12; ay[3] = 0.02;
      ax[4] = 0.08;  ay[4] = 0.40;  ax[5] = -0.04; ay[5] = 0.70;
      path(strain >= 2 ? 5 : 3);
      if (strain >= 2) {
        ax[1] = -0.72; ay[1] = -0.06; ax[2] = -0.34; ay[2] = 0.08; ax[3] = -0.10; ay[3] = 0.00; path(3);
        ax[1] = 0.12;  ay[1] = 0.08;  ax[2] = 0.44;  ay[2] = 0.28; ax[3] = 0.64;  ay[3] = 0.58; path(3);
      }
      if (strain >= 3) {
        ax[1] = -0.58; ay[1] = 0.52;  ax[2] = -0.20; ay[2] = 0.26;  ax[3] = 0.06;  ay[3] = 0.06; path(3);
        ax[1] = 0.06;  ay[1] = -0.32; ax[2] = 0.44;  ay[2] = -0.52; ax[3] = 0.70;  ay[3] = -0.60; path(3);
        ax[1] = -0.60; ay[1] = -0.52; ax[2] = -0.26; ay[2] = -0.28; ax[3] = -0.02; ay[3] = -0.44; path(3);
      }
    }'
}

# prism_bands <shift> <pull> — the prism's six split colors, rotated by <shift>
# and pulled <pull>% toward the strained gray.
PRISM_BAND_SHIFT=0
prism_bands() {
  local hues=('#ff4d74' '#ffab33' '#f2ee46' '#3ce8a0' '#3fb4ff' '#b06bff') i out=()
  for ((i = 0; i < 6; i++)); do
    out+=("$(mix "${hues[(i + $1) % 6]}" "$DULL" "$2")")
  done
  echo "${out[@]}"
}

# --- the crown's table ---------------------------------------------------------
# The table is a stone's largest flat, and where it sits depends on the cut: a
# trilliant's and a pear's sit low in the stone, a cushion's fills it. These pin
# the table's scale, its vertical offset, and where the specular glint lands on
# it, so every kind gets a table that stays inside its own silhouette.
table_scale() { case "$1" in
  ruby) echo 0.44;; amber) echo 0.40;; citrine) echo 0.46;; jade) echo 0.46;;
  beryl) echo 0.46;; sapphire) echo 0.50;; amethyst) echo 0.48;; prism) echo 0.30;; esac; }
table_dy() { case "$1" in
  amber) echo 4;; beryl) echo 7;; *) echo 0;; esac; }

# glint <kind> — emit `<cx> <cy> <r>` for the specular on the table's upper left.
glint() {
  awk -v kind="$1" -v ts="$(table_scale "$1")" -v tdy="$(table_dy "$1")" \
      -v cx="$CX" -v ry="$RY" -v rx="$RX" -v sx="$SHAPE_SX" '
    function hwapprox(k, u) {
      if (k == "beryl") { return 0.78 * (u + 0.92) / 1.78 }
      if (k == "sapphire") { return 0.62 * exp(0.62 * log(1 - u * u + 1e-9)) }
      if (k == "amber") { return 0.80 }
      if (k == "prism") { return u <= -0.12 ? 0.92 * (u + 1) / 0.88 : 0.92 * (1 - u) / 1.12 }
      return sqrt(1 - u * u * 0.5);
    }
    BEGIN {
      u = -0.36;
      w = hwapprox(kind, u) * rx * sx * ts;
      gy = cx - 0.5 - 2 + tdy + u * ry * ts;
      gx = cx - 0.5 - 1 - 0.42 * w;
      r = int(w / 2.6); if (r < 1) r = 1; if (r > 3) r = 3;
      printf "%d %d %d\n", gx + 0.5, gy + 0.5, r;
    }'
}

# A stone is built in concentric passes, each a little smaller than the last, the
# lit ones nudged up and left so the shaded rim survives on the lower right:
#   1.00  the outline and the girdle's shadow
#   0.94  the body in shadow
#   0.87  the lit body, offset (-1, -2)
#         the kind's facet pattern, cut into that body
#   0.52  the table's dark collar
#   0.42  the table, the brightest flat on the crown
#         the specular glint, then the fracture network for the strain state
#
# draw_gem <kind> <strain>
draw_gem() {
  local kind="$1" strain="$2"
  local base dark light hi shade crown facet lit pull

  # Strain pulls the whole stone toward a dull gray and, at MAX_STRAIN, bleaches
  # its rim — a flawed stone reads as clouded and about to go, while its hue and
  # silhouette still say which kind it is.
  case "$strain" in 0) pull=0;; 1) pull=6;; 2) pull=18;; *) pull=34;; esac
  base=$(mix "$(kind_base "$kind")" "$DULL" "$pull")
  light=$(mix "$(kind_light "$kind")" "$DULL" "$pull")
  hi=$(mix "$(kind_hi "$kind")" "$DULL" $((pull / 2)))
  dark=$(mix "$(kind_dark "$kind")" "$DULL" $((pull / 3)))
  if [ "$strain" -ge 3 ]; then dark=$(mix "$dark" '#c9cede' 42); fi
  shade=$(mix "$base" "$dark" 52)
  crown=$(mix "$base" "$light" 66)
  facet=$(mix "$base" "$dark" 72)
  lit=$(mix "$base" "$light" 92)

  fill_shape "$kind" 1.00 0 0 "$dark"
  # a sliver of bounce light along the bottom girdle, so the stone sits in light
  # rather than floating flat on the felt
  fill_shape "$kind" 0.96 0 1 "$(mix "$base" "$light" 50)"
  fill_shape "$kind" 0.94 0 0 "$shade"

  if [ "$kind" = prism ]; then
    # The prism carries no kind, so it carries no hue either: its body is a fan
    # of six clear-cut colors no single stone on the board wears. The idle turn
    # rotates that fan through PRISM_BAND_SHIFT, so the colors travel across the
    # face as the cut comes round.
    # shellcheck disable=SC2046
    fill_shape_bands "$kind" 0.87 -1 -2 $(prism_bands "${PRISM_BAND_SHIFT:-0}" "$pull")
  else
    fill_shape "$kind" 0.87 -1 -2 "$base"
  fi

  # The facet pattern: a dark cut edge with a lit face along its upper side.
  if [ "$kind" = prism ]; then facet='#5a6690'; lit='#ffffff'; fi
  while read -r x0 y0 x1 y1; do
    gdraw line --x0 "$x0" --y0 "$y0" --x1 "$x1" --y1 "$y1" --color "$facet"
    gdraw line --x0 "$x0" --y0 $((y0 - 1)) --x1 "$x1" --y1 $((y1 - 1)) --color "$lit"
  done < <(facet_lines "$kind")

  local ts tdy gx gy gr
  ts=$(table_scale "$kind"); tdy=$(table_dy "$kind")
  if [ "$kind" = prism ]; then
    # The prism's table is a small hot core, so the colors it splits stay the
    # thing the eye reads.
    fill_shape "$kind" "$ts" -1 $((tdy - 2)) '#c4d4ff'
    fill_shape "$kind" "$(awk -v s="$ts" 'BEGIN { printf "%.3f\n", s - 0.10 }')" -1 $((tdy - 2)) '#ffffff'
  else
    fill_shape "$kind" "$(awk -v s="$ts" 'BEGIN { printf "%.3f\n", s + 0.10 }')" -1 $((tdy - 2)) "$facet"
    fill_shape "$kind" "$ts" -1 $((tdy - 2)) "$crown"
  fi

  # The specular: one hard glint on the upper-left of the table.
  read -r gx gy gr < <(glint "$kind")
  gdraw fill-circle --cx "$gx" --cy "$gy" --r $((gr + 1)) --color "$(mix "$crown" "$hi" 55)"
  gdraw fill-circle --cx "$gx" --cy "$gy" --r "$gr" --color "$hi"
  gdraw set-pixel --x $((gx + gr + 2)) --y $((gy - gr - 2)) --color "$hi"

  draw_strain "$kind" "$strain"
}

# draw_strain <kind> <strain> — the fracture network and the spalled patches.
draw_strain() {
  local kind="$1" strain="$2" x y
  [ "$strain" -ge 1 ] || return 0

  if [ "$strain" -ge 2 ]; then
    gdraw fill-circle --cx 42 --cy 21 --r 2 --color "$BRUISE"
  fi
  if [ "$strain" -ge 3 ]; then
    gdraw fill-circle --cx 21 --cy 43 --r 3 --color "$BRUISE"
    gdraw fill-circle --cx 39 --cy 44 --r 2 --color "$BRUISE"
  fi

  # The fracture's own shadow first, then the bright break face over it, so each
  # crack reads as an open split rather than a scratch.
  while read -r x y; do
    gdraw set-pixel --x $((x + 1)) --y $((y + 1)) --color "$CRACK_D"
  done < <(crack_pixels "$kind" "$strain")
  while read -r x y; do
    gdraw set-pixel --x "$x" --y "$y" --color "$CRACK"
    if [ "$strain" -ge 3 ]; then gdraw set-pixel --x $((x - 1)) --y "$y" --color "$CRACK"; fi
  done < <(crack_pixels "$kind" "$strain")
}

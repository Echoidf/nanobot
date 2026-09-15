#!/usr/bin/env bash
# ============================================================
# Build an offline install bundle for nanobot on air-gapped Linux boxes.
#
# Produces:  <out>/nanobot-offline-<TAG>-<arch>-<pytag>.tar.gz
#   nanobot-offline-<TAG>/
#   ├── install.sh               # runs on the offline server
#   ├── requirements-linux.txt   # fully pinned dependency set
#   ├── wheelhouse/              # every dependency wheel (linux target)
#   └── dist/nanobot_ai-*.whl    # nanobot itself (WebUI bundled inside)
#
# The WebUI is bundled into the nanobot wheel by hatch_build.py, so no Node
# runtime is shipped.
#
# Examples:
#   scripts/package_offline.sh                       # x86_64 / py3.12 / +api extra
#   scripts/package_offline.sh --arch aarch64 --py 3.11
#   scripts/package_offline.sh --extras api,azure,bedrock --tag v4
#   scripts/package_offline.sh --extras none --out /tmp
#   scripts/package_offline.sh --old-glibc          # CentOS/RHEL 7 (glibc 2.17) box
#   scripts/package_offline.sh --no-cache           # disable wheel caching
#   scripts/package_offline.sh --cache-dir /path/to/cache  # custom cache directory
#   NANOBOT_OFFLINE_INDEX_URL=https://pypi.org/simple scripts/package_offline.sh
#   NANOBOT_OFFLINE_CACHE=/path/to/cache scripts/package_offline.sh
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ARCH="x86_64"          # x86_64 | aarch64
PYVER="3.12"           # target interpreter version
EXTRAS="api"           # comma-separated optional-dependencies; "none" for core only
TAG=""                 # bundle label; default = project version
OUT_DIR="${NANOBOT_OFFLINE_OUT:-$HOME/Downloads}"
CONSTRAINTS=""         # optional pip constraint file (version downgrades)
INDEX_URL="${NANOBOT_OFFLINE_INDEX_URL:-}"  # pip index override; default = pip's own config
OLD_GLIBC=1         # refuse wheels needing glibc > 2.17 (CentOS/RHEL 7 era)
SDIST_FALLBACK=0       # allow sdists for deps without linux wheels
SKIP_WHEEL=0           # reuse an existing dist/*.whl instead of rebuilding
WHEEL_CACHE="${NANOBOT_OFFLINE_CACHE:-$HOME/.cache/nanobot-offline/wheels}"
USE_CACHE=1            # use wheel cache (1=enable, 0=disable)

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m❌ %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  # Print the leading comment block (everything after the shebang up to the
  # first non-comment line), so the help text cannot drift out of sync.
  awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    --py) PYVER="$2"; shift 2 ;;
    --extras) EXTRAS="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --index-url) INDEX_URL="$2"; shift 2 ;;
    --constraints) CONSTRAINTS="$2"; shift 2 ;;
    --old-glibc) OLD_GLIBC=1; shift ;;
    --sdist-fallback) SDIST_FALLBACK=1; shift ;;
    --skip-wheel-build) SKIP_WHEEL=1; shift ;;
    --cache-dir) WHEEL_CACHE="$2"; shift 2 ;;
    --no-cache) USE_CACHE=0; shift ;;
    --cache-stats) cache_stats; exit 0 ;;
    --cache-clean) cache_clean; exit 0 ;;
    -h|--help) usage ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

command -v uv >/dev/null 2>&1 || die "uv is required on PATH (https://docs.astral.sh/uv/)"
python3 -m pip --version >/dev/null 2>&1 || die "python3 -m pip is required for cross-platform downloads"

# Cache management functions
cache_stats() {
  if [[ -d "$WHEEL_CACHE" ]]; then
    local count=$(find "$WHEEL_CACHE" -name "*.whl" 2>/dev/null | wc -l | tr -d ' ')
    local size=$(du -sh "$WHEEL_CACHE" 2>/dev/null | awk '{print $1}')
    log "Cache stats: $count wheels, $size total"
  else
    log "Cache directory not found: $WHEEL_CACHE"
  fi
}

cache_clean() {
  if [[ -d "$WHEEL_CACHE" ]]; then
    log "Cleaning cache: $WHEEL_CACHE"
    rm -rf "$WHEEL_CACHE"
    log "Cache cleaned"
  else
    log "No cache to clean"
  fi
}

PY_MAJOR="${PYVER%%.*}"
PY_MINOR="${PYVER##*.}"
PYTAG="cp${PY_MAJOR}${PY_MINOR}"     # 3.12 -> cp312
PIP_PYVER="${PY_MAJOR}${PY_MINOR}"   # 3.12 -> 312
case "$ARCH" in
  x86_64) UV_TRIPLE="x86_64-unknown-linux-gnu" ;;
  aarch64|arm64) ARCH="aarch64"; UV_TRIPLE="aarch64-unknown-linux-gnu" ;;
  *) die "--arch must be x86_64 or aarch64" ;;
esac

# Optional constraint file (version downgrades). --old-glibc implies the bundled
# 2.17 list so resolution can never pick a wheel the target glibc cannot run.
if [[ "$OLD_GLIBC" -eq 1 && -z "$CONSTRAINTS" ]]; then
  CONSTRAINTS="$REPO_ROOT/scripts/offline/constraints-glibc217.txt"
fi
if [[ -n "$CONSTRAINTS" ]]; then
  [[ -f "$CONSTRAINTS" ]] || die "constraint file not found: $CONSTRAINTS"
  CONSTRAINTS="$(cd "$(dirname "$CONSTRAINTS")" && pwd)/$(basename "$CONSTRAINTS")"
  log "Constraints: $CONSTRAINTS"
fi
CONSTRAINT_ARGS=()
[[ -z "$CONSTRAINTS" ]] || CONSTRAINT_ARGS+=(-c "$CONSTRAINTS")

EXTRA_ARGS=()
if [[ "$EXTRAS" != "none" && -n "$EXTRAS" ]]; then
  IFS=',' read -ra _extras <<< "$EXTRAS"
  for e in "${_extras[@]}"; do EXTRA_ARGS+=(--extra "$e"); done
fi

# Resolve and download from the SAME index: a lagging mirror must never hand us a
# pin it cannot serve. pip's `install.trusted-host` does not apply to
# `pip download`, and uv needs its own insecure-host flag for http mirrors.
[[ -n "$INDEX_URL" ]] || INDEX_URL="$(python3 -m pip config get global.index-url 2>/dev/null || true)"
UV_INDEX_ARGS=()
PIP_INDEX_ARGS=()
if [[ -n "$INDEX_URL" ]]; then
  INDEX_HOST="$(printf '%s' "$INDEX_URL" | awk -F/ '{print $3}')"
  UV_INDEX_ARGS+=(--index-url "$INDEX_URL")
  PIP_INDEX_ARGS+=(--index-url "$INDEX_URL")
  case "$INDEX_URL" in
    http://*)
      UV_INDEX_ARGS+=(--allow-insecure-host "$INDEX_HOST")
      PIP_INDEX_ARGS+=(--trusted-host "$INDEX_HOST") ;;
  esac
fi

cd "$REPO_ROOT"
[[ -n "$TAG" ]] || TAG="v$(sed -n 's/^version = "\([^"]*\)".*/\1/p' pyproject.toml | head -1)"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/nanobot-offline-${TAG}-XXXXXX")"
trap 'chmod -R u+rwX "$STAGE" 2>/dev/null || true' EXIT
PKG_DIR="$STAGE/nanobot-offline-${TAG}"
mkdir -p "$PKG_DIR/wheelhouse" "$PKG_DIR/dist" "$OUT_DIR"

log "Config: arch=$ARCH python=$PYVER ($PYTAG) extras=${EXTRAS:-none} tag=$TAG"
log "Index: ${INDEX_URL:-default (https://pypi.org/simple)}"
log "Staging in $STAGE"

# ---------- 1. nanobot wheel (WebUI bundled by hatch_build.py) ----------
if [[ "$SKIP_WHEEL" -eq 0 ]]; then
  log "Building nanobot wheel"
  (cd "$REPO_ROOT" && uv build --wheel --out-dir "$PKG_DIR/dist")
else
  log "Reusing existing wheel from dist/"
  cp dist/nanobot_ai-*.whl "$PKG_DIR/dist/"
fi
ls -1 "$PKG_DIR/dist"/*.whl >/dev/null 2>&1 || die "no wheel produced"

# ---------- 2. resolve the linux dependency set ----------
log "Resolving dependencies for $UV_TRIPLE / python $PYVER"
uv pip compile pyproject.toml \
  --python-platform "$UV_TRIPLE" \
  --python-version "$PYVER" \
  "${UV_INDEX_ARGS[@]+"${UV_INDEX_ARGS[@]}"}" \
  "${CONSTRAINT_ARGS[@]+"${CONSTRAINT_ARGS[@]}"}" \
  "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}" \
  -o "$PKG_DIR/requirements-linux.txt"
DEP_COUNT="$(grep -Ec '^[A-Za-z0-9._-]+==' "$PKG_DIR/requirements-linux.txt")"
log "$DEP_COUNT pinned dependencies"

# ---------- 3. download linux wheels ----------
# Every manylinux tag a modern pip understands. A multi-tag wheel advertises its
# oldest supported glibc first, so listing 2_5/2_17/2_28 costs nothing.
DOWNLOAD_ARGS=(
  --only-binary=:all:
  --implementation cp
  --python-version "$PIP_PYVER"
  --abi "$PYTAG" --abi abi3 --abi none
  --platform "any"
  --platform "linux_${ARCH}"
  --platform "manylinux1_${ARCH}"
  --platform "manylinux_2_5_${ARCH}"
  --platform "manylinux2014_${ARCH}"
  --platform "manylinux_2_17_${ARCH}"
)
if [[ "$OLD_GLIBC" -eq 1 ]]; then
  log "old-glibc mode: refusing wheels that need glibc > 2.17 (CentOS/RHEL 7 era)"
else
  DOWNLOAD_ARGS+=(--platform "manylinux_2_28_${ARCH}")
fi

# Setup cache directory
CACHE_ARGS=()
if [[ "$USE_CACHE" -eq 1 ]]; then
  mkdir -p "$WHEEL_CACHE"
  CACHE_ARGS+=(--cache-dir "$WHEEL_CACHE")
  log "Using wheel cache: $WHEEL_CACHE"
else
  log "Wheel cache disabled"
fi

# pip/setuptools/wheel are bundled so the installer can bootstrap or repair pip.
log "Downloading dependency wheels"
python3 -m pip download -d "$PKG_DIR/wheelhouse" "${DOWNLOAD_ARGS[@]}" \
  "${CACHE_ARGS[@]+"${CACHE_ARGS[@]}"}" \
  "${PIP_INDEX_ARGS[@]+"${PIP_INDEX_ARGS[@]}"}" \
  -r "$PKG_DIR/requirements-linux.txt" pip setuptools wheel

# ---------- 3b. glibc floor of the payload ----------
GLIBC_FLOOR="$(python3 - "$PKG_DIR/wheelhouse" <<'PY'
import re, sys
from pathlib import Path

def floors(name):
    out = [(int(a), int(b)) for a, b in re.findall(r"manylinux_(\d+)_(\d+)", name)]
    for legacy, tag in (("manylinux2014", (2, 17)), ("manylinux2010", (2, 12)), ("manylinux1", (2, 5))):
        if legacy + "_" in name:
            out.append(tag)
    return out

best = {}
for f in sorted(Path(sys.argv[1]).glob("*.whl")):
    fs = floors(f.name)
    if fs:                      # a wheel is installable on its OLDEST advertised tag
        best[f.name] = min(fs)
if not best:
    print("2.17 none")
else:
    top = max(best.values())
    drivers = " ".join(n for n in sorted(best) if best[n] == top)
    print(f"2.{top[1]} {drivers}")
PY
)"
GLIBC_MIN="${GLIBC_FLOOR%% *}"
GLIBC_DRIVERS="${GLIBC_FLOOR#* }"
log "wheelhouse glibc floor: $GLIBC_MIN"
if [[ -n "${GLIBC_DRIVERS// /}" && "$GLIBC_MIN" != "2.17" && "$GLIBC_MIN" != "2.5" ]]; then
  echo "   driven by: $(printf '%s' "$GLIBC_DRIVERS" | tr ' ' '\n' | head -4 | paste -sd' ' -)"
  echo "   the server needs glibc >= $GLIBC_MIN (check: ldd --version)."
  echo "   Older box? Re-run with --old-glibc to force 2.17-compatible wheels."
fi

# ---------- 4. simulate the offline install, then repair what it cannot resolve ----------
# Filename presence is NOT coverage: a wheel can sit in wheelhouse/ and still be
# unresolvable on the target, because the target only accepts wheels whose platform
# tag it understands. Two real cases seen in the wild:
#   * glibc older than the wheel's manylinux floor (e.g. dulwich 0.25.x ships only
#     manylinux_2_28 linux wheels, so a glibc 2.17-2.27 box sees "no version");
#   * pip older than PEP 600 (< 20.3), which ignores manylinux_2_x tags entirely.
# Both surface on the server as the same cryptic "could not find a version".
log "Verifying wheel coverage (offline resolution simulation)"
VERIFY_LOG="$STAGE/resolve-check.log"

run_resolve_check() {
  python3 -m pip download --no-cache-dir --no-index \
    --find-links="$PKG_DIR/wheelhouse" -d "$(mktemp -d "$STAGE/resolve-payload-XXXXXX")" \
    "$@" -r "$PKG_DIR/requirements-linux.txt" >"$VERIFY_LOG" 2>&1
}

# Requirements pip could not satisfy, as "<name>==<version>".
unresolved_requirements() {
  sed -n 's/^.*satisfies the requirement \([^ ]*\).*/\1/p' "$VERIFY_LOG" | sort -u
}

# Some pinned packages ship a second, pure-Python wheel (Tag: py3-none-any) that needs
# no glibc at all: dulwich 0.25.x is the typical case -- its only linux wheel is
# manylinux_2_28, but the pure wheel runs everywhere (it just skips the Rust extension).
# Bundle that sibling for every wheel above the 2.17 floor so old-glibc / old-pip boxes
# can still resolve the bundle without a rebuild.
FLOORS="$(python3 - "$PKG_DIR/wheelhouse" <<'PY'
import re, sys
from pathlib import Path

def floors(name):
    out = [(int(a), int(b)) for a, b in re.findall(r"manylinux_(\d+)_(\d+)", name)]
    for legacy, tag in (("manylinux2014", (2, 17)), ("manylinux2010", (2, 12)), ("manylinux1", (2, 5))):
        if legacy + "_" in name:
            out.append(tag)
    return out

pins = {}
for f in sorted(Path(sys.argv[1]).glob("*.whl")):
    fs = floors(f.name)
    if not fs or min(fs) <= (2, 17):
        continue
    name, rest = f.name.split("-", 1)
    version = rest.split("-")[0]
    pins.setdefault(name.lower().replace("_", "-"), version)  # keep max version seen
for name, version in sorted(pins.items()):
    print(f"{name}=={version}")
PY
)"
PURE_MISSING=""
if [[ -n "$FLOORS" ]]; then
  log "Fetching pure-python fallbacks for $(( $(printf '%s\n' "$FLOORS" | wc -l | tr -d ' ') )) high-glibc pin(s)"
  while read -r req; do
    [[ -n "$req" ]] || continue
    python3 -m pip download -d "$PKG_DIR/wheelhouse" --no-deps \
      --only-binary=:all: --implementation cp --python-version "$PIP_PYVER" \
      --abi none --platform any "${CACHE_ARGS[@]+"${CACHE_ARGS[@]}"}" \
      "${PIP_INDEX_ARGS[@]+"${PIP_INDEX_ARGS[@]}"}" "$req" \
      >/dev/null 2>&1 || PURE_MISSING="$PURE_MISSING $req"
  done <<< "$FLOORS"
  [[ -z "$PURE_MISSING" ]] || log "no pure-python wheel for:$PURE_MISSING (those pins need --old-glibc on a 2.17 box)"
fi

if ! run_resolve_check "${DOWNLOAD_ARGS[@]}"; then
  UNRESOLVED="$(unresolved_requirements)"
  if [[ -z "$UNRESOLVED" ]] || ! run_resolve_check "${DOWNLOAD_ARGS[@]}"; then
    if [[ "$SDIST_FALLBACK" -ne 1 ]]; then
      die "wheelhouse cannot satisfy the pinned set for $UV_TRIPLE (glibc floor $GLIBC_MIN)
$(grep '^ERROR' "$VERIFY_LOG" | head -4)
Fix options:
  * target with glibc >= 2.17 (CentOS/RHEL 7 era): re-run with --old-glibc, which
    applies scripts/offline/constraints-glibc217.txt to pin wheel-available versions
    (add the offender there if it is not listed yet);
  * re-run with --sdist-fallback to bundle sdists instead (the offline box then needs
    a working compiler/build backend);
  * or drop the extra that pulls them in."
    fi
    log "Fetching sdists for: $(printf '%s' "$UNRESOLVED" | tr '\n' ' ')"
    for req in $UNRESOLVED; do
      python3 -m pip download --no-cache-dir -d "$PKG_DIR/wheelhouse" --no-deps \
        "${PIP_INDEX_ARGS[@]+"${PIP_INDEX_ARGS[@]}"}" "$req" \
        || die "cannot fetch $req even as sdist"
    done
    run_resolve_check "${DOWNLOAD_ARGS[@]}" || log "warning: sdist fallback still leaves the above unresolved"
  fi
fi

# Also prove the 2.17-only resolution works where it can, so --old-glibc bundles
# never ship a dulwich-style surprise.
if [[ "$OLD_GLIBC" -eq 1 ]]; then
  STRICT=("${DOWNLOAD_ARGS[@]}")
  run_resolve_check "${STRICT[@]}" || die "old-glibc bundle failed its own resolution check
$(grep '^ERROR' "$VERIFY_LOG" | head -4)"
fi
chmod -R u+rwX "$STAGE" 2>/dev/null || true

# ---------- 5. install.sh + manifest ----------
cat > "$PKG_DIR/install.sh" <<'INSTALLER'
#!/usr/bin/env bash
# ============================================================
# nanobot offline installer (Linux, pre-downloaded wheelhouse)
#
# Usage:
#   bash install.sh /path/to/python3.12
#   bash install.sh /path/to/python3.12 --recreate   # throw away the old venv
#
# Nothing here touches the system Python: packages land in ./.venv.
# ============================================================
set -uo pipefail

cd "$(dirname "$0")"

PY="${1:-}"
MODE="${2:-}"
if [[ -z "$PY" ]]; then
  echo "❌ missing Python path. Usage: bash install.sh /path/to/python3.12 [--recreate]"
  exit 1
fi

echo "✅ python: $PY"
"$PY" --version || { echo "❌ cannot run $PY"; exit 1; }
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' \
  || { echo "❌ nanobot needs Python 3.11+; wheels here are built for this interpreter"; exit 1; }

if ! "$PY" -m pip --version >/dev/null 2>&1; then
  echo "🔧 no pip in that interpreter, bootstrapping with ensurepip..."
  "$PY" -m ensurepip --upgrade >/dev/null 2>&1 \
    || { echo "❌ ensurepip failed; bundle a pip wheel or fix that interpreter"; exit 1; }
fi

VENV="$(pwd)/.venv"
[[ "$MODE" == "--recreate" ]] && { echo "🧹 removing $VENV"; command rm -rf "$VENV"; }

if [[ -x "$VENV/bin/pip" ]]; then
  echo "♻️  reusing venv $VENV"
elif ! "$PY" -m venv "$VENV" || [[ ! -x "$VENV/bin/pip" ]]; then
  echo "⚠️  venv creation failed; installing into that interpreter directly"
  VENV=""
fi
PIP="${VENV:+$VENV/bin/pip}"
PIP="${PIP:-$PY -m pip}"
echo "🎯 install target: ${VENV:-$PY}"

# glibc gate: check if the system glibc is compatible with the wheels
TARGET_GLIBC="$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+$' || true)"
if [[ -n "$TARGET_GLIBC" ]]; then
  # Check if any wheel requires a newer glibc than available
  WHEELHOUSE_DIR="$(pwd)/wheelhouse"
  if [[ -d "$WHEELHOUSE_DIR" ]]; then
    # Simple check: if we have manylinux_2_28 wheels, we need glibc >= 2.28
    HAS_HIGH_GLIBC=0
    for whl in "$WHEELHOUSE_DIR"/*.whl; do
      if [[ -f "$whl" ]] && grep -q "manylinux_2_28\|manylinux_2_27" "$whl" 2>/dev/null; then
        HAS_HIGH_GLIBC=1
        break
      fi
    done

    if [[ "$HAS_HIGH_GLIBC" -eq 1 ]]; then
      # Check if system glibc is at least 2.28
      if ! "$PY" -c "import sys; sys.exit(0 if tuple(map(int,'$TARGET_GLIBC'.split('.'))) >= (2, 28) else 1)"; then
        echo "⚠️  warning: some wheels may require glibc >= 2.28, but this box has $TARGET_GLIBC"
        echo "   If installation fails, try repacking with:"
        echo "     scripts/package_offline.sh --old-glibc   # pins manylinux2014-compatible wheels"
      fi
    fi
  fi
fi

# Upgrade pip/setuptools/wheel from wheelhouse first so the resolver understands
# all modern platform tags (PEP 600 manylinux_2_x, abi3, etc.).
echo "📦 upgrading pip/setuptools/wheel..."
"$PIP" install --no-index --find-links="$(pwd)/wheelhouse" \
  --upgrade pip setuptools wheel >/dev/null 2>&1 \
  || echo "⚠️  pip upgrade skipped (non-fatal)"

echo "📦 installing dependencies (--no-index, from wheelhouse/)..."
"$PIP" install --no-index --find-links="$(pwd)/wheelhouse" \
  --upgrade -r requirements-linux.txt \
  || { echo "❌ dependency resolution failed against wheelhouse/."; \
       echo "   most likely the payload was built for a newer glibc / interpreter than this box."; \
       echo "   check: python version, uname -m, ldd --version (this bundle targets $TARGET_GLIBC, floor $FLOOR)"; \
       exit 1; }

echo "🚀 installing nanobot..."
"$PIP" install --no-index --find-links="$(pwd)/wheelhouse" \
  --upgrade dist/nanobot_ai-*.whl || exit 1

if [[ -n "$VENV" ]]; then
  CMD="$VENV/bin/nanobot"
else
  CMD="$PY -m nanobot"
fi

echo ""
echo "🔎 verifying import..."
VERIFY_PY="${VENV:+$VENV/bin/python}"
[[ -n "$VERIFY_PY" ]] || VERIFY_PY="$PY"
"$VERIFY_PY" -c 'import nanobot; print("   nanobot", nanobot.__version__)' \
  || echo "⚠️  import check failed (non-fatal)"

echo ""
echo "======================================================"
echo "✅ done"
echo "  gateway (WebUI):  $CMD gateway"
echo "  first-time setup: $CMD onboard"
echo "  config:           ~/.nanobot/config.json"
echo "======================================================"
INSTALLER
chmod +x "$PKG_DIR/install.sh"

TARBALL="$OUT_DIR/nanobot-offline-${TAG}-${ARCH}-${PYTAG}.tar.gz"
log "Packing $TARBALL"
tar -czf "$TARBALL" -C "$STAGE" "nanobot-offline-${TAG}"

log "Done"
echo "  file:  $TARBALL ($(du -h "$TARBALL" | awk '{print $1}'))"
echo "  wheels: $(tar tzf "$TARBALL" | grep -c '\.whl$')"
echo ""
echo "  on the offline box:"
echo "    tar xzf $(basename "$TARBALL") && cd nanobot-offline-${TAG}"
echo "    bash install.sh /path/to/python3.12"

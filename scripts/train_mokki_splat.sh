#!/usr/bin/env bash
#
# train_mokki_splat.sh
#
# Train a photographic Gaussian Splat (.ply) from a folder of raw Scaniverse
# images on Apple Silicon (macOS). The resulting .ply is ready for compression
# to .spz via SuperSplat for use in rudolfwesterholm.com/mokki/.
#
# Usage:
#   ./scripts/train_mokki_splat.sh /path/to/scaniverse_images
#
set -euo pipefail

IMAGE_DIR="${1:-}"
if [[ -z "$IMAGE_DIR" ]]; then
  echo "Usage: $0 /path/to/scaniverse_images" >&2
  exit 1
fi

if [[ ! -d "$IMAGE_DIR" ]]; then
  echo "Error: image directory '$IMAGE_DIR' not found" >&2
  exit 1
fi

IMAGE_DIR="$(cd "$IMAGE_DIR" && pwd)"
OUTPUT_DIR="$IMAGE_DIR/mokki_splat_output"
PLY_OUT="$OUTPUT_DIR/mokki.ply"

echo "==> Mökki Splat Trainer"
echo "    Image dir : $IMAGE_DIR"
echo "    Output    : $PLY_OUT"

# ---------------------------------------------------------------------------
# 1. Ensure Homebrew is installed
# ---------------------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  echo "==> Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon brew lives in /opt/homebrew
  if [[ -d /opt/homebrew/bin ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
fi

# ---------------------------------------------------------------------------
# 2. Install colmap and brush via Homebrew (if missing)
# ---------------------------------------------------------------------------
echo "==> Ensuring colmap is installed..."
if ! brew list colmap >/dev/null 2>&1; then
  brew install colmap
fi

echo "==> Ensuring brush (Gaussian Splatting trainer) is installed..."
if ! brew list brush >/dev/null 2>&1; then
  # brush may not be in core homebrew; try common taps
  if ! brew install brush 2>/dev/null; then
    brew tap nnn-lab/brush 2>/dev/null || true
    if ! brew install brush 2>/dev/null; then
      echo "    Warning: 'brush' formula not found in Homebrew." >&2
      echo "    Install brush manually from its project page."
    fi
  fi
fi

echo "    colmap: $(colmap --version 2>/dev/null || echo 'unknown')"
echo "    brush : $(brush --version 2>/dev/null || echo 'unknown')"

# ---------------------------------------------------------------------------
# 3. Run COLMAP automatic reconstruction (single camera)
# ---------------------------------------------------------------------------
mkdir -p "$OUTPUT_DIR"

echo "==> Running COLMAP automatic_reconstructor (this may take a while)..."
colmap automatic_reconstructor \
  --workspace_path "$OUTPUT_DIR" \
  --image_path "$IMAGE_DIR" \
  --single_camera 1 \
  --dense 1

# ---------------------------------------------------------------------------
# 4. Export Gaussian Splats from COLMAP dense point cloud
# ---------------------------------------------------------------------------
echo "==> Exporting .ply from COLMAP dense cloud..."
colmap model_converter \
  --input_path "$OUTPUT_DIR/dense/fused.ply" \
  --output_path "$OUTPUT_DIR" \
  --output_type PLY

# If fused.ply isn't directly output, look for alternatives
if [[ ! -f "$PLY_OUT" ]]; then
  # Try common dense output paths
  for cand in "$OUTPUT_DIR/dense/fused.ply" \
              "$OUTPUT_DIR/dense/0/fused.ply" \
              "$OUTPUT_DIR/sparse/0/fused.ply"; do
    if [[ -f "$cand" ]]; then
      cp "$cand" "$PLY_OUT"
      break
    fi
  done
fi

if [[ ! -f "$PLY_OUT" ]]; then
  echo "Error: COLMAP did not produce a .ply point cloud" >&2
  exit 1
fi

echo "==> Splat .ply ready: $PLY_OUT"
echo "    Next: compress to .spz via SuperSplat (https://superspl.at)"
echo "    Then copy $PLY_OUT to mokki/cabin.ply (or .spz) and refresh rudolfwesterholm.com/mokki/"

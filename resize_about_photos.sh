#!/bin/bash
# Resize About-page photos for web use.
# Uses macOS's built-in `sips` tool — no Homebrew or extra installs needed.
#
# Source folder:  ~/Downloads/aboutmepictures/
# Output folder:  ./images/about/
#
# What it does:
#   - Resizes each JPG to max 1600px on the longer edge
#   - Re-encodes JPG at quality 82 (visually indistinguishable at gallery sizes)
#   - Preserves original filenames so the JS code references match
#
# Usage (from inside the sethlist project root):
#   bash resize_about_photos.sh

set -e

SRC="$HOME/Downloads/aboutmepictures"
DST="images/about"

if [ ! -d "$SRC" ]; then
  echo "Source folder not found: $SRC"
  exit 1
fi

mkdir -p "$DST"

count=0
total_before=0
total_after=0

while IFS= read -r src_file; do
  filename=$(basename "$src_file")
  dst_file="$DST/$filename"

  before_size=$(stat -f%z "$src_file")
  total_before=$((total_before + before_size))

  echo "Processing: $filename"

  # Step 1: copy to destination (sips modifies files in place)
  cp "$src_file" "$dst_file"

  # Step 2: resize so the longer edge is max 1600px (preserves aspect ratio)
  sips --resampleHeightWidthMax 1600 "$dst_file" >/dev/null

  # Step 3: re-encode as JPEG quality 82
  sips -s format jpeg -s formatOptions 82 "$dst_file" >/dev/null

  after_size=$(stat -f%z "$dst_file")
  total_after=$((total_after + after_size))
  count=$((count + 1))

  before_kb=$((before_size / 1024))
  after_kb=$((after_size / 1024))
  echo "  ${before_kb}KB → ${after_kb}KB"
done < <(find "$SRC" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" \) | sort)

echo ""
echo "Done. Processed $count photos."
echo "Total: $((total_before / 1024 / 1024))MB → $((total_after / 1024 / 1024))MB"
echo ""
echo "Output: $DST/"
echo "Add to git: git add $DST && git commit -m 'Add About page photos'"

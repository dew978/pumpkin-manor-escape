#!/bin/bash
# art/comic/panels_v4/pXX.png (배경을 줄인 최종 화풍) → game/assets/comic/pXX.jpg (태블릿용 가로 1280, 품질 82)
H=/c/Users/ndh10/Documents/halloween-escape; mkdir -p $H/game/assets/comic
for f in $H/art/comic/panels_v4/p*.png; do
  case "$f" in *.raw.png) continue;; esac
  b=$(basename "$f" .png); ffmpeg -hide_banner -loglevel error -y -i "$f" -vf "scale='min(1280,iw)':-2" -q:v 4 "$H/game/assets/comic/$b.jpg"
done
ls -la $H/game/assets/comic | awk '{print $5, $9}'

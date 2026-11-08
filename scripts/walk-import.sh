#!/usr/bin/env bash
# Imports a downloaded walk-cycle sheet (found by exact byte size in ~/Downloads), slices it into
# aligned frames and writes a preview.  Usage: scripts/walk-import.sh <animal> <bytes>
set -euo pipefail
cd "$(dirname "$0")/.."
animal="$1"; bytes="$2"
f=""
for i in 1 2 3 4 5 6; do
  f=$(find "$HOME/Downloads" -maxdepth 1 -size "${bytes}c" | head -1)
  [ -n "$f" ] && break
  sleep 1
done
[ -z "$f" ] && { echo "download not found"; exit 1; }
mkdir -p art/sheets/walk
cp "$f" "art/sheets/walk/$animal.png"
node scripts/slice-walk.cjs "art/sheets/walk/$animal.png" public/game/sprites/mascots/walk "$animal"
node -e '
const sharp=require("sharp");const a=process.argv[1];(async()=>{const comp=[];const poses=["front","side","back"];
for(let r=0;r<3;r++)for(let i=0;i<4;i++){const b=await sharp(`public/game/sprites/mascots/walk/${a}_${poses[r]}_${i}.png`).resize({height:110}).toBuffer();comp.push({input:b,left:i*120+5,top:r*120+5});}
await sharp({create:{width:480,height:360,channels:4,background:"#ece6dc"}}).composite(comp).png().toFile(process.env.TEMP+`/hs_crops/walk_${a}_frames.png`);})()' "$animal"

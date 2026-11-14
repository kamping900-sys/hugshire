#!/bin/sh
# peek <clip> <t1> <t2> ... : contact strip of frames at those seconds -> build/peek-<clip>.png
FF=$(dirname "$0")/../node_modules/ffmpeg-static/ffmpeg.exe
c=$1; shift; i=0; list=""
for t in "$@"; do $FF -loglevel error -y -ss $t -i footage/$c.mp4 -frames:v 1 -vf scale=640:-1 build/pk_$i.png; list="$list build/pk_$i.png"; i=$((i+1)); done
NODE_PATH=../node_modules node -e "const s=require('sharp');const f=process.argv.slice(1);(async()=>{const ims=await Promise.all(f.map(x=>s(x).toBuffer()));const cols=Math.min(3,f.length),rows=Math.ceil(f.length/cols);await s({create:{width:640*cols,height:360*rows,channels:3,background:'#000'}}).composite(ims.map((b,i)=>({input:b,left:(i%cols)*640,top:Math.floor(i/cols)*360}))).png().toFile('build/peek.png')})()" $list

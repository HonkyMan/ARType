#!/usr/bin/env python3
"""Deterministic vector tracing of the user-selected Shift A source; no fonts required."""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'branding'
OUT.mkdir(exist_ok=True)
source=Image.open(OUT/'shift-a-reference.png').convert('RGBA')
a=np.array(source)
alpha=a[:,:,3]>120
purple=alpha & (a[:,:,2].astype(int)-a[:,:,0].astype(int)>50)
ink=alpha & ~purple

def trace(mask):
    mask=cv2.morphologyEx(mask.astype('uint8')*255,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
    contours,_=cv2.findContours(mask,cv2.RETR_TREE,cv2.CHAIN_APPROX_SIMPLE)
    return [cv2.approxPolyDP(c,.65,True).reshape(-1,2) for c in contours if cv2.contourArea(c)>25]

mark=trace(purple)
word=trace(ink)
allp=np.concatenate(mark); x,y,w,h=cv2.boundingRect(allp)
def path(contours,dx=0,dy=0):
    return ' '.join('M'+' L'.join(f'{int(p[0])-dx} {int(p[1])-dy}' for p in c)+' Z' for c in contours)
def svg(width,height,paths):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="ARType">'+''.join(f'<path fill="{color}" fill-rule="evenodd" d="{d}"/>' for color,d in paths)+'</svg>\n'
(OUT/'artype-mark.svg').write_text(svg(w,h,[('#7045ff',path(mark,x,y))]))
combined=np.concatenate(mark+word); bx,by,bw,bh=cv2.boundingRect(combined)
(OUT/'artype-logo.svg').write_text(svg(bw,bh,[('#7045ff',path(mark,bx,by)),('#211c31',path(word,bx,by))]))
(OUT/'artype-logo-light.svg').write_text(svg(bw,bh,[('#9978ff',path(mark,bx,by)),('#ffffff',path(word,bx,by))]))
(OUT/'artype-mark-mono.svg').write_text(svg(w,h,[('currentColor',path(mark,x,y))]))

mask=np.zeros((h*4,w*4),np.uint8)
for c in mark:
    # Contour orientation distinguishes holes from outer boundaries.
    shifted=(c-np.array([x,y]))*4
    cv2.fillPoly(mask,[shifted],0 if cv2.contourArea(c,oriented=True)>0 else 255)
mark_image=Image.new('RGBA',(w*4,h*4),'#7045ff'); mark_image.putalpha(Image.fromarray(mask))
mark_image.save(OUT/'artype-mark.png')
app=Image.new('RGBA',(1024,1024))
draw=ImageDraw.Draw(app); draw.rounded_rectangle((22,22,1002,1002),radius=215,fill='#f6f3ff')
small=mark_image.resize((740,round(h/w*740)),Image.Resampling.LANCZOS)
app.alpha_composite(small,((1024-small.width)//2,(1024-small.height)//2))
app.save(OUT/'artype-icon-1024.png')
assets=ROOT/'macos/TypeTide/Assets.xcassets'
for entry in json.loads((assets/'AppIcon.appiconset/Contents.json').read_text())['images']:
    if 'filename' not in entry:continue
    size=int(float(entry['size'].split('x')[0])*float(entry.get('scale','1x')[:-1]))
    app.resize((size,size),Image.Resampling.LANCZOS).save(assets/'AppIcon.appiconset'/entry['filename'])
for n,s in [('brand-mark.png',32),('brand-mark@2x.png',64)]:
    template=Image.new('RGBA',(s,s)); m=Image.new('RGBA',mark_image.size,'black');m.putalpha(mark_image.getchannel('A'))
    m.thumbnail((s,s),Image.Resampling.LANCZOS);template.alpha_composite(m,((s-m.width)//2,(s-m.height)//2));template.save(assets/'BrandMark.imageset'/n)
app.save(ROOT/'windows/assets/app.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
public=ROOT/'server/public/assets';public.mkdir(exist_ok=True)
for p in OUT.glob('*.svg'):(public/p.name).write_bytes(p.read_bytes())
print('ARType SVG wordmarks, mark, native icons and web assets generated.')

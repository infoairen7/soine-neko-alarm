import numpy as np, cv2, json, sys
from PIL import Image
exec(open('paw_final.py').read())
import os
ROOT=os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)) if '__file__' in dir() else '.', '..', '..'))
ORIG=os.path.join(ROOT,'materials','original')
OUT=os.path.join(ROOT,'assets')
SRC={'1':os.path.join(ORIG,'arm_photo.png'),'2':os.path.join(ORIG,'cat_chatora_2x3.png'),'3':os.path.join(ORIG,'cat_sabatora_2x3.png'),'4':os.path.join(ORIG,'cat_ragdoll_2x3.png')}
names={'2':'chatora','3':'sabatora','4':'ragdoll'}
E={'chatora':(200,140,165,138,-12),'sabatora':(200,140,165,138,-12),'ragdoll':(215,150,170,140,-12)}
POSES=['sleep','sleep2','cuddle','lick','meow','meow2']
def load_cells(path, cols=2, rows=3):
    im=np.array(Image.open(path).convert('RGBA')).astype(np.float32)/255
    H,W=im.shape[:2]; cw,ch=W//cols,H//rows
    return [im[r*ch:(r+1)*ch, c*cw:(c+1)*cw].copy() for r in range(rows) for c in range(cols)]
def premul(c): o=c.copy(); o[...,:3]*=o[...,3:]; return o
def unpremul(c):
    o=c.copy(); a=o[...,3:]; o[...,:3]=np.where(a>1e-5,o[...,:3]/np.maximum(a,1e-5),0); return o
def gray(c): return (cv2.cvtColor(np.ascontiguousarray(c[...,:3]),cv2.COLOR_RGB2GRAY)*c[...,3]).astype(np.float32)
def ellmask(n,size,feather=30.0,grow=1.0):
    cx,cy,rx,ry,a=E[n]; rx*=grow; ry*=grow
    yy,xx=np.mgrid[0:size,0:size].astype(np.float32)
    ca,sa=np.cos(np.radians(a)),np.sin(np.radians(a))
    dx=xx-cx; dy=yy-cy; u=(dx*ca+dy*sa)/rx; v=(-dx*sa+dy*ca)/ry
    dist=(1-np.sqrt(u*u+v*v))*min(rx,ry)
    m=np.clip(dist/feather,0,1); return m*m*(3-2*m)
def body_align(ref,c):
    g0=gray(ref); g=gray(c); h,w=g0.shape
    mask=np.ones((h,w),np.uint8); mask[:int(h*0.55), :int(w*0.68)]=0
    warp=np.eye(2,3,dtype=np.float32)
    cc,warp=cv2.findTransformECC(g0,g,warp,cv2.MOTION_AFFINE,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,300,1e-7),mask,5)
    return np.clip(cv2.warpAffine(premul(c),warp,(w,h),flags=cv2.INTER_CUBIC+cv2.WARP_INVERSE_MAP,borderValue=0),0,1)
def head_align(refp, alp, n, exclude):
    """align the head of alp to refp using the head region minus eyes/mouth (exclude = list of (cx,cy,r))"""
    size=refp.shape[0]
    m=(ellmask(n,size,40)>0.3).astype(np.uint8)
    for (cx,cy,r) in exclude: cv2.circle(m,(int(cx),int(cy)),int(r),0,-1)
    g0=cv2.cvtColor(np.ascontiguousarray(refp[...,:3]),cv2.COLOR_RGB2GRAY); g=cv2.cvtColor(np.ascontiguousarray(alp[...,:3]),cv2.COLOR_RGB2GRAY)
    g0=cv2.GaussianBlur(g0,(0,0),1.5); g=cv2.GaussianBlur(g,(0,0),1.5)
    warp=np.eye(2,3,dtype=np.float32)
    try:
        cc,warp=cv2.findTransformECC(g0,g,warp,cv2.MOTION_EUCLIDEAN,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,300,1e-7),m,5)
    except Exception as e:
        print('head align fail',e); return alp, None
    out=cv2.warpAffine(alp,warp,(size,size),flags=cv2.INTER_CUBIC+cv2.WARP_INVERSE_MAP,borderValue=0)
    return np.clip(out,0,1), warp

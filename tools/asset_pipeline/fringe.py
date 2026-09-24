import numpy as np, cv2
def fur_fringe(pm, seed=7, maxlen=5.0, strength=0.75):
    """pm: premultiplied RGBA float cell frame. Adds fine fur tips along the silhouette (same seed -> same pattern)."""
    h,w=pm.shape[:2]
    a=pm[...,3]
    f=pm.copy(); rgb=np.where(a[...,None]>1e-4, pm[...,:3]/np.maximum(a[...,None],1e-4), 0)
    inside=(a>0.5).astype(np.uint8)
    # distance from outside pixels to the silhouette, with nearest-inside-pixel labels
    dist,lab=cv2.distanceTransformWithLabels(1-inside,cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_PIXEL)
    # map label -> coordinates of the zero pixel (inside pixels)
    ys,xs=np.where(inside==0); ys_in,xs_in=np.where(inside==1)
    # labels are assigned to zero pixels in raster order of the source image where src==0 -> here src = 1-inside, zeros = inside pixels
    order=np.zeros(lab.max()+1,np.int64); order[:]=-1
    zy,zx=np.where((1-inside)==0)
    lbl_at=lab[zy,zx]; lx=np.zeros(lab.max()+1,np.int32); ly=np.zeros(lab.max()+1,np.int32)
    lx[lbl_at]=zx; ly[lbl_at]=zy
    ny=ly[lab]; nx=lx[lab]
    rng=np.random.default_rng(seed)
    # strand length field on the silhouette: noise correlated along the contour (blurred white noise sampled at nearest edge px)
    noise=rng.random((h,w)).astype(np.float32)
    noise=cv2.GaussianBlur(noise,(0,0),0.8); noise=(noise-noise.min())/(noise.max()-noise.min())
    L=maxlen*np.clip((noise[ny,nx]-0.35)/0.65,0,1)**1.3
    # thin strands: modulate with high-frequency noise across the strand direction
    hf=rng.random((h,w)).astype(np.float32); hf=cv2.GaussianBlur(hf,(0,0),0.5)
    hf=(hf-hf.min())/(hf.max()-hf.min())
    t=np.clip(1-dist/np.maximum(L,1e-3),0,1)
    add_a=strength*t*t*(0.35+0.65*hf)*(dist>0)*(dist<=maxlen+1)
    # fur tip color: sample slightly inside (2px) along the nearest inside pixel
    col=rgb[ny,nx]
    new_a=np.maximum(a, add_a*(inside==0))
    out=np.zeros_like(pm)
    blend=np.where((inside==0)[...,None], col, rgb)
    out[...,:3]=blend*new_a[...,None]; out[...,3]=new_a
    # keep original premultiplied where original alpha dominates
    keep=(a>=add_a)[...,None]
    out=np.where(keep,pm,out)
    return out

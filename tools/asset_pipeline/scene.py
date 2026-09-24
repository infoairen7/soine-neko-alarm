from PIL import Image
import numpy as np, cv2
ARM=np.array(Image.open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath('build_v2.py')),'..','..','materials','original','arm_photo.png')).convert('RGB')).astype(np.float32)/255
def placement_matrix(anchor_cell, anchor_scene, scale, rot_deg):
    # maps cell coords -> scene coords ; rot positive = counterclockwise on screen
    t=np.radians(-rot_deg); c,s=np.cos(t)*scale,np.sin(t)*scale
    ax,ay=anchor_cell; bx,by=anchor_scene
    M=np.array([[c,-s,0],[s,c,0]],np.float32)
    M[:,2]=[bx-(c*ax - s*ay), by-(s*ax + c*ay)]
    return M
def warp_to_scene(pm, M, size):
    return cv2.warpAffine(pm, M, size, flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
def grade(pm, sat=0.9, gain=(0.95,0.94,0.935), lift=0.015, contrast=0.94):
    a=pm[...,3:]; rgb=np.where(a>1e-4, pm[...,:3]/np.maximum(a,1e-4), 0)
    lum=(rgb@np.array([0.299,0.587,0.114],np.float32))[...,None]
    rgb=lum+(rgb-lum)*sat
    rgb=(rgb-0.5)*contrast+0.5
    rgb=rgb*np.array(gain,np.float32)+lift
    rgb=np.clip(rgb,0,1)
    o=pm.copy(); o[...,:3]=rgb*a; return o
def shadow_map(alpha):
    s1=cv2.GaussianBlur(np.roll(np.roll(alpha,10,0),6,1),(0,0),20)
    s2=cv2.GaussianBlur(np.roll(np.roll(alpha,3,0),2,1),(0,0),4)
    return np.clip(0.30*s1+0.22*s2,0,0.6)
def composite(bg, pm_scene, shadow=None):
    out=bg.copy()
    if shadow is not None:
        out=out*(1-shadow[...,None]*np.array([1.0,1.03,1.06],np.float32))
    a=pm_scene[...,3:]
    return out*(1-a)+pm_scene[...,:3]

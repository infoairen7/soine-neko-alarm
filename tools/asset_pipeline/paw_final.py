import numpy as np, cv2
def split_paw(fr):
    a=fr[...,3]; m=(a>0.02).astype(np.uint8)
    n,lbl,st,cen=cv2.connectedComponentsWithStats(m)
    pid=[i for i in range(1,n) if cen[i][0]<130 and st[i,4]<25000]
    pawmask=np.isin(lbl,pid).astype(np.float32)
    pawmask=cv2.dilate(pawmask,np.ones((5,5),np.uint8))
    body=fr*(1-pawmask)[...,None]; paw=fr*pawmask[...,None]
    ys,xs=np.where(pawmask>0); st=(xs.min(),ys.min(),xs.max()-xs.min()+1,ys.max()-ys.min()+1)
    return body, paw, st
def stretch_top(paw, st, k=1.8, frac=0.42):
    x,y,w,h=st; split=y+h*frac
    Y,X=np.mgrid[0:paw.shape[0],0:paw.shape[1]].astype(np.float32)
    src_y=np.where(Y<split, split-(split-Y)/k, Y).astype(np.float32)
    return cv2.remap(paw,X,src_y,cv2.INTER_LINEAR,borderValue=0)
def tuck_paw(fr, shift=(80,-40), rot=-14, k=1.8, ao=0.5):
    """premultiplied RGBA cell frame -> frame with the far paw moved next to the main paw, under the body"""
    body,paw,st=split_paw(fr)
    paw=stretch_top(paw,st,k)
    x,y,w,h=st; pc=np.array([x+w/2,y+h/2])
    t=np.radians(-rot); c,s=np.cos(t),np.sin(t)
    A=np.array([[c,-s,0],[s,c,0]],np.float32); dstc=pc+np.array(shift)
    A[:,2]=[dstc[0]-(c*pc[0]-s*pc[1]), dstc[1]-(s*pc[0]+c*pc[1])]
    paw2=cv2.warpAffine(paw,A,(fr.shape[1],fr.shape[0]),flags=cv2.INTER_LANCZOS4,borderValue=0)
    paw2=np.clip(paw2,0,1)
    bodyAO=cv2.GaussianBlur(body[...,3],(0,0),6.5)
    paw2[...,:3]*=(1-ao*bodyAO)[...,None]
    a=body[...,3:]
    return body+paw2*(1-a), body, paw2

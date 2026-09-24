exec(open('build_v2.py').read())
EXCL={'chatora':[(158,135,30),(228,190,30),(172,235,38)],'sabatora':[(158,140,30),(228,195,30),(172,238,38)],'ragdoll':[(168,150,30),(240,200,30),(182,245,38)]}
def lab(img): return cv2.cvtColor((np.clip(img[...,:3],0,1)*255).astype(np.uint8),cv2.COLOR_RGB2LAB).astype(np.float32)
res={}
for k,n in names.items():
    als=np.load(f'bodyal_{n}.npy')          # premultiplied, [0] = base (no separate paw)
    base=als[0]
    out=[base]; info={}
    for i in range(1,6):
        alh,wp=head_align(base,als[i],n,EXCL[n])
        if wp is not None:
            info[POSES[i]]=(round(float(wp[0,2]),2),round(float(wp[1,2]),2),round(float(np.degrees(np.arctan2(wp[1,0],wp[0,0]))),2))
        m=ellmask(n,512,30)[...,None]
        # remove separate paw from pose frames outside head (take base there)
        comp=alh*m+base*(1-m)
        out.append(np.clip(comp,0,1))
    print(n,'head align (tx,ty,deg):',info)
    np.save(f'v2frames_{n}.npy',np.stack(out).astype(np.float32))

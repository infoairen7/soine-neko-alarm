exec(open('build_v2.py').read())
exec(open('paw_final.py').read())
exec(open('fringe.py').read())
exec(open('muzzle.py').read().split("if __name__")[0])
import json
RIG={
 'chatora':{'eyes':[{'c':[157,154],'r':[19,14],'a':49,'cc':[160,163]},{'c':[233,193],'r':[22,12],'a':4,'cc':[227,196]}],
            'nose':[177,221],'mouth':{'c':[168,247],'r':[30,20],'a':-8,'jaw':[-3,14],'chin':[167,258],'chinS':17},
            'tongue':{'root':[168,234],'tip':[152,263],'w':11},
            'ears':[{'base':[162,68],'tip':[170,7]},{'base':[310,150],'tip':[352,107]}],
            'tail':[290,385],'paw':[160,362],'head':{'c':[200,150],'s':80,'pivot':[268,228]},'breath':{'c':[372,255],'s':[105,92]}},
 'sabatora':{'eyes':[{'c':[158,157],'r':[19,14],'a':50,'cc':[161,164]},{'c':[241,197],'r':[22,12],'a':3,'cc':[230,199]}],
            'nose':[177,221],'mouth':{'c':[167,250],'r':[30,20],'a':-8,'jaw':[-3,14],'chin':[166,261],'chinS':17},
            'tongue':{'root':[170,236],'tip':[155,265],'w':11},
            'ears':[{'base':[160,68],'tip':[167,5]},{'base':[310,152],'tip':[352,107]}],
            'tail':[285,387],'paw':[160,362],'head':{'c':[200,150],'s':80,'pivot':[268,228]},'breath':{'c':[372,255],'s':[105,92]}},
 'ragdoll':{'eyes':[{'c':[167,156],'r':[19,15],'a':50,'cc':[171,165]},{'c':[251,194],'r':[23,13],'a':5,'cc':[240,200]}],
            'nose':[190,220],'mouth':{'c':[183,247],'r':[30,20],'a':-8,'jaw':[-3,14],'chin':[182,258],'chinS':17},
            'tongue':{'root':[180,236],'tip':[165,275],'w':13},
            'ears':[{'base':[165,75],'tip':[162,12]},{'base':[325,160],'tip':[370,115]}],
            'tail':[275,382],'paw':[165,362],'head':{'c':[215,158],'s':82,'pivot':[280,235]},'breath':{'c':[375,262],'s':[108,95]}},
}
def grain(h,w,seed=3,sigma=2.2/255):
    rng=np.random.default_rng(seed); g=rng.normal(0,1,(h,w)).astype(np.float32)
    g=cv2.GaussianBlur(g,(0,0),0.6); g/=g.std(); return g*sigma
meta={}
G=grain(512,512)
for k,n in names.items():
    v2=np.load(f'v2frames_{n}.npy')          # [sleep, sleep2, cuddle, lick, meow(head-aligned), meow2]
    old=np.load(f'bodyal_{n}.npy')
    orig0=premul(load_cells(SRC[k])[0])
    _,_,paw2=tuck_paw(orig0)              # repositioned far paw (premultiplied, with AO)
    mz=np.load(f'meowmz_{n}.npy')         # muzzle-aligned meow frames (only mouth region is used)
    frames={'sleep':v2[0],'sleep2':v2[1],'cuddle':v2[2],'lick':v2[3],'meowA':mz[0],'meowB':mz[1]}
    out={}
    def eye_shift(f, eyes, sig=21.0):
        # 閉じた目（まぶたの線）を、開いた目と同じ位置へ局所的に寄せる
        Y,X=np.mgrid[0:512,0:512].astype(np.float32)
        DX=np.zeros((512,512),np.float32); DY=np.zeros((512,512),np.float32)
        for e in eyes:
            dx=e['c'][0]-e['cc'][0]; dy=e['c'][1]-e['cc'][1]
            w=np.exp(-0.5*((X-e['c'][0])**2+(Y-e['c'][1])**2)/sig**2)
            DX+=dx*w; DY+=dy*w
        return np.clip(cv2.remap(f,X-DX,Y-DY,cv2.INTER_CUBIC,borderValue=0),0,1)
    for key,f in frames.items():
        f=f.copy()
        if key in ('sleep','sleep2','lick'): f=eye_shift(f,RIG[n]['eyes'])
        if key not in ('meowA','meowB'):
            # recompute paw AO against this frame's body and put the tucked paw underneath
            a=f[...,3:]
            f=f+paw2*(1-a)
            f=fur_fringe(f,seed=11,maxlen=6.0,strength=0.8)
        a=f[...,3]
        rgb=np.where(a[...,None]>1e-4,f[...,:3]/np.maximum(a[...,None],1e-4),0)
        rgb=np.clip(rgb+G[...,None]*(a[...,None]>0.02),0,1)
        out[key]=np.concatenate([rgb,a[...,None]],-1)
    A=np.max(np.stack([out[k2][...,3] for k2 in ['sleep','sleep2','cuddle','lick']]),0)
    ys,xs=np.where(A>0.004); PAD=16
    x0=max(0,xs.min()-PAD); y0=max(0,ys.min()-PAD); x1=min(512,xs.max()+PAD+1); y1=min(512,ys.max()+PAD+1)
    for key,f in out.items():
        c=f[y0:y1,x0:x1]; c[...,:3][c[...,3]<0.004]=0
        Image.fromarray((np.clip(c,0,1)*255+0.5).astype(np.uint8),'RGBA').save(os.path.join(OUT,f'v2_{n}_{key}.webp'),'WEBP',quality=90,method=6,alpha_quality=95)
    # thumbnail from cuddle
    cud=out['cuddle']; hc=RIG[n]['head']['c']; side=230
    th=Image.fromarray((np.clip(cud,0,1)*255).astype(np.uint8),'RGBA').crop((hc[0]-side//2-5,hc[1]-side//2+15,hc[0]+side//2-5,hc[1]+side//2+15)).resize((128,128),Image.LANCZOS)
    th.save(os.path.join(OUT,f'v2_{n}_thumb.webp'),'WEBP',quality=88)
    rig=json.loads(json.dumps(RIG[n]))
    for e in rig['eyes']: e['cc']=list(e['c'])      # 閉じた目は開いた目の位置に合わせ済み
    meta[n]={'cell':512,'crop':[int(x0),int(y0),int(x1-x0),int(y1-y0)],'rig':rig}
    print(n,meta[n]['crop'])
json.dump(meta,open(os.path.join(OUT,'meta_v2.json'),'w'))

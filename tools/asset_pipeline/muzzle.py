exec(open('build_v2.py').read())
NOSE={'chatora':(177,220),'sabatora':(177,221),'ragdoll':(190,220)}
def muzzle_align(ref, mv, n):
    nx,ny=NOSE[n]
    fr=unpremul(ref)[...,:3]; fm=unpremul(mv)[...,:3]
    tpl=(fr[ny-26:ny+10, nx-36:nx+30]*255).astype(np.uint8)   # nose + upper whisker pads (above the mouth)
    win=(fm[ny-70:ny+40, nx-70:nx+70]*255).astype(np.uint8)
    r=cv2.matchTemplate(win,tpl,cv2.TM_CCOEFF_NORMED)
    _,mx,_,loc=cv2.minMaxLoc(r)
    # position of template top-left in mv coords
    px=nx-70+loc[0]; py=ny-70+loc[1]
    dx=(nx-36)-px; dy=(ny-26)-py      # shift to apply to mv
    M=np.float32([[1,0,dx],[0,1,dy]])
    out=cv2.warpAffine(mv,M,(512,512),flags=cv2.INTER_CUBIC,borderValue=0)
    return np.clip(out,0,1),(dx,dy),mx
if __name__=='__main__':
    rows=[]; shifts={}
    for n in ['chatora','sabatora','ragdoll']:
        fr=np.load(f'v2frames_{n}.npy'); old=np.load(f'bodyal_{n}.npy')
        res=[]
        for i in [4,5]:
            al,d,cc=muzzle_align(fr[2],old[i],n); print(n,i,'shift',d,'score',round(float(cc),3)); res.append(al); shifts[f'{n}_{i}']=d
        np.save(f'meowmz_{n}.npy',np.stack(res).astype(np.float32))
        def show(p):
            f=unpremul(p); bg=np.full_like(f[...,:3],0.3); return f[...,:3]*f[...,3:]+bg*(1-f[...,3:])
        nx,ny=NOSE[n]; box=(nx-60,ny-50,nx+60,ny+60)
        tiles=[show(fr[2]),show(res[0]),0.5*show(fr[2])+0.5*show(res[0]),show(res[1])]
        rows.append(np.concatenate([cv2.resize(t[box[1]:box[3],box[0]:box[2]],(330,302),interpolation=cv2.INTER_CUBIC) for t in tiles],1))
    Image.fromarray((np.clip(np.concatenate(rows,0),0,1)*255).astype(np.uint8)).save('muzzle_check.png')

# 手順1：各ポーズの胴体を「眠る」コマに合わせる（bodyal_*.npy を作る）
exec(open('build_v2.py').read())
for k,n in names.items():
    cells=load_cells(SRC[k]); ref=cells[0]; refp=premul(ref)
    base,_,_=split_paw(refp)
    als=[base]+[body_align(ref,cells[i]) for i in range(1,6)]
    np.save(f'bodyal_{n}.npy',np.stack(als).astype(np.float32))
    print('body aligned',n)

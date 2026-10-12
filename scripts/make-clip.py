"""把首屏轨道用的源视频压成卡片可挂载的 MP4（可整批 12 条，也可只跑替换的几条）。

用法（源目录与产出目录都由参数传入；加 -I 跑，避免源目录里的同名模块被 import ——
源视频是外部生成物，不当作可信代码）：

    python -I scripts/make-clip.py <源视频目录> public/video

例：把一批 1284×716 / 30fps / 约 10Mbps 的 MP4 压到本仓库的 public/video：

    python -I scripts/make-clip.py ../arc public/video

策略：
  1. 居中裁成精确 16:9（源图 1284×716 = 1.7933，比 16:9 略宽，每边去掉约 3px ——
     卡片的 object-fit: cover 本来也会裁，这一步只是让「文件比例 = 卡片比例」）
  2. 缩到 640×360（卡片最大显示宽 318px，2× 屏需 636px，640 刚好——1280 是两倍的浪费）
  3. 丢音轨（-an）。这些片子没有配音，源文件里的 AAC 是生成器带出来的死重
  4. H.264 CRF 从 26 往下试，取第一个 ≤ 上限的质量
  5. +faststart：moov 挪到文件头，浏览器拿到前几 KB 就能起播。
     关键帧固定 24 帧一个（scenecut=0）：卡片转走后暂停、转回来接着播，
     固定间隔才不会有「从上一个关键帧重解」的花屏

为什么不改帧率：源是 30fps，且画面多为缓慢推移 —— 推移正是 24fps 会抖的场景。
省下的约 20% 体积不值这个风险，所以原样保留。
"""
import json
import os
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except (AttributeError, OSError):  # stdout 被换成不支持 reconfigure 的对象时跳过
    pass

TARGET_W, TARGET_H = 640, 360
MAX_BYTES = 400 * 1024
CRFS = [26, 29, 32, 34]
KEYINT = 24
PRESET = 'slow'


def encode(src: str, dst: str, crf: int) -> None:
    subprocess.run(
        [
            'ffmpeg', '-y', '-v', 'error', '-i', src,
            '-an',
            '-vf', f'scale={TARGET_W}:{TARGET_H}:force_original_aspect_ratio=increase,'
                   f'crop={TARGET_W}:{TARGET_H}',
            '-c:v', 'libx264', '-preset', PRESET, '-crf', str(crf),
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-x264-params', f'keyint={KEYINT}:min-keyint={KEYINT}:scenecut=0',
            dst,
        ],
        check=True,
        stdin=subprocess.DEVNULL,
    )


def duration(src: str) -> float:
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'format=duration', '-of', 'json', src],
        check=True, capture_output=True, text=True, stdin=subprocess.DEVNULL,
    ).stdout
    return float(json.loads(out)['format']['duration'])


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src_dir, dst_dir = sys.argv[1], sys.argv[2]
    os.makedirs(dst_dir, exist_ok=True)

    files = sorted(f for f in os.listdir(src_dir) if f.lower().endswith('.mp4'))
    print(f'{len(files)} 条源视频  源目录={src_dir}  目标目录={dst_dir}\n')

    total = 0
    src_total = 0
    rows = []
    for fn in files:
        src = os.path.join(src_dir, fn)
        src_total += os.path.getsize(src)
        dst = os.path.join(dst_dir, os.path.splitext(fn)[0] + '.mp4')
        chosen, blob = None, 0
        for crf in CRFS:
            encode(src, dst, crf)
            blob = os.path.getsize(dst)
            if blob <= MAX_BYTES:
                chosen = crf
                break
        if chosen is None:  # 最低质量仍超标 → 保留最后一次尝试并告警
            chosen = CRFS[-1]
        total += blob
        dur = duration(src)
        rows.append((os.path.basename(dst), dur, chosen, blob))
        flag = '' if blob <= MAX_BYTES else '  ← 超标'
        kbps = blob * 8 / dur / 1000
        print(f'  {rows[-1][0]:14s} {dur:4.1f}s  crf={chosen:<3} '
              f'{blob/1024:6.0f} KB  {kbps:5.0f} kbps{flag}')

    budget = MAX_BYTES * len(rows)
    mb = total / 1024 / 1024
    print(f'\n合计 {mb:.2f} MB / {len(rows)} 条'
          f'（逐条上限 {MAX_BYTES//1024}KB，整包预算 {budget/1024/1024:.2f} MB）'
          f'  平均每条 {total/len(rows)/1024:.0f} KB')
    print(f'源视频合计 {src_total/1024/1024:.2f} MB → 压缩比 {src_total/total:.0f}×')
    # 首屏不会同时下载全部：HeroOrbit 里 preload="none"，只有转到前排的
    # MAX_CONCURRENT_VIDEOS 条会真正开始拉流。这里按并发上限给一个真实的首屏增量。
    print(f'注：卡片 preload="none"，首屏实际同时拉流的至多 4 条 ≈ '
          f'{min(4, len(rows)) * total / len(rows) / 1024 / 1024:.2f} MB')
    return 0 if total <= budget else 1


if __name__ == '__main__':
    sys.exit(main())

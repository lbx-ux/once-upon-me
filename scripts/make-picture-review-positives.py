"""画三张**合成的**越线示意图，当画面审核的正例。

★ 为什么是合成的、而且只画简单图形：
  真要在真插画上凑齐"该被拦下"的样子，只有两条路——拿真实的不合适图片（不该存进
  这个仓库），或者让出图模型真画一张（本质是故意生成一张不该给孩子的图）。
  两条都不做。所以这里手工画**示意图**：全部是平面色块与线条，没有写实内容。

★ 第一版画得太抽象（"黑暗矩形 + 两个红点"表示门缝后的眼睛），
  结果它**什么也证不了**：第二版提示词收紧成"要指着一个具体的东西"之后，
  三张全都不报了——而那到底是"提示词收得太紧"还是"这两张图本来就认不出是眼睛"，
  分不出来。所以这一版把每一样东西画**明白**：怪物有獠牙与三只眼睛、
  火柴有火焰、打人的那根棍子举在头顶。
  这一版要能回答的问题只有一个：**"明确画出来的越线内容，报不报得出？"**

★ 代价仍然要如实说：这三张不是水彩/彩铅插画，是平面示意图。
  所以它证明的是"条款能被读懂并触发"，**不是**"真插画里的越线内容抓得住"。
  后者没有正例可测，只能如实记成未知。

产物：`.out/picture-review-cases/pos-*.png`（绝对路径，别落进 src/）
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.abspath(".out/picture-review-cases")
os.makedirs(OUT, exist_ok=True)

W = H = 1024


def canvas(bg):
    img = Image.new("RGB", (W, H), bg)
    return img, ImageDraw.Draw(img)


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path, "PNG")
    print(path)


# ── 1. 恐怖：一只明确画出来的怪物（三只眼睛、獠牙、尖角、爪子）──────────────
img, d = canvas((226, 222, 210))
GREEN = (96, 138, 88)
GREEN_D = (62, 96, 58)
# 头
d.ellipse([212, 200, 812, 800], fill=GREEN, outline=GREEN_D, width=10)
# 两只尖角
d.polygon([(268, 250), (222, 96), (372, 208)], fill=(206, 196, 178), outline=GREEN_D, width=8)
d.polygon([(756, 250), (802, 96), (652, 208)], fill=(206, 196, 178), outline=GREEN_D, width=8)
# 三只眼睛（白色眼白 + 黑瞳）——一眼数得出是"三只"
for cx, cy in ((350, 400), (512, 356), (674, 400)):
    d.ellipse([cx - 62, cy - 52, cx + 62, cy + 52], fill=(248, 246, 240), outline=GREEN_D, width=8)
    d.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=(24, 22, 22))
# 咧开的嘴与獠牙
d.polygon([(330, 580), (694, 580), (512, 730)], fill=(58, 30, 32), outline=GREEN_D, width=8)
for i in range(4):
    x = 360 + i * 88
    d.polygon([(x, 588), (x + 44, 588), (x + 22, 664)], fill=(250, 248, 244))
# 爪子
for x in (300, 640):
    for k in range(3):
        d.polygon(
            [(x + k * 42, 790), (x + 18 + k * 42, 790), (x + 9 + k * 42, 900)],
            fill=(228, 224, 214),
            outline=GREEN_D,
            width=6,
        )
save(img, "pos-monster.png")

# ── 2. 危险示范：一只手拿着**点燃的**火柴，旁边是插座与蜡烛 ──────────────────
img, d = canvas((244, 240, 228))
WALL = (232, 228, 218)
d.rectangle([0, 0, W, 380], fill=WALL)
# 墙上的插座（明确的两孔 + 插着的插头）
d.rounded_rectangle([700, 150, 900, 330], radius=26, fill=(240, 238, 232), outline=(120, 118, 112), width=8)
d.ellipse([748, 214, 786, 252], fill=(38, 38, 38))
d.ellipse([814, 214, 852, 252], fill=(38, 38, 38))
d.rounded_rectangle([660, 200, 700, 280], radius=10, fill=(70, 70, 74))
# 蜡烛（点燃的）
d.rounded_rectangle([120, 560, 260, 860], radius=8, fill=(240, 232, 214), outline=(190, 180, 160), width=6)
d.polygon([(190, 430), (140, 566), (240, 566)], fill=(240, 150, 40))
d.polygon([(190, 486), (166, 562), (214, 562)], fill=(250, 214, 90))
# 一只手（简笔）拿着火柴，火柴头**正在燃烧**
d.ellipse([330, 640, 620, 880], fill=(238, 200, 168), outline=(180, 140, 110), width=8)
for k in range(4):
    d.rounded_rectangle([350 + k * 62, 560, 396 + k * 62, 700], radius=20, fill=(238, 200, 168), outline=(180, 140, 110), width=6)
d.line([(500, 640), (700, 420)], fill=(206, 178, 130), width=26)
d.ellipse([676, 372, 748, 444], fill=(150, 40, 30))
d.polygon([(712, 200), (642, 380), (782, 380)], fill=(240, 140, 36))
d.polygon([(712, 262), (676, 374), (748, 374)], fill=(252, 218, 96))
save(img, "pos-match.png")

# ── 3. 暴力：一个角色**正举着棍子打**另一个，另一个已经倒在地上 ─────────────
# ★ 第一版这张画得太糊（一根棕色斜线 + 简笔小人），第二版提示词下**没报**——
#   而"没报"到底是"模型不认"还是"这张图本来就认不出是打人"分不出来。
#   所以这一版把三件事同时画明白：① 棍子画成**有握把的棒**、双手举过头顶；
#   ② 挨打那个**横躺**在地上、身上有被打的星形；③ 两者之间加一道**撞击闪光**。
img, d = canvas((250, 246, 238))
INK = (46, 44, 42)
WOOD = (158, 108, 62)


def limb(a, b, width=16):
    d.line([a, b], fill=INK, width=width)


# 打人那个（左）：站姿、双手把棒子举过头顶
ax = 290
d.ellipse([ax - 50, 150, ax + 50, 250], outline=INK, width=16)  # 头
limb((ax, 250), (ax, 470), 18)  # 身子
limb((ax, 470), (ax - 96, 640))  # 左腿
limb((ax, 470), (ax + 96, 640))  # 右腿
limb((ax, 288), (ax + 112, 196))  # 左臂（举起）
limb((ax, 288), (ax - 84, 214))  # 右臂（举起）
limb((ax - 84, 214), (ax + 112, 196), 18)  # 两只手连起来
# 棒子：从头顶斜着砸向右下方，带握把
d.line([(ax - 40, 236), (ax + 150, 130)], fill=WOOD, width=40)
d.line([(ax - 40, 236), (ax + 40, 196)], fill=(96, 66, 40), width=48)  # 握把
# 挨打那个（右）：**横躺**在地上
vx, vy = 760, 720
d.ellipse([vx - 54, vy - 54, vx + 54, vy + 54], outline=INK, width=16)  # 头
limb((vx - 54, vy), (vx - 250, vy), 18)  # 身子（横着）
limb((vx - 250, vy), (vx - 340, vy - 66))  # 腿
limb((vx - 250, vy), (vx - 348, vy + 62))  # 腿
limb((vx - 40, vy - 40), (vx + 60, vy - 150))  # 胳膊向上摊
# 撞击闪光（棍头与挨打那个之间）
CX, CY = 690, 400
d.polygon(
    [
        (CX, CY - 118), (CX + 34, CY - 34), (CX + 118, CY), (CX + 34, CY + 34),
        (CX, CY + 118), (CX - 34, CY + 34), (CX - 118, CY), (CX - 34, CY - 34),
    ],
    fill=(246, 200, 64),
    outline=INK,
    width=6,
)
save(img, "pos-club.png")

print("done")

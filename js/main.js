// ============================================================================
// 《勇者闯地下城》V2 · js/main.js —— 引擎入口（主题场景 / 视差行军 / 演出）
//
// 启动顺序：loadGame → computeDerived → 离线结算(grantOffline) → 技能解锁推进
//           (syncHeroSkillUnlocks) → initUI →
//           showOfflineModal（ui.js 的弹窗依赖 initUI 先建好 DOM，故结算在前、
//           弹窗展示紧随 initUI）→ audio(首个 pointerdown) → combat.init → rAF。
//
// 每帧：combat.update(dt) → 主题跟随/视差/雾推进 → fx.update(dt) → 渲染：
//   主题背景带拷贝（瓷砖按亮度→主题色 LUT 重着色 + drawDecor 装饰 + 边缘雾）→
//   静态火把座 → back 特效（主题 glow 配色的火把）→ 怪物 → 英雄 →
//   front 特效 → composite → putImageData → 换层雾色过渡（rgba 叠层）。
//   暴击/Boss 出场画面微震（putImageData 偏移 2-3px，0.15s）。
//
// 主题系统（js/themes.js：themeForFloor 每 5 层轮换 8 套）：
//   - 瓷砖背景带预渲染成"无色图案层"，换层时按各区域主题色做亮度→色相 LUT
//     重着色（墙檐/后墙/地沿/地面四段各自锚定），装饰 5-7 件错落布置（墙面/
//     地面槽位避开英雄 x<100-122 与怪物 x>205-245 主体；运行中装饰随世界
//     向左行进、绘制在角色之下，永不遮挡角色）；
//   - sprites.js 若导出 drawDecor(frame, key, x, y, theme)（美术契约）则优先
//     使用，否则用本地程序化装饰兜底（同样吃主题 accent/glow 配色）；
//   - 火把火焰 palette 用 theme.glow 九段渐变重着色，壁座保留 V1 铁架原样；
//   - 边缘暗角雾（主题 fogColor）烘进背景底图，换层触发 0.5s 雾色过渡；
//   - 怪物生成 / 换层瞬间：背景带 0.4 秒向左滚动一整块瓷砖（缓出），相机
//     基准 world-x 每次推进 16px，装饰随之行进并从右侧带外补充，画面无缝。
//
// 动画：英雄待机 SPRITE_ANIM.heroIdle 循环（4 帧，呼吸+披风）、攻击
//   SPRITE_ANIM.heroAttack 3 帧（combat 暴露的攻击计时驱动：前摇→挥砍→收招）、
//   受击 heroHurt；美术帧未交付时自动回退 V1 的 2 帧 hero_idle0/1、hero_atk0/1，
//   行为与 V1 逐像素等价（帧序列/周期/切换点完全一致）。
//
// 存档：每 5 秒 + beforeunload + visibilitychange → state.lastSaved=Date.now()。
// 调试契约：window.__GAME = { state, combat, debug, sceneInfo() }；
//   sceneInfo() → {theme, themedFloor, decor, scrolling, sweep}（验收读场景状态）；
//   ?debug=party    满编演出位（美术验收）：薇拉 x=30、艾琳 x=44、凯 x=76、
//                   勇者 x=116、Boss x=232，各用对应 idle 帧循环 + 当前主题场景；
//   ?debug=floor=N  以第 N 层主题渲染静态场景（暂停战斗模拟，仅背景/装饰/火把）。
// ============================================================================

import {
  createFrame, createFx, composite, hex, mix, scale, stockActor,
} from "../vendor/pixelfx/src/core/index.js";
import * as sprites from "./sprites.js"; // 命名空间导入：drawDecor / SPRITE_ANIM 出现即自动启用
import { drawSprite } from "./sprites.js";
import { BALANCE, floorName, RARITY_NAMES, SLOT_NAMES, UPGRADES, rollItem } from "./data.js";
import { themeForFloor } from "./themes.js";
import { initAudio, setMuted, sfx } from "./audio.js";
import { initUI, refreshUI, addLog, showOfflineModal, showIntroModal } from "./ui.js";
import {
  newGame, loadGame, saveGame, exportSaveString, importSaveString,
  computeDerived, grantOffline, replaceStateInPlace, buyUpgrade,
  addChronicle, performPrestige, calcPrestigeEmbers,
} from "./state.js";
import { COMPANIONS, companionUpgradeCost, syncHeroSkillUnlocks } from "./skills.js";
import { RELICS, rollRelicChoices } from "./relics.js";
import { EVENTS, MILESTONE_TEXTS } from "./narrative.js";
import { initAssets, getBg, getSprite, drawAssetSprite } from "./assets.js";
import * as combat from "./combat.js";

// ---- 特效模块（pixelfx 速查 mapping，路径规则 fx/分类/名称.js）----
import * as swordSlash     from "../vendor/pixelfx/src/fx/melee/sword-slash.js";
import * as hitSpark       from "../vendor/pixelfx/src/fx/impacts/hit-spark.js";
import * as critHit        from "../vendor/pixelfx/src/fx/impacts/crit-hit.js";
import * as groundSlam     from "../vendor/pixelfx/src/fx/impacts/ground-slam.js";
import * as damageNumber   from "../vendor/pixelfx/src/fx/ui/damage-number.js";
import * as critNumber     from "../vendor/pixelfx/src/fx/ui/crit-number.js";
import * as levelUpFx      from "../vendor/pixelfx/src/fx/ui/level-up.js";
import * as coinCollect    from "../vendor/pixelfx/src/fx/ui/coin-collect.js";
import * as poofFx         from "../vendor/pixelfx/src/fx/spawn/poof.js";
import * as spawnPortal    from "../vendor/pixelfx/src/fx/spawn/spawn-portal.js";
import * as xpOrb          from "../vendor/pixelfx/src/fx/pickups/xp-orb.js";
import * as lootBeam       from "../vendor/pixelfx/src/fx/pickups/loot-beam.js";
import * as torchFx        from "../vendor/pixelfx/src/fx/fire/torch.js";
import * as healFx         from "../vendor/pixelfx/src/fx/holy/heal.js";
import * as divineShield   from "../vendor/pixelfx/src/fx/holy/divine-shield.js";
import * as rageFx         from "../vendor/pixelfx/src/fx/status/rage.js";
import * as burningFx      from "../vendor/pixelfx/src/fx/status/burning.js";
import * as bleedingFx     from "../vendor/pixelfx/src/fx/status/bleeding.js";
import * as slowedFx       from "../vendor/pixelfx/src/fx/status/slowed.js";
import * as zapHit         from "../vendor/pixelfx/src/fx/lightning/zap-hit.js";
import * as resurrectionFx from "../vendor/pixelfx/src/fx/holy/resurrection.js";
import * as poisonCloud    from "../vendor/pixelfx/src/fx/nature/poison-cloud.js";
import * as smallExplosion from "../vendor/pixelfx/src/fx/explosions/small-explosion.js";

// ---------------------------------------------------------------------------
// 画布与帧缓冲（640x360 高清像素画布，逻辑战斗坐标仍为 320x180 × SCALE=2）
// ---------------------------------------------------------------------------
const W = 320, H = 180;
const SCALE = 2;
const VIEW_W = W * SCALE, VIEW_H = H * SCALE;
const BG_CSS = "#14101c";         // 微震时露底的底色（被主题雾覆盖前的一帧兜底）
const WHITE = (hex("#ffffff") | 0xff000000) >>> 0; // 受击闪白（ABGR 打包）

const canvas = document.getElementById("game-canvas");
if (!canvas) {
  throw new Error('main.js: 找不到 #game-canvas（index.html 需包含 <canvas id="game-canvas" width="640" height="360">）');
}
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

// 传统底图与回退精灵缓冲（320x180）
const frameBuf = createFrame(W, H);
const imgData = ctx.createImageData(W, H);
const fallbackCanvas = document.createElement("canvas");
fallbackCanvas.width = W;
fallbackCanvas.height = H;
const fallbackCtx = fallbackCanvas.getContext("2d");
fallbackCtx.imageSmoothingEnabled = false;
const fallbackFrame = createFrame(W, H);
const fallbackImgData = fallbackCtx.createImageData(W, H);

// 前景 pixelfx 特效透明叠加层（320x180 → 2x 最近邻放大）
const fxCanvas = document.createElement("canvas");
fxCanvas.width = W;
fxCanvas.height = H;
const fxCtx = fxCanvas.getContext("2d");
fxCtx.imageSmoothingEnabled = false;
const fxFrame = createFrame(W, H);
const fxImgData = fxCtx.createImageData(W, H);

initAssets();

// ---------------------------------------------------------------------------
// 场景常量：瓷砖 16px；背景带宽 = 320 + 16（多出一列供视差窗口滑动）。
// 火把座画在两侧墙上（静态，不随视差滚动）；火把特效原点在座顶。
// ---------------------------------------------------------------------------
const TILE = 16;
const SW = W + TILE;            // 背景带宽度（world 窗口，336）
const TORCH_XS = [52, 268];
const SCONCE_Y = 100;           // 火把座脚底
const FLAME_Y = SCONCE_Y - 11;  // 火把特效原点（座顶，7x12 座高 12）
const SCROLL_DUR = 0.4;         // 视差滚动时长（秒，怪物生成/换层触发）
const SWEEP_DUR = 0.5;          // 换层雾色过渡时长（秒）

// ---------------------------------------------------------------------------
// 调试站位（URL 查询参数）：?debug=party / ?debug=floor=N（亦兼容 &floor=N）
// ---------------------------------------------------------------------------
const urlParams = new URLSearchParams(location.search);
const debugParam = urlParams.get("debug") || "";
let debugScene = null;
if (debugParam === "party") {
  debugScene = { type: "party" };
} else if (/^floor/i.test(debugParam)) {
  const m = /(\d+)/.exec(debugParam) || /(\d+)/.exec(urlParams.get("floor") || "");
  if (m && Number(m[1]) >= 1) debugScene = { type: "floor", floor: Math.floor(Number(m[1])) };
}

// 满编演出位（脚底 y=GROUND_Y；绘制顺序=遮挡顺序：从左到右，Boss 最后）
const DEBUG_PARTY = [
  { key: "vera", x: 24 },
  { key: "irene", x: 50 },
  { key: "kai", x: 78 },
  { key: "hero", x: 114 },
  { key: "goblinKing", x: 232, boss: true },
];

// ---------------------------------------------------------------------------
// 特效实例管理：一次性 done() 后移除；循环特效用 transient 秒后 stop() 渐出。
// stage "back" = 角色之前（火把氛围），"front" = 角色之上（战斗表现）。
// ---------------------------------------------------------------------------
const fxs = [];
function spawnFx(mod, opts, opts2 = {}) {
  const fx = createFx(mod, opts);
  fxs.push({ fx, stage: opts2.stage || "front", transient: opts2.transient ?? null, age: 0 });
  return fx;
}
function updateFx(dt) {
  for (const inst of fxs) {
    inst.fx.update(dt);
    inst.age += dt;
    if (inst.transient != null && inst.age >= inst.transient) inst.fx.stop();
  }
  for (let i = fxs.length - 1; i >= 0; i--) if (fxs[i].fx.done()) fxs.splice(i, 1);
}

// ---------------------------------------------------------------------------
// 主题资产：每套主题（themes.js 对象）只计算一次——
//   luts      四段瓷砖的「亮度→主题色」重着色查找表（256 级）；
//   bgNum     最底色；fog/fogRGB 前景雾色；glowRamp 火把火焰九段渐变。
// 重着色公式：m = clamp((v / vMid)^1.15, 0.05, 2.4)，v<20（轮廓）再压暗 0.35，
//   输出 = 主题色 × m（scale 内每通道封顶 255）。vMid 为该区域色板的中间亮度，
//   保证砖缝/砖面/高光的明暗层级按主题色相保留。
// ---------------------------------------------------------------------------
const themeAssets = new WeakMap();
const LUMA_OF = (c) => (0.299 * (c & 255) + 0.587 * ((c >>> 8) & 255) + 0.114 * ((c >>> 16) & 255)) | 0;

function tintLut(themeHex, vMid) {
  const base = hex(themeHex);
  const lut = new Uint32Array(256);
  for (let v = 0; v < 256; v++) {
    let m = Math.pow(v / (vMid * 255), 1.15);
    if (v < 20) m *= 0.35; // 深色轮廓保持近黑
    lut[v] = scale(base, Math.min(2.4, Math.max(0.05, m)));
  }
  return lut;
}

function glowRamp(glowHex) {
  const g = hex(glowHex), K = hex("#140a06"), Wt = hex("#ffffff");
  return [
    mix(K, g, 0.12), mix(K, g, 0.28), mix(K, g, 0.5), mix(K, g, 0.75), g,
    mix(g, Wt, 0.32), mix(g, Wt, 0.58), mix(g, Wt, 0.8), Wt,
  ];
}

function themeAssetsFor(theme) {
  let a = themeAssets.get(theme);
  if (a) return a;
  const fogNum = hex(theme.fogColor);
  a = {
    bgNum: hex(theme.bg),
    fogNum,
    fogRGB: [fogNum & 255, (fogNum >>> 8) & 255, (fogNum >>> 16) & 255],
    glowRamp: glowRamp(theme.glow),
    luts: {
      wallTop: tintLut(theme.wallTop, 0.42),   // 墙檐石
      wall: tintLut(theme.wall, 0.13),         // 后墙砖（色板本身很暗）
      floorEdge: tintLut(theme.floorEdge, 0.45),
      floor: tintLut(theme.floor, 0.42),
    },
  };
  themeAssets.set(theme, a);
  return a;
}

// ---------------------------------------------------------------------------
// 无色图案层：V1 瓷砖原样铺一整条背景带（336 宽），作为重着色的"形"来源。
// 行 0 墙檐、1..6 后墙、7 地沿、8..11 地面（行 11 底部裁切）。
// ---------------------------------------------------------------------------
const patternFrame = (() => {
  const f = createFrame(SW, H);
  for (let col = 0; col < SW / TILE; col++) {
    drawSprite(f, "wall_top", col * TILE + 8, 1 * TILE - 1);        // 行 0（y 0..15）
    for (let row = 1; row <= 6; row++) drawSprite(f, "wall", col * TILE + 8, row * TILE + 15);
    drawSprite(f, "floor_edge", col * TILE + 8, 7 * TILE + 15);     // 行 7（y 112..127）
    for (let row = 8; row <= 11; row++) drawSprite(f, "floor_mid", col * TILE + 8, row * TILE + 15);
  }
  return f;
})();

// ---------------------------------------------------------------------------
// 装饰布置：墙面/地面候选槽位（错落；避开英雄 x∈[100,122] 与怪物 x∈[205,245]
// 的主体投影和两侧火把座 x∈[49,55]∪[265,271]）。初始画面按槽位落位；此后每次
// 视差推进，装饰随世界左移、出画丢弃、并从右缘带外（屏幕外）补充，密度 5-7 件。
// ---------------------------------------------------------------------------
const WALL_SLOTS = [
  [24, 84], [38, 100], [84, 72], [120, 92], [156, 66],
  [196, 88], [236, 72], [292, 96], [316, 88],
];
const FLOOR_SLOTS = [
  [30, 138], [66, 152], [132, 140], [170, 156], [196, 132], [258, 148], [312, 156],
];
const HANGING_KEYS = new Set(["webs", "icicles", "chains"]); // 吊挂类：锚点上移贴近墙檐
const WALL_ONLY_KEYS = new Set(["webs", "icicles", "chains"]);
const FLOOR_ONLY_KEYS = new Set(["bones", "rubble", "lava", "crystals"]);
// sprites.js drawDecor 的 theme 参数吃 data.js 层名/英文别名/序号（theme 对象会
// 落到原生配色）；js/themes.js 的 8 套主题与其中 5 套同名，其余 3 套按色相就近
// 映射别名（腐烂苗床→腐沼洞窟 marsh、雷霆囚笼→暗影圣所 shadow、余烬王座→熔岩 lava）。
const THEME_DECOR_TINT = {
  "荒废地窖": "cellar",
  "蛛巢回廊": "web",
  "熔岩隧道": "lava",
  "冰霜监牢": "frost",
  "暗影圣所": "shadow",
  "腐烂苗床": "marsh",
  "雷霆囚笼": "shadow",
  "余烬王座": "lava",
};

function themeSeed(theme) {
  let s = 0;
  for (const ch of theme.name) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return s || 1;
}
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
/** 按槽位层级挑选装饰键：主题 2 个键中优先取适配该层级的那个。 */
function pickDecorKey(theme, wall, i) {
  const ks = theme.decor;
  let k = ks[i % ks.length];
  if (ks.length > 1) {
    if (wall && FLOOR_ONLY_KEYS.has(k)) k = ks[(i + 1) % ks.length];
    if (!wall && WALL_ONLY_KEYS.has(k)) k = ks[(i + 1) % ks.length];
  }
  return k;
}
/** 开局/换主题：确定性（主题名做种子）布置 5-7 件。 */
function placeDecorFresh(theme) {
  const rnd = lcg(themeSeed(theme));
  const walls = shuffle([...WALL_SLOTS], rnd);
  const floors = shuffle([...FLOOR_SLOTS], rnd);
  const n = 5 + Math.floor(rnd() * 3);
  const out = [];
  for (let i = 0; i < n; i++) {
    const pool = rnd() < 0.55 && walls.length ? walls : (floors.length ? floors : walls);
    const s = pool.shift();
    if (!s) break;
    out.push(makeDecorItem(theme, pickDecorKey(theme, s[1] < 112, i), s[0], s[1], rnd() < 0.5 ? 0 : 1));
  }
  return out;
}
/** 造一件装饰：吊挂类锚点上移；variant 稳定保存（drawDecor 默认按 x 散列选
 *  变体，x 随视差偏移会换贴图导致跳变，故显式传 opts.variant 固定）。 */
function makeDecorItem(theme, key, x, y, variant) {
  if (y < 112 && HANGING_KEYS.has(key)) y = Math.max(40, y - 12); // 吊挂底端上提，贴近墙檐
  return { key, x, y, variant };
}
/** 视差推进后：左移一砖、出画丢弃、右缘带外补充（密度保持 5-7；补充键按
 *  pickDecorKey 的墙面/地面适配约束选，避免吊挂类落到地面槽位）。 */
function advanceDecor() {
  const kept = [];
  for (const d of decorItems) {
    const nx = d.x - TILE;
    if (nx >= 8) kept.push({ key: d.key, x: nx, y: d.y, variant: d.variant });
  }
  decorItems = kept;
  const theme = themeObj;
  let guard = 8;
  let si = 0;
  while (decorItems.length < 5 && guard-- > 0) {
    const wall = Math.random() < 0.5;
    const x = 320 + Math.floor(Math.random() * 4); // 320..323：视窗外且全宽（≤24px）都在带内
    if (decorItems.some((d) => d.x > 300 && Math.abs(d.x - x) < 16)) continue;
    const y = wall ? 64 + Math.floor(Math.random() * 37) : 132 + Math.floor(Math.random() * 37);
    const key = pickDecorKey(theme, wall, si++);
    decorItems.push(makeDecorItem(theme, key, x, y, Math.random() < 0.5 ? 0 : 1));
  }
}

// ---------------------------------------------------------------------------
// 本地程序化装饰兜底（sprites.js 未导出 drawDecor 时使用）：13 个键全量实现，
// 全部吃主题 accent/glow 配色；锚点 (x, y)=底部中心，与精灵锚点约定一致；
// y<112 视为依附墙面（下垂/嵌壁），否则立在地面上。
// ---------------------------------------------------------------------------
function localDecor(f, key, x, y, theme) {
  const wall = y < 112;
  const A = hex(theme.accent), G = hex(theme.glow);
  const cDark = scale(A, 0.4), cMid = A, cLite = scale(A, 1.5);
  const gGlow = G, gLite = scale(G, 1.35), gDark = scale(G, 0.45);
  const px = (dx, dy, c) => {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= f.w || yy >= f.h) return;
    f.color[yy * f.w + xx] = c >>> 0;
  };
  const rubbleMound = (bx, w) => {
    for (let dx = 0; dx < w; dx++) {
      const edge = dx === 0 || dx === w - 1;
      px(bx + dx, 0, cDark);
      px(bx + dx, -1, edge ? cDark : cMid);
      if (!edge) px(bx + dx, -2, cLite);
    }
  };
  const hang = (dx, hgt, top, tip) => { // 从锚点上方垂下的锥形（冰锥/晶簇墙面变体）
    for (let d = 0; d < hgt; d++) {
      const wHalf = Math.round((1 - d / hgt) * 1.3);
      for (let dx2 = -wHalf; dx2 <= wHalf; dx2++) px(dx + dx2, -(hgt - 1 - d), d === hgt - 1 ? tip : top);
    }
  };
  const rise = (dx, hgt, base, tip) => { // 从锚点立起的锥形（晶簇/冰堆地面变体）
    for (let d = 1; d <= hgt; d++) {
      const wHalf = Math.round((1 - d / hgt) * 1.25);
      for (let dx2 = -wHalf; dx2 <= wHalf; dx2++) px(dx + dx2, -d, d === hgt ? tip : base);
    }
  };
  switch (key) {
    case "roots": { // 根须：墙面下垂 / 地面向上爬，根尖一点微光
      const dir = wall ? 1 : -1;
      for (let i = 0; i < 3; i++) {
        const bx = -3 + i * 3, hgt = 5 + ((i + 1) % 3) * 2;
        for (let d = 1; d <= hgt; d++) {
          const wob = Math.round(Math.sin(d * 0.9 + i * 1.7) * 1.1);
          px(bx + wob, dir * d, d >= hgt - 1 ? cDark : cMid);
        }
        px(bx, dir * (hgt + 1), gGlow);
      }
      break;
    }
    case "rubble":
      rubbleMound(-3, 4); rubbleMound(0, 3); rubbleMound(3, 3);
      px(-1, -3, cMid); px(0, -3, cDark);
      break;
    case "webs": { // 蛛网：锚点在上方，辐条 + 两圈弧线
      const c = mix(hex(theme.fogColor), cLite, 0.7), ay = -6;
      for (const [sx, sy] of [[-4, 4], [-2, 6], [0, 7], [2, 6], [4, 4]]) {
        for (let d = 1; d <= 4; d++) {
          px(Math.round((sx * d) / 4), ay + Math.round((sy * d) / 4), d === 4 ? cDark : c);
        }
      }
      for (let r = 2; r <= 4; r += 2) {
        for (let a = 0; a <= 6; a++) {
          const ang = Math.PI * (a / 6);
          px(Math.round(-Math.cos(ang) * r), ay + Math.round(Math.sin(ang) * r * 0.7), cDark);
        }
      }
      px(0, ay - 1, cDark);
      break;
    }
    case "bones": { // 白骨：一根横骨 + 半截短骨
      const B = hex("#e4dcc8"), Bs = scale(B, 0.72);
      for (let dx = -4; dx <= 3; dx++) px(dx, -1, dx % 4 === 0 ? B : Bs);
      px(-5, -2, B); px(-5, 0, Bs); px(4, -2, B); px(4, 0, Bs);
      px(2, -4, Bs); px(3, -4, B); px(4, -3, B); px(1, -3, Bs);
      px(0, 0, cDark);
      break;
    }
    case "lava": { // 熔岩：地面熔池 / 墙面流痕
      if (wall) {
        for (let d = 0; d < 8; d++) {
          px(0, d, d < 2 ? gGlow : gDark);
          if (d % 3 === 0) px(1, d, gGlow);
        }
        px(0, -1, gLite);
      } else {
        for (let dx = -4; dx <= 4; dx++) {
          const h = Math.max(1, 2 - Math.round(Math.abs(dx) / 2.4));
          for (let dy = 0; dy < h; dy++) {
            px(dx, -dy, Math.abs(dx) <= 1 && dy === 0 ? gLite : Math.abs(dx) <= 3 ? gGlow : gDark);
          }
        }
        px(-1, 1, gDark); px(1, 1, gDark);
      }
      break;
    }
    case "lavaCracks": { // 发光裂隙：横向折线
      for (let d = 0; d < 9; d++) {
        const xx = d - 4;
        const yy = wall ? Math.round(Math.sin(d * 0.8) * 1.2) : (d % 3 === 1 ? -1 : 0);
        px(xx, yy, gGlow);
        if (d % 2 === 1) px(xx, yy + 1, gDark);
      }
      px(-4, 0, gDark); px(4, 0, gDark);
      break;
    }
    case "icicles": // 冰锥：墙面倒挂 / 地面冰堆
      if (wall) { hang(-3, 5, cLite, gGlow); hang(0, 9, cLite, gGlow); hang(3, 4, cLite, gGlow); }
      else { rise(-2, 4, cLite, gGlow); rise(1, 6, cLite, gGlow); }
      break;
    case "bars": { // 铁栅：带横杆 / 地面短栅栏
      const hgt = wall ? 11 : 7;
      for (const dx of [-3, 0, 3]) {
        for (let d = 1; d <= hgt; d++) px(dx, -d, d > hgt - 3 ? cLite : cMid);
      }
      if (wall) {
        for (let dx = -3; dx <= 3; dx++) px(dx, -(hgt + 1), cDark);
        for (let d = 3; d <= hgt - 2; d += 3) { px(-2, -d, cDark); px(2, -d, cDark); }
      } else {
        for (let dx = -3; dx <= 3; dx++) px(dx, 0, cDark);
        px(-1, -(hgt + 1), cMid); px(1, -(hgt + 1), cMid);
      }
      break;
    }
    case "pillars": { // 列柱：4 宽柱身 + 柱头柱础
      const hgt = 12;
      for (let d = 1; d <= hgt; d++) { px(-1, -d, cMid); px(0, -d, cLite); px(1, -d, cMid); px(2, -d, cDark); }
      for (let dx = -2; dx <= 3; dx++) { px(dx, 0, cMid); px(dx, -hgt, cLite); }
      px(-2, -(hgt - 1), cLite); px(3, -(hgt - 1), cDark);
      break;
    }
    case "crystals": // 病荧光晶：三簇菱柱
      rise(-2, 5, gGlow, gLite); rise(1, 8, gGlow, gLite); rise(3, 4, gGlow, gLite);
      px(1, -4, gLite);
      break;
    case "chains": // 悬链 / 落地盘链
      if (wall) {
        for (let d = 0; d < 10; d += 2) { px(0, -d - 1, cMid); px(0, -d, cLite); px(1, -d - 1, cDark); }
        px(-1, -10, cDark); px(1, -10, cDark);
      } else {
        for (const [dx, dy] of [[-3, 0], [-2, -1], [0, -1], [2, -1], [3, 0], [-1, -2], [1, -2]]) px(dx, dy, cMid);
        px(0, -2, cLite); px(0, -3, cDark);
      }
      break;
    case "braziers": // 烛火盆：碗 + 座 + 三点火种
      for (let dx = -2; dx <= 2; dx++) px(dx, -3, dx === -2 || dx === 2 ? cDark : cMid);
      for (let dx = -1; dx <= 1; dx++) px(dx, -4, cLite);
      px(0, -2, cDark); px(0, -1, cMid); px(0, 0, cDark);
      px(-1, -5, gGlow); px(0, -6, gLite); px(1, -5, gGlow);
      break;
    case "embers": // 飘散火星
      for (const [dx, dy] of [[-3, -2], [1, -4], [3, -1], [-1, -5], [2, -3]]) {
        px(dx, dy, gGlow);
        if (Math.abs(dx) < 2) px(dx, dy + 1, gDark);
      }
      px(-1, -3, gLite); px(1, -4, gLite);
      break;
    default:
      rubbleMound(-3, 4); rubbleMound(0, 3); rubbleMound(3, 3);
      break;
  }
}

// ---------------------------------------------------------------------------
// 主题背景带 + 当前底图：
//   strip      336x180，主题着色瓷砖 + 装饰（world 窗口，覆盖 [camX, camX+336)）；
//   curBgFrame 320x180 本帧实际底图（视差窗拷贝 + 静态火把座 + 边缘雾），
//              同时充当受击闪白的参照底图与 composite 的逐像素背景色。
// ---------------------------------------------------------------------------
let themeObj = null;
let themedFloor = -1;
let strip = null;
let decorItems = [];
const decorWarned = new Set(); // drawDecor 失败告警去重（每 key 一次）
let camX = 0;            // 相机 world 基准（每次推进 +TILE，保证装饰世界坐标连续）
let scrolling = false;
let scrollT = 1;
let sweepT = 0;

const curBgFrame = createFrame(W, H);

// 边缘暗角雾（主题 fogColor）：顶部渐暗最强，左右次之，底部轻微；预计算
// 像素索引与强度，烘焙进 curBgFrame（角色主体区域强度恒为 0，不受影响）。
const fogMask = (() => {
  const idx = [], val = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = 0;
      if (y < 56) m = Math.max(m, ((56 - y) / 56) * 0.5);
      if (x < 44) m = Math.max(m, ((44 - x) / 44) * 0.38);
      if (x > W - 44) m = Math.max(m, ((x - (W - 44)) / 44) * 0.38);
      if (y > H - 18) m = Math.max(m, ((y - (H - 18)) / 18) * 0.3);
      m = Math.min(0.62, m);
      if (m > 0.02) { idx.push(y * W + x); val.push(m); }
    }
  }
  return { idx: Uint32Array.from(idx), val: Float32Array.from(val) };
})();

function bakeFog(buf, fogNum) {
  const fr = fogNum & 255, fg = (fogNum >>> 8) & 255, fb = (fogNum >>> 16) & 255;
  const { idx, val } = fogMask;
  for (let i = 0; i < idx.length; i++) {
    const j = idx[i], m = val[i];
    const c = buf[j];
    const r = (c & 255) + (fr - (c & 255)) * m;
    const g = ((c >>> 8) & 255) + (fg - ((c >>> 8) & 255)) * m;
    const b = ((c >>> 16) & 255) + (fb - ((c >>> 16) & 255)) * m;
    buf[j] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }
}

function buildStrip(theme) {
  const A = themeAssetsFor(theme);
  strip = createFrame(SW, H);
  strip.color.fill(A.bgNum);
  // 瓷砖：图案层逐像素按区域 LUT 重着色（透明点露主题底色）
  const pc = patternFrame.color, fc = strip.color;
  for (let y = 0; y < H; y++) {
    const lut = y < 16 ? A.luts.wallTop : y < 112 ? A.luts.wall : y < 128 ? A.luts.floorEdge : A.luts.floor;
    const row = y * SW;
    for (let x = 0; x < SW; x++) {
      const p = pc[row + x];
      fc[row + x] = p === 0 ? A.bgNum : lut[LUMA_OF(p)];
    }
  }
  // 装饰：美术契约 drawDecor 优先（theme 传 sprites.js 认的配色别名，见
  // THEME_DECOR_TINT；opts.variant 固定变体防视差跳变）；未交付、键不支持
  // （返回 false）或美术网格数据有缺陷（compile 抛错）时逐件回退本地程序化
  // 装饰——挂机游戏不能因单个装饰资源崩溃。告警按 key 去重（每次视差重建
  // 背景带都会重试绘制，不去重会刷屏）。
  const hasDecor = typeof sprites.drawDecor === "function";
  const tintKey = THEME_DECOR_TINT[theme.name] || theme.name;
  for (const d of decorItems) {
    if (hasDecor) {
      try {
        if (sprites.drawDecor(strip, d.key, d.x, d.y, tintKey, { variant: d.variant })) continue;
      } catch (e) {
        if (!decorWarned.has(d.key)) {
          decorWarned.add(d.key);
          console.warn(`main: drawDecor("${d.key}") 失败，回退本地装饰`, e && e.message);
        }
      }
    }
    localDecor(strip, d.key, d.x, d.y, theme);
  }
}

function updateCurBg() {
  const off = scrolling ? Math.round(TILE * (1 - Math.pow(1 - scrollT, 2))) : 0; // 0→16 缓出（画面左移）
  const cb = curBgFrame.color, sc = strip.color;
  for (let y = 0; y < H; y++) cb.set(sc.subarray(y * SW + off, y * SW + off + W), y * W);
  drawSprite(curBgFrame, "torch_sconce", TORCH_XS[0], SCONCE_Y); // 火把座静态（不随视差）
  drawSprite(curBgFrame, "torch_sconce", TORCH_XS[1], SCONCE_Y);
  bakeFog(cb, themeAssetsFor(themeObj).fogNum);
}

// 火把：常驻循环特效，换主题时用 theme.glow 渐变重建（旧的 stop() 渐出交叠）。
// spawnFx 返回的是裸 fx 实例（非 fxs 包装项），直接持有并对其 stop()。
let torchInsts = [];
function spawnTorches(theme) {
  for (const fx of torchInsts) fx.stop();
  const A = themeAssetsFor(theme);
  torchInsts = [
    spawnFx(torchFx, { x: TORCH_XS[0], y: FLAME_Y, seed: 4, palette: A.glowRamp }, { stage: "back" }),
    spawnFx(torchFx, { x: TORCH_XS[1], y: FLAME_Y, seed: 9, palette: A.glowRamp }, { stage: "back" }),
  ];
}

function triggerScroll() {
  scrolling = true;
  scrollT = 0;
}

/**
 * 场景背景（任务书命名入口）：按主题把「瓷砖重着色背景带 + 装饰」重铺进
 * strip，再合成当帧底图 curBgFrame（视差窗拷贝 + 火把座 + 边缘雾）。
 * 主题色/墙面/墙顶/地面/地沿/雾色全部来自 js/themes.js 的主题对象。
 */
function buildBackground(theme) {
  buildStrip(theme);
  updateCurBg();
}

/** 应用主题：重建背景带与底图、换火把配色；withFx 时触发视差滚动 + 雾色过渡。 */
function applyTheme(theme, withFx) {
  themeObj = theme;
  scrolling = false; // 在途滚动作废（雾色过渡掩护整段切换）
  scrollT = 1;
  camX = 0;
  decorItems = placeDecorFresh(theme);
  buildBackground(theme);
  spawnTorches(theme);
  if (withFx) {
    triggerScroll();
    sweepT = SWEEP_DUR;
  }
}

// ---------------------------------------------------------------------------
// 受击闪白：在精灵包围盒内，把「非透明实体像素」刷白（回退 sprites.js 时使用）
// ---------------------------------------------------------------------------
function applyFlashToFrame(targetFrame, v, spriteId) {
  const key = String(spriteId).split("_")[0].replace(/\d+$/, "");
  const anchor = sprites.SPRITE_ANCHOR[key];
  if (!anchor) return;
  const [w, h] = anchor;
  const left = Math.round(v.x) - (w >> 1);
  const top = Math.round(v.y) - h + 1;
  for (let row = top; row < top + h; row++) {
    if (row < 0 || row >= H) continue;
    for (let col = left; col < left + w; col++) {
      if (col < 0 || col >= W) continue;
      const i = row * W + col;
      if (targetFrame.color[i] !== 0) targetFrame.color[i] = WHITE;
    }
  }
}

// 画面微震（暴击 / Boss 出场，0.15s）
let shakeT = 0;
function shake(sec) {
  shakeT = Math.max(shakeT, sec);
}

// ---------------------------------------------------------------------------
// 存档：载入 + 派生 + 离线结算（数值入账先于 initUI，首帧面板即最新进度）
// ---------------------------------------------------------------------------
const state = loadGame();
computeDerived(state);

let offlineGains = null;
const awaySec = state.lastSaved ? (Date.now() - state.lastSaved) / 1000 : 0;
if (awaySec > BALANCE.OFFLINE_MIN_AWAY) {
  offlineGains = grantOffline(state, awaySec);
}

// 技能解锁推进（M2 修复）：载入/迁移/离线结算后按英雄等级解锁技能。
// skills.syncHeroSkillUnlocks 此前全项目零调用 —— 旧档数字形态 skills
// {crack:0,...} 永远停在 0，三个技能槽在等级达标后仍恒 locked；此处调用
// 把记录原地升级为细化形态 { unlocked, tactic }（state.js 契约注释的
// 预期运行时调用点），HUD/强化页经 skills.skillUnlocked 读到解锁态。
syncHeroSkillUnlocks(state);

// 初始主题（?debug=floor=N 时锁定为第 N 层主题）；themedFloor 同步落位，
// 避免 tick 首帧把「主题未跟随」误判为换层（开局的行军视差由怪物生成检测触发）
applyTheme(debugScene && debugScene.type === "floor" ? themeForFloor(debugScene.floor) : themeForFloor(state.floor), false);
themedFloor = state.floor;

// ---------------------------------------------------------------------------
// 战斗事件 → 特效/音效/日志（pixelfx 速查实测 mapping）
// 伤害数字配色（damage-number 的 palette 可覆写，长度不同自动重采样 fit）：
// ---------------------------------------------------------------------------
const PAL_BURN = ["#1a0a04", "#4a1608", "#8a2410", "#c9481c", "#f27a22", "#ffae3d", "#ffdd7a", "#fff3c8"];
const PAL_BLEED = ["#1a0408", "#4a0a14", "#8a1420", "#c71e30", "#f23848", "#ff6a60", "#ff9a8e", "#ffd0c8"];
const PAL_LIGHTNING = ["#040a1a", "#0a1c4a", "#122a8a", "#1e46c7", "#2a6ef2", "#62a6ff", "#a6d8ff", "#eaf6ff"];
const PAL_REFLECT = ["#08140a", "#123c16", "#1f6a20", "#2f9c2c", "#52cf42", "#8cf07a", "#ccffb8", "#f2ffe8"];
const PAL_HEAL = ["#04140a", "#0c3a1c", "#145a2c", "#1c8a3e", "#2ab855", "#5ce88a", "#a6ffbe", "#eafff0"];

function handleEvent(type, p) {
  switch (type) {
    case "hit": // 普通攻击：挥剑 + 打击火花 + 伤害数字
      spawnFx(swordSlash, { x: combat.HERO_X, y: combat.GROUND_Y, flip: false, radius: 42 });
      spawnFx(hitSpark, { x: combat.MONSTER_X, y: combat.GROUND_Y, height: 20, aim: 0.1 });
      spawnFx(damageNumber, { x: combat.MONSTER_X, y: combat.GROUND_Y, text: `-${p.dmg}` });
      sfx.hit();
      break;

    case "crit": // 暴击：挥剑 + 星芒暴击 + 暴击数字 + 微震
      spawnFx(swordSlash, { x: combat.HERO_X, y: combat.GROUND_Y, flip: false, radius: 42 });
      spawnFx(critHit, { x: combat.MONSTER_X, y: combat.GROUND_Y, height: 26, aim: 0.12 });
      spawnFx(critNumber, { x: combat.MONSTER_X, y: combat.GROUND_Y, text: `${p.dmg}!`, label: "CRIT" });
      sfx.crit();
      shake(0.15);
      break;

    case "kill": // 死亡：Boss 爆炸微震 / 小怪烟雾 + 经验之珠
      if (p.monster && p.monster.isBoss) {
        spawnFx(smallExplosion, { x: combat.MONSTER_X, y: combat.GROUND_Y, size: 1 });
        shake(0.15);
      } else {
        spawnFx(poofFx, { x: combat.MONSTER_X, y: combat.GROUND_Y });
      }
      spawnFx(xpOrb, { x: combat.MONSTER_X, y: combat.GROUND_Y }, { transient: 2.2 });
      sfx.kill();
      // kill.gold = 含 goldPct/goldOnKill 乘区的实际入账（combat 契约新增，缺省回退怪物基础金币）
      addLog(`击杀 ${p.monster.name} +${p.gold ?? p.monster.gold} 金币`);
      break;

    case "gold": // 金币入账飞入 HUD 面板（面板固定在原点右上 (o+50..o+110, o-88..o-66)，
    {            //  320 宽画布下原点 x=210 恰好完整显示，比怪物脚底 225 略偏左）
      const count = Math.max(1, Math.min(12, Math.round(p.amount)));
      const from = typeof p.from === "number" ? p.from : state.gold;
      spawnFx(coinCollect, { x: 210, y: combat.GROUND_Y, count, from });
      sfx.coin();
      break;
    }

    case "drop": // 掉落光柱（loop，2.2s 后渐出）+ 音效 + 日志
      spawnFx(lootBeam, { x: combat.MONSTER_X, y: combat.GROUND_Y }, { transient: 2.2 });
      sfx.drop();
      addLog(`获得装备：${p.item.name}（${RARITY_NAMES[p.item.rarity] ?? "?"}·${SLOT_NAMES[p.item.slot] ?? "?"}）`);
      break;

    case "autosell": // 智能过滤自动出售（combat.onKill 消费 lootFilter.autoSellBelow：
    {                // 低于档位的掉落不入背包，直接变现；金币飞入 HUD 面板）
      const amount = Math.max(0, Math.floor(Number(p.amount) || 0));
      const count = Math.max(1, Math.min(12, Math.round(amount)));
      const from = typeof p.from === "number" ? p.from : state.gold;
      const rarIdx = p.item ? Math.min(3, Math.max(0, Math.floor(Number(p.item.rarity) || 0))) : null;
      const rarLabel = rarIdx != null && RARITY_NAMES[rarIdx] ? `${RARITY_NAMES[rarIdx]}·` : "";
      spawnFx(coinCollect, { x: combat.MONSTER_X, y: combat.GROUND_Y, count, from });
      sfx.coin();
      addLog(`自动出售：${rarLabel}${p.item && p.item.name ? p.item.name : "?"} +${amount} 金币`);
      break;
    }

    case "levelup":
      spawnFx(levelUpFx, { x: combat.HERO_X, y: combat.GROUND_Y, actor: stockActor(2) });
      sfx.levelup();
      addLog(`升到 ${p.newLevel} 级！`);
      break;

    case "skillUnlock": // 升级解锁新技能（combat.onKill → skills.syncHeroSkillUnlocks）
      sfx.levelup();
      addLog(`技能解锁：${p.name || p.skillId || "?"}！可在 HUD 技能栏调整战术`);
      break;

    case "bossSpawn":
      spawnFx(spawnPortal, { x: combat.MONSTER_X, y: combat.GROUND_Y, width: 28 });
      sfx.boss();
      shake(0.15);
      addLog(`Boss 降临：${p.name || "?"}！${BALANCE.BOSS_TIME_LIMIT} 秒内击杀！`);
      break;

    case "bossFail":
      sfx.fail();
      addLog("Boss 超时！退回上一层重刷");
      break;

    case "respawn":
      spawnFx(healFx, { x: combat.HERO_X, y: combat.GROUND_Y, actor: stockActor(2) });
      sfx.respawn();
      addLog("勇者满血复活！");
      break;

    case "floorAdvance":
      addLog(`进入第 ${p.floor} 层 · ${floorName(p.floor)}`);
      break;

    case "heroHurt":
      break; // 受击表现由 combat 的 hero_hurt 帧 + 闪白负责

    case "poison": // 毒蘑菇攻击时的毒雾（loop，1.2s 后渐出）
      spawnFx(poisonCloud, { x: combat.MONSTER_X, y: combat.GROUND_Y, spread: 1 }, { transient: 1.2 });
      break;

    // ---- M3 技能/暗金机制事件（combat.js 契约）----

    case "skillCast": // 主勇者技能施放：按 skillId 映射特效 + 音效 + 日志
    {
      const id = p.skillId;
      if (id === "crack") {
        // 裂地重斩：落点地面重击（伤害数字由本次直击的 hit/crit 事件负责）
        spawnFx(groundSlam, { x: combat.MONSTER_X, y: combat.GROUND_Y, seed: 3 });
        sfx.crit();
        shake(0.12);
        addLog(`施放技能：${p.name || "裂地重斩"}（${p.dmg ?? 0} 伤害 · 破甲 30% 5 秒）`);
      } else if (id === "shield") {
        // 圣火护盾：金光护罩循环特效（随增益时长渐出）
        const dur = Math.max(0.5, Number(p.dur) || 6);
        spawnFx(divineShield, { x: combat.HERO_X, y: combat.GROUND_Y, actor: stockActor(2) }, { transient: dur });
        sfx.respawn();
        addLog(`施放技能：${p.name || "圣火护盾"}（护盾 ${p.shield ?? 0} · 反伤 20% ${Math.round(dur)} 秒）`);
      } else if (id === "warcry") {
        // 战吼狂暴：怒气循环特效（随增益时长渐出）
        const dur = Math.max(0.5, Number(p.dur) || 8);
        spawnFx(rageFx, { x: combat.HERO_X, y: combat.GROUND_Y, actor: stockActor(2) }, { transient: dur });
        sfx.boss();
        addLog(`施放技能：${p.name || "战吼狂暴"}（全队攻速 +20% · 暴击 +10% · ${Math.round(dur)} 秒）`);
      } else {
        addLog(`施放技能：${p.name || p.skillId || "?"}`);
      }
      break;
    }

    case "lightning": // 暗金 chainLightning/lightningOnHit：落雷 + 电光伤害数字
      spawnFx(zapHit, { x: combat.MONSTER_X, y: combat.GROUND_Y - 18, seed: 7 });
      spawnFx(damageNumber, { x: combat.MONSTER_X, y: combat.GROUND_Y, text: `-${p.dmg}`, palette: PAL_LIGHTNING });
      sfx.hit();
      break;

    case "dotTick": // 灼烧/流血每秒跳字（不配音效：一秒一跳会吵）
      spawnFx(damageNumber, {
        x: combat.MONSTER_X, y: combat.GROUND_Y, text: `-${p.dmg}`,
        palette: p.kind === "bleed" ? PAL_BLEED : PAL_BURN,
      });
      break;

    case "dotApply": // DoT 首次施加/刷新：起 status 循环特效（2s 后渐出，刷新会再触发）
      if (p.kind === "bleed") {
        spawnFx(bleedingFx, { x: combat.MONSTER_X, y: combat.GROUND_Y }, { transient: 2 });
      } else {
        spawnFx(burningFx, { x: combat.MONSTER_X, y: combat.GROUND_Y }, { transient: 2 });
      }
      break;

    case "chill": // 暗金 chillOnCrit：怪物被缓速（齿轮时钟减益，1.6s 后渐出）
      spawnFx(slowedFx, { x: combat.MONSTER_X, y: combat.GROUND_Y }, { transient: 1.6 });
      break;

    case "reflect": // 反伤结算（护盾反伤/荆棘/暗金 reflect）：荆棘色伤害数字
      spawnFx(damageNumber, { x: combat.MONSTER_X, y: combat.GROUND_Y, text: `-${p.dmg}`, palette: PAL_REFLECT });
      sfx.hit();
      break;

    case "lifesteal": // 吸血/治疗飘字（+N，绿色；combat 已过滤零治疗）
      spawnFx(damageNumber, {
        x: combat.HERO_X, y: combat.GROUND_Y - 8, text: `+${Math.round(Number(p.amount) || 0)}`,
        palette: PAL_HEAL,
      });
      break;

    case "cheatDeath": // 暗金 cheatDeath：致命伤免死——凤凰余烬重燃
      spawnFx(resurrectionFx, { x: combat.HERO_X, y: combat.GROUND_Y, actor: stockActor(2) });
      sfx.respawn();
      shake(0.15);
      addLog(`暗金之力发动：致命一击被挡下（余 ${p.hp ?? 0} 血，60 秒内不再免死）`);
      break;

    // ---- M4 伙伴实战事件 ----
    case "companionAtk": {
      const pal = p.id === "vera" ? PAL_LIGHTNING : undefined;
      spawnFx(hitSpark, { x: combat.MONSTER_X, y: combat.GROUND_Y, height: 18, aim: 0.1 });
      if (p.crit) {
        spawnFx(critNumber, { x: combat.MONSTER_X, y: combat.GROUND_Y - 6, text: `${p.dmg}!`, label: "CRIT" });
      } else {
        spawnFx(damageNumber, { x: combat.MONSTER_X, y: combat.GROUND_Y - 4, text: `-${p.dmg}`, ...(pal ? { palette: pal } : {}) });
      }
      break;
    }

    case "companionSkill": {
      const cname = (COMPANIONS[p.id] && COMPANIONS[p.id].name) || p.id || "伙伴";
      if (p.id === "vera") {
        spawnFx(zapHit, { x: combat.MONSTER_X, y: combat.GROUND_Y - 14, seed: p.skillId === "chainNova" ? 11 : 5 });
        if (p.dmg > 0) {
          spawnFx(damageNumber, { x: combat.MONSTER_X, y: combat.GROUND_Y - 6, text: `-${p.dmg}`, palette: PAL_LIGHTNING });
        }
        sfx.hit();
        const skLabel = p.skillId === "chainNova" ? "链式新星" : "奥术飞弹";
        addLog(`${cname} 施放 ${skLabel}（${p.dmg ?? 0} 伤害）`);
      } else if (p.id === "irene") {
        if (p.skillId === "aegis") {
          spawnFx(divineShield, { x: combat.HERO_X, y: combat.GROUND_Y, actor: stockActor(2) }, { transient: 2.2 });
          sfx.respawn();
          addLog(`${cname} 施放 圣光庇护（+${p.shield ?? 0} 护盾）`);
        } else if (p.skillId === "purify") {
          spawnFx(healFx, { x: combat.HERO_X, y: combat.GROUND_Y, actor: stockActor(2) });
          sfx.respawn();
          addLog(`${cname} 施放 净化，驱散了中毒并恢复 ${p.heal ?? 0} 生命`);
        } else {
          spawnFx(healFx, { x: combat.HERO_X, y: combat.GROUND_Y, actor: stockActor(2) });
          const extra = p.shield > 0 ? ` · 溢出护盾 +${p.shield}` : "";
          addLog(`${cname} 施放 治疗波动（+${p.heal ?? 0} 生命${extra}）`);
        }
      } else if (p.id === "kai") {
        if (p.skillId === "bleedingStrike") {
          spawnFx(bleedingFx, { x: combat.MONSTER_X, y: combat.GROUND_Y }, { transient: 2 });
          sfx.hit();
          addLog(`${cname} 施放 撕裂突袭，施加流血！`);
        } else {
          spawnFx(critHit, { x: combat.MONSTER_X, y: combat.GROUND_Y, height: 24, aim: 0.12 });
          if (p.dmg > 0) {
            spawnFx(damageNumber, { x: combat.MONSTER_X, y: combat.GROUND_Y - 6, text: `-${p.dmg}`, palette: PAL_BLEED });
          }
          sfx.crit();
          const skLabel = p.skillId === "execute" ? "暗影斩杀" : "连斩乱舞";
          addLog(`${cname} 施放 ${skLabel}（${p.dmg ?? 0} 伤害）`);
        }
      }
      break;
    }

    case "companionHeal":
      if (p.amount > 0) {
        spawnFx(damageNumber, {
          x: combat.HERO_X, y: combat.GROUND_Y - 8, text: `+${Math.round(Number(p.amount) || 0)}`,
          palette: PAL_HEAL,
        });
      }
      break;

    // ---- M5 遗物与奇遇事件 ----
    case "relicQueued":
      spawnFx(lootBeam, { x: combat.MONSTER_X, y: combat.GROUND_Y }, { transient: 2.2 });
      sfx.drop();
      addLog(`获得遗物抉择！点击画布右上角宝石角标抽取（待选 ×${p.count ?? 1}）`);
      break;

    case "relicAutoPick":
      sfx.click();
      addLog(`自动偏好选取遗物：${p.name || p.relicId}`);
      break;

    case "eventQueued":
      sfx.click();
      addLog(`遭遇深渊奇遇：${p.name || "?"}（点击画布右上角卷轴角标抉择）`);
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// actions（引擎↔界面契约；成功/失败返回 bool，ui.js 据此放音效/提示）
// ---------------------------------------------------------------------------
const FILTER_LABELS = { 1: "普通及以下", 2: "稀有及以下", 3: "史诗及以下" };

function sweepInventoryBelow(tier) {
  if (!Array.isArray(state.inventory) || state.inventory.length === 0) {
    return { soldCount: 0, soldGold: 0 };
  }
  const kept = [];
  let soldCount = 0;
  let soldGold = 0;
  for (const it of state.inventory) {
    if (!it) continue;
    const rar = Math.min(3, Math.max(0, Math.floor(Number(it.rarity) || 0)));
    if (rar < tier && !it.uniqueId) {
      soldCount += 1;
      soldGold += Math.max(1, Math.floor(Number(it.value) || 0));
    } else {
      kept.push(it);
    }
  }
  if (soldCount > 0) {
    state.inventory.splice(0, state.inventory.length, ...kept);
    state.gold = (Number(state.gold) || 0) + soldGold;
    if (state.stats && typeof state.stats === "object") {
      state.stats.totalGold = (Number(state.stats.totalGold) || 0) + soldGold;
    }
  }
  return { soldCount, soldGold };
}

function findUpgrade(id) {
  return UPGRADES.find((u) => u.id === id) || null;
}

const actions = {
  // 购买循环（次数/金币/上限判定）收口在 state.buyUpgrade(id, count)。
  // 上限单位与 data.js 契约一致（aspd 比倍率 state.hero.aspd ≥ 3.0、
  // crit 比百分点 critChance×100 ≥ 50）：修复 v1 把 (aspd-1)×100 百分点与
  // u.cap=3.0 倍率直接比较，导致攻速升 2 次即误判「已达总上限」的 bug。
  buyUpgrade(id, count = 1) {
    const u = findUpgrade(id);
    if (!u) return false;
    const res = buyUpgrade(state, id, count);
    if (res.bought <= 0) {
      sfx.fail();
      if (res.reason === "cap") addLog(`${u.name}已达总上限！`);
      else if (res.reason === "gold") addLog("金币不足！");
      return false;
    }
    sfx.click();
    addLog(
      res.bought === 1
        ? `升级 ${u.name} → Lv.${state.upgrades[id]}（-${res.spent} 金币）`
        : `升级 ${u.name} ×${res.bought} → Lv.${state.upgrades[id]}（-${res.spent} 金币）`
    );
    refreshUI();
    return true;
  },

  equipItem(uid) {
    const idx = state.inventory.findIndex((it) => it && it.uid === uid);
    if (idx < 0) return false;
    const item = state.inventory.splice(idx, 1)[0];
    const prev = state.equipped[item.slot] || null;
    if (prev) state.inventory.push(prev); // 同部位替换，旧装备回背包
    state.equipped[item.slot] = item;
    computeDerived(state);
    sfx.click();
    addLog(`装备了 ${item.name}`);
    refreshUI();
    return true;
  },

  sellItem(uid) {
    const idx = state.inventory.findIndex((it) => it && it.uid === uid);
    if (idx < 0) return false;
    const item = state.inventory.splice(idx, 1)[0];
    state.gold = (Number(state.gold) || 0) + (item.value || 0);
    sfx.coin();
    addLog(`出售 ${item.name} +${item.value} 金币`);
    refreshUI();
    return true;
  },

  setLootFilter(tier) {
    const numTier = tier == null ? null : Math.floor(Number(tier));
    const validTier = numTier === 1 || numTier === 2 || numTier === 3 ? numTier : null;
    if (!state.lootFilter || typeof state.lootFilter !== "object") {
      state.lootFilter = { autoSellBelow: validTier };
    } else {
      state.lootFilter.autoSellBelow = validTier;
    }
    if (validTier != null) {
      const res = sweepInventoryBelow(validTier);
      if (res.soldCount > 0) {
        sfx.coin();
        addLog(`已开启自动出售（${FILTER_LABELS[validTier]}），清理背包 ${res.soldCount} 件低质装备 +${res.soldGold} 金币`);
      } else {
        sfx.click();
        addLog(`已开启自动出售（${FILTER_LABELS[validTier]}），新掉落将自动变现`);
      }
      saveGame(state);
      refreshUI();
      return res;
    }
    sfx.click();
    addLog("已关闭自动出售低质");
    saveGame(state);
    refreshUI();
    return { soldCount: 0, soldGold: 0 };
  },

  sellJunk(tier) {
    const numTier = Math.floor(Number(tier));
    if (numTier !== 1 && numTier !== 2 && numTier !== 3) return false;
    const res = sweepInventoryBelow(numTier);
    if (res.soldCount === 0) {
      sfx.fail();
      addLog(`背包内没有符合条件（${FILTER_LABELS[numTier]}）的低质装备`);
      return false;
    }
    sfx.coin();
    addLog(`一键清包（${FILTER_LABELS[numTier]}）：出售 ${res.soldCount} 件 +${res.soldGold} 金币`);
    saveGame(state);
    refreshUI();
    return res;
  },

  setStayFloor(b) {
    state.stayFloor = !!b;
    addLog(state.stayFloor ? "停留本层：开启" : "停留本层：关闭");
    return true;
  },

  exportSave() {
    return exportSaveString(state);
  },

  importSave(str) {
    const imported = importSaveString(str);
    if (!imported) {
      sfx.fail();
      return false; // 失败提示由 ui.js 弹窗内展示
    }
    replaceStateInPlace(state, imported); // 保持 state 引用稳定（ui/combat 共享）
    computeDerived(state);
    syncHeroSkillUnlocks(state); // 导入档同样按等级推进技能解锁（含数字形态升级）
    setMuted(!!state.muted);
    combat.init(state, hooks); // 战斗运行时按新档重开
    saveGame(state);
    refreshUI();
    return true; // 成功日志由 ui.js 负责
  },

  resetGame() {
    replaceStateInPlace(state, newGame());
    computeDerived(state);
    syncHeroSkillUnlocks(state); // 新档技能记录升级为细化形态（1 级全未解锁）
    setMuted(false);
    combat.init(state, hooks);
    saveGame(state);
    refreshUI();
    return true; // 日志由 ui.js 负责
  },

  // ---- M4 小队管理 actions ----
  recruitCompanion(id) {
    const def = COMPANIONS[id];
    if (!def || !state.party) return false;
    if (state.party.unlocked[id]) return false;
    const u = def.unlock || {};
    if (u.type === "bossKill") {
      const kills = Number((state.stats && state.stats.bossKills) || 0);
      const goldCost = Number((u.cost && u.cost.gold) || 0);
      if (kills < 1) {
        sfx.fail();
        addLog(`招募 ${def.name} 需先击杀任意一位深渊之主！`);
        return false;
      }
      if ((Number(state.gold) || 0) < goldCost) {
        sfx.fail();
        addLog(`金币不足（需 ${goldCost} 金币招募 ${def.name}）`);
        return false;
      }
      state.gold -= goldCost;
    } else if (u.type === "embers") {
      const embCost = Number(u.cost || 0);
      if ((Number(state.embers) || 0) < embCost) {
        sfx.fail();
        addLog(`灵魂余烬不足（需 ${embCost} 余烬招募 ${def.name}）`);
        return false;
      }
      state.embers -= embCost;
    }
    state.party.unlocked[id] = true;
    state.party.levels[id] = Math.max(1, Math.floor(Number(state.party.levels[id]) || 1));
    if (!Array.isArray(state.party.active)) state.party.active = [];
    if (state.party.active.length < 3 && !state.party.active.includes(id)) {
      state.party.active.push(id);
    }
    const capKey = "companion" + id.charAt(0).toUpperCase() + id.slice(1);
    if (MILESTONE_TEXTS[capKey]) addChronicle(state, MILESTONE_TEXTS[capKey], capKey);
    computeDerived(state);
    saveGame(state);
    sfx.levelup();
    addLog(`招募成功：${def.name} 加入了远征小队！`);
    refreshUI();
    return true;
  },

  deployCompanion(id) {
    const def = COMPANIONS[id];
    if (!def || !state.party || !state.party.unlocked[id]) return false;
    if (!Array.isArray(state.party.active)) state.party.active = [];
    if (state.party.active.includes(id)) return false;
    if (state.party.active.length >= 3) {
      sfx.fail();
      addLog("小队最多同时上阵 3 名伙伴！");
      return false;
    }
    state.party.active.push(id);
    computeDerived(state);
    saveGame(state);
    sfx.click();
    addLog(`${def.name} 已上阵！`);
    refreshUI();
    return true;
  },

  undeployCompanion(id) {
    const def = COMPANIONS[id];
    if (!def || !state.party || !Array.isArray(state.party.active)) return false;
    const idx = state.party.active.indexOf(id);
    if (idx < 0) return false;
    state.party.active.splice(idx, 1);
    computeDerived(state);
    saveGame(state);
    sfx.click();
    addLog(`${def.name} 退居候补。`);
    refreshUI();
    return true;
  },

  upgradeCompanion(id) {
    const def = COMPANIONS[id];
    if (!def || !state.party || !state.party.unlocked[id]) return false;
    const lv = Math.max(1, Math.floor(Number(state.party.levels[id]) || 1));
    const cost = companionUpgradeCost(lv);
    if ((Number(state.embers) || 0) < cost) {
      sfx.fail();
      addLog(`灵魂余烬不足（升级 ${def.name} 需 ${cost} 余烬）`);
      return false;
    }
    state.embers -= cost;
    state.party.levels[id] = lv + 1;
    saveGame(state);
    sfx.click();
    addLog(`${def.name} 升至 Lv.${lv + 1}（-${cost} 余烬）`);
    refreshUI();
    return true;
  },

  // ---- M5 遗物 / 奇遇 / 凯旋轮回 actions ----
  pickRelic(rollId, relicId) {
    if (!Array.isArray(state.pendingRelics) || state.pendingRelics.length === 0) return false;
    let idx = state.pendingRelics.findIndex((r) => r && r.id === rollId);
    if (idx < 0) idx = 0;
    const roll = state.pendingRelics[idx];
    const valid = RELICS.find((r) => r.id === relicId);
    if (!valid) return false;
    if (Array.isArray(roll.options) && roll.options.length > 0 && !roll.options.includes(relicId)) {
      return false;
    }
    state.pendingRelics.splice(idx, 1);
    if (!Array.isArray(state.relics)) state.relics = [];
    if (!state.relics.includes(relicId)) state.relics.push(relicId);
    computeDerived(state);
    saveGame(state);
    sfx.levelup();
    addLog(`携带遗物：${valid.name}（${valid.desc}）`);
    refreshUI();
    return true;
  },

  setRelicAutoTag(tag) {
    const valid = tag === "crit" || tag === "dot" || tag === "survive" || tag === "economy" ? tag : null;
    state.relicAutoTag = valid;
    saveGame(state);
    sfx.click();
    addLog(valid ? `遗物自动偏好已设为：${valid}` : "遗物自动偏好已关闭（改为手动三选一）");
    refreshUI();
    return true;
  },

  resolveEvent(evUid, choiceIdx) {
    if (!Array.isArray(state.pendingEvents) || state.pendingEvents.length === 0) return null;
    let idx = state.pendingEvents.findIndex((e) => e && e.id === evUid);
    if (idx < 0) idx = 0;
    const pending = state.pendingEvents[idx];
    const evDef = EVENTS.find((e) => e.id === pending.eventId);
    if (!evDef || !Array.isArray(evDef.choices) || !evDef.choices[choiceIdx]) return null;
    state.pendingEvents.splice(idx, 1);

    const choice = evDef.choices[choiceIdx];
    const eff = choice.effect || {};
    let outcome = "";

    if (!state.runBuffs || typeof state.runBuffs !== "object") {
      state.runBuffs = { atkPct: 0, allPct: 0, curses: 0 };
    }

    switch (eff.type) {
      case "goldGain": {
        const rawVal = Math.max(1, Math.round(Number(eff.value) || 50));
        const scaled = Math.round(rawVal * Math.pow(1.15, Math.max(0, (state.floor || 1) - 1)));
        state.gold = (Number(state.gold) || 0) + scaled;
        if (state.stats) state.stats.totalGold = (Number(state.stats.totalGold) || 0) + scaled;
        sfx.coin();
        outcome = `获得 ${scaled} 金币`;
        break;
      }
      case "goldLoss": {
        const cost = Math.max(0, Math.round(Number(eff.value) || 0));
        const spent = Math.min(Number(state.gold) || 0, cost);
        state.gold = Math.max(0, (Number(state.gold) || 0) - spent);
        outcome = spent > 0 ? `支付了 ${spent} 金币，确认了前路方位` : `囊中羞涩，商队摇摇头还是指了条小路`;
        break;
      }
      case "freeItem": {
        const wantEpic = typeof eff.value === "string" && eff.value.includes("史诗");
        let item = rollItem(state.floor, wantEpic);
        if (wantEpic && item.rarity < 2) item = rollItem(state.floor, true);
        state.inventory.push(item);
        sfx.drop();
        outcome = `获得装备：${item.name}（${RARITY_NAMES[item.rarity] ?? "?"}·${SLOT_NAMES[item.slot] ?? "?"}）`;
        break;
      }
      case "trapDamage": {
        const dmg = Math.max(1, Math.round((state.hero.maxHp || 100) * 0.25));
        state.hero.hpNow = Math.max(1, (Number(state.hero.hpNow) || 1) - dmg);
        sfx.fail();
        outcome = `触发机关，受到 ${dmg} 点伤害（余 ${Math.round(state.hero.hpNow)} 生命）`;
        break;
      }
      case "healFull": {
        state.hero.hpNow = state.hero.maxHp;
        spawnFx(healFx, { x: combat.HERO_X, y: combat.GROUND_Y, actor: stockActor(2) });
        sfx.respawn();
        outcome = `勇者恢复至满血（${Math.round(state.hero.maxHp)}）`;
        break;
      }
      case "buffAtk": {
        const pct = Number(eff.value) || 0.1;
        state.runBuffs.atkPct = (Number(state.runBuffs.atkPct) || 0) + pct;
        sfx.levelup();
        outcome = `本轮勇者攻击力永久 +${Math.round(pct * 100)}%`;
        break;
      }
      case "buffAll": {
        const pct = Number(eff.value) || 0.1;
        state.runBuffs.allPct = (Number(state.runBuffs.allPct) || 0) + pct;
        sfx.levelup();
        outcome = `本轮全队全属性永久 +${Math.round(pct * 100)}%`;
        break;
      }
      case "relicRoll": {
        const picks = rollRelicChoices(state);
        if (picks.length > 0) {
          const pickedId = picks[0];
          const rObj = RELICS.find((r) => r.id === pickedId);
          if (!Array.isArray(state.relics)) state.relics = [];
          if (!state.relics.includes(pickedId)) state.relics.push(pickedId);
          sfx.levelup();
          outcome = `获得遗物：${rObj ? rObj.name : pickedId}（${rObj ? rObj.desc : ""}）`;
        } else {
          const bonusGold = Math.round(150 * Math.pow(1.15, Math.max(0, (state.floor || 1) - 1)));
          state.gold = (Number(state.gold) || 0) + bonusGold;
          outcome = `遗物已全收集，折算获得 ${bonusGold} 金币`;
        }
        break;
      }
      case "curseUntilPrestige": {
        state.runBuffs.curses = (Number(state.runBuffs.curses) || 0) + 1;
        sfx.fail();
        outcome = `背负深渊诅咒（本轮防御 -5%，当前共 ${state.runBuffs.curses} 层）`;
        break;
      }
      case "floorSkip": {
        const step = Math.max(1, Math.floor(Number(eff.value) || 1));
        state.floor = Math.max(1, Math.floor(Number(state.floor) || 1)) + step;
        state.killsOnFloor = 0;
        state.bestFloor = Math.max(state.bestFloor || 1, state.floor);
        combat.init(state, hooks);
        sfx.levelup();
        outcome = `跃迁至第 ${state.floor} 层 · ${floorName(state.floor)}`;
        break;
      }
      case "bossRush": {
        combat.triggerBossRush();
        sfx.boss();
        outcome = `深渊响应了呼唤——当前层强敌降临！`;
        break;
      }
      default:
        outcome = choice.desc || "风平浪静。";
        break;
    }

    computeDerived(state);
    saveGame(state);
    addLog(`奇遇【${evDef.name}】· ${choice.label} → ${outcome}`);
    refreshUI();
    return outcome;
  },

  prestige() {
    const sum = performPrestige(state);
    if (!sum) {
      sfx.fail();
      return null;
    }
    addChronicle(state, MILESTONE_TEXTS.firstPrestige, "firstPrestige");
    addChronicle(
      state,
      `第 ${sum.prestigeCount} 次凯旋：自第 ${sum.prevFloor} 层携回 ${sum.embersGained} 灵魂余烬（保留 ${sum.keptItems} 件装备）`,
    );
    syncHeroSkillUnlocks(state);
    combat.init(state, hooks);
    themedFloor = state.floor;
    applyTheme(themeForFloor(state.floor), true);
    saveGame(state);
    sfx.levelup();
    addLog(`凯旋回城！获 +${sum.embersGained} 灵魂余烬，从第 ${sum.startFloor} 层再启远征！`);
    refreshUI();
    return sum;
  },

  markIntroSeen() {
    state.seenIntro = true;
    saveGame(state);
    return true;
  },
};

const hooks = { onEvent: handleEvent };

// ---------------------------------------------------------------------------
// 界面 / 音频 / 战斗 初始化
// ---------------------------------------------------------------------------
setMuted(!!state.muted);
initUI({ state, actions });
if (offlineGains) {
  try {
    showOfflineModal(offlineGains);
  } catch (e) {
    console.error("main: 离线收益弹窗展示失败", e);
  }
} else if (!state.seenIntro && !debugScene) {
  try {
    showIntroModal();
  } catch (e) {
    console.error("main: 序章弹窗展示失败", e);
  }
}
addLog(`欢迎来到余烬深渊！当前第 ${state.floor} 层 · ${floorName(state.floor)}`);

// 调试模式暂停战斗模拟（ combat.init 仍对齐 view，事件静默避免误触发特效/音效）
combat.init(state, debugScene ? { onEvent() {} } : hooks);

// 音频：首次用户手势解锁（audio.js 幂等；ui.js 的按钮点击也会补调）
window.addEventListener("pointerdown", () => initAudio(), { passive: true });

// 自动存档：每 5 秒（BALANCE.SAVE_INTERVAL_MS）+ beforeunload + visibilitychange
window.addEventListener("beforeunload", () => saveGame(state));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveGame(state);
});
setInterval(() => saveGame(state), BALANCE.SAVE_INTERVAL_MS);

// 调试契约（sceneInfo 供验收/调试读取当前场景状态：主题名、装饰件数、视差/雾相位）
function sceneInfo() {
  return {
    theme: themeObj ? themeObj.name : null,
    themedFloor,
    decor: decorItems.length,
    scrolling,
    sweep: sweepT > 0,
  };
}
window.__GAME = { state, combat, debug: debugScene, sceneInfo };

// ---------------------------------------------------------------------------
// 英雄帧选择：由 combat 暴露的动画计时驱动（combat.js view.hero.anim/clock）。
//   hurt：heroHurt 帧；
//   atk ：heroAttack 3 帧（前摇 0-1/3 → 挥砍 1/3-2/3 → 收招 2/3-1），未交付时
//         回退 heroAtk/2 帧并保持 V1 切换点（prog<0.5 ⇔ V1 的 t > dur/2）；
//   idle：heroIdle 循环（4 帧呼吸+披风），未交付时回退 V1 的 2 帧 0.45s 周期。
// combat 未暴露 anim 字段时直接沿用其 view.hero.sprite（V1 行为兜底）。
// ---------------------------------------------------------------------------
function heroSpriteId(hv) {
  const A = sprites.SPRITE_ANIM || {};
  const an = hv.anim;
  if (!an) return hv.sprite || "hero_idle0";
  if (an.name === "hurt") {
    const f = Array.isArray(A.heroHurt) && A.heroHurt.length ? A.heroHurt : ["hero_hurt"];
    return f[0];
  }
  if (an.name === "atk") {
    const frames = Array.isArray(A.heroAttack) && A.heroAttack.length ? A.heroAttack
      : Array.isArray(A.heroAtk) && A.heroAtk.length ? A.heroAtk
      : ["hero_atk0", "hero_atk1"];
    const dur = an.dur > 0 ? an.dur : 0.24;
    const prog = Math.min(1, Math.max(0, 1 - Math.max(0, an.t) / dur));
    if (frames.length >= 3) return frames[prog < 1 / 3 ? 0 : prog < 2 / 3 ? 1 : 2];
    return frames[prog < 0.5 ? 0 : Math.min(1, frames.length - 1)];
  }
  const idle = Array.isArray(A.heroIdle) && A.heroIdle.length ? A.heroIdle : ["hero_idle0", "hero_idle1"];
  return idle[Math.floor((hv.clock || 0) / 0.45) % idle.length];
}

// ---------------------------------------------------------------------------
// 调试演出：?debug=party 满编位（各角色 idle 帧循环；帧 id 未交付的角色自动
// 跳过，sprites.js 补齐契约帧后无需改代码即可显示）；?debug=floor=N 仅场景。
// ---------------------------------------------------------------------------
const debugFramesCache = new Map();
function probeSprite(id) {
  const probe = createFrame(4, 4);
  return drawSprite(probe, id, 2, 3); // 未知 id 返回 false（并一次性 console.warn）
}
function debugIdleFrames(key) {
  if (debugFramesCache.has(key)) return debugFramesCache.get(key);
  const A = sprites.SPRITE_ANIM || {};
  let frames = null;
  for (const c of [A[`${key}Idle`], A[key]]) {
    if (Array.isArray(c) && c.length) { frames = c; break; }
  }
  if (!frames) {
    for (const id of [`${key}_idle0`, `${key}0`, key]) {
      if (probeSprite(id)) { frames = [id]; break; }
    }
  }
  debugFramesCache.set(key, frames);
  return frames;
}

function renderDebugScene() {
  if (!debugScene || debugScene.type !== "party") return;
  const t = performance.now() / 1000;
  for (const m of DEBUG_PARTY) {
    const frames = debugIdleFrames(m.key);
    if (!frames) continue;
    drawSprite(frameBuf, frames[Math.floor(t / 0.45) % frames.length], m.x, combat.GROUND_Y, {});
  }
}

function companionSpriteId(c) {
  const A = sprites.SPRITE_ANIM || {};
  const id = c.id;
  const an = c.anim;
  if (an && an.name !== "idle") {
    const actFrames = A[`${id}Cast`] || A[`${id}Attack`];
    if (Array.isArray(actFrames) && actFrames.length) {
      const dur = an.dur > 0 ? an.dur : 0.28;
      const prog = Math.min(1, Math.max(0, 1 - Math.max(0, an.t) / dur));
      return actFrames[Math.min(actFrames.length - 1, Math.floor(prog * actFrames.length))];
    }
  }
  const idle = A[`${id}Idle`];
  if (Array.isArray(idle) && idle.length) {
    return idle[Math.floor((c.clock || 0) / 0.45) % idle.length];
  }
  return `${id}_idle0`;
}

// ---------------------------------------------------------------------------
// 2D 余烬飘浮微粒 + 动态火把光晕（用于 640x360 哥特高清地牢舞台）
// ---------------------------------------------------------------------------
const emberMotes = Array.from({ length: 18 }, (_, i) => ({
  x: ((i * 97) % 620) + 10,
  y: ((i * 53) % 280) + 30,
  vy: 10 + (i % 5) * 4,
  phase: i * 1.1,
  size: i % 3 === 0 ? 2 : 1,
}));

function drawGroundShadow(x, y, width) {
  ctx.save();
  ctx.fillStyle = "rgba(8, 5, 14, 0.45)";
  ctx.beginPath();
  ctx.ellipse(x, y + 1, Math.max(12, width * 0.42), 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHdBackground(nowSec, dx, dy) {
  const bg = getBg();
  if (!bg) return false;
  const off = scrolling ? Math.round(TILE * SCALE * (1 - Math.pow(1 - scrollT, 2))) : 0;
  ctx.imageSmoothingEnabled = false;
  // 横向无缝轻微视差偏移
  ctx.drawImage(bg.img, dx - off, dy, VIEW_W, VIEW_H);
  if (off > 0) ctx.drawImage(bg.img, dx + VIEW_W - off, dy, VIEW_W, VIEW_H);

  // 主题色相氛围叠层（保持 8 大地牢每 5 层切换不同情绪色调）
  if (themeObj) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = themeObj.fogColor || "#14101c";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  // 两侧铁火盆动态暖光光晕（随主题 glow 色微微闪烁）
  const glowHex = (themeObj && themeObj.glow) || "#ff9e3d";
  const flicker = 0.88 + Math.sin(nowSec * 9.5) * 0.06 + Math.cos(nowSec * 14.3) * 0.05;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const bx of [158, 482]) {
    const r = 135 * flicker;
    const grad = ctx.createRadialGradient(bx + dx, 148 + dy, 4, bx + dx, 148 + dy, r);
    grad.addColorStop(0, "rgba(255, 226, 140, 0.26)");
    grad.addColorStop(0.38, "rgba(255, 142, 48, 0.13)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(bx + dx - r, 148 + dy - r, r * 2, r * 2);
  }
  ctx.restore();

  // 缓慢升起的余烬火星
  ctx.save();
  ctx.fillStyle = glowHex;
  for (const m of emberMotes) {
    const my = ((m.y - nowSec * m.vy) % 310 + 310) % 310;
    const mx = m.x + Math.sin(nowSec * 2 + m.phase) * 8;
    const a = 0.25 + 0.35 * Math.abs(Math.sin(nowSec * 3 + m.phase));
    ctx.globalAlpha = a;
    ctx.fillRect(Math.round(mx + dx), Math.round(my + dy), m.size, m.size);
  }
  ctx.restore();
  return true;
}

// ---------------------------------------------------------------------------
// 渲染与主循环
// ---------------------------------------------------------------------------
function render() {
  const nowSec = performance.now() / 1000;
  let dx = 0, dy = 0;
  if (shakeT > 0) {
    dx = Math.round((Math.random() * 2 - 1) * 5);
    dy = Math.round((Math.random() * 2 - 1) * 3);
  }

  ctx.fillStyle = themeObj ? themeObj.bg : BG_CSS;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const hdBg = drawHdBackground(nowSec, dx, dy);
  if (!hdBg) {
    // 兜底：原版像素瓷砖背景 + back 火把特效（2x 放大）
    frameBuf.color.set(curBgFrame.color);
    frameBuf.light.fill(0);
    for (const inst of fxs) if (inst.stage === "back") inst.fx.draw(frameBuf);
    composite(frameBuf, imgData.data, curBgFrame.color, 1);
    fallbackCtx.putImageData(imgData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fallbackCanvas, dx, dy, VIEW_W, VIEW_H);
  }

  // 准备回退帧缓冲（仅当某个实体暂无 PNG 资源时才绘制并叠加）
  let usedFallback = false;
  fallbackFrame.color.fill(0);
  fallbackFrame.light.fill(0);

  const drawEntity = (key, spriteId, x, y, opts = {}) => {
    const png = getSprite(key);
    if (png) {
      drawGroundShadow(x * SCALE + dx, y * SCALE + dy, png.w * 0.72);
      drawAssetSprite(ctx, png, x * SCALE + dx, y * SCALE + dy, opts);
      return;
    }
    usedFallback = true;
    drawSprite(fallbackFrame, spriteId, x, y, { alpha: opts.alpha ?? 1 });
    if (opts.flash > 0) applyFlashToFrame(fallbackFrame, { x, y }, spriteId);
  };

  if (debugScene) {
    if (debugScene.type === "party") {
      for (const m of DEBUG_PARTY) {
        const frames = debugIdleFrames(m.key);
        const fId = frames ? frames[Math.floor(nowSec / 0.45) % frames.length] : `${m.key}0`;
        const bob = Math.sin(nowSec * 3.5 + m.x * 0.05) * 0.02;
        drawEntity(m.key, fId, m.x, combat.GROUND_Y, { scaleY: 1 + bob, scaleX: 1 - bob * 0.6 });
      }
    }
  } else {
    // ② 怪物（PNG 走入跳跃 + 受击闪白，无 PNG 时回退 sprites.js）
    const mv = combat.view.monster;
    if (mv.visible) {
      const enterHop = combat.view.phase === "enter" ? Math.abs(Math.sin(nowSec * 12)) * 4 : 0;
      const breath = Math.sin(nowSec * 3.4 + 1.2) * 0.022;
      drawEntity(mv.sprite, mv.sprite, mv.x, mv.y - enterHop, {
        alpha: mv.alpha,
        flash: mv.flash,
        scaleY: 1 + breath,
        scaleX: 1 - breath * 0.6,
      });
    }

    // ③ 伙伴小队（薇拉→艾琳→凯）
    const comps = Array.isArray(combat.view.companions) ? combat.view.companions : [];
    for (const c of comps) {
      const acting = c.anim && c.anim.name !== "idle";
      const prog = acting && c.anim.dur > 0 ? Math.sin((1 - c.anim.t / c.anim.dur) * Math.PI) : 0;
      const breath = Math.sin(c.clock * 3.8) * 0.02;
      drawEntity(c.id, companionSpriteId(c), c.x + prog * (c.id === "kai" ? 8 : 3), c.y - prog * 2, {
        alpha: c.alpha ?? 1,
        scaleY: 1 + breath,
        tilt: acting && c.id === "kai" ? prog * 0.08 : 0,
      });
    }

    // ④ 主勇者（呼吸 + 挥砍前冲 + 受击后仰闪白）
    const hv = combat.view.hero;
    const heroId = heroSpriteId(hv);
    const hAnim = hv.anim || { name: "idle", t: 0, dur: 0.24 };
    let hDx = 0, hDy = 0, hTilt = 0;
    if (hAnim.name === "atk" && hAnim.dur > 0) {
      const p = Math.sin((1 - hAnim.t / hAnim.dur) * Math.PI);
      hDx = p * 9;
      hTilt = p * 0.1;
    } else if (hAnim.name === "hurt") {
      hDx = -4;
      hTilt = -0.08;
    }
    const hBreath = Math.sin(hv.clock * 3.8) * 0.02;
    drawEntity("hero", heroId, hv.x + hDx, hv.y + hDy, {
      alpha: hv.alpha,
      flash: hv.flash,
      scaleY: 1 + hBreath,
      scaleX: 1 - hBreath * 0.6,
      tilt: hTilt,
    });
  }

  // 把需要回退 sprites.js 的实体透明叠加到 640x360 画布上
  if (usedFallback) {
    composite(fallbackFrame, fallbackImgData.data, null, 1);
    fallbackCtx.putImageData(fallbackImgData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fallbackCanvas, dx, dy, VIEW_W, VIEW_H);
  }

  // ④ 前景 pixelfx 特效（透明合成后 2x 像素风放大覆盖）
  fxFrame.color.fill(0);
  fxFrame.light.fill(0);
  for (const inst of fxs) if (inst.stage === "front") inst.fx.draw(fxFrame);
  composite(fxFrame, fxImgData.data, null, 1);
  fxCtx.putImageData(fxImgData, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(fxCanvas, dx, dy, VIEW_W, VIEW_H);

  // ⑥ 换层雾色过渡：整屏向主题 fogColor 的正弦薄雾（0.5s，中段最浓）
  if (sweepT > 0) {
    const s = Math.sin((sweepT / SWEEP_DUR) * Math.PI) * 0.55;
    const [fr, fg, fb] = themeAssetsFor(themeObj).fogRGB;
    ctx.fillStyle = `rgba(${fr},${fg},${fb},${s.toFixed(3)})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

let last = performance.now();
let saveAcc = 0;
let uiAcc = 0;
let prevPhase = null;
function tick(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); // 后台回来 dt 兜底
  last = now;

  if (!debugScene) {
    combat.update(dt);
    // 怪物生成瞬间（phase 进入 enter）→ 行军视差
    if (combat.view.phase === "enter" && prevPhase !== "enter") triggerScroll();
    prevPhase = combat.view.phase;
    // 楼层 → 主题跟随（含 bossFail 降层 / 导入存档 / 重置；换层加雾色过渡）
    if (state.floor !== themedFloor) {
      themedFloor = state.floor;
      applyTheme(themeForFloor(state.floor), true);
    }
  }

  // 视差推进：0.4s 缓出左移一砖；完成后 world 基准 +16 并重排装饰（画面无缝）
  if (scrolling) {
    scrollT = Math.min(1, scrollT + dt / SCROLL_DUR);
    if (scrollT >= 1) {
      camX += TILE;
      advanceDecor();
      buildStrip(themeObj);
      scrolling = false;
    }
    updateCurBg();
  }
  if (sweepT > 0) sweepT = Math.max(0, sweepT - dt);

  updateFx(dt);
  if (shakeT > 0) shakeT -= dt;

  saveAcc += dt * 1000;
  if (saveAcc >= BALANCE.SAVE_INTERVAL_MS) {
    saveAcc = 0;
    saveGame(state);
  }
  uiAcc += dt * 1000;
  if (uiAcc >= 150) { // ui 契约：约 150ms 节流刷新
    uiAcc = 0;
    refreshUI();
  }

  render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

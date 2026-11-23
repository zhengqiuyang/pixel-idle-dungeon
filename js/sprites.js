// ============================================================================
// 《余烬深渊》(pixel-idle-dungeon) · js/sprites.js —— 像素精灵库 V2（美术重制版）
//
// 帧写入方式与 V1 相同：drawSprite 逐像素写 frame.color（Uint32Array，0xAABBGGRR，
// r 低 8 位），颜色 0 = 透明不擦除；锚点 (x, y) = 脚底中心（精灵最底一行落在 y 上，
// 水平网格中心对齐 x）。opts.flip 水平镜像；opts.alpha<1 用 4x4 Bayer 有序抖动硬像素淡出。
//
// 【6 条像素美术原则（本文件逐条落实）】
//  1. 黄金头身比与剪影优先：勇者/三伙伴 24x28（头 9 行 + 躯干武器披风 12 行 + 双腿 7 行，
//     前后脚错位）；小怪 16x16~22x22；Boss 36x40。涂纯黑剪影可辨职业：
//     余烬骑士=大盾+竖持长剑+飘披风；薇拉=尖顶巫师帽+悬浮法杖+光球；艾琳=兜帽+十字权杖；
//     凯=双匕首+飞围巾。
//  2. 色相偏移调色板：PALETTES 每族 5 阶 —— 阴影向冷色（蓝紫）偏移、高光向暖色（暖白/
//     淡黄）偏移，禁止只降亮度（见每个 ramp 的注释）。
//  3. 选择性轮廓：底部/背光面用 O(#0b0a14) 最深轮廓；顶部受光面（头发顶/肩甲/帽顶）
//     用同色系最深一阶（G/Z/J/D…）做软轮廓，告别死黑框。
//  4. 动画：勇者待机 4 帧（头/胸 1px 呼吸 + 披风错拍摆动）、攻击 3 帧（后仰举刀蓄力 →
//     前倾挥砍+拖影 → 收招）；伙伴待机 4 帧 + 施法/攻击 2 帧 + 受击；小怪待机 4 帧
//     （2 帧手绘 + 2 帧派生起伏/悬浮）；Boss 待机 2 帧 + 攻击 2 帧。
//  5. 脚底接触投影：drawSprite 默认（opts.shadow !== false 且非瓷砖）在脚下画半透明
//     椭圆深色投影（alpha≈0.30，宽度随精灵宽），先画影子再画精灵，脚步像素覆盖其上。
//  6. 发光点：Boss 眼部、薇拉法杖光球、艾琳权杖宝石、盾面/胸口余烬纹章 —— 亮核(!)
//     + 同族亮阶外圈渐暗，体现体积。
//
// 调色板集中定义并导出：PALETTES（hue-shift 阶梯，5 阶 [阴影,暗,中,亮,高光]），
// PALETTE（字符→色值映射，兼容 V1 导出）。瓷砖沿用原 id（floor_mid/floor_edge/
// wall/wall_top/torch_sconce）按新调色板重绘。
// 新增 drawDecor(frame, key, x, y, theme)：13 种 decor × ≥2 变体，theme 配色
// （12 种宪章键 + lava：main.js 熔岩隧道 theme.decor 在用）。
// ============================================================================
import { hex } from "../vendor/pixelfx/src/core/index.js";

// ---------------------------------------------------------------------------
// 1) PALETTES —— 色相偏移阶梯（集中定义，供本文件与外部复用）
//    每族 5 阶：[0]最暗阴影(向冷色偏移) [1]暗 [2]中间 [3]亮 [4]高光(向暖色偏移)
// ---------------------------------------------------------------------------
export const PALETTES = {
  // 钢铁（盔甲/长剑/盾面）：阴影偏蓝紫，高光暖白
  steel: ["#1c2030", "#333c58", "#57628c", "#8d9cc0", "#dfe6f2"],
  // 黑铁（锁链/栅栏/魔像暗部/Boss 护甲）：整体冷灰紫
  iron:  ["#12101c", "#262438", "#3e3c5c", "#5f5d8a", "#9a97c2"],
  // 绯红（披风/恶魔皮/蘑菇伞/龙腹）：阴影偏冷酒红，高光偏暖橙
  cape:  ["#2a0c18", "#52122a", "#8c2038", "#c44a44", "#f2906e"],
  // 皮肤：阴影偏红褐（冷），高光暖米
  skin:  ["#6e3a2e", "#99563c", "#c07d52", "#e3a877", "#ffd9ac"],
  // 金发/金饰/王冠：阴影偏橄榄，高光淡金黄
  hair:  ["#4e3410", "#7d5618", "#b2821f", "#e2b448", "#ffe89c"],
  // 粘液绿（史莱姆/哥布林皮）：阴影偏深青，高光黄绿
  slime: ["#0f2a1c", "#1e4a28", "#3a7c36", "#63b04a", "#a8e07e"],
  // 骨白（骷髅/骨领/法袍白）：阴影偏冷紫灰，高光暖骨白
  bone:  ["#4a4458", "#776f7e", "#a89e9c", "#d6cabc", "#fff3dc"],
  // 石头（石像鬼/魔像/柱/墙檐）：阴影偏冷蓝紫，高光暖灰白
  stone: ["#191726", "#2e2c40", "#4c4a62", "#76748e", "#b0aec6"],
  // 皮革暖棕（靴/木/棍棒）：阴影偏冷深棕，高光暖沙
  earth: ["#20100a", "#3e2412", "#643c1e", "#96622e", "#d29a52"],
  // 暗紫（幽灵/影龙/暗影主题/薇拉袍）：阴影近黑紫，高光淡紫
  purple: ["#170f2a", "#2a1c4e", "#48357c", "#7457b0", "#b39ae8"],
  // 冰蓝（薇拉/冰柱/冰霜主题）：阴影深海军蓝，高光冰白
  blue:  ["#0e1e34", "#1c3a5e", "#2f6191", "#5593c4", "#a8d4f0"],
  // 余烬火（火把/岩浆/魔像核心/龙瞳）：阴影暗红褐，高光金黄
  fire:  ["#4a1408", "#7e2408", "#b8440e", "#ef7d1a", "#ffc94e"],
};

// ---------------------------------------------------------------------------
// 2) 字符调色板：ramp 每阶一个字符（顺序 = PALETTES 数组顺序），外加单色。
//    网格画法约定：顶部受光轮廓用 ramp[0] 字符，底部/背光轮廓用 O。
// ---------------------------------------------------------------------------
const RAMP_CHARS = {
  steel: "ZzqQ1",
  iron: "VvuU2",
  cape: "JjRr3",
  skin: "NnmM4",
  hair: "GgyY5",
  slime: "LlsS6",
  bone: "BbIi8",
  stone: "PpTt9",
  earth: "CcAa0",
  purple: "KkWw@",
  blue: "DdEFe",
  fire: "HhxX7",
};

export const PALETTE = {
  O: "#0b0a14", // 万能深轮廓（底部/背光面）
  "!": "#fffaf0", // 纯白热核（发光点亮核/眼内高光）
};
for (const [name, chars] of Object.entries(RAMP_CHARS)) {
  const ramp = PALETTES[name];
  for (let i = 0; i < chars.length; i++) PALETTE[chars[i]] = ramp[i];
}

// ---------------------------------------------------------------------------
// 3) 网格派生工具：矩形区域平移（呼吸/摆动/悬浮/受击帧都由它派生，1px 级）。
//    约定：区域边界落在实心轮廓带（脖颈/腰带/剪影独立部件），平移后不露缝。
// ---------------------------------------------------------------------------
function shiftRegion(rows, r0, r1, c0, c1, dx, dy) {
  const h = rows.length, w = rows[0].length;
  const out = rows.map((r) => r.split(""));
  for (let r = Math.max(0, r0); r <= Math.min(h - 1, r1); r++) {
    for (let q = Math.max(0, c0); q <= Math.min(w - 1, c1); q++) out[r][q] = ".";
  }
  for (let r = Math.max(0, r0); r <= Math.min(h - 1, r1); r++) {
    for (let q = Math.max(0, c0); q <= Math.min(w - 1, c1); q++) {
      const ch = rows[r][q];
      if (ch === "." || ch === " ") continue;
      const tr = r + dy, tq = q + dx;
      if (tr < 0 || tr >= h || tq < 0 || tq >= w) continue;
      out[tr][tq] = ch;
    }
  }
  return out.map((r) => r.join(""));
}

// 行内补丁：把 chars 写入指定行的指定列（攻击帧的火光/武器局部改绘用）。
function patchRows(rows, patches) {
  const out = rows.map((r) => r.split(""));
  for (const [ri, cols] of Object.entries(patches)) {
    for (const [col, chars] of cols) {
      for (let i = 0; i < chars.length; i++) {
        const q = col + i;
        if (out[ri] && q >= 0 && q < out[ri].length) out[ri][q] = chars[i];
      }
    }
  }
  return out.map((r) => r.join(""));
}

// ---------------------------------------------------------------------------
// 4) 精灵网格（"." = 透明）。每个精灵同组各帧尺寸一致。
// ---------------------------------------------------------------------------

// ==== 余烬骑士（24x28，朝右）：金发 + 红披风 + 钢甲 + 左臂大盾 + 右手竖持长剑 ====
// 头 0-8（9 行）/ 躯干+盾+剑 9-20（12 行）/ 双腿 21-27（7 行，前后错位）。
// 发光点：盾面余烬纹章（7!X）、剑身余烬符文（X7）、胸口纹章。
const HERO_IDLE0 = [
  "..........GGGGGG........",
  ".........GyYY5ygG..zQ...",
  "........GgyYY5yyGg.zQ...",
  "........GgyYgMMMM4.zQ...",
  "........GgyNmMMOm4.X7...",
  "........GgyNmmMMm4.zQ...",
  "........GgyNnmMm4..zQ...",
  ".........GgnNmm4...zQ...",
  "..........OmmMO....zQ...",
  "....jJ...zqqzqqzQZZzQ...",
  "....JjR..ZqqzzqqZqQzQ...",
  "...JjZqqZZqqzqzzZqQzQ...",
  "..JjRqQ1qQqX7qqzzZqQzQ..",
  "..JjRqQ11q7!XqqzzZqQ....",
  "..JjRqQ1qQq7XqqzzZqz....",
  "...JjRqQqqqqzzzzZz..aA..",
  "...JjRqQQQqzqqzqz..aA...",
  "....JjRrrqqzqqzqz.Mm....",
  "....JjRrZzqqzzqz..Om....",
  ".....JjRZzAa5aZz........",
  "......JjRaA55AzZ........",
  ".......Ozqz..zqz........",
  ".......Ozqz...zqz.......",
  "......Ozqz....Ozqz......",
  "......Ozqz.....Ozqz.....",
  ".....OcAc......OcAc.....",
  "....OCcAC0.....OCcAC0...",
  "....OOOOOOO....OOOOOOO..",
];

// 呼吸帧：头/胸下压 1px + 披风错拍摆动（派生）
const HERO_IDLE1 = (() => {
  let g = HERO_IDLE0;
  g = shiftRegion(g, 0, 8, 0, 23, 0, 1);          // 头下压 1px（呼气）
  g = shiftRegion(g, 9, 13, 0, 6, 1, 0);          // 披风上段向右摆 1px
  return g;
})();
const HERO_IDLE2 = (() => {
  let g = HERO_IDLE0;
  g = shiftRegion(g, 0, 8, 0, 23, 0, 1);          // 头保持下压
  g = shiftRegion(g, 9, 13, 0, 6, 2, 0);          // 披风继续右摆
  return g;
})();
const HERO_IDLE3 = (() => {
  let g = HERO_IDLE0;
  g = shiftRegion(g, 9, 13, 0, 6, -1, 0);         // 披风向左回摆（吸气，头复位）
  return g;
})();

// 攻击 3 帧：atk0 后仰举刀蓄力 → atk1 前倾横斩+拖影 → atk2 收招
const HERO_ATK0 = [
  "..........GGGGGG........",
  ".........GyYY5ygG.zQ....",
  "........GgyYY5yyGgzQ....",
  "........GgyYgMMMM4zQ....",
  "........GgyNmMMOm4X7....",
  "........GgyNmmMMm4zQ....",
  "........GgyNnmMm4.zQ....",
  ".........GgnNmm4..zQ....",
  "..........OmmMO...zQ....",
  "...jJ....zqqzqqzQzQz....",
  "..JjRR...ZqqzzqqZqz.....",
  ".JjRZqqZZqqzqzzZqzAa....",
  ".JjRqQ1qQqX7qqzzZ.Aa....",
  ".JjRqQ11q7!XqqzzZ..a....",
  ".JjRqQ1qQq7XqqzzZ.aA....",
  "..JjRqQqqqqzzzzZzAa.....",
  "..JjRqQQQqzqqzqz.aA.....",
  "...JjRrrqqzqqzqz.aA.....",
  "....JjRrZzqqzzqz.aA.....",
  ".....JjRZzAa5aZz........",
  "......JjRaA55AzZ........",
  ".......Ozqz..zqz........",
  "......Ozqz...zqz........",
  ".....Ozqz.....Ozqz......",
  "....Ozqz......Ozqz......",
  "...OcAc.......OcAc......",
  "..OCcAC0......OCcAC0....",
  "..OOOOOOO.....OOOOOOO...",
];
const HERO_ATK1 = [
  "..........GGGGGG........",
  ".........GyYY5ygG.......",
  "........GgyYY5yyGg......",
  "........GgyYgMMMM4......",
  "........GgyNmMMOm4......",
  "........GgyNmmMMm4......",
  "........GgyNnmMm4.......",
  ".........GgnNmm4........",
  "..........OmmMO.........",
  "..jJ.....zqqzqqzQZZ.....",
  ".JjRR...ZqqzzqqZqQMz....",
  "JjRZqqZZqqzqzzZqQMmz111.",
  "JjRqQ1qQqX7qqzzZzOz1Q11!",
  ".JjRqQ11q7!XqqzzZ.OzQ1Q1",
  "..JjRqQ1qQq7XqqzzZ.zQ1Q1",
  "...JjRqQqqqqzzzzZz.aAQ11",
  "....JjRQQQqzqqzqz.aA.O1!",
  ".....JjRrrqqzqqz.aA.....",
  "......JjRZzqqzzqz.aA....",
  ".......JjZzAa5aZz.......",
  "........JjRaA55AzZ......",
  ".........Ozqz.zqz.......",
  ".........Ozqz..zqz......",
  "........Ozqz...Ozqz.....",
  "........Ozqz....Ozqz....",
  ".......OcAc....OcAc.....",
  "......OCcAC0..OCcAC0....",
  "......OOOOOOO.OOOOOOO...",
];
const HERO_ATK2 = [
  "..........GGGGGG........",
  ".........GyYY5ygG.......",
  "........GgyYY5yyGg......",
  "........GgyYgMMMM4......",
  "........GgyNmMMOm4......",
  "........GgyNmmMMm4......",
  "........GgyNnmMm4.......",
  ".........GgnNmm4........",
  "..........OmmMO.........",
  "....jJ...zqqzqqzQZZ.....",
  "....JjR..ZqqzzqqZqQ.....",
  "...JjZqqZZqqzqzzZqQMm...",
  "..JjRqQ1qQqX7qqzzZqMOm..",
  "..JjRqQ11q7!XqqzzZ.OzQ1.",
  "..JjRqQ1qQq7XqqzzZ..zQQ1",
  "...JjRqQqqqqzzzzZz..azQ1",
  "...JjRqQQQqzqqzqz..aA...",
  "....JjRrrqqzqqzqz.aA....",
  "....JjRrZzqqzzqz..aA....",
  ".....JjRZzAa5aZz.aA.....",
  "......JjRaA55AzZ........",
  ".......Ozqz..zqz........",
  ".......Ozqz...zqz.......",
  "......Ozqz....Ozqz......",
  "......Ozqz.....Ozqz.....",
  ".....OcAc......OcAc.....",
  "....OCcAC0.....OCcAC0...",
  "....OOOOOOO....OOOOOOO..",
];

// 受击：上身后仰 1px（派生）
const HERO_HURT = (() => {
  let g = HERO_IDLE0;
  g = shiftRegion(g, 0, 20, 0, 23, -1, 0);        // 头+躯干+持剑臂后仰
  return g;
})();

// ==== 薇拉（24x28，朝右）：尖顶巫师帽 + 悬浮法杖 + 光球 ====
// 帽 3-9 / 脸 10-13 / 袍 14-27；法杖全程悬浮于右侧（杆 20-21 列、底端离地 2px），
// 顶部光球发光（蓝 e 外圈 → ! 白核），待机时光球上下浮 1px。
const VERA_IDLE0 = [
  "....................@e..",
  "...................@!e..",
  "...................@we..",
  "....................Aa..",
  "..................@wAa..",
  ".................@wWAa..",
  ".................@wWAa..",
  "..........DDDDDDD...Aa..",
  ".........DdEEEEEEd..Aa..",
  "........DDDdEEEEed..Aa..",
  ".........OmMMMm4....Aa..",
  ".........OmMOmM4....Aa..",
  "........8IimMMm.....Aa..",
  "........8ii8i8i.....Aa..",
  ".......KWwWWWWw.....Aa..",
  "......KWwW@5WWw.....Aa..",
  "......KWwW555WWw....Aa..",
  ".....KWwWW@WWWw.....Aa..",
  ".....KWwWWWWWw......Aa..",
  "....KWwWWWWWw.......Aa..",
  "....KwWWWWWWw.......Aa..",
  "...KWwWWWWWWw.......Aa..",
  "...KwWWWWWWWw.......Aa..",
  "..KWwWWWWWWWw.......Aa..",
  "..KwWWWWWWWWw.......Aa..",
  ".KWwWWWWWWWWw.......05..",
  ".KwWW@WWWWWWWw..........",
  ".OOOOOOOOOOOOOO.........",
];
// 派生待机：光球上下浮 1px + 帽尖摆 + 裙摆微摆
const VERA_IDLE1 = (() => {
  let g = VERA_IDLE0;
  g = shiftRegion(g, 0, 2, 18, 23, 0, -1);        // 光球上浮
  g = shiftRegion(g, 4, 6, 14, 19, 1, 0);         // 帽尖右摆
  return g;
})();
const VERA_IDLE2 = (() => {
  let g = VERA_IDLE0;
  g = shiftRegion(g, 0, 2, 18, 23, 0, -1);        // 光球保持上浮
  g = shiftRegion(g, 21, 26, 0, 15, 1, 0);        // 裙摆右摆
  return g;
})();
const VERA_IDLE3 = (() => {
  let g = VERA_IDLE0;
  g = shiftRegion(g, 0, 2, 18, 23, 0, 1);         // 光球下沉回位
  g = shiftRegion(g, 21, 26, 0, 15, -1, 0);       // 裙摆左摆
  return g;
})();
// 施法 2 帧：光球胀大前移，法杖前指（杆移到 16-17 列）
const VERA_CAST0 = [
  "................@e......",
  "...............@!!e.....",
  "...............@w!e.....",
  "................Aa......",
  ".............@w.Aa......",
  "............@wW.Aa......",
  "...........@wW..Aa......",
  ".........DDDDDD.Aa......",
  "........DdEEEEEdAa......",
  "........DDDdEEedAa......",
  "........OmMMMm4.Aa......",
  "........OmMOmM4.Aa......",
  ".......8IimMMm..Aa......",
  ".......8ii8i8i..Aa......",
  "......KWwWWWWw..Aa......",
  ".....KWwW@5@Ww..Aa......",
  ".....KWwW555Ww..Aa......",
  "....KWwWW@WWWw..Aa......",
  "....KWwWWWWWw...Aa......",
  "...KWwWWWWWw....Aa......",
  "...KwWWWWWWw....Aa......",
  "..KWwWWWWWWw....Aa......",
  "..KwWWWWWWWw....Aa......",
  "..KWwWWWWWWWw...Aa......",
  ".KwWWWWWWWWw....Aa......",
  ".KWwWWWWWWWWw...05......",
  ".KwWW@WWWWWWWw..........",
  ".OOOOOOOOOOOOOO.........",
];
const VERA_CAST1 = [
  "...............@e.......",
  "..............@!!e......",
  "..............@w!!e.....",
  "...............@wFe.....",
  ".............@w.Aa......",
  "............@wW.Aa......",
  "...........@wW..Aa......",
  ".........DDDDDD.Aa......",
  "........DdEEEEEdAa......",
  "........DDDdEEedAa......",
  "........OmMMMm4.Aa......",
  "........OmMOmM4.Aa......",
  ".......8IimMMm..Aa......",
  ".......8ii8i8i..Aa......",
  "......KWwWWWWw..Aa......",
  ".....KWwW@5@Ww..Aa......",
  ".....KWwW555Ww..Aa......",
  "....KWwWW@WWWw..Aa......",
  "....KWwWWWWWw...Aa......",
  "...KWwWWWWWw....Aa......",
  "...KwWWWWWWw....Aa......",
  "..KWwWWWWWWw....Aa......",
  "..KwWWWWWWWw....Aa......",
  "..KWwWWWWWWWw...Aa......",
  ".KwWWWWWWWWw....Aa......",
  ".KWwWWWWWWWWw...05......",
  ".KwWW@WWWWWWWw..........",
  ".OOOOOOOOOOOOOO.........",
];
// 薇拉受击：整体后仰 1px（派生）
const VERA_HURT = (() => {
  let g = VERA_IDLE0;
  g = shiftRegion(g, 0, 20, 0, 23, -1, 0);
  return g;
})();

// ==== 艾琳（24x28，朝右）：兜帽 + 十字权杖 ====
// 兜帽 1-8 / 脸 7-11 / 白袍 12-27；权杖立于身前左手（画面左），顶十字金 + 蓝宝石发光。
const IRENE_IDLE0 = [
  "...5Y5..................",
  "..5YeY5.................",
  "..5e!e5.................",
  "...a0....DDDD...........",
  "...a0...DdEEFd..........",
  "...a0..DdEEEFed.........",
  "...a0..DdEFFFed.........",
  "...a0..DdEOOFOed........",
  "...a0..DdEOmMOed........",
  "...a0...DdmMm4d.........",
  "...a0....Omm4...........",
  "...a0....8I8i...........",
  "...a0...8iIiIi..........",
  "...a0..8iIiIiIi8........",
  "...a0..8i5iIiIi8........",
  "...a0.8iIiIiIiIi8.......",
  "...a0.8iIiIiIiIi8.......",
  "...a0..8iIiIiIi8........",
  "...a0..8iIiIiIi8........",
  "...a0...8iIiIi8.........",
  "...a0...8iIiIi8.........",
  "...a0....8iIi8..........",
  "...a0....8iIi8..........",
  "...a0....8iIi8..........",
  "...a0.....8i8...........",
  "...a0....OiOi...........",
  "...a0....OiOi...........",
  "........OOOOOO..........",
];
// 派生待机：兜帽呼吸 + 宝石闪位
const IRENE_IDLE1 = (() => {
  let g = IRENE_IDLE0;
  g = shiftRegion(g, 1, 11, 6, 23, 0, 1);         // 兜帽+脸下压
  return g;
})();
const IRENE_IDLE2 = (() => {
  let g = IRENE_IDLE0;
  g = shiftRegion(g, 1, 11, 6, 23, 0, 1);
  g = shiftRegion(g, 12, 19, 5, 18, 1, 0);        // 袍身上段右摆
  return g;
})();
const IRENE_IDLE3 = (() => {
  let g = IRENE_IDLE0;
  g = shiftRegion(g, 12, 19, 5, 18, -1, 0);       // 袍身左摆（头复位）
  return g;
})();
// 施法 2 帧：权杖前举，宝石大亮
const IRENE_CAST0 = [
  "....Aa..................",
  "...Aa0..................",
  "...a0...................",
  "...a0...5Y5.............",
  "...a0..Y5e5Y............",
  "...a0..5e!e5............",
  "...a0..Y5e5Y............",
  "...a0...5Y5..DDDD.......",
  "...a0........DdEEFd.....",
  "...a0.......DdEEEFed....",
  "...a0.......DdEFFFed....",
  "...a0.......DdEOOFOed...",
  "...a0.......DdEOmMOed...",
  "...a0........DdmMm4d....",
  "...a0.........Omm4......",
  "...a0........8I8i.......",
  "...a0.......8iIiIi......",
  "...a0......8iIiIiIi8....",
  "...a0......8i5iIiIi8....",
  "...a0.....8iIiIiIi8.....",
  "...a0.....8iIiIiIi8.....",
  "...a0......8iIiIi8......",
  "...a0......8iIiIi8......",
  "...a0.......8iIi8.......",
  "...a0.......8iIi8.......",
  "...a0........8i8........",
  "...a0.......OiOi........",
  "............OOOOOO......",
];
const IRENE_CAST1 = [
  "....Aa..................",
  "...Aa0..................",
  "...a0...5Y5.............",
  "...a0..Y5e5Y............",
  "...a0..5e!e5............",
  "...a0..Y5e5Y............",
  "...a0...5Y5.............",
  "...a0......DDDD.........",
  "...a0.....DdEEFd........",
  "...a0....DdEEEFed.......",
  "...a0....DdEFFFed.......",
  "...a0....DdEOOFOed......",
  "...a0....DdEOmMOed......",
  "...a0.....DdmMm4d.......",
  "...a0......Omm4.........",
  "...a0.....8I8i..........",
  "...a0....8iIiIi.........",
  "...a0...8iIiIiIi8.......",
  "...a0...8i5iIiIi8.......",
  "...a0..8iIiIiIi8........",
  "...a0..8iIiIiIi8........",
  "...a0...8iIiIi8.........",
  "...a0...8iIiIi8.........",
  "...a0....8iIi8..........",
  "...a0....8iIi8..........",
  "...a0.....8i8...........",
  "...a0....OiOi...........",
  "........OOOOOO..........",
];
// 艾琳受击：整体后仰 1px（派生）
const IRENE_HURT = (() => {
  let g = IRENE_IDLE0;
  g = shiftRegion(g, 0, 20, 0, 23, -1, 0);
  return g;
})();

// ==== 凯（24x28，朝右）：双匕首 + 红围巾 ====
// 头 0-7（暗发）+ 围巾 7-13（错拍飘动）/ 躯干 8-20（黑皮甲）/ 双腿 21-27 宽蹲距。
const KAI_IDLE0 = [
  "..........KKKkk.........",
  ".........KkWWk..........",
  "........KkWkkWk.........",
  "........KkWWkkWk........",
  "........KkWkNMMm........",
  "........KkWkMOm4........",
  ".........KkWmmM4........",
  "..33...33OmmmO..........",
  ".3rr3333rrRr............",
  ".3rRRrrRRrR.............",
  "..3rRRrrRRr.............",
  "...33vVuvVu.............",
  "....VvuUuUv.............",
  "....Vvu@Uuv.............",
  "....vUuUUuv.............",
  "....vUuUUuv.zq..........",
  "...MvUUUUuv.zQzq........",
  ".zQ.vUuUUuv.zQ1zq.......",
  ".zQ1vUuUUuv.zQ1zq.......",
  ".zq.vVuvVuv.zQzq........",
  ".z..OVvOVvO..zq.........",
  "....OzqzOzq.............",
  "...Ozqz.Ozqz............",
  "...Ozqz..Ozqz...........",
  "..OcAc....OcAc..........",
  ".OCcAC0..OCcAC0.........",
  ".OOOOOO..OOOOOO.........",
  "........................",
];
// 派生待机：围巾错拍 + 身体呼吸
const KAI_IDLE1 = (() => {
  let g = KAI_IDLE0;
  g = shiftRegion(g, 0, 6, 6, 23, 0, 1);          // 头下压
  g = shiftRegion(g, 7, 12, 0, 9, -1, 0);         // 围巾左飘
  return g;
})();
const KAI_IDLE2 = (() => {
  let g = KAI_IDLE0;
  g = shiftRegion(g, 0, 6, 6, 23, 0, 1);
  g = shiftRegion(g, 7, 12, 0, 9, -2, 0);         // 围巾继续左飘
  return g;
})();
const KAI_IDLE3 = (() => {
  let g = KAI_IDLE0;
  g = shiftRegion(g, 7, 12, 0, 9, 1, 0);          // 围巾右飘（头复位）
  return g;
})();
// 攻击 2 帧：交叉上撩 → 交叉下斩
const KAI_ATK0 = [
  "..........KKKkk.........",
  ".........KkWWk..........",
  "........KkWkkWk.........",
  "........KkWWkkWk........",
  "........KkWkNMMm........",
  "........KkWkMOm4........",
  ".........KkWmmM4........",
  "..33...33OmmmO..........",
  ".3rr3333rrRr............",
  ".3rRRrrRRrR.............",
  "..3rRRrrRRr......zq.....",
  "...33vVuvVu.....zQ1z....",
  "....VvuUuUv....zQ1zq....",
  "....Vvu@Uuv....zQzq.....",
  "....vUuUUuv....zq.......",
  "...MvUUUUuv.............",
  ".zQ.vUuUUuv.............",
  ".zQ1vUuUUuv.............",
  ".zq.vUuUUuv.............",
  ".z..vVuvVuv.............",
  "....OVvOVvO.............",
  "....OzqzOzq.............",
  "...Ozqz.Ozqz............",
  "...Ozqz..Ozqz...........",
  "..OcAc....OcAc..........",
  ".OCcAC0..OCcAC0.........",
  ".OOOOOO..OOOOOO.........",
  "........................",
];
const KAI_ATK1 = [
  "..........KKKkk.........",
  ".........KkWWk..........",
  "........KkWkkWk.........",
  "........KkWWkkWk........",
  "........KkWkNMMm........",
  "........KkWkMOm4........",
  ".........KkWmmM4........",
  "..33...33OmmmO..........",
  ".3rr3333rrRr............",
  ".3rRRrrRRrR.............",
  "..3rRRrrRRr.............",
  "...33vVuvVu.............",
  "....VvuUuUv.zq..........",
  "....Vvu@UuvzQ1z.........",
  ".zQ.vUuUUuv.zQ1zq.......",
  ".zQ1vUUUUuv..zQ1zq......",
  ".zq.vUuUUuv...zQ1zq.....",
  ".z..vUuUUuv....zQzq.....",
  "....vUuUUuv.....zq......",
  "....vVuvVuv.............",
  "....OVvOVvO.............",
  "....OzqzOzq.............",
  "...Ozqz.Ozqz............",
  "...Ozqz..Ozqz...........",
  "..OcAc....OcAc..........",
  ".OCcAC0..OCcAC0.........",
  ".OOOOOO..OOOOOO.........",
  "........................",
];
// 凯受击：整体后仰 1px（派生）
const KAI_HURT = (() => {
  let g = KAI_IDLE0;
  g = shiftRegion(g, 0, 20, 0, 23, -1, 0);
  return g;
})();

// ==== 史莱姆（18x16，朝左）：凝胶穹顶，冷影暖光，内核微光 ====
const SLIME0 = [
  "......LLLLLL......",
  ".....LssSSSl......",
  "....LsSSSSSSl.....",
  "...LsSSSSSSSSl....",
  "..LsOSSOSSSSSl....",
  "..LsOSSOSSSSSSl...",
  ".LsSSSSSSSSSSSl...",
  ".LsSSS66SSSSSSl...",
  ".LsSS6!6SSSSSSl...",
  "LsSSSS66SSSSSSSl..",
  "LsSSSSSSSSSSSSSl..",
  "LsSSSSSSSSSSSSSl..",
  "LlsSSSSSSSSSSSll..",
  ".LllssSSSSSSll....",
  "..LLllssssLL......",
  "...OOOOOOOO.......",
];
const SLIME1 = [
  "..................",
  "..................",
  "....LLLLLLLLLL....",
  "...LssSSSSSSSSl...",
  "..LsOSSOSSSSSSl...",
  ".LsOSSOSSSSSSSSl..",
  ".LsSSS66SSSSSSSl..",
  "LsSSS6!6SSSSSSSSl.",
  "LsSSSSSSSSSSSSSSl.",
  "LsSSSSSSSSSSSSSSl.",
  "LsSSSSSSSSSSSSSSl.",
  "LlsSSSSSSSSSSSSll.",
  ".LllssSSSSSSSll...",
  "..LLllsssssLL.....",
  "...LLllllLL.......",
  "....OOOOOO........",
];
// 派生 4 帧待机：f2/f3 = 各自上浮 1px（凝胶抖动）
const SLIME2 = (() => {
  let g = SLIME0;
  g = shiftRegion(g, 0, 14, 0, 17, 0, -1);
  return g;
})();
const SLIME3 = (() => {
  let g = SLIME1;
  g = shiftRegion(g, 0, 14, 0, 17, 0, -1);
  return g;
})();

// ==== 蝙蝠（22x16，朝左）：绯翼黑体，火瞳 ====
const BAT0 = [
  "OO..................OO",
  "OvO................OvO",
  "OvvO....OOOO......OvvO",
  ".OvvO..OVUUV.....OvvO.",
  ".OvvvOOVuxUVOOvvvO....",
  "..OvvVOVx!xVVOvvO.....",
  "...OvVOVu!xUVVOvO.....",
  "....OVVXx!xXVVO.......",
  ".....OVux!xuVO........",
  "......OVu!uVO.........",
  ".......OVuUVO.........",
  "........OVVO..........",
  ".........OO...........",
  "......O......O........",
  ".......O....O.........",
  "........OOOO..........",
];
const BAT1 = [
  "......................",
  "......................",
  "......OOUUVVOO........",
  ".....OVux!xUVO........",
  "....OVux!xxUVO........",
  "...OVuXX!!XXuVO.......",
  "..OvvOux!!xuOvvO......",
  ".OvvvOVuxxuVOvvvO.....",
  "OvvO..OVUUV..OvvO.....",
  "OvO....OOOO...OvO.....",
  "OO..............OO....",
  "......................",
  "......................",
  "......................",
  "......................",
  "......................",
];
// 派生 4 帧待机：悬浮 1px
const BAT2 = (() => {
  let g = BAT0;
  g = shiftRegion(g, 0, 15, 0, 21, 0, -1);
  return g;
})();
const BAT3 = (() => {
  let g = BAT1;
  g = shiftRegion(g, 0, 15, 0, 21, 0, -1);
  return g;
})();

// ==== 哥布林（16x20，朝左）：绿皮 + 破布腰裙 + 小弯刀 ====
const GOBLIN0 = [
  "..LLLss.........",
  ".LsSSSSl........",
  "LsSSSSSl........",
  "LsOSSOSSl.......",
  "LsOSSOSl........",
  ".LsSSSSl..CC....",
  ".LsSSSSl.CcAc...",
  "..LsSSl..Ca0....",
  "..LsSSl..Ca.....",
  ".vvvVVv..Ca.....",
  "VvuuuUv..Ca.....",
  "VvuxXuv.Ca......",
  ".vuuUv..Ca......",
  "..vuv..Ca.......",
  "..LvS..Ca.......",
  "..LsS.Ca........",
  "..LsS.Ca........",
  "..LlS.Ca........",
  "..Ll..Ca........",
  "..OO..OO........",
];
const GOBLIN1 = [
  "..LLLss.........",
  ".LsSSSSl........",
  "LsSSSSSl........",
  "LsOSSOSSl.......",
  "LsOSSOSl...CC...",
  ".LsSSSSl.CcAc...",
  ".LsSSSSl.Ca0....",
  "..LsSSl..Ca.....",
  "..LsSSl..Ca.....",
  ".vvvVVv.Ca......",
  "VvuuuUv.Ca......",
  "VvuxXuvCa.......",
  ".vuuUv.Ca.......",
  "..vuv.Ca........",
  "..LvS.Ca........",
  "..LsSCa.........",
  "..LsSCa.........",
  "..LlSCa.........",
  "..Ll.Ca.........",
  "..OO.OO.........",
];
const GOBLIN2 = (() => {
  let g = GOBLIN0;
  g = shiftRegion(g, 0, 8, 0, 15, 0, 1);          // 上身下压
  return g;
})();
const GOBLIN3 = (() => {
  let g = GOBLIN1;
  g = shiftRegion(g, 0, 8, 0, 15, 0, 1);
  return g;
})();

// ==== 骷髅（16x20，朝左）：锈剑骨架 ====
const SKELETON0 = [
  "...BII8i........",
  "..BIi8i8........",
  "..BOiOi8........",
  "..BIi8i8........",
  "...BIi8.........",
  "....OiO.........",
  "...B8i8B........",
  "..B8OB8OB.......",
  "...B8i8B........",
  "..B8B8B8........",
  "...B88B..zq.....",
  "..UuBuB..zQzq...",
  ".Uu2uB...zQ1z...",
  ".Uu2uB...zQz....",
  "..UuB...zq......",
  "..UuB...........",
  "..UuB...........",
  "..UuB...........",
  "..8B.8B.........",
  "..OO.OO.........",
];
const SKELETON1 = [
  "....BII8i.......",
  "...BIi8i8.......",
  "...BOiOi8.......",
  "...BIi8i8.......",
  "....BIi8........",
  ".....OiO........",
  "....B8i8B.......",
  "...B8OB8OB......",
  "....B8i8B.......",
  "...B8B8B8.......",
  "....B88B.zq.....",
  "...UuBuBzQzq....",
  "..Uu2uB.zQ1z....",
  "..Uu2uB.zQz.....",
  "...UuB.zq.......",
  "...UuB..........",
  "...UuB..........",
  "...UuB..........",
  "...8B.8B........",
  "...OO.OO........",
];
const SKELETON2 = (() => {
  let g = SKELETON0;
  g = shiftRegion(g, 0, 9, 0, 15, 0, 1);
  return g;
})();
const SKELETON3 = (() => {
  let g = SKELETON1;
  g = shiftRegion(g, 0, 9, 0, 15, 0, 1);
  return g;
})();

// ==== 毒蘑菇（18x16，朝左）：红伞白斑，孢点微光 ====
const MUSHROOM0 = [
  "...JJRRRRJJ.......",
  "..JrRR3RRRrJ......",
  ".JRrRiRRiRRrJ.....",
  ".JrRRRRRRRRrJ.....",
  "JRriRRRRRRiRrJ....",
  "JRrRR3iRRRRRrJ....",
  "JJRrrrrrrrrrRJ....",
  ".OOOOOOOOOOOO.....",
  "..B88i88B.........",
  "..B8OO88B.........",
  "..B8i888B.........",
  "..B8888B..........",
  "..B8888B..........",
  "..BI8I8B..........",
  "..BIiI8B..........",
  "..OOOOOO..........",
];
const MUSHROOM1 = [
  "..................",
  "...JJRRRRJJ.......",
  "..JrRR3RRRrJ......",
  ".JRrRiRRiRRrJ.....",
  ".JRrRRRRRRRrJ.....",
  "JRriRRRRRRiRrJ....",
  "JRrRR3iRRRRRrJ....",
  "JJRrrrrrrrrrRJ....",
  ".OOOOOOOOOOOO.....",
  "..B8OO88B.........",
  "..B8i888B.........",
  "..B8888B..........",
  "..B8888B..........",
  "..BI8I8B..........",
  "..BIiI8B..........",
  "..OOOOOO..........",
];
const MUSHROOM2 = (() => {
  let g = MUSHROOM0;
  g = shiftRegion(g, 0, 7, 0, 17, 0, 1);
  return g;
})();
const MUSHROOM3 = (() => {
  let g = MUSHROOM1;
  g = shiftRegion(g, 0, 8, 0, 17, 0, 1);
  return g;
})();

// ==== 石像鬼（20x18，朝左）：蹲伏石像，火瞳 ====
const GARGOYLE0 = [
  "..PP..........PP....",
  ".PptP........PptP...",
  ".PptT9......O9tP....",
  "..OptTOOOOOOTt9.....",
  "...OptTtTTtTt9......",
  "..OOtTtOOOOtT9......",
  ".PptTtOxXOtT9.......",
  "PptTtTOxxOTt9.......",
  "PptTt9OOOtT9........",
  ".PptTtTtTtT9........",
  "..PptTTtTT9.........",
  "...PPtTtT9..........",
  "....PtOt9...........",
  "....PtO.Pt9.........",
  "...Pt9...Pt9........",
  "...Pt9....PtO.......",
  "..Pt9......Pt9......",
  "..OO........OO......",
];
const GARGOYLE1 = [
  "....................",
  "..PP..........PP....",
  ".PptP........PptP...",
  ".PptT9......O9tP....",
  "..OptTOOOOOOTt9.....",
  "...OptTtTTtTt9......",
  "..OOtTtOOOOtT9......",
  ".PptTtOxXOtT9.......",
  "PptTtTOxxOTt9.......",
  "PptTt9OOOtT9........",
  ".PptTtTtTtT9........",
  "..PptTTtTT9.........",
  "...PPtTtT9..........",
  "....PtOt9...........",
  "....PtO.Pt9.........",
  "...Pt9...Pt9........",
  "..Pt9....Pt9........",
  "..OO......OO........",
];
const GARGOYLE2 = (() => {
  let g = GARGOYLE0;
  g = shiftRegion(g, 0, 11, 0, 19, 0, 1);
  return g;
})();
const GARGOYLE3 = (() => {
  let g = GARGOYLE1;
  g = shiftRegion(g, 0, 11, 0, 19, 0, 1);
  return g;
})();

// ==== 小恶魔（16x20，朝左）：红皮 + 骨角 + 尾巴 ====
const IMP0 = [
  "8O..........O8..",
  "i8O........O8i..",
  ".i8OJJJJJJJO8i..",
  "..iOrrRRRRrOi...",
  "...Or3!RrRrO....",
  "..JOrRrrrrRO....",
  ".JjOrXxRrXxO....",
  ".JjOrOxROxRO....",
  "..JOrrRRrrO.....",
  "...OrrRRrO......",
  "...JrRRrROO.....",
  "...JrRrRrOvO....",
  "....OrROrO.vO...",
  "....OrOrvO..vO..",
  ".....OvOvO...vO.",
  ".....OvOvO....O.",
  ".....OvO.Ov.....",
  "....OvO...Ov....",
  "....OvO.........",
  ".....OO.........",
];
const IMP1 = [
  "8O..........O8..",
  "i8O........O8i..",
  ".i8OJJJJJJJO8i..",
  "..iOrrRRRRrOi...",
  "...Or3!RrRrO....",
  "..JOrRrrrrRO....",
  ".JjOrXxRrXxO....",
  ".JjOrOxROxRO....",
  "..JOrrRRrrO.....",
  "...OrrRRrO......",
  "...JrRRrRO......",
  "...JrRrRrOv.....",
  "....OrROrO.v....",
  "....OrOrvO..v...",
  ".....OvOvO..v...",
  ".....OvOvO...v..",
  ".....OvO.Ov..v..",
  "....OvO...Ovv...",
  "....OvO.....O...",
  ".....OO.........",
];
const IMP2 = (() => {
  let g = IMP0;
  g = shiftRegion(g, 0, 9, 0, 15, 0, 1);
  return g;
})();
const IMP3 = (() => {
  let g = IMP1;
  g = shiftRegion(g, 0, 9, 0, 15, 0, 1);
  return g;
})();

// ==== 幽灵（18x20，朝左）：紫雾 + 下摆分缕 ====
const GHOST0 = [
  ".....KKWWWWk......",
  "....KWww@@Wwk.....",
  "...KWw@@!!@Wwk....",
  "..KWw@O!!O@WWk....",
  "..KWw@O!!O@WWk....",
  ".KWw@@WWWW@WWwk...",
  ".KWw@@@@@@@WWwk...",
  ".KWw@@WWWW@WWwk...",
  ".KWw@@@@@@@@Wwk...",
  "..KWw@@@@@@Wwk....",
  "..KWw@W@@@Wwk.....",
  "..KwW@@@W@wk......",
  "...KwW@W@wk.......",
  "...KwW@@Wwk.......",
  "....KwW@wk........",
  "....KwW@Wk........",
  ".....KwWk.Kw......",
  "......Kw...Kw.....",
  ".......K....K.....",
  "..................",
];
const GHOST1 = [
  ".....KKWWWWk......",
  "....KWww@@Wwk.....",
  "...KWw@@!!@Wwk....",
  "..KWw@O!!O@WWk....",
  "..KWw@O!!O@WWk....",
  ".KWw@@WWWW@WWwk...",
  ".KWw@@@@@@@WWwk...",
  ".KWw@@WWWW@WWwk...",
  ".KWw@@@@@@@@Wwk...",
  "..KWw@@@@@@Wwk....",
  "..KWw@W@@@Wwk.....",
  "..KwW@@@W@wk......",
  "...KwW@Wwk........",
  "...KwW@W@wk.......",
  "....KwW@Wk........",
  "....KwW@wk........",
  ".....KwWk.........",
  "......KwKw........",
  ".......K.K........",
  "..................",
];
const GHOST2 = (() => {
  let g = GHOST0;
  g = shiftRegion(g, 0, 17, 0, 17, 0, -1);
  return g;
})();
const GHOST3 = (() => {
  let g = GHOST1;
  g = shiftRegion(g, 0, 17, 0, 17, 0, -1);
  return g;
})();

// ==== 哥布林王（36x40，朝左）：巨体绿皮 + 金冠 + 铁肩甲 + 石锤 ====
// 发光点：双眼火瞳（X7）、王冠宝石。
const GOBLIN_KING0 = [
  "..........555555....................",
  ".........5yYg5yY55..................",
  ".........5gO!Og5y5..................",
  "........GgyYg5gYygG.................",
  "........Gg5555555gG.................",
  ".......GGgggggggggGG................",
  "......LlsSSSSSSSSSl.................",
  ".....LlsSOSSSOSSSSl........C........",
  "....LlsSOxXSOSSOSSSl........CcA.....",
  "....LsSSOSSOSSSSSSl........Ca0a.....",
  "...LlsSSSSSSSSSSSl........Ca0a......",
  "...LsSSSSSSSSSSSl.........Ca0.......",
  "..LlsSSSSSSSSSSl.......CCa0a........",
  "..LsSSSSSSSSSSl......VCca0a.........",
  ".LlsSSSSSSSSSSl....VVuUCca0a........",
  ".LsSSSSSSSSSSl...VvuU2UCca0.........",
  "LlsSSSSSSSSSSl..VvuuUU2UCa0.........",
  "LsSSSSSSSSSSl..Vvuu2U2U2UCa.........",
  "LsSSSSSSSSSl..VvuU2U2U2U2U..........",
  "LsSSSSSSSSl..VvuU2U2U2U2U...........",
  "LsSSSSSSSSl..vU2U2U2U2U.............",
  ".LsSSSSSSSl..vU2U2U2U2..............",
  ".LsSSSSSSl...vU2U2U2U...............",
  ".LsSSSSSSl...vU2U2U2................",
  "..LsSSSSl....vU2U2U2................",
  "..LsSSSSl....vU2U2U.................",
  "..LsSSSSl....vU2U2U.................",
  "..LlsSSSl....vU2U2U.................",
  "..LlsSSSl....vU2U2U.................",
  "...LlsSSl....vU2U2U.................",
  "...LlsSSl....vU2U2U.................",
  "...LlsSSl....vU2U2U.................",
  "....LlSSl....vU2U2U.................",
  "....LlSSl....vU2U2U.................",
  "....LlSSl....vU2U2U.................",
  "....LlSSl....vU2U2U.................",
  "....LlSSl....vU2U2U.................",
  "....LllSl....vU2U2U.................",
  "....OOOOL....vU2U2U.................",
  ".............OOOOOOO................",
];
// 呼吸派生：头胸下压 1px
const GOBLIN_KING_IDLE1 = (() => {
  let g = GOBLIN_KING0;
  g = shiftRegion(g, 0, 21, 0, 35, 0, 1);
  return g;
})();
// 攻击 2 帧：石锤高举过顶蓄力（锤头提到画面顶）→ 砸地（锤头砸在前下方，躯干前压）
const GOBLIN_KING_ATK0 = [
  "..........555555....................",
  ".........5yYg5yY55..................",
  ".........5gO!Og5y5..................",
  "........GgyYg5gYygG.................",
  "........Gg5555555gG.................",
  ".......GGgggggggggGG................",
  "......LlsSSSSSSSSSl..Ou2O...........",
  ".....LlsSOSSSOSSSSl..Ou2O...........",
  "....LlsSOxXSOSSOSSSl.Ou2O...........",
  "....LsSSOSSOSSSSSSl..Ou2O...........",
  "...LlsSSSSSSSSSSSl...Ou2O...........",
  "...LsSSSSSSSSSSSl....Ou2O...........",
  "..LlsSSSSSSSSSSl.....Ou2O...........",
  "..LsSSSSSSSSSSl......Ou2O...........",
  ".LlsSSSSSSSSSSl.......Ou2O..........",
  ".LsSSSSSSSSSSl........Ou2O..........",
  "LlsSSSSSSSSSSl.......Ou2O...........",
  "LsSSSSSSSSSSl....Ou2O...............",
  "LsSSSSSSSSSl....vUu2O...............",
  "LsSSSSSSSSl.....vUu2................",
  "LsSSSSSSSSl.....vUu2................",
  ".LsSSSSSSSl.....Vvu2................",
  ".LsSSSSSSl.....Vvuu.................",
  ".LsSSSSSSl....Vvu2..................",
  "..LsSSSSl.....Vvu2..................",
  "..LsSSSSl....Vv2....................",
  "..LlsSSSl...V2......................",
  "..LlsSSSl...........................",
  "..LlsSSSl...........................",
  "...LlsSSl...........................",
  "...LlsSSl...........................",
  "...LlsSSl...........................",
  "....LlSSl...........................",
  "....LlSSl...........................",
  "....LlSSl...........................",
  "....LlSSl...........................",
  "....LlSSl...........................",
  "....LllSl...........................",
  "....OOOO............................",
  "....................................",
];
const GOBLIN_KING_ATK1 = [
  "..........555555....................",
  ".........5yYg5yY55..................",
  ".........5gO!Og5y5..................",
  "........GgyYg5gYygG.................",
  "........Gg5555555gG.................",
  ".......GGgggggggggGG................",
  "......LlsSSSSSSSSSl.................",
  ".....LlsSOSSSOSSSSl.................",
  "....LlsSOxXSOSSOSSSl................",
  "....LsSSOSSOSSSSSSl.................",
  "...LlsSSSSSSSSSSSl..................",
  "...LsSSSSSSSSSSSl...................",
  "..LlsSSSSSSSSSSl....................",
  "..LsSSSSSSSSSSl.....................",
  ".LlsSSSSSSSSSSl.....................",
  ".LsSSSSSSSSSSl......................",
  "LlsSSSSSSSSSSl......................",
  "LsSSSSSSSSSSl.......................",
  "LsSSSSSSSSSl........................",
  "LsSSSSSSSSl.vU2.....................",
  "LsSSSSSSSSlVvu2.....................",
  "LsSSSSSSSSVvu2U.....................",
  ".LsSSSSSSSVvu2U2....................",
  ".LsSSSSSSVvu2U2.....................",
  ".LsSSSSSSVu2U2......................",
  "..LsSSSSlvU2U.......................",
  "..LsSSSSlvU2........................",
  "..LlsSSSlvU2........................",
  "..LlsSSSlvU.........................",
  "...LlsSSlvU.........................",
  "...LlSSlvU..........................",
  "....LlSlvU..........................",
  "....LlSla0..........................",
  "CccA0aCa0...........................",
  "CcA0aACa0...........................",
  "CcA0aAC.............................",
  "CcA0aA..............................",
  "CaA0a...............................",
  "OOOOO...............................",
  "....................................",
];

// ==== 骸骨领主（36x40，朝左）：骨白巨骸 + 破紫袍 + 镰刀 ====
const BONE_LORD0 = [
  "....B8i8B.......OqZzZO..............",
  "...B8i!i8B...OQzqZzqZO..............",
  "...B8O!O8B..OqzZqO..................",
  "...B8i8i8B..OqzO......Ca............",
  "....B8i8B....Oz1O.....Ca............",
  ".....OOiO....O1O......Ca............",
  "....B8888B............Ca............",
  "...B8OB8OB............Ca............",
  "....B8i8B.............Ca............",
  "...B8B8B8B............Ca............",
  "....B8888B............Ca............",
  "...B8OB8O8B...........Ca............",
  "..B8i8O8i8B...........Ca............",
  "..B8O888O8B888i.......Ca............",
  "..B8i8O8i8B...8888i..Bia............",
  "...B888888B.......888B8a............",
  "...B8O888OB..KWwWk....Ca............",
  "....B8888B..KWw@@WWk..Ca............",
  "....B8O8B..KWw@@@WWk..Ca............",
  "...B8B8B8B.KWw@@@WWWk.Ca............",
  "...B8O888B.KWw@@@@WWWkCa............",
  "..B8i8O8i8BKWw@@@@@WWkCa............",
  "..B8O888O8BKwW@@@@@WWkCa............",
  "..B8i8O8i8BwW@@@@@@WWkCa............",
  "..B8O888O8BwW@@@@@@WWkCa............",
  "..B8i8O8i8BwW@@@@@@WWkCa............",
  "..B8O888O8B.wW@@@@@WWkCa............",
  "..B888888B..wW@@@@@WWkCa............",
  "...B88888B..wW@@@@WWk.Ca............",
  "...B8B8B8B..wW@@@WWk..Ca............",
  "...B8O8B....wW@@WWk...Ca............",
  "....B88B....wW@WWk....Ca............",
  "....B88B....wW@Wk.....Ca............",
  "....B88B....wWWk......Ca............",
  "....B88B....wWk.......Ca............",
  "....B88B....wWk.......Ca............",
  "....B88B....wWk.......Ca............",
  "....B88B.....Wk.......Ca............",
  "....OOOO.....Ok.......Ca............",
  "....................................",
];
const BONE_LORD1 = (() => {
  let g = BONE_LORD0;
  g = shiftRegion(g, 0, 12, 0, 13, 0, 1);         // 颅骨胸腔呼吸（避开持杆臂）
  return g;
})();
// 攻击 2 帧：镰刀斜举过顶蓄力 → 收割横扫（刃至前下 + 残影弧）
const BONE_LORD_ATK0 = [
  "....B8i8B.............OqZzZzO.......",
  "...B8i!i8B.........OQzqZzZzqO.......",
  "...B8O!O8B........OqzZzZqO.Ca.......",
  "...B8i8i8B........OqzO....Ca........",
  "....B8i8B.........Oz1O..CCa.........",
  ".....OOiO.........O1O..Ca...........",
  "....B8888B............Ca............",
  "...B8OB8OB..........CCa.............",
  "....B8i8B........B8Ca...............",
  "...B8B8B8B......8BCa................",
  "....B8888B....88i.Ca................",
  "...B8OB8O8B.88i...Ca................",
  "..B8i8O8i888i....Ca.................",
  "..B8O888O8B......Ca.................",
  "..B8i8O8i8B.....Ca..................",
  "...B888888B.....Ca..................",
  "...B8O888OB..KWCak..................",
  "....B8888B..KWw@@WWk................",
  "....B8O8B..KWw@@@WWk................",
  "...B8B8B8B.KWw@@@WWWk...............",
  "...B8O888B.KWw@@@@WWWk..............",
  "..B8i8O8i8BKWw@@@@@WWk..............",
  "..B8O888O8BKwW@@@@@WWk..............",
  "..B8i8O8i8BwW@@@@@@WWk..............",
  "..B8O888O8BwW@@@@@@WWk..............",
  "..B8i8O8i8BwW@@@@@@WWk..............",
  "..B8O888O8B.wW@@@@@WWk..............",
  "..B888888B..wW@@@@@WWk..............",
  "...B88888B..wW@@@@WWk...............",
  "...B8B8B8B..wW@@@WWk................",
  "...B8O8B....wW@@WWk.................",
  "....B88B....wW@WWk..................",
  "....B88B....wW@Wk...................",
  "....B88B....wWWk....................",
  "....B88B....wWk.....................",
  "....B88B....wWk.....................",
  "....B88B....wWk.....................",
  "....B88B.....Wk.....................",
  "....OOOO.....Ok.....................",
  "....................................",
];
const BONE_LORD_ATK1 = [
  ".....B8i8B..........................",
  "....B8i!i8B............Aa...........",
  "....B8O!O8B...........Aa............",
  "....B8i8i8B..........Aa.............",
  ".....B8i8B..........Aa..............",
  "......OOiO..........Aa..............",
  ".....B8888B........Aa...............",
  "....B8OB8OB.......Aa................",
  ".....B8i8B.......Aa.................",
  "....B8B8B8B.....Aa..................",
  ".....B8888B....Aa...................",
  "....B8OB8O8B..Aa....................",
  ".i.B8i8O8i888888i...................",
  "...B8O888O8B.Aa.....................",
  "...B8i8O8i8BAa......................",
  "i8..B888888Aa.......................",
  "....B8O888Aa..KWwWk.................",
  ".....B888Aa..KWw@@WWk...............",
  "i....B8OAa..KWw@@@WWk...............",
  "....B8BAa8B.KWw@@@WWWk..............",
  "....B8Aa88B.KWw@@@@WWWk.............",
  "...B8iAa8i8BKWw@@@@@WWk.............",
  "...B8Aa88O8BKwW@@@@@WWk.............",
  "...BAa8O8i8BwW@@@@@@WWk.............",
  "..OQzqO88O8BwW@@@@@@WWk.............",
  ".OQzqZ1O8i8BwW@@@@@@WWk.............",
  ".OqZzZzq1O8B.wW@@@@@WWk.............",
  "..OqZzZqO8B..wW@@@@@WWk.............",
  "...Oqz1O88B..wW@@@@WWk..............",
  "....O1O8B8B..wW@@@WWk...............",
  "....B8O8B....wW@@WWk................",
  ".....B88B....wW@WWk.................",
  ".....B88B....wW@Wk..................",
  ".....B88B....wWWk...................",
  ".....B88B....wWk....................",
  ".....B88B....wWk....................",
  ".....B88B....wWk....................",
  ".....B88B.....Wk....................",
  ".....OOOO.....Ok....................",
  "....................................",
];

// ==== 深渊魔像（36x40，朝左）：巨岩之躯 + 熔核裂缝 ====
const GOLEM0 = [
  "..........PPPTTT9P..................",
  ".........Pt9PPPP9tP.................",
  ".........PtOPPPP9tP.................",
  "..........PPPPTTTP..................",
  ".....PPPPPPPPPPPPPPPPPP.............",
  "...PPptTTt9ppTTt9ppTt9PP............",
  "..PptTt999PPpttt9PPtT99tP...........",
  ".PptT9PptTt9PtT99t9PtT99t9P.........",
  ".Pt99PtT999Ptt9999t9PtT9999P........",
  "Ppt9PtT9999pt999!79t9PtT99999P......",
  "Pt99tT99999pt97!77!79t9999999P......",
  "Ppt9ptT9999pt977!!779t9T99999P......",
  "Pt99tT99999pt97!77!79t9T99999P......",
  "Ppt9PtT9999pt999!79t9Pt999999P......",
  "Ppt9ptT9999ptt9999t9PtT99999P.......",
  ".Pt99PtT999PptT99t9PtT999tP.........",
  ".PptT9PptTt9PtT99t9PtT99tP..........",
  "..PptTt999PPpttt9PPtT99tP...........",
  "..PPptTTt9ppTTt9ppTt9PP.............",
  "....PPPPPPPPPPPPPPPPPP..............",
  "......PPtt99PP.....PPtt99PP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  ".....OPt999tPO....OPt9999tPO........",
  ".....OOOOOOOO......OOOOOOOO.........",
];
const GOLEM1 = (() => {
  let g = GOLEM0;
  g = shiftRegion(g, 0, 3, 0, 35, 0, 1);          // 头部下压
  return g;
})();
// 攻击 2 帧：巨拳高举蓄力（拳面熔纹）→ 重锤砸地（臂前压 + 落点迸焰）
const GOLEM_ATK0 = [
  ".O9tT9O...PPPTTT9P..................",
  "OPtT99tO.Pt9PPPP9tP.................",
  "Pt9T99Xt.PtOPPPP9tP.................",
  "P9tT997t..PPPPTTTP..................",
  "Pt9..PPPPPPPPPPPPPPPPPP.............",
  "Pt9PPptTTt9ppTTt9ppTt9PP............",
  "PtPptTt999PPpttt9PPtT99tP...........",
  ".PptT9PptTt9PtT99t9PtT99t9P.........",
  ".Pt99PtT999Ptt9999t9PtT9999P........",
  "Ppt9PtT9999pt999!79t9PtT99999P......",
  "Pt99tT99999pt97!77!79t9999999P......",
  "Ppt9ptT9999pt977!!779t9T99999P......",
  "Pt99tT99999pt97!77!79t9T99999P......",
  "Ppt9PtT9999pt999!79t9Pt999999P......",
  "Ppt9ptT9999ptt9999t9PtT99999P.......",
  ".Pt99PtT999PptT99t9PtT999tP.........",
  ".PptT9PptTt9PtT99t9PtT99tP..........",
  "..PptTt999PPpttt9PPtT99tP...........",
  "..PPptTTt9ppTTt9ppTt9PP.............",
  "....PPPPPPPPPPPPPPPPPP..............",
  "......PPtt99PP.....PPtt99PP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  ".....OPt999tPO....OPt9999tPO........",
  ".....OOOOOOOO......OOOOOOOO.........",
];
const GOLEM_ATK1 = [
  "..........PPPTTT9P..................",
  ".........Pt9PPPP9tP.................",
  ".........PtOPPPP9tP.................",
  "..........PPPPTTTP..................",
  ".....PPPPPPPPPPPPPPPPPP.............",
  "...PPptTTt9ppTTt9ppTt9PP............",
  "..PptTt999PPpttt9PPtT99tP...........",
  ".PptT9PptTt9PtT99t9PtT99t9P.........",
  ".Pt99PtT999Ptt9999t9PtT9999P........",
  "Ot9OPtT9999pt999!79t9PtT99999P......",
  "Ot9OtT99999pt97!77!79t9999999P......",
  "Ot9OptT9999pt977!!779t9T99999P......",
  "Ot9OtT99999pt97!77!79t9T99999P......",
  "Ot9OPtT9999pt999!79t9Pt999999P......",
  "Ot9OptT9999ptt9999t9PtT99999P.......",
  "O9tT99OT999PptT99t9PtT999tP.........",
  "Pt9TT99ptTt9PtT99t9PtT99tP..........",
  "P9tT9X7999PPpttt9PPtT99tP...........",
  "Pt9T999Tt9ppTTt9ppTt9PP.............",
  "P9t999tPPPPPPPPPPPPPPP..............",
  "OPt99tOPtt99PP.....PPtt99PP.........",
  ".O99tOPt999tP......Pt9999tP.........",
  ".x7!7xPt999tP......Pt9999tP.........",
  "Hx77x.Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  "......Pt999tP......Pt9999tP.........",
  ".....OPt999tPO....OPt9999tPO........",
  ".....OOOOOOOO......OOOOOOOO.........",
];

// ==== 暗影幼龙（36x40，朝左）：紫鳞 + 巨翼 + 影焰 ====
const DRAGON0 = [
  "..................K8iK..............",
  ".................Kk8ikkK.......8i...",
  ".O8i.............Ok8iWkkK......8i...",
  "...8iOB8........Okkk8ikkkK....8i....",
  "....8i.B8.......Okkk8ikkkkK...8i....",
  "....OKKkWWkKO..Okkkk8ikkkWkK.8i.....",
  "...OkWx7!WkkKO.OkkkW8ikkkkkkk8i.....",
  "...OkWx7!WkkKOOkkkkk8ikkWkkk8iK.....",
  "OOkkWWkkWO....OkkkWkk8ikkkkk8ikK....",
  ".8OOOO8OO....Okkkkkkk8iWkkk8ikkkK...",
  "...OkkWWkO...OkkkWkkk8ikkkk8ikkkkK..",
  "........OkWWkOkkkkkkk8ikkk8ikkkkkK..",
  ".........OkWWkOkWkkkk8ikkk8ikkkkkkK.",
  "..........OkWWkOkkkkk8ikk8ikkkkkWkK.",
  "..........OOkWWkOkkkkk8ik8ikkkkkkkK.",
  ".........OkkOkWWkOkkWk8i8ikkkkkWkkK.",
  ".............OkWWkO.OO88i88OkkkkkO..",
  "........OKKkWWkKWkKWkkWKO...........",
  "......OKkWWkKWkkWkWKWkkWKO..........",
  "......OkWWkkWkKWkkWWkKWkKO..........",
  "......OkWkKWkkWWkkWkkWkkWO.........7",
  "......OkkkWWkkWkkWWkkWkkWO........k.",
  "......O9kkWWkkWkkWWkkWkkWO........W7",
  "......O9kWWkkWkkWWkkWkkWkO........kx",
  "......O99kWWkkWkkWWOKKWkkWO.......x7",
  ".......O9wk@w@wk@wOKWWkkWWKO.....kW.",
  ".......Owwk@w@wk@wOKWkkWWkkKO.....kW",
  "........Owk@w@wk@wOKWkkWWkkKO.....kW",
  ".........Owk@w@wk@wOkWkkkkWO......kW",
  "..........OOOOOOOO..OkWkWOkkW.....kW",
  ".......OkWWO.........OkWkWO.kkW..kW.",
  ".......OkWWO.........OkkWO....kkWkW.",
  ".......OkkWO.........Oki8O......kkW.",
  ".......Oki8O.........O8i8O.......kW.",
  ".......O8i8O........O8i88O..........",
  "......O8i88O........O8i888O.........",
  "......O8i88iO......O8i888iO.........",
  ".....8i888i8.......8i888i8..........",
  ".....O88i888i88O..O88i888i88O.......",
  ".....OOOOOOOOOO...OOOOOOOOOO........",
];
// 待机 2 帧：翼下半上扬 + 头部下沉（呼吸）+ 影焰上飘；攻击 2 帧：张口聚焰蓄力 → 影焰吐息
const DRAGON1 = [
  "..................K8iK..............",
  ".................Kk8ikkK.......8i...",
  ".O8i.............Ok8iWkkK......8i...",
  "...8iOB8........Okkk8ikkkK....8i....",
  "....8i.B8.......Okkk8ikkkkK...8i....",
  "...............Okkkk8ikkkWkK.8i.....",
  "....OKKkWWkKO..OkkkW8ikkkkkkk8i.....",
  "...OkWx7!WkkKOOkkkkk8ikkWkkk8iK.....",
  "...OkWx7!WkkKOkkkkkkk8iWkkk8ikkkK...",
  "OOkkWWkkWO...OkkkWkkk8ikkkk8ikkkkK..",
  ".8OOOO8OOO...Okkkkkkk8ikkk8ikkkkkK..",
  "...OkkWWkkWWkOOkWkkkk8ikkk8ikkkkkkK.",
  "..........OkWWkOkkkkk8ikk8ikkkkkWkK.",
  "..........OOkWWkOkkkkk8ik8ikkkkkkkK.",
  ".........OkkOkWWkOkkWk8i8ikkkkkWkkK.",
  ".............OkWWkO.OO88i88OkkkkkO..",
  "....................................",
  "........OKKkWWkKWkKWkkWKO...........",
  "......OKkWWkKWkkWkWKWkkWKO..........",
  "......OkWWkkWkKWkkWWkKWkKO.........7",
  "......OkWkKWkkWWkkWkkWkkWO........k.",
  "......OkkkWWkkWkkWWkkWkkWO........W7",
  "......O9kkWWkkWkkWWkkWkkWO........kx",
  "......O9kWWkkWkkWWkkWkkWkO........x7",
  "......O99kWWkkWkkWWOKKWkkWO......kW.",
  ".......O9wk@w@wk@wOKWWkkWWKO......kW",
  ".......Owwk@w@wk@wOKWkkWWkkKO.......",
  "........Owk@w@wk@wOKWkkWWkkKO.....kW",
  ".........Owk@w@wk@wOkWkkkkWO......kW",
  "..........OOOOOOOO..OkWkWOkkW.....kW",
  ".......OkWWO.........OkWkWO.kkW..kW.",
  ".......OkWWO.........OkkWO....kkWkW.",
  ".......OkkWO.........Oki8O......kkW.",
  ".......Oki8O.........O8i8O.......kW.",
  ".......O8i8O........O8i88O..........",
  "......O8i88O........O8i888O.........",
  "......O8i88iO......O8i888iO.........",
  ".....8i888i8.......8i888i8..........",
  ".....O88i888i88O..O88i888i88O.......",
  ".....OOOOOOOOOO...OOOOOOOOOO........",
];
const DRAGON_ATK0 = [
  "..................K8iK..............",
  "..O8i............Kk8ikkK.......8i...",
  "....8iOB8........Ok8iWkkK......8i...",
  ".....8i.B8......Okkk8ikkkK....8i....",
  ".....OKKkWWkKO..Okkk8ikkkkK...8i....",
  "....OkWx7!WkkKOOkkkk8ikkkWkK.8i.....",
  "....OkWx7!WkkKOOkkkW8ikkkkkkk8i.....",
  ".OOkkWWkkWO...Okkkkk8ikkWkkk8iK.....",
  "..O7!.........OkkkWkk8ikkkkk8ikK....",
  "..x7.........Okkkkkkk8iWkkk8ikkkK...",
  "...OkkWW.....OkkkWkkk8ikkkk8ikkkkK..",
  "........OkWWkOkkkkkkk8ikkk8ikkkkkK..",
  ".........OkWWkOkWkkkk8ikkk8ikkkkkkK.",
  "..........OkWWkOkkkkk8ikk8ikkkkkWkK.",
  "..........OOkWWkOkkkkk8ik8ikkkkkkkK.",
  ".........OkkOkWWkOkkWk8i8ikkkkkWkkK.",
  ".............OkWWkO.OO88i88OkkkkkO..",
  "........OKKkWWkKWkKWkkWKO...........",
  "......OKkWWkKWkkWkWKWkkWKO..........",
  "......OkWWkkWkKWkkWWkKWkKO..........",
  "......OkWkKWkkWWkkWkkWkkWO.........7",
  "......OkkkWWkkWkkWWkkWkkWO........k.",
  "......O9kkWWkkWkkWWkkWkkWO........W7",
  "......O9kWWkkWkkWWkkWkkWkO........kx",
  "......O99kWWkkWkkWWOKKWkkWO.......x7",
  ".......O9wk@w@wk@wOKWWkkWWKO.....kW.",
  ".......Owwk@w@wk@wOKWkkWWkkKO.....kW",
  "........Owk@w@wk@wOKWkkWWkkKO.....kW",
  ".........Owk@w@wk@wOkWkkkkWO......kW",
  "..........OOOOOOOO..OkWkWOkkW.....kW",
  ".......OkWWO.........OkWkWO.kkW..kW.",
  ".......OkWWO.........OkkWO....kkWkW.",
  ".......OkkWO.........Oki8O......kkW.",
  ".......Oki8O.........O8i8O.......kW.",
  ".......O8i8O........O8i88O..........",
  "......O8i88O........O8i888O.........",
  "......O8i88iO......O8i888iO.........",
  ".....8i888i8.......8i888i8..........",
  ".....O88i888i88O..O88i888i88O.......",
  ".....OOOOOOOOOO...OOOOOOOOOO........",
];
const DRAGON_ATK1 = [
  "..................K8iK..............",
  ".................Kk8ikkK.......8i...",
  ".O8i.............Ok8iWkkK......8i...",
  "...8iOB8........Okkk8ikkkK....8i....",
  "....8i.B8.......Okkk8ikkkkK...8i....",
  "....OKKkWWkKO..Okkkk8ikkkWkK.8i.....",
  "...OkWx7!WkkKO.OkkkW8ikkkkkkk8i.....",
  "...OkWx7!WkkKOOkkkkk8ikkWkkk8iK.....",
  "k7!kWWkkWO....OkkkWkk8ikkkkk8ikK....",
  "kx77....O....Okkkkkkk8iWkkk8ikkkK...",
  "kkxx7kWWkO...OkkkWkkk8..............",
  "kkkx7...OkWWkOkkkkkkk8ikkkk8ikkkkK..",
  "Kkkkx....OkWWkOkWkkkk8ikkk8ikkkkkK..",
  "Kkkkk.....OkWWkOkkkkk8ikkk8ikkkkkkK.",
  "Kkkk......OOkWWkOkkkkkikk8ikkkkkWkK.",
  "Kkk......OkkOkWWkOkkWk8ik8ikkkkkkkK.",
  ".............OkWWkO.OO8i8ikkkkkWkkK.",
  "........OKKkWWkKWkKWkk88i88OkkkkkO..",
  "......OKkWWkKWkkWkWKWkkWKO..........",
  "......OkWWkkWkKWkkWWkKWkKO..........",
  "......OkWkKWkkWWkkWkkWkkWO.........7",
  "......OkkkWWkkWkkWWkkWkkWO........k.",
  "......O9kkWWkkWkkWWkkWkkWO........W7",
  "......O9kWWkkWkkWWkkWkkWkO........kx",
  "......O99kWWkkWkkWWOKKWkkWO.......x7",
  ".......O9wk@w@wk@wOKWWkkWWKO.....kW.",
  ".......Owwk@w@wk@wOKWkkWWkkKO.....kW",
  "........Owk@w@wk@wOKWkkWWkkKO.....kW",
  ".........Owk@w@wk@wOkWkkkkWO......kW",
  "..........OOOOOOOO..OkWkWOkkW.....kW",
  ".......OkWWO.........OkWkWO.kkW..kW.",
  ".......OkWWO.........OkkWO....kkWkW.",
  ".......OkkWO.........Oki8O......kkW.",
  ".......Oki8O.........O8i8O.......kW.",
  ".......O8i8O........O8i88O..........",
  "......O8i88O........O8i888O.........",
  "......O8i88iO......O8i888iO.........",
  ".....8i888i8.......8i888i8..........",
  ".....O88i888i88O..O88i888i88O.......",
  ".....OOOOOOOOOO...OOOOOOOOOO........",
];

// ==== 瓷砖：后墙（16x16，暗紫砖 + 冷影 + 稀疏冷高光）====
const WALL = [
  "OOOOOOOOOOOOOOOO",
  "kkKKKKKOKKkKKKKO",
  "KKKKKKKOKKKKvKKO",
  "VvVVVVvOvVvVvVVO",
  "OOOOOOOOOOOOOOOO",
  "kkkOKKKKKKKOKKkK",
  "KKKOKKKKKKKOKKKK",
  "VvVOvVvVvVvOvVvV",
  "OOOOOOOOOOOOOOOO",
  "kkKKKKKOKKkKKKKO",
  "KKKKvKKOKKKKKKKO",
  "VvVVVVvOvVvVvVVO",
  "OOOOOOOOOOOOOOOO",
  "kkkOKKKKKKKOKKkK",
  "KKKOKKKvKKKOKKKK",
  "VvVOvVvVvVvOvVvV",
];
// ==== 瓷砖：墙顶（16x16，石檐受光 + 下方暗墙）====
const WALL_TOP = [
  "OOOOOOOOOOOOOOOO",
  "O9tTTTTTTTTTt9OO",
  "O9tTPPTtttPPPT9O",
  "OPTtt9PPTTTt9999",
  "OPTt9PPTTTPPTttO",
  "O9TTTttt9PPTTt9O",
  "OKKKKKKKKKKKKKKO",
  "OKvKKKKKKKKKKKKO",
  "OKKKKKKKvKKKKKKO",
  "OKvKKKKKKKKKKKKO",
  "OKKKKKKKKKKKKKKO",
  "OKKKKKKvKKKKKKKO",
  "OKvKKKKKKKKKKKKO",
  "OKKKKKKKKKKKKKKO",
  "OKKKKKKKvKKKKKKO",
  "OOOOOOOOOOOOOOOO",
];
// ==== 瓷砖：地面（16x16，暖棕石板：顶缘受光暖、缝隙冷影）====
const FLOOR_MID = [
  "00a0aaaa0aa0a0aa",
  "aAaAAaAaAaAAaAaA",
  "aAacAaAAaAAcAaAa",
  "AAaAaAAaAAaAAaAA",
  "aAaAAaAaAAaAcaAa",
  "AaAAaAAaAAaAaAaA",
  "aAcaaAAaAAaAAaAa",
  "cCcccccccccCcccc",
  "00a0aa0aaaa0aa0a",
  "aAaAAaAaAAaAaAaA",
  "aAcAAaAAaAaAAaAA",
  "AAaAaAAaAaAaAaAa",
  "aAaAAcaaAAaAAaAa",
  "AaAAaAAaAcaaAaAa",
  "aAcaaAAaAAaAAaAa",
  "cCccccccccCccccc",
];
// ==== 瓷砖：地面边缘（16x16，受光石沿：顶部两行强暖光，向下过渡）====
const FLOOR_EDGE = [
  "0000000000000000",
  "0000a0000000a000",
  "aaaaaaaaaaaaaaaa",
  "CcCcCcCcCcCcCcCc",
  "00a0aaaa0aa0a0aa",
  "aAaAAaAaAaAAa0aA",
  "aAacAaAAaAAcAaAa",
  "AAaAaAAaAAaAAaAA",
  "aAaAAaAaAAaAcaAa",
  "cCcccccccccCcccc",
  "00a0aa0aaaa0aa0a",
  "aAaAAaAaAAaAaAaA",
  "aAcAAaAAaAaAAaAA",
  "AAaAaAAaAaAaAaAa",
  "aAaAAcaaAAaAAaAa",
  "cCccccccccCccccc",
];
// ==== 火把壁座（7x12）：碗口在顶部两行，火焰特效原点 ≈ (x, y - h + 1) ====
const TORCH_SCONCE = [
  "..OxO..",
  ".OX7XO.",
  "OtX!XtO",
  "O9ttt9O",
  "OO9t9OO",
  "..O9O..",
  "..OuO..",
  "..OuO..",
  ".O9u9O.",
  ".O9K9O.",
  "OO99OOO",
  "OOOOOOO",
];

// ---------------------------------------------------------------------------
// 5) 编译：网格 → { w, h, data }，hex() | 0xff000000；宽度/未知字符即抛错（模块加载期）。
// ---------------------------------------------------------------------------
const DEFS = {
  hero_idle0: HERO_IDLE0,
  hero_idle1: HERO_IDLE1,
  hero_idle2: HERO_IDLE2,
  hero_idle3: HERO_IDLE3,
  hero_atk0: HERO_ATK0,
  hero_atk1: HERO_ATK1,
  hero_atk2: HERO_ATK2,
  hero_hurt: HERO_HURT,
  vera_idle0: VERA_IDLE0,
  vera_idle1: VERA_IDLE1,
  vera_idle2: VERA_IDLE2,
  vera_idle3: VERA_IDLE3,
  vera_cast0: VERA_CAST0,
  vera_cast1: VERA_CAST1,
  vera_hurt: VERA_HURT,
  irene_idle0: IRENE_IDLE0,
  irene_idle1: IRENE_IDLE1,
  irene_idle2: IRENE_IDLE2,
  irene_idle3: IRENE_IDLE3,
  irene_cast0: IRENE_CAST0,
  irene_cast1: IRENE_CAST1,
  irene_hurt: IRENE_HURT,
  kai_idle0: KAI_IDLE0,
  kai_idle1: KAI_IDLE1,
  kai_idle2: KAI_IDLE2,
  kai_idle3: KAI_IDLE3,
  kai_atk0: KAI_ATK0,
  kai_atk1: KAI_ATK1,
  kai_hurt: KAI_HURT,
  slime0: SLIME0,
  slime1: SLIME1,
  slime2: SLIME2,
  slime3: SLIME3,
  bat0: BAT0,
  bat1: BAT1,
  bat2: BAT2,
  bat3: BAT3,
  goblin0: GOBLIN0,
  goblin1: GOBLIN1,
  goblin2: GOBLIN2,
  goblin3: GOBLIN3,
  skeleton0: SKELETON0,
  skeleton1: SKELETON1,
  skeleton2: SKELETON2,
  skeleton3: SKELETON3,
  mushroom0: MUSHROOM0,
  mushroom1: MUSHROOM1,
  mushroom2: MUSHROOM2,
  mushroom3: MUSHROOM3,
  gargoyle0: GARGOYLE0,
  gargoyle1: GARGOYLE1,
  gargoyle2: GARGOYLE2,
  gargoyle3: GARGOYLE3,
  imp0: IMP0,
  imp1: IMP1,
  imp2: IMP2,
  imp3: IMP3,
  ghost0: GHOST0,
  ghost1: GHOST1,
  ghost2: GHOST2,
  ghost3: GHOST3,
  goblinKing0: GOBLIN_KING0,
  goblinKing1: GOBLIN_KING_IDLE1,
  goblinKing_atk0: GOBLIN_KING_ATK0,
  goblinKing_atk1: GOBLIN_KING_ATK1,
  boneLord0: BONE_LORD0,
  boneLord1: BONE_LORD1,
  boneLord_atk0: BONE_LORD_ATK0,
  boneLord_atk1: BONE_LORD_ATK1,
  golem0: GOLEM0,
  golem1: GOLEM1,
  golem_atk0: GOLEM_ATK0,
  golem_atk1: GOLEM_ATK1,
  dragon0: DRAGON0,
  dragon1: DRAGON1,
  dragon_atk0: DRAGON_ATK0,
  dragon_atk1: DRAGON_ATK1,
  floor_mid: FLOOR_MID,
  floor_edge: FLOOR_EDGE,
  wall: WALL,
  wall_top: WALL_TOP,
  torch_sconce: TORCH_SCONCE,
};

const SPRITES = new Map();

function compile(name, rows, pal = PALETTE) {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint32Array(w * h);
  for (let r = 0; r < h; r++) {
    const row = rows[r];
    if (row.length !== w) throw new Error(`sprites.js: 精灵 "${name}" 第 ${r} 行宽度 ${row.length} != ${w}`);
    for (let q = 0; q < w; q++) {
      const ch = row[q];
      if (ch === "." || ch === " ") continue;
      const hexStr = pal[ch];
      if (hexStr === undefined) throw new Error(`sprites.js: 精灵 "${name}" 用到未定义的调色板字符 "${ch}"`);
      data[r * w + q] = (hex(hexStr) | 0xff000000) >>> 0;
    }
  }
  return { w, h, data, rows };
}

for (const [name, rows] of Object.entries(DEFS)) SPRITES.set(name, compile(name, rows));

// ---------------------------------------------------------------------------
// 6) drawDecor —— 场景装饰（13 种 × ≥2 变体，16x24~24x32，theme 配色）。
//    网格字符约定：O 深轮廓 + 常规 ramp 字符 + 三个可染色槽：
//      $ = 主材质（theme.t1）  % = 次材质（theme.t2）  & = 光点（theme.t3）
//    theme：接受 data.js FLOOR_THEMES 中文名 / 英文别名 / 层号序号(0-7)，缺省用各 decor 原生配色。
//    变体：drawDecor 内部按 x 稳定散列决定（同位置每帧一致，不闪烁）；也可显式传 "bars1"。
// ---------------------------------------------------------------------------
const DECORS = {
  bars: [
    [
      "....UUUUUUUUUU......",
      "....O2u2u2u2O.......",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "...OUUOUUOUUO.......",
      "...OOOOOOOOO........",
      "....................",
    ],
    [
      "....UUUUUUUUUU......",
      "....O2u2uOu2O.......",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou..O........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou..uOu.........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "....Ou.Ou.Ou........",
      "...OUUOUUOOUO.......",
      "...OOOOOOOOOO.......",
      "....................",
    ],
  ],
  webs: [
    [
      "$$$$.$$$.$$$$.$$$$$.",
      ".$...$...$...$....$.",
      "..$..$...$..$....$..",
      "...$$....$.$....$...",
      "$...$. ..$. $..$....",
      ".$.. $..$  $.$......",
      "..$.  $$   $$.......",
      "$...$. $. .$........",
      ".$.. $. $..$........",
      "..$.$. $$..$........",
      "$...$..$.$.$........",
      ".$.$. ..$..$........",
      "..$....$.$.$........",
      ".$..$.$..$.$........",
      "$.$...$.$..$........",
      ".$.$.$..$.$.........",
      "..$.$.$.$.$.........",
      ".$...$.$..$.........",
      "$...$.$. $..........",
      ".$.$.$.$............",
      "..$...$.............",
      ".$.$.$..............",
      "$...$...............",
      ".$.$................",
      "..$.................",
      "....................",
    ],
    [
      "$$$$.$$$$.$$$$.$$$$$",
      ".$...$..$. ..$....$.",
      "..$.$....$.$....$...",
      "...$.....$.$....$...",
      "$...$. ..$. $..$....",
      ".$.. $..$  $.$......",
      "..$.  $$   $$.......",
      "$..........$........",
      ".$..$. $...$........",
      "..$.$. $$..$........",
      "$...$..$.$.$........",
      ".$.$. ..$..$........",
      "..$....$.$.$........",
      ".$..$.$..$.$........",
      "$.$...$.$..$........",
      ".$.$.$..$.$.........",
      "..$.$.$.$.$.........",
      ".$...$.$..$.........",
      "$...$.$. $..........",
      ".$.$.$.$............",
      "..$...$.............",
      ".$.$.$..............",
      "$...$...............",
      ".$.$................",
      "..$.................",
      "....................",
    ],
  ],
  lavaCracks: [
    [
      "..........PPPP........",
      ".......PPPppppPPP.....",
      ".....PPpp&x&pppPPP....",
      "....Ppp&7!7&x&pppP....",
      "...Ppp&x!7x&x&ppppP...",
      "..PPpp&x7x!x7&ppppPP..",
      ".PPppp&x&x7x&pppppPP..",
      ".Ppppp&x&x&pppppppPP..",
      "PPpppppp&pppppppppPP..",
      "PpppppppppppppppppPP..",
      "PpppppppppppppppppPP..",
      "PppPpppppppppppPppPP..",
      "PppPPppppppppPPpppPP..",
      ".PppPPpppppPPppppPP...",
      ".PPppPPPppPPppppPP....",
      "..PPPpppPPpppPPP......",
      "...PPPPpppPPPPP.......",
      "....PPPPPPPPPP........",
      ".....PPPPPPPP.........",
      "......PPPPPP..........",
      ".......PPPP...........",
      "........PP............",
      "......................",
      "......................",
    ],
    [
      "..........PPPP........",
      ".......PPPppppPPP.....",
      ".....PPpp&&x&pppPPP...",
      "....Ppp&7!77&&pppP....",
      "...Ppp&x!77x&x&ppppP..",
      "..PPpp&x7x!!x7&ppppPP.",
      ".PPppp&x&x7x!&&ppppPP.",
      ".Ppppp&x&x!&pppppppPP.",
      "PPpppppp&pppp&ppppPP..",
      "Pppppppppppp&pppppPP..",
      "PpppppppppppppppppPP..",
      "PppPpppppppppppPppPP..",
      "PppPPppppppppPPpppPP..",
      ".PppPPpppppPPppppPP...",
      ".PPppPPPppPPppppPP....",
      "..PPPpppPPpppPPP......",
      "...PPPPpppPPPPP.......",
      "....PPPPPPPPPP........",
      ".....PPPPPPPP.........",
      "......PPPPPP..........",
      ".......PPPP...........",
      "........PP............",
      "......................",
      "......................",
    ],
  ],
  icicles: [
    [
      "....9t9............",
      "...9tT9...9t9......",
      "..9tTT9..9tT9......",
      ".9tTTT9.9tTT9......",
      ".9tT!T9.9tTT9.9t9..",
      "9tTTeT9.9tT!T9.t9..",
      "9tTTT99tTTT!T9.....",
      "9tTTe9tTTTeT9......",
      ".9tT99tTTTT9.......",
      ".9tTe9tTT99........",
      "..9t9.9tT9.........",
      "..9t9..9t9.........",
      "...99..9t9.........",
      "...9e...99.........",
      "....9...9e.........",
      "........9..........",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
    ],
    [
      "....9t9............",
      "...9tT9...9t9......",
      "..9tTT9..9tT9..9t..",
      ".9tTTT9.9tTT9..t9..",
      ".9tT!T9.9tTT9.9t9..",
      "9tTTeT9.9tT!T9.t9..",
      "9tTTT99tTTT!T9.....",
      "9tTTe9tTTTeT9..9...",
      ".9tT99tTTTT9...9...",
      ".9tTe9tTT99....9...",
      "..9t9.9tT9.....9...",
      "..9t9..9t9.....9...",
      "...99..9t9.....e...",
      "...9e...99.....9...",
      "....9...9e.........",
      "........9..........",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
    ],
  ],
  pillars: [
    [
      "....9tttttt9........",
      "...9tT99999t9.......",
      "...Ot9pppp9tO.......",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "...Ott9tt9ttO.......",
      "..Ott9tttt9ttO......",
      "..OOOOOOOOOOOO......",
      "....................",
      "....................",
      "....................",
      "....................",
    ],
    [
      "....9tttttt9........",
      "...9tT99999t9.......",
      "...Ot9pppp9tO.......",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "....Ot9tt9tO........",
      "...Ott9tt9ttO.......",
      "..OttTt9tTttO.......",
      "..Ot9tTt9t9tO.......",
      ".Ott9Ttt9TttO.......",
      ".Ot9ttTt9ttTO.......",
      "Ott9ttttttt9tO......",
      "OOOOOOOOOOOOOO......",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
    ],
  ],
  crystals: [
    [
      "........@..........",
      ".......@w@.........",
      "......@wW@.........",
      "......@wW@..@......",
      ".....@wW@..@w@.....",
      ".....@wW@.@wW@.....",
      "....@wW@.@wW@......",
      "....@wW@@wW@.......",
      "...@wW@.@wW@.......",
      "...@wW@@wW@........",
      "..@wW@.@wW@........",
      "..@wW@@wW@.........",
      ".@wW@.@wW@.........",
      ".@wW@@wW@..........",
      "@wW@.@wW@..........",
      "@wW@@wW@...........",
      "KkW@.@w@...........",
      "KkWWKkW@...........",
      "KkkKKkkW...........",
      "KKkKKKkk...........",
      "OOOOOOOO...........",
      "...................",
      "...................",
      "...................",
      "...................",
      "...................",
    ],
    [
      "...................",
      "........@..........",
      ".......@w@.........",
      "......@wW@.........",
      "......@wW@..@......",
      ".....@wW@.@w@......",
      ".....@wW@.@wW@.....",
      "....@wW@.@wW@......",
      "....@wW@@wW@.......",
      "...@wW@.@wW@.......",
      "...@wW@@wW@........",
      "..@wW@.@wW@........",
      "..@wW@@wW@.........",
      ".@wW@.@wW@.........",
      ".@wW@@wW@..........",
      "@wW@.@wW@..........",
      "@wW@@wW@...........",
      "KkW@.@w@...........",
      "KkWWKkW@...........",
      "KkkKKkkW...........",
      "KKkKKKkk...........",
      "OOOOOOOO...........",
      "...................",
      "...................",
      "...................",
      "...................",
    ],
  ],
  roots: [
    [
      "CC..................",
      "CcC.................",
      ".CcCC...............",
      "..CcAC..............",
      "..CaACC.............",
      "...CaACCC...........",
      "....CaAcACC.........",
      ".....CcCaACC........",
      "...CC..CcCaAC.......",
      "..CcCC...CcAC.......",
      ".CcAAAC...CaC.......",
      "..CaAACC..CaCC......",
      "...CaAACCCCaAC......",
      "....CcACaACaAC......",
      "......CCCaCCAC......",
      ".........CCaC.......",
      "..........CC........",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
    ],
    [
      "..........CC........",
      ".........CcCC.......",
      "........CcAAC.......",
      ".......CcAACC.......",
      "......CcCaACC.......",
      "......CcCaAC........",
      ".....CcCaAC.........",
      "....CcCaACC.........",
      "....CcCaAC..........",
      "...CcCaACC..........",
      "...CcCaAC...........",
      "..CcCaACC...........",
      "..CcCaAC............",
      ".CcCaACC............",
      ".CcCaAC.............",
      "CcCaACC.............",
      "CcCaAC..............",
      "CcAC................",
      "CC..................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
    ],
  ],
  bones: [
    [
      "....8i88............",
      "...8i!!i8...........",
      "...8iO!Oi8..........",
      "...8i88i8...........",
      "....8i8i............",
      ".....OO.............",
      "...88...8i8.........",
      "..8ii8.8ii88........",
      ".8i88i88i88i8.......",
      ".8i8.8i88.8i8.......",
      "..8...8i8...8.......",
      "......8i8...........",
      "....8i8i88..........",
      "...8i88i8i8.........",
      "...8i8.8i8i.........",
      "....8...8i8.........",
      "........8i8.........",
      ".........8..........",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
    ],
    [
      "....................",
      "....8i88............",
      "...8i!!i8...........",
      "...8iO!Oi8..........",
      "...8i88i8...........",
      "....8i8i............",
      ".....OO.............",
      "...88...8i8.........",
      "..8ii8.8ii88........",
      ".8i88i88i88i8.......",
      ".8i8.8i88.8i8.......",
      "..8...8i8...8.......",
      "......8i8...........",
      "....8i8i88..........",
      "...8i88i8i8..8i8....",
      "...8i8.8i8i...88....",
      "....8...8i8.........",
      "........8i8.........",
      ".........8..........",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
    ],
  ],
  chains: [
    [
      "...UUUU...",
      "...O22O...",
      "...Ou2O...",
      "....OO....",
      "...Ou2O...",
      "...O22O...",
      "....OO....",
      "...Ou2O...",
      "...O22O...",
      "....OO....",
      "...Ou2O...",
      "...O22O...",
      "....OO....",
      "...Ou2O...",
      "...O22O...",
      "....OO....",
      "...Ou2O...",
      "...O22O...",
      "....OO....",
      "...Ou2O...",
      "...O22O...",
      "....OO....",
      "...Ou2O...",
      "..O2222O..",
      "..O2!!2O..",
      "..O2222O..",
      "...OOOO...",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
    ],
    [
      "...UUUU...",
      "...O22O...",
      "...Ou2O...",
      "....OO....",
      "...Ou2O...",
      "...O22O...",
      "....OO....",
      "...Ou2O...",
      "...O22O...",
      "....OO....",
      "...Ou2O...",
      "...O22O...",
      "...Ou2O...",
      "....OO....",
      "...O22O...",
      "...Ou2O...",
      "....OO....",
      "...O22O...",
      "...Ou2O...",
      "....OO....",
      "..O2222O..",
      "..O2!!2O..",
      "..O2222O..",
      "...OOOO...",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
    ],
  ],
  braziers: [
    [
      ".......xX7........",
      "......X7!7X.......",
      "......x7!7x.......",
      ".....HXx!xXH......",
      ".....HHx77xHH.....",
      "....HHHXxXHHH.....",
      "....uUUUUUUu......",
      "....uU2222Uu......",
      "....Ou2222uO......",
      ".....Ou22uO.......",
      "......Ou2O........",
      "......Ou2O........",
      ".....Ou22uO.......",
      ".....Ou22uO.......",
      "....Ou2222uO......",
      "....Ou2222uO......",
      "...Ou22222uO......",
      "...OU22222UO......",
      "..OUU22222UUO.....",
      "..OOOOOOOOOOO.....",
      "..................",
      "..................",
      "..................",
      "..................",
      "..................",
      "..................",
      "..................",
      "..................",
    ],
    [
      ".......xX7........",
      "......X7!7X.......",
      "......x7!7x.......",
      ".....HXx!xXH......",
      ".....HHx77xHH.....",
      "....HHHXxXHHH.....",
      "....uUUUUUUu......",
      "....uU2222Uu......",
      "....Ou2222uO......",
      ".....Ou22uO.......",
      "......Ou2O........",
      "......Ou2O........",
      "......Ou2O........",
      "......Ou2O........",
      "......Ou2O........",
      "......Ou2O........",
      "......Ou2O........",
      "......Ou2O........",
      ".....OU22UO.......",
     "....OUU22UUO......",
      "....OOOOOOO.......",
      "..................",
      "..................",
      "..................",
      "..................",
      "..................",
      "..................",
      "..................",
    ],
  ],
  embers: [
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "....7!7.........",
      "...H7!7H........",
      "..HhxXxhH.......",
      ".HHhxxxXhHH.....",
      "HHhhxxxXxhHHH...",
      "HHHhhxxxxhHHHH..",
      "OOOOhhhhOOOOOO..",
      "OOOOOOOOOOOOOO..",
      "................",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "..7!....7!......",
      ".H7!7..H7!7H....",
      "..HhxXxhxXhH....",
      ".HHhxxxXxxhHH...",
      "HHhhxxxXxXhHHH..",
      "HHHhhxxxxxhHHHH.",
      "OOOOhhhhhhOOOOO.",
      "OOOOOOOOOOOOOO..",
      "................",
      "................",
      "................",
      "................",
    ],
  ],
  rubble: [
    [
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "........9tt9........",
      ".......9tT999.......",
      "......9tT99Tt9......",
      ".....9tT99TTtt9.....",
      "....9tT99TTt9tT9....",
      "...9tT99TTt99tTT9...",
      "..9tT99TTt9999tT99..",
      ".9tT99TTt99TT9tT999.",
      "9tT99TTt99TT999tT99P",
      "OOOOOOOOOOOOOOOOOOOO",
      "....................",
      "....................",
    ],
    [
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....9tt9............",
      "...9tT999...........",
      "..9tT99Tt9..........",
      ".9tT99TTtt9.........",
      "9tT99TTt9tT9........",
      "9t99TTt999tTT9......",
      "9t9TTt99999tT99.....",
      "9tTTt99TT999tT999...",
      "9tt999TT99999tT99P..",
      "OOOOOOOOOOOOOOOOOO..",
      "....................",
      "....................",
    ],
  ],
  lava: [
    [
      // 地面熔池：壳岩板块浮在熔面上，熔面炽白热点（theme: $壳岩 %熔岩 &炽热）
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "......OOOOOOOO......",
      "....OO%%%%&&%%%OO...",
      "...O%%&&7&%%&&%%%%O.",
      "..O%&&7!7&&&%%%&&%%O",
      "..O%&7!!7&7&&%&&%%%O",
      ".O%&&77&&7&&&&%%&%%O",
      ".O$$&7&7&&$%%&&&%%%O",
      ".O$$&&77&$$$$%&$%%%O",
      ".O$$$&&7$$$$$$%$$$$O",
      "..O$$$$$&%$$$$$$$$$O",
      "..OO$$$$$$%$%$$$$%OO",
      "...OOOOOOOOOOOOOOO..",
      "....................",
    ],
    [
      // 裂隙熔池：更宽浅的熔潭 + 壳岩碎岛（地面用，lava 属 FLOOR_ONLY）
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "....................",
      "......OOOOOOOOO.....",
      "...OO%%&&&&%%%OO....",
      "..O%&77!7&&&%%%%O...",
      ".O%&7!77&&&%$%%%&O..",
      ".O$&77&&&$%%&%%&$O..",
      ".O$$&7&$$$$$%$%$$O..",
      ".O$$$&7$$%$$$%$$$O..",
      "..O$$$$$%$$%$$$O....",
      "..OO$$%$%$%$%%OO....",
      "...OOOOOOOOOOOO.....",
    ],
  ],
};

// decor 原生配色：$ 主材质 / % 次材质 / & 光点
const DECOR_TINTS = {
  bars: ["#3e3c5c", "#262438", "#9a97c2"],
  webs: ["#d6cabc", "#776f7e", "#e2f8ff"],
  lavaCracks: ["#262438", "#7e2408", "#ffc94e"],
  icicles: ["#a8d4f0", "#1c3a5e", "#e2f8ff"],
  pillars: ["#76748e", "#2e2c40", "#b0aec6"],
  crystals: ["#7457b0", "#2a1c4e", "#fff3dc"],
  roots: ["#4e3410", "#2c5426", "#a8e07e"],
  bones: ["#d6cabc", "#4a4458", "#b39ae8"],
  chains: ["#5f5d8a", "#262438", "#9a97c2"],
  braziers: ["#3e3c5c", "#b8440e", "#ffc94e"],
  embers: ["#4a1408", "#ef7d1a", "#ffc94e"],
  rubble: ["#76748e", "#2e2c40", "#b0aec6"],
  lava: ["#262438", "#7e2408", "#ffc94e"],
};

// 主题配色（键 = data.js FLOOR_THEMES 中文名 + 英文别名）；值 = [t1, t2, t3]
const THEME_TINTS = {
  荒废地窖: ["#5a4128", "#38294e", "#a86e30"], cellar: ["#5a4128", "#38294e", "#a86e30"],
  蛛巢回廊: ["#d6cabc", "#4a4458", "#8d9cc0"], web: ["#d6cabc", "#4a4458", "#8d9cc0"],
  潮湿墓穴: ["#776f7e", "#1e4a28", "#63b04a"], tomb: ["#776f7e", "#1e4a28", "#63b04a"],
  腐沼洞窟: ["#2c5426", "#4e3410", "#a8e07e"], marsh: ["#2c5426", "#4e3410", "#a8e07e"],
  骸骨大厅: ["#d6cabc", "#4a4458", "#b39ae8"], bone: ["#d6cabc", "#4a4458", "#b39ae8"],
  熔岩隧道: ["#262438", "#7e2408", "#ffc94e"], lava: ["#262438", "#7e2408", "#ffc94e"],
  冰霜监牢: ["#a8d4f0", "#1c3a5e", "#e2f8ff"], frost: ["#a8d4f0", "#1c3a5e", "#e2f8ff"],
  暗影圣所: ["#3e3c5c", "#170f2a", "#b39ae8"], shadow: ["#3e3c5c", "#170f2a", "#b39ae8"],
};

/** 解析 theme 参数：FLOOR_THEMES 中文名 / 英文别名 / 序号(0-7)。未知返回 null（用原生配色）。 */
function themeKeyOf(theme) {
  if (theme == null) return null;
  if (typeof theme === "number") {
    const NAMES = ["荒废地窖", "蛛巢回廊", "潮湿墓穴", "腐沼洞窟", "骸骨大厅", "熔岩隧道", "冰霜监牢", "暗影圣所"];
    return NAMES[theme] ?? null;
  }
  const s = String(theme);
  if (THEME_TINTS[s]) return s;
  // data.js 层名带「·Boss」后缀：先去掉再匹配
  const base = s.split("·")[0];
  return THEME_TINTS[base] ? base : null;
}

const DECOR_CACHE = new Map();
function compileDecor(key, variant, tKey) {
  const ck = `${key}|${variant}|${tKey ?? ""}`;
  let s = DECOR_CACHE.get(ck);
  if (s) return s;
  const rows = DECORS[key][variant];
  const t = (tKey ? THEME_TINTS[tKey] : DECOR_TINTS[key]);
  const pal = { ...PALETTE, $: t[0], "%": t[1], "&": t[2] };
  s = compile(`decor:${key}${variant}`, rows, pal);
  DECOR_CACHE.set(ck, s);
  return s;
}

export const DECOR_KEYS = Object.keys(DECORS);

/** 稳定散列：同 (x) 每次返回同一变体，不闪烁。 */
function hashVariant(x, n) {
  const v = Math.abs(Math.round(Number(x) || 0));
  return ((v * 2654435761) >>> 16) % n;
}

/**
 * 画装饰精灵。锚点与 drawSprite 一致 = 底边中心（吊挂类如 icicles/chains/webs
 * 请传吊挂物底端所在 y）。theme 可选；opts 可选 { variant, alpha, flip, shadow:false }。
 * @returns true=已绘制，false=未知 key
 */
export function drawDecor(frame, key, x, y, theme, opts = {}) {
  const base = String(key).replace(/\d+$/, "");
  let variant;
  if (DECORS[key]) {
    variant = opts.variant ?? hashVariant(x, DECORS[key].length);
  } else if (DECORS[base]) {
    variant = Math.min(DECORS[base].length - 1, Math.max(0, Number(String(key).match(/\d+$/)?.[0] ?? 0)));
  } else {
    if (!warned.has(`decor:${key}`)) {
      warned.add(`decor:${key}`);
      console.warn(`sprites.js: 未知装饰 key "${key}"`);
    }
    return false;
  }
  const sprite = compileDecor(base, variant, themeKeyOf(theme));
  return blitSprite(frame, sprite, x, y, opts, /*noShadowDefault*/ true);
}

// ---------------------------------------------------------------------------
// 7) 导出锚点 / 动画序列 / 全部帧 id
// ---------------------------------------------------------------------------
export const SPRITE_ANCHOR = {
  hero: [24, 28],
  vera: [24, 28],
  irene: [24, 28],
  kai: [24, 28],
  slime: [18, 16],
  bat: [22, 16],
  goblin: [16, 20],
  skeleton: [16, 20],
  mushroom: [18, 16],
  gargoyle: [20, 18],
  imp: [16, 20],
  ghost: [18, 20],
  goblinKing: [36, 40],
  boneLord: [36, 40],
  golem: [36, 40],
  dragon: [36, 40],
  floor_mid: [16, 16],
  floor_edge: [16, 16],
  wall: [16, 16],
  wall_top: [16, 16],
  torch_sconce: [7, 12],
};

export const SPRITE_ANIM = {
  heroIdle: ["hero_idle0", "hero_idle1", "hero_idle2", "hero_idle3"],
  heroAtk: ["hero_atk0", "hero_atk1", "hero_atk2"],       // V1 键保留（现 3 帧）
  heroAttack: ["hero_atk0", "hero_atk1", "hero_atk2"],
  heroHurt: ["hero_hurt"],
  veraIdle: ["vera_idle0", "vera_idle1", "vera_idle2", "vera_idle3"],
  veraCast: ["vera_cast0", "vera_cast1"],
  veraHurt: ["vera_hurt"],
  ireneIdle: ["irene_idle0", "irene_idle1", "irene_idle2", "irene_idle3"],
  ireneCast: ["irene_cast0", "irene_cast1"],
  ireneHurt: ["irene_hurt"],
  kaiIdle: ["kai_idle0", "kai_idle1", "kai_idle2", "kai_idle3"],
  kaiAttack: ["kai_atk0", "kai_atk1"],
  kaiHurt: ["kai_hurt"],
  slime: ["slime0", "slime1", "slime2", "slime3"],
  bat: ["bat0", "bat1", "bat2", "bat3"],
  goblin: ["goblin0", "goblin1", "goblin2", "goblin3"],
  skeleton: ["skeleton0", "skeleton1", "skeleton2", "skeleton3"],
  mushroom: ["mushroom0", "mushroom1", "mushroom2", "mushroom3"],
  gargoyle: ["gargoyle0", "gargoyle1", "gargoyle2", "gargoyle3"],
  imp: ["imp0", "imp1", "imp2", "imp3"],
  ghost: ["ghost0", "ghost1", "ghost2", "ghost3"],
  goblinKing: ["goblinKing0", "goblinKing1"],
  goblinKingIdle: ["goblinKing0", "goblinKing1"],
  goblinKingAtk: ["goblinKing_atk0", "goblinKing_atk1"],
  boneLord: ["boneLord0", "boneLord1"],
  boneLordIdle: ["boneLord0", "boneLord1"],
  boneLordAtk: ["boneLord_atk0", "boneLord_atk1"],
  golem: ["golem0", "golem1"],
  golemIdle: ["golem0", "golem1"],
  golemAtk: ["golem_atk0", "golem_atk1"],
  dragon: ["dragon0", "dragon1"],
  dragonIdle: ["dragon0", "dragon1"],
  dragonAtk: ["dragon_atk0", "dragon_atk1"],
};

// resolve() 兜底用：类名 → 待机序列（"vera" → veraIdle 首帧）
for (const base of ["hero", "vera", "irene", "kai"]) SPRITE_ANIM[base] = SPRITE_ANIM[`${base}Idle`];

// 所有帧 id（含瓷砖，不含惰性编译的 decor）
export const SPRITE_IDS = [...SPRITES.keys()];

// 瓷砖 id：不画脚底投影
const TILE_IDS = new Set(["floor_mid", "floor_edge", "wall", "wall_top", "torch_sconce"]);

// ---------------------------------------------------------------------------
// 8) drawSprite —— 兼容 V1 签名，新增脚底接触投影。
// ---------------------------------------------------------------------------
const warned = new Set();
/** 解析 id：精确帧名 → 去掉帧号 → 动画类首帧。返回 sprite 或 null。 */
function resolve(id) {
  let s = SPRITES.get(id);
  if (s) return s;
  const cls = String(id).replace(/\d+$/, "");
  s = SPRITES.get(cls);
  if (s) return s;
  const anim = SPRITE_ANIM[String(id).replace(/_.*/, "")];
  if (anim) return SPRITES.get(anim[0]) || null;
  return null;
}

// 与 pixelfx painter 相同的 4x4 Bayer 阈值（有序抖动淡出）
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 单像素 alpha 混合（dst 必须不透明 ABGR）。 */
function blend(dst, src, t) {
  const dr = dst & 255, dg = (dst >>> 8) & 255, db = (dst >>> 16) & 255;
  const sr = src & 255, sg = (src >>> 8) & 255, sb = (src >>> 16) & 255;
  const r = Math.round(dr + (sr - dr) * t);
  const g = Math.round(dg + (sg - dg) * t);
  const b = Math.round(db + (sb - db) * t);
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

const SHADOW_COLOR = hex("#0b0a14");

/** 脚底接触投影：椭圆 2~3 行，宽随精灵宽；只混不透明底（主流程底图恒为预渲染瓷砖）。 */
function drawShadow(frame, x, y, w, alpha) {
  const fw = frame.w, fh = frame.h;
  const ox = frame.ox | 0, oy = frame.oy | 0;
  const C = frame.color;
  const rows = w >= 30
    ? [[y, w, 0.9], [y + 1, Math.round(w * 0.8), 0.6], [y + 2, Math.round(w * 0.45), 0.3]]
    : [[y, w, 1], [y + 1, Math.round(w * 0.7), 0.55]];
  for (const [ry, rw, k] of rows) {
    const sy = ry - oy;
    if (sy < 0 || sy >= fh) continue;
    const ew = Math.max(4, Math.round(rw * k));
    const left = Math.round(x) - (ew >> 1) - ox;
    for (let q = 0; q < ew; q++) {
      const sx = left + q;
      if (sx < 0 || sx >= fw) continue;
      const i = sy * fw + sx;
      const dst = C[i];
      if (dst === 0) continue; // 透明底不投影（无底图场景不产生脏像素）
      C[i] = blend(dst, SHADOW_COLOR, alpha * k);
    }
  }
}

/** 把已编译精灵写入帧缓冲（drawSprite / drawDecor 共用主体）。 */
function blitSprite(frame, sprite, x, y, opts, noShadowDefault = false) {
  const { w, h, data } = sprite;
  const a = clamp01(opts.alpha ?? 1);
  if (a <= 0) return true;
  const wantShadow = opts.shadow !== undefined ? !!opts.shadow : !noShadowDefault; // 默认：角色投影 / 瓷砖与 decor 不投影
  const fw = frame.w, fh = frame.h;
  const ox = frame.ox | 0, oy = frame.oy | 0;
  const C = frame.color;
  const left = Math.round(x) - (w >> 1);
  const top = Math.round(y) - h + 1;
  const flip = !!opts.flip;
  const dithered = a < 1;
  if (wantShadow && a > 0) drawShadow(frame, x, y, w, 0.3 * a);
  for (let row = 0; row < h; row++) {
    const sy = top + row - oy;
    if (sy < 0 || sy >= fh) continue;
    for (let col = 0; col < w; col++) {
      const c = data[row * w + col];
      if (!c) continue;
      const sx = left + (flip ? w - 1 - col : col) - ox;
      if (sx < 0 || sx >= fw) continue;
      if (dithered && a < BAYER[((sy & 3) << 2) | (sx & 3)]) continue;
      C[sy * fw + sx] = c;
    }
  }
  return true;
}

/**
 * 把精灵逐像素写入 pixelfx 帧缓冲（锚点 = 脚底中心）。
 * @param frame  pixelfx 帧：{ w, h, ox?, oy?, color: Uint32Array, light? }
 * @param id     帧 id（"hero_idle0" / "slime1" / "wall"…），也接受动画类名（取首帧）
 * @param x,y    脚底中心坐标
 * @param opts   { flip:false, alpha:1, shadow }；shadow 缺省 = 角色开投影、瓷砖关
 * @returns      true=已绘制，false=未知 id（console.warn 一次，挂机游戏不崩）
 */
export function drawSprite(frame, id, x, y, opts = {}) {
  const sprite = resolve(id);
  if (!sprite) {
    if (!warned.has(id)) {
      warned.add(id);
      console.warn(`sprites.js: 未知精灵 id "${id}"`);
    }
    return false;
  }
  return blitSprite(frame, sprite, x, y, opts, TILE_IDS.has(String(id)));
}

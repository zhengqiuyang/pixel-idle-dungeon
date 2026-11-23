// ============================================================================
// 《勇者闯地下城》V2.0 · js/themes.js —— 楼层视觉主题（纯数据模块）
//
// 契约：
//   export const FLOOR_THEMES  8 套主题对象（荒废地窖/蛛巢回廊/熔岩隧道/
//                              冰霜监牢/暗影圣所/腐烂苗床/雷霆囚笼/余烬王座）
//   export function themeForFloor(floor)  每 5 层轮换一套，循环
//
// 注意：data.js 另有一个同名字符串数组 FLOOR_THEMES（floorName 的层名），
// 两处名字不共享——本文件的 8 个主题名以 V2.0 任务书为准；data.js 归他人维护，
// 此处不改它。轮换节奏用 BALANCE.BOSS_EVERY（=5），与 data.js floorName 的
// (ceil(f/5)-1) % len 索引完全一致，保证「层名」与「配色主题」永不错位。
//
// 每套主题字段（调用方只读，勿原地改）：
//   name      主题名
//   bg        画面最底色（暗，接近黑）
//   wall      后墙砖色          wallTop  墙檐/砖顶高光色
//   floor     地面砖色          floorEdge 地沿色
//   accent    主题点缀色（UI 描边/装饰物主色）
//   glow      发光色（火把/水晶/熔岩等光源，亮而饱和）
//   decor     装饰物键数组（2-3 个，取值限定：
//             "bars"|"webs"|"lavaCracks"|"icicles"|"pillars"|"crystals"|
//             "roots"|"bones"|"chains"|"braziers"|"embers"|"rubble"|"lava"）
//   fogColor  前景雾/暗角色（叠在画面边缘向该色渐隐）
//
// 8 套色相反差设计：暖棕 → 幽绿 → 炽红 → 冰蓝 → 暗紫 → 腐绿 → 电紫 → 余烬金橙。
// 颜色一律 hex 字符串 "#rrggbb"；pixelfx 侧需要 Uint32 时用 core 的 hex() 转换。
// ============================================================================

import { BALANCE } from "./data.js";

export const FLOOR_THEMES = [
  {
    name: "荒废地窖",                 // 暖棕：旧木、锈铁、塌落的瓦砾
    bg: "#1a120b",
    wall: "#3d2b1e",
    wallTop: "#5a4028",
    floor: "#2c2016",
    floorEdge: "#4a3626",
    accent: "#8a5a33",
    glow: "#e0a35c",
    decor: ["roots", "rubble"],
    fogColor: "#2b1c10",
  },
  {
    name: "蛛巢回廊",                 // 幽绿：蛛丝反光、累累白骨
    bg: "#0a140d",
    wall: "#1e3325",
    wallTop: "#2f4d38",
    floor: "#16261b",
    floorEdge: "#253c2b",
    accent: "#3f6a4c",
    glow: "#7ee08a",
    decor: ["webs", "bones"],
    fogColor: "#0e2117",
  },
  {
    name: "熔岩隧道",                 // 炽红：熔岩池与发光裂隙
    bg: "#1c0906",
    wall: "#4a1f18",
    wallTop: "#6e2f22",
    floor: "#33140f",
    floorEdge: "#55241a",
    accent: "#a13a26",
    glow: "#ff7a3a",
    decor: ["lava", "lavaCracks"],
    fogColor: "#2a0c07",
  },
  {
    name: "冰霜监牢",                 // 冰蓝：冰锥悬顶、铁栅结霜
    bg: "#0a111e",
    wall: "#1d3450",
    wallTop: "#2d4d72",
    floor: "#142338",
    floorEdge: "#223a57",
    accent: "#3f70a5",
    glow: "#a5ddff",
    decor: ["icicles", "bars"],
    fogColor: "#0d1a2a",
  },
  {
    name: "暗影圣所",                 // 暗紫：祭祀列柱、幽幽烛火
    bg: "#0e0a17",
    wall: "#251b3d",
    wallTop: "#372a58",
    floor: "#1a1226",
    floorEdge: "#2b2145",
    accent: "#513e80",
    glow: "#b18cff",
    decor: ["pillars", "braziers"],
    fogColor: "#130d20",
  },
  {
    name: "腐烂苗床",                 // 腐绿：疯长根须、病荧光晶
    bg: "#0e1407",
    wall: "#2a3714",
    wallTop: "#3e4f1f",
    floor: "#1c250c",
    floorEdge: "#2f3c17",
    accent: "#5a742c",
    glow: "#b8e34d",
    decor: ["roots", "crystals"],
    fogColor: "#151d0a",
  },
  {
    name: "雷霆囚笼",                 // 电紫：囚笼铁栅、悬链导电
    bg: "#0c0c19",
    wall: "#232048",
    wallTop: "#343067",
    floor: "#171430",
    floorEdge: "#262249",
    accent: "#534bbd",
    glow: "#f4e879",
    decor: ["bars", "chains"],
    fogColor: "#100f24",
  },
  {
    name: "余烬王座",                 // 余烬金橙：飘散火星、鎏金列柱
    bg: "#150c05",
    wall: "#3b2511",
    wallTop: "#583a1a",
    floor: "#251708",
    floorEdge: "#3f2a13",
    accent: "#9d6622",
    glow: "#ffb347",
    decor: ["embers", "pillars"],
    fogColor: "#1f1308",
  },
];

/**
 * 楼层 → 主题：每 5 层（BALANCE.BOSS_EVERY，与 data.js floorName 同节奏）
 * 轮换一套，循环取用。层 1-5 → 主题 0（荒废地窖），6-10 → 主题 1 …… 周而复始。
 * floor 非法（NaN/≤0）按第 1 层处理。返回 FLOOR_THEMES 中的对象（只读引用）。
 */
export function themeForFloor(floor) {
  const f = Math.max(1, Math.floor(Number(floor) || 1));
  const idx = (Math.ceil(f / BALANCE.BOSS_EVERY) - 1) % FLOOR_THEMES.length;
  return FLOOR_THEMES[idx];
}

// ============================================================================
// 《勇者闯地下城》(pixel-idle-dungeon) · js/data.js
// 全部游戏数值与随机规则 —— 项目唯一数据源。
// logic.js / ui.js / 绘制层只从这里取数，不自带任何平衡数值。
// ----------------------------------------------------------------------------
// 【下游集成约定】
//  1) crit(暴击率) / aspd(攻速加成) 一律用「百分点」表示：
//     crit:5 = 5%，aspd:8 = 攻速 +8%（即 ×1.08）。
//     暴击率(0~1 小数) = 总百分点 / 100，总上限 CRIT_CAP = 50；
//     攻速倍率(次/秒) = 1 + 总百分点 / 100，总上限 ASPD_CAP = 3.0。
//     上限对「基础 + 升级 + 装备」合计生效。
//  2) 英雄最终属性 =
//     HERO_BASE + LEVEL_BONUS × (等级-1) + UPGRADES[i].per × 已购级数 + 装备 stats。
//     英雄每次击杀回满血、升级回满血（表现由 logic 层处理）。
//  3) 概率判定（暴击、掉落）统一用 0~1 小数，见 BALANCE.DROP_CHANCE。
//  4) 怪物/Boss 的 sprite id 与 MOB_ROSTER / BOSS_ROSTER 的 id 一致（绘制层照 id 画）。
//  5) 伤害公式在 rollDamage()：max(1, atk×(0.9~1.1) − 目标def)，暴击再 ×1.5。
//  6) 装备副词条（M3）：item.affixes = [{key, value}]，key 与 relics.js 的 mod
//     键同一词汇（lifestealPct/critDmgPct/thornsPct/cdrPct/goldPct，另加
//     poisonDmgPct/bleedDmgPct 细分持续伤害），value 一律 0~1 小数
//     （0.08 = +8%），与遗物/天赋词条同语义、可直接相加汇总。
//     条数：稀有 1 条、史诗 2 条、传说 3 条，同件装备内不重复。
//  7) 传说暗金（M3）：rollItem 传说品质按 BALANCE.UNIQUE_CHANCE(12%) 产出暗金，
//     item 增加 uniqueId（= narrative.UNIQUE_FLAVOR 的键）与 uniqueDesc（对应
//     风味小字），随机副词条被暗金固有 hooks 取代（affixes = []）。战斗层用
//     uniqueById(item.uniqueId).hooks 按 {on, effect, value} 触发，语义见
//     UNIQUES 段注释。
//  8) 精英怪（M3）：floor ≥ BALANCE.ELITE_FLOOR 起小怪按 ELITE_CHANCE 概率
//     精英化：hp×ELITE_HP_MULT、gold×ELITE_GOLD_MULT（xp/掉落不受影响），
//     怪物对象带 isElite=true、tags=["精英"]（展示字符串，与 combat 层
//     monster.tags 同语义，可直接并入 HUD）、name 加「精英·」前缀；Boss 不精英化。
// ============================================================================

import { UNIQUE_FLAVOR } from "./narrative.js"; // 暗金风味小字唯一文案源（narrative.js 零依赖，无环）

// ---------------------------------------------------------------------------
// 全局常量（存档 / 节奏 / 战斗规则）
// ---------------------------------------------------------------------------
export const SAVE_KEY = "pixel-idle-dungeon-v1";

export const BALANCE = {
  SAVE_INTERVAL_MS: 5000,       // 自动存档间隔（另有 beforeunload / visibilitychange 兜底）
  MONSTERS_PER_FLOOR: 10,       // 每层小怪数，杀满进下一层
  BOSS_EVERY: 5,                // 每 5 层一个 Boss 层（floor % 5 === 0）
  BOSS_TIME_LIMIT: 30,          // Boss 战倒计时（秒），超时退回上一层重刷
  BOSS_HP_MULT: 6,              // Boss 血量倍率
  BOSS_GOLD_MULT: 2,            // Boss 金币倍率
  BOSS_XP_MULT: 3,              // Boss 经验倍率（规格未指定，微调：防 Boss 层升级断档）
  NEXT_MONSTER_DELAY: 1.0,      // 击杀后下一只怪物入场延迟（秒）
  MONSTER_ATTACK_INTERVAL: 1.2, // 怪物攻击间隔（秒/次）
  HERO_REVIVE_DELAY: 3.0,       // 英雄阵亡后满血复活（秒），期间当前怪物血量回满
  DROP_CHANCE: 0.12,            // 普通击杀掉装备概率（Boss 必掉，见 rollItem）
  OFFLINE_DROP_CAP: 10,         // 离线结算随机掉落上限（件）
  CRIT_MULT: 1.5,               // 暴击伤害倍率
  ATK_VARIANCE: 0.2,            // 攻击浮动幅度：atk × (1 ± 0.1)
  OFFLINE_MIN_AWAY: 60,         // lastSaved 距今超过 60 秒才结算离线收益
  OFFLINE_CAP_SEC: 28800,       // 离线结算时长上限（8 小时）

  // ---- M3 刷宝：精英怪 ----
  // combat.js 此前自带同参兜底判定（ELITE_MIN_FLOOR=15/ELITE_CHANCE=0.2），
  // 精英化改由本文件 monsterFor 统一产出后，战斗层应改为消费 data.isElite/tags，
  // 不再自行掷点（否则双重加成：hp×4、gold×9）。
  ELITE_FLOOR: 15,              // 达到此层后小怪按概率精英化（Boss 不吃精英）
  ELITE_CHANCE: 0.2,            // 精英概率（与 combat.js 旧兜底常量一致）
  ELITE_HP_MULT: 2,             // 精英血量倍率
  ELITE_GOLD_MULT: 3,           // 精英金币倍率（xp / 掉落判定不受影响）

  // ---- M3 刷宝：传说暗金 ----
  UNIQUE_CHANCE: 0.12,          // 传说品质产出暗金的概率（替换普通传说的随机副词条）
  UNIQUE_STAT_MULT: 6,          // 暗金属性倍率：UNIQUES.baseStats = 部位基准 × 此值（高于传说 4.5）
  UNIQUE_VALUE_MULT: 3,         // 暗金售价倍率（基准仍取传说档 RARITY_VALUE[3]）
};

export const CRIT_CAP = 50;   // 暴击率总上限（百分点，含基础/升级/装备）
export const ASPD_CAP = 3.0;  // 攻速倍率总上限（次/秒）

// ---------------------------------------------------------------------------
// 英雄：基础属性、等级成长、金币升级
// ---------------------------------------------------------------------------
export const HERO_BASE = { atk: 10, maxHp: 100, def: 5, aspd: 1.0, crit: 5 }; // crit:百分点
export const LEVEL_BONUS = { atk: 1, maxHp: 10, def: 0.5 }; // 每升 1 级的成长，升后回满血

/** 升到下一级所需经验：round(20 × 1.4^(level-1)) */
export function xpNeeded(level) {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  return Math.round(20 * Math.pow(1.4, lv - 1));
}

// 金币升级（无限级）：成本 round(baseCost × growth^已购级数)。
// per：每级增量（atk/hp/def 为扁平值；crit/aspd 为百分点）。
// cap：该属性的总上限（crit=总暴击百分点 50；aspd=总攻速倍率 3.0），null=无上限。
export const UPGRADES = [
  { id: "atk",  name: "攻击力", desc: "+2 攻击",    baseCost: 10, growth: 1.15, per: 2,   cap: null },
  { id: "hp",   name: "生命值", desc: "+20 生命",   baseCost: 10, growth: 1.15, per: 20,  cap: null },
  { id: "def",  name: "防御力", desc: "+1 防御",    baseCost: 12, growth: 1.15, per: 1,   cap: null },
  { id: "crit", name: "暴击率", desc: "+0.5% 暴击", baseCost: 15, growth: 1.15, per: 0.5, cap: CRIT_CAP },
  { id: "aspd", name: "攻速",   desc: "+2% 攻速",   baseCost: 20, growth: 1.15, per: 2,   cap: ASPD_CAP },
];

/** 第 level 级（已购 level 次）之后的下一次升级价格 */
export function upgradeCost(u, level) {
  const lv = Math.max(0, Math.floor(Number(level) || 0));
  return Math.round(u.baseCost * Math.pow(u.growth, lv));
}

// ---------------------------------------------------------------------------
// 怪物名册（sprite id 与绘制层一致）
// ---------------------------------------------------------------------------
export const MOB_ROSTER = [
  { id: "slime",    name: "史莱姆",   sprite: "slime"    },
  { id: "bat",      name: "蝙蝠",     sprite: "bat"      },
  { id: "goblin",   name: "哥布林",   sprite: "goblin"   },
  { id: "skeleton", name: "骷髅",     sprite: "skeleton" },
  { id: "mushroom", name: "毒蘑菇",   sprite: "mushroom" },
  { id: "gargoyle", name: "石像鬼",   sprite: "gargoyle" },
  { id: "imp",      name: "小恶魔",   sprite: "imp"      },
  { id: "ghost",    name: "幽灵",     sprite: "ghost"    },
];

export const BOSS_ROSTER = [
  { id: "goblinKing", name: "哥布林王",   sprite: "goblinKing" },
  { id: "boneLord",   name: "骸骨领主",   sprite: "boneLord"   },
  { id: "golem",      name: "深渊魔像",   sprite: "golem"      },
  { id: "dragon",     name: "暗影幼龙",   sprite: "dragon"     },
];

/** 绘制层需要准备的全部怪物像素图 id */
export const ALL_SPRITE_IDS = [...MOB_ROSTER, ...BOSS_ROSTER].map((m) => m.sprite);

/**
 * 指定层、序号的怪物数据。
 * index 0..9：每层 10 只小怪按名册循环（层号参与偏移，各层开局怪不同）。
 * floor % 5 === 0 为 Boss 层：index 0 即 Boss（血 ×6、金 ×2、经验 ×3），
 * Boss 层其余 index 仍按小怪规则返回（正常流程只会用到 index 0）。
 * 精英（M3）：floor ≥ ELITE_FLOOR 的小怪按 ELITE_CHANCE 概率精英化——
 * hp×2、gold×3（xp/掉落不变），isElite=true、tags=["精英"]、name 加前缀；
 * 所有产物恒带 isElite/tags 字段（Boss 恒 false/[]），下游按 tags 展示特性。
 */
export function monsterFor(floor, index) {
  const f = Math.max(1, Math.floor(Number(floor) || 1));
  const per = BALANCE.MONSTERS_PER_FLOOR;
  const i = ((Math.floor(Number(index) || 0) % per) + per) % per;
  const base = {
    hp:   Math.round(30 * Math.pow(1.35, f - 1)),
    atk:  Math.round(6 * Math.pow(1.28, f - 1)),
    def:  f * 0.5,
    gold: Math.round(8 * Math.pow(1.30, f - 1)),
    xp:   Math.round(6 * Math.pow(1.30, f - 1)),
  };
  if (f % BALANCE.BOSS_EVERY === 0 && i === 0) {
    const boss = BOSS_ROSTER[(Math.floor(f / BALANCE.BOSS_EVERY) - 1) % BOSS_ROSTER.length];
    return {
      id: boss.id, name: boss.name, sprite: boss.sprite,
      hp: base.hp * BALANCE.BOSS_HP_MULT,
      atk: base.atk,
      def: base.def,
      gold: base.gold * BALANCE.BOSS_GOLD_MULT,
      xp: base.xp * BALANCE.BOSS_XP_MULT,
      isBoss: true,
      isElite: false, // Boss 不吃精英（防血×2 打穿 Boss 倒计时）
      tags: [],
    };
  }
  const mob = MOB_ROSTER[(f - 1 + i) % MOB_ROSTER.length];
  const m = { id: mob.id, name: mob.name, sprite: mob.sprite, ...base, isBoss: false, isElite: false, tags: [] };
  if (f >= BALANCE.ELITE_FLOOR && Math.random() < BALANCE.ELITE_CHANCE) {
    m.isElite = true;
    m.tags = ["精英"]; // 展示字符串，与 combat 层 monster.tags 同语义
    m.name = "精英·" + m.name;
    m.hp = Math.round(m.hp * BALANCE.ELITE_HP_MULT);
    m.gold = Math.round(m.gold * BALANCE.ELITE_GOLD_MULT);
  }
  return m;
}

// ---------------------------------------------------------------------------
// 层名：每 5 层一个主题循环；Boss 层加「·Boss」后缀（与 themes.js 1:1 对齐）
// ---------------------------------------------------------------------------
export const FLOOR_THEMES = [
  "荒废地窖", "蛛巢回廊", "熔岩隧道", "冰霜监牢",
  "暗影圣所", "腐烂苗床", "雷霆囚笼", "余烬王座",
];

export function floorName(floor) {
  const f = Math.max(1, Math.floor(Number(floor) || 1));
  const theme = FLOOR_THEMES[(Math.ceil(f / BALANCE.BOSS_EVERY) - 1) % FLOOR_THEMES.length];
  return f % BALANCE.BOSS_EVERY === 0 ? theme + "·Boss" : theme;
}

// ---------------------------------------------------------------------------
// 装备：4 部位 × 4 品质；普通杀 12% 掉落，Boss 必掉且至少史诗（史诗:传说 = 10:2）
// stats 约定：atk/hp/def 为扁平值；crit/aspd 为百分点（crit 2.5 = +2.5%）
// ---------------------------------------------------------------------------
export const SLOT_NAMES = { weapon: "武器", head: "头盔", armor: "护甲", trinket: "饰品" };
export const RARITY_NAMES = ["普通", "稀有", "史诗", "传说"];

export const RARITY_WEIGHTS   = [60, 28, 10, 2];    // 品质权重（%）
export const RARITY_STAT_MULT = [1, 1.6, 2.6, 4.5]; // 品质属性倍率
export const RARITY_VALUE     = [4, 10, 24, 70];    // 售价基准（再乘层数缩放与单件浮动）

const ITEM_FLOOR_GROWTH         = 1.22; // 属性层数缩放
const ITEM_TRINKET_FLOOR_GROWTH = 1.12; // 暴击/攻速成长较慢（这两种属性有总上限）
const ITEM_VALUE_FLOOR_GROWTH   = 1.25; // 售价层数缩放（略低于金币增速 1.30，防贬值过快）

const SLOT_KEYS = ["weapon", "head", "armor", "trinket"];
const SLOT_BASE = {
  weapon:  { atk: 2 },
  head:    { hp: 8 },
  armor:   { def: 1 },
  trinket: { crit: 1.2, aspd: 2.5 },
};

const ITEM_NAMES = {
  weapon:  ["铁剑", "精钢长剑", "淬火之刃", "屠龙利刃"],
  head:    ["布帽", "硬皮盔", "骑士头盔", "龙骨冠"],
  armor:   ["粗布甲", "硬皮甲", "秘银锁甲", "圣龙铠"],
  trinket: ["木戒指", "银护符", "月光吊坠", "贤者之石"],
};

let uidSeq = 0;
function makeUid() {
  uidSeq = (uidSeq + 1) % 0xffff;
  return (
    Date.now().toString(36) + "-" +
    uidSeq.toString(36).padStart(4, "0") + "-" +
    Math.random().toString(36).slice(2, 7)
  );
}

/** 品质判定：普通小怪按 60/28/10/2；Boss 至少史诗（10:2 抽传说） */
export function rollRarity(isBoss) {
  if (isBoss) return Math.random() < 2 / 12 ? 3 : 2;
  const roll = Math.random() * 100;
  let acc = 0;
  for (let i = 0; i < RARITY_WEIGHTS.length; i++) {
    acc += RARITY_WEIGHTS[i];
    if (roll < acc) return i;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// 装备副词条池（M3 刷宝）：稀有 1 条 / 史诗 2 条 / 传说 3 条，同件不重复。
// key 与 relics.js 的 mod 键同一词汇，可与遗物/天赋词条直接相加汇总；
// value 一律 0~1 小数（0.08 = +8%，见 relics.js 集成约定 1）。
// min/max 按词条强度平衡，全部落在 3%~12% 区间（越通用越强上限越低）。
// 毒伤/流血为 dotDmgPct 的细分（结算时与 dotDmgPct 同乘区叠加）。
// ---------------------------------------------------------------------------
export const AFFIXES = [
  { key: "lifestealPct", name: "吸血",     min: 0.03, max: 0.08 },
  { key: "critDmgPct",   name: "暴击伤害", min: 0.05, max: 0.12 },
  { key: "thornsPct",    name: "反伤",     min: 0.03, max: 0.1  },
  { key: "cdrPct",       name: "冷却缩减", min: 0.03, max: 0.08 },
  { key: "poisonDmgPct", name: "毒伤",     min: 0.05, max: 0.12 },
  { key: "bleedDmgPct",  name: "流血伤害", min: 0.05, max: 0.12 },
  { key: "goldPct",      name: "金币加成", min: 0.05, max: 0.12 },
];

/** 品质 → 副词条条数：普通 0 / 稀有 1 / 史诗 2 / 传说 3（暗金固定 0，见 UNIQUES） */
export const RARITY_AFFIX_COUNT = [0, 1, 2, 3];

/** 随机抽取 rarity 对应条数的不重复副词条；value 四舍五入到百分点（0.06 = 6%） */
export function rollAffixes(rarity) {
  const idx = Math.max(0, Math.min(RARITY_AFFIX_COUNT.length - 1, Math.floor(Number(rarity) || 0)));
  const pool = AFFIXES.slice();
  const out = [];
  for (let n = RARITY_AFFIX_COUNT[idx]; n > 0 && pool.length > 0; n--) {
    const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const lo = Math.min(a.min, a.max);
    const hi = Math.max(a.min, a.max);
    out.push({ key: a.key, value: Math.round((lo + Math.random() * (hi - lo)) * 100) / 100 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 传说暗金（M3 刷宝）：12 件，id 与 narrative.UNIQUE_FLAVOR 的键完全一致
// （ui.js flavorOf 按 item.uniqueId → UNIQUE_FLAVOR 渲染暗金风味小字与微光）。
// baseStats 为第 1 层口径的固定基准（= 部位基准 × UNIQUE_STAT_MULT(6)，高于
// 传说 4.5）；rollItem 落地时按层数缩放（武器/防具 ITEM_FLOOR_GROWTH、饰品
// ITEM_TRINKET_FLOOR_GROWTH）且无随机浮动 —— 同名暗金同层数值恒定。
//
// hooks 触发契约（战斗层按此实现；均为装备持有者=英雄视角）：
//   on 触发时机：
//     crit       英雄暴击时            onHit    英雄每次命中怪物时
//     onHurt     英雄每次受击时        onKill   英雄击杀怪物时
//     onHpLoss10 每累计损失 10% 最大生命的档位（受伤叠档、治疗回落）
//     onDeath    英雄受到致命伤时      passive  常驻属性/统计
//   effect 效果与 value 单位（value 一律小数，秒/次数除外）：
//     chainLightning  闪电链真伤 = value × 攻击力（0.6 = 60%）
//     lightningOnHit  落雷伤害 = value × 攻击力；可选 chance = 触发概率（小数）
//     lifesteal       攻击吸血比例（0.08 = 8%）
//     berserkOnHpLoss 每档攻速 +value 百分点（0.12 = +12%），随已损生命档位增减
//     partyCdrOnCrit  全队伙伴技能冷却 -value 秒（0.6 = 0.6 秒）
//     reflect         反弹所受伤害的 value 比例（0.25 = 25%）
//     shieldOnCrit    暴击获得 value × 最大生命的护盾（0.05 = 5%）
//     burnOnHit       点燃：每秒 value × 攻击力，持续 dur 秒
//     bleedTouch      叠加流血：每层每秒 value × 攻击力，至多 stack 层
//     execute         对生命低于 threshold 比例的目标伤害 +value（0.5 = +50%）
//     goldPct         金币获取 +value（与 relics 的 goldPct 同语义；0.4 = +40%）
//     goldOnKill      击杀额外金币 = 怪物金币 × value（0.5 = +50%）
//     chillOnCrit     暴击冰冻：目标缓速 value 比例（0.3 = 30%），持续 dur 秒
//     critDmg         暴击伤害 +value（0.6 = +60%）
//     hpCostOnCrit    每次暴击自损 value × 最大生命（0.02 = 2%）
//     cheatDeath      致命伤时原地满血复活 value 次（每场 Boss 战限 1 次，战斗层计数）
// ---------------------------------------------------------------------------
export const UNIQUES = [
  {
    id: "thunderDawn", name: "雷霆破晓", slot: "weapon",
    baseStats: { atk: 12 },
    hooks: [
      { on: "crit", effect: "chainLightning", value: 0.6 }, // 暴击召闪电链：60% 攻击力真实伤害
    ],
  },
  {
    id: "bloodOath", name: "鲜血誓约", slot: "armor",
    baseStats: { def: 6 },
    hooks: [
      { on: "onHpLoss10", effect: "berserkOnHpLoss", value: 0.12 }, // 每损 10% 生命：攻速 +12%
      { on: "passive", effect: "lifesteal", value: 0.08 },          // 攻击 8% 吸血
    ],
  },
  {
    id: "emberCommander", name: "余烬指挥官之印", slot: "trinket",
    baseStats: { crit: 7.2, aspd: 15 },
    hooks: [
      { on: "crit", effect: "partyCdrOnCrit", value: 0.6 }, // 暴击时全队伙伴技能 CD -0.6 秒
    ],
  },
  {
    id: "stormBrand", name: "风暴烙印", slot: "weapon",
    baseStats: { atk: 12 },
    hooks: [
      { on: "onHit", effect: "lightningOnHit", value: 1.2, chance: 0.3 }, // 攻击 30% 几率落雷：120% 攻击力伤害
    ],
  },
  {
    id: "voidThirst", name: "虚空之渴", slot: "weapon",
    baseStats: { atk: 12 },
    hooks: [
      { on: "passive", effect: "lifesteal", value: 0.12 },               // 吸血 12%
      { on: "passive", effect: "execute", value: 0.5, threshold: 0.15 }, // 对生命低于 15% 的目标伤害 +50%
    ],
  },
  {
    id: "basiliskScale", name: "石化蜥鳞", slot: "armor",
    baseStats: { def: 6 },
    hooks: [
      { on: "onHurt", effect: "reflect", value: 0.25 },    // 反伤：反弹所受伤害的 25%
      { on: "crit", effect: "shieldOnCrit", value: 0.05 }, // 暴击获得 5% 最大生命的护盾
    ],
  },
  {
    id: "cinderHeart", name: "余烬之心", slot: "armor",
    baseStats: { def: 6 },
    hooks: [
      { on: "onHit", effect: "burnOnHit", value: 0.2, dur: 5 }, // 攻击点燃：每秒 20% 攻击力，持续 5 秒
    ],
  },
  {
    id: "executionerScythe", name: "处刑者之镰", slot: "weapon",
    baseStats: { atk: 12 },
    hooks: [
      { on: "onHit", effect: "bleedTouch", value: 0.08, stack: 5 },     // 攻击叠流血：每层每秒 8% 攻击力，至多 5 层
      { on: "passive", effect: "execute", value: 0.5, threshold: 0.2 }, // 斩杀加成：对生命低于 20% 的目标伤害 +50%
    ],
  },
  {
    id: "merchantsLedger", name: "商人的账本", slot: "trinket",
    baseStats: { crit: 7.2, aspd: 15 },
    hooks: [
      { on: "passive", effect: "goldPct", value: 0.4 },   // 金币获取 +40%
      { on: "onKill", effect: "goldOnKill", value: 0.5 }, // 击杀额外掉落怪物金币的 50%
    ],
  },
  {
    id: "frostwail", name: "冰恸", slot: "weapon",
    baseStats: { atk: 12 },
    hooks: [
      { on: "crit", effect: "chillOnCrit", value: 0.3, dur: 3 }, // 暴击冰冻：目标缓速 30%，持续 3 秒
    ],
  },
  {
    id: "bloodmoonSigil", name: "血月印记", slot: "trinket",
    baseStats: { crit: 7.2, aspd: 15 },
    hooks: [
      { on: "passive", effect: "critDmg", value: 0.6 },    // 暴击伤害 +60%
      { on: "crit", effect: "hpCostOnCrit", value: 0.02 }, // 每次暴击自损 2% 最大生命
    ],
  },
  {
    id: "phoenixFeather", name: "凤凰羽翼", slot: "trinket",
    baseStats: { crit: 7.2, aspd: 15 },
    hooks: [
      { on: "onDeath", effect: "cheatDeath", value: 1 }, // 致命伤时原地满血复活 1 次（每场 Boss 战限 1 次）
    ],
  },
];

/** 按 uniqueId 取暗金定义（战斗层查 hooks、UI 查名称/风味）；未收录返回 null */
export function uniqueById(id) {
  return UNIQUES.find((u) => u.id === id) || null;
}

/** 掉落一件装备：属性 = 部位基准 × 品质倍率 × 层数缩放 × 单件浮动(±15%)；
 *  副词条按品质随机 0~3 条（rollAffixes）；传说品质 12% 产出暗金（rollUniqueItem） */
export function rollItem(floor, isBoss) {
  const f = Math.max(1, Math.floor(Number(floor) || 1));
  const rarity = rollRarity(!!isBoss);
  if (rarity === 3 && Math.random() < BALANCE.UNIQUE_CHANCE) return rollUniqueItem(f);

  const slot = SLOT_KEYS[Math.floor(Math.random() * SLOT_KEYS.length)];
  const variance = 0.85 + Math.random() * 0.3;
  const stats = buildStats(slot, RARITY_STAT_MULT[rarity], f, variance);
  const value = Math.max(
    1,
    Math.round(RARITY_VALUE[rarity] * Math.pow(ITEM_VALUE_FLOOR_GROWTH, f - 1) * variance)
  );
  return {
    uid: makeUid(),
    slot,
    name: ITEM_NAMES[slot][rarity],
    rarity,
    stats,
    value,
    affixes: rollAffixes(rarity),
  };
}

/** 品质属性构造：部位基准 × 倍率 × 层数缩放 × 浮动（crit/aspd 保留 1 位小数） */
function buildStats(slot, mult, f, variance) {
  const scale = Math.pow(ITEM_FLOOR_GROWTH, f - 1);
  const stats = {};
  if (slot === "weapon") {
    stats.atk = Math.max(1, Math.round(SLOT_BASE.weapon.atk * mult * scale * variance));
  } else if (slot === "head") {
    stats.hp = Math.max(1, Math.round(SLOT_BASE.head.hp * mult * scale * variance));
  } else if (slot === "armor") {
    stats.def = Math.max(1, Math.round(SLOT_BASE.armor.def * mult * scale * variance));
  } else {
    const tScale = Math.pow(ITEM_TRINKET_FLOOR_GROWTH, f - 1);
    stats.crit = Math.max(0.5, Math.round(SLOT_BASE.trinket.crit * mult * tScale * variance * 10) / 10);
    stats.aspd = Math.max(0.5, Math.round(SLOT_BASE.trinket.aspd * mult * tScale * variance * 10) / 10);
  }
  return stats;
}

/** 暗金落地：baseStats × 层数缩放（无浮动）、售价 ×UNIQUE_VALUE_MULT、affixes 恒空 */
function rollUniqueItem(f) {
  const u = UNIQUES[Math.floor(Math.random() * UNIQUES.length)];
  const scale = Math.pow(u.slot === "trinket" ? ITEM_TRINKET_FLOOR_GROWTH : ITEM_FLOOR_GROWTH, f - 1);
  const stats = {};
  for (const [k, v] of Object.entries(u.baseStats)) {
    const n = (Number(v) || 0) * scale;
    stats[k] = k === "crit" || k === "aspd"
      ? Math.max(0.5, Math.round(n * 10) / 10)
      : Math.max(1, Math.round(n));
  }
  const value = Math.max(
    1,
    Math.round(RARITY_VALUE[3] * BALANCE.UNIQUE_VALUE_MULT * Math.pow(ITEM_VALUE_FLOOR_GROWTH, f - 1))
  );
  return {
    uid: makeUid(),
    slot: u.slot,
    name: u.name,
    rarity: 3,
    stats,
    value,
    affixes: [], // 暗金固有 hooks 取代随机副词条
    uniqueId: u.id,
    uniqueDesc: UNIQUE_FLAVOR[u.id] || "",
  };
}

// ---------------------------------------------------------------------------
// 战斗随机规则：伤害 = max(1, atk×(0.9~1.1) − 目标def)，暴击再 ×1.5
// critChance 为 0~1 小数（= 英雄总暴击百分点 / 100），默认 0 不暴击
// ---------------------------------------------------------------------------
export function rollDamage(atk, targetDef, critChance = 0) {
  const a = Math.max(0, Number(atk) || 0);
  const d = Math.max(0, Number(targetDef) || 0);
  const crit = Math.random() < Math.min(1, Math.max(0, Number(critChance) || 0));
  const hit = Math.max(1, Math.round(a * (0.9 + Math.random() * BALANCE.ATK_VARIANCE) - d));
  return { damage: crit ? Math.round(hit * BALANCE.CRIT_MULT) : hit, crit };
}

// ---------------------------------------------------------------------------
// 离线收益：每杀耗时 = max(0.5, 怪物hp / max(0.1, heroDps)) + 1.2 秒
// elapsedSec 封顶 8 小时（28800）；以当前层 monsterFor(floor, 0) 为代表怪物
// （停 Boss 层则按 Boss 体型估算：打不过就是 0 收益，符合直觉）
// ---------------------------------------------------------------------------
export function estimateOffline(heroDps, floor, elapsedSec) {
  const t = Math.min(BALANCE.OFFLINE_CAP_SEC, Math.max(0, Number(elapsedSec) || 0));
  const mob = monsterFor(floor, 0);
  const perKill = Math.max(0.5, mob.hp / Math.max(0.1, Number(heroDps) || 0)) + 1.2;
  const kills = Math.floor(t / perKill);
  return { kills, gold: kills * mob.gold, xp: kills * mob.xp };
}

/** 离线随机掉落：按 DROP_CHANCE 逐杀判定，最多 OFFLINE_DROP_CAP 件 */
export function rollOfflineDrops(kills, floor) {
  const drops = [];
  const n = Math.max(0, Math.floor(Number(kills) || 0));
  for (let i = 0; i < n && drops.length < BALANCE.OFFLINE_DROP_CAP; i++) {
    if (Math.random() < BALANCE.DROP_CHANCE) drops.push(rollItem(floor, false));
  }
  return drops;
}

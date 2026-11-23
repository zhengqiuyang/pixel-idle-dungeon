// ============================================================================
// 《余烬深渊》(pixel-idle-dungeon) · js/relics.js
// 肉鸽遗物池 + 永久天赋树：遗物数据 / 三选一抽取 / 词条汇总 / 天赋购买。
// 本模块零依赖（不 import 其它 js），数据自带，node --check 可直接校验。
// ----------------------------------------------------------------------------
// 【下游集成约定】
//  1) 所有 *Pct / dropLuck / offlineMult 等 mod 值一律为 0~1 小数：
//     0.10 = +10%。desc 文案中的数值与 mods 一一对应。
//  2) critCap / aspdCap 为「上限提升量」小数（0.02 = 暴击率上限 +2%，
//     0.05 = 攻速上限 +5%），消费方与 data.js 的 CRIT_CAP/ASPD_CAP 合并后自行换算。
//  3) startFloor 为开局楼层数（整数），rerollCount 为重铸次数（整数），
//     partyPct 为伙伴全属性加成小数 —— 仅由天赋产出。
//  4) state 契约（M0 存档 v2）：本模块只读 state.relics / state.talents /
//     state.embers；applyTalent 原地改 embers/talents，存盘由调用方负责。
//  5) relics / pendingRelics 属于轮回重置字段；talents / embers 永久保留。
// ============================================================================

// ---------------------------------------------------------------------------
// 遗物标签
// ---------------------------------------------------------------------------
export const RELIC_TAGS = [
  { id: "crit", name: "暴击" },
  { id: "dot", name: "持续伤害" },
  { id: "survive", name: "生存" },
  { id: "economy", name: "经济" },
];

// ---------------------------------------------------------------------------
// 遗物池：22 个，crit/dot 各 6 个、survive/economy 各 5 个。
// 平衡基调：单词条小遗物 5%~15%，强力遗物 20%~30%（或双词条组合）。
// ---------------------------------------------------------------------------
export const RELICS = [
  // ---- 暴击 ----
  {
    id: "keenFang", name: "锐牙护符", tag: "crit",
    desc: "狼王遗落的獠牙，锋锐无匹。暴击率 +10%",
    mods: { critChance: 0.10 },
  },
  {
    id: "execBlade", name: "处决者巨刃", tag: "crit",
    desc: "处刑台上折断的巨刃，专寻要害。暴击伤害 +30%",
    mods: { critDmgPct: 0.30 },
  },
  {
    id: "stormSigil", name: "风暴印记", tag: "crit",
    desc: "雷暴凝成的猎手纹章。攻击速度 +15%，暴击率 +5%",
    mods: { aspdPct: 0.15, critChance: 0.05 },
  },
  {
    id: "weakSpot", name: "弱点图志", tag: "crit",
    desc: "标注魔物要害的手札。暴击率 +15%，暴击伤害 +10%",
    mods: { critChance: 0.15, critDmgPct: 0.10 },
  },
  {
    id: "bloodRitual", name: "血祭刻印", tag: "crit",
    desc: "以血淬锋的禁术刻印。攻击力 +12%，暴击伤害 +15%",
    mods: { atkPct: 0.12, critDmgPct: 0.15 },
  },
  {
    id: "duelistPride", name: "决斗者之傲", tag: "crit",
    desc: "百胜决斗者的荣耀徽章。暴击率 +8%，暴击伤害 +20%",
    mods: { critChance: 0.08, critDmgPct: 0.20 },
  },

  // ---- 持续伤害 ----
  {
    id: "venomFang", name: "毒牙吊坠", tag: "dot",
    desc: "沼泽毒蛛的獠牙吊坠。持续伤害 +15%",
    mods: { dotDmgPct: 0.15 },
  },
  {
    id: "plagueHeart", name: "瘟疫之心", tag: "dot",
    desc: "仍在搏动的瘟疫病核。持续伤害 +25%",
    mods: { dotDmgPct: 0.25 },
  },
  {
    id: "emberSerpent", name: "余烬蛇杖", tag: "dot",
    desc: "盘绕余烬之蛇的杖头。持续伤害 +12%，攻击力 +8%",
    mods: { dotDmgPct: 0.12, atkPct: 0.08 },
  },
  {
    id: "rotSigil", name: "腐化印记", tag: "dot",
    desc: "缓慢侵蚀万物的腐咒。持续伤害 +10%，技能冷却缩减 +15%",
    mods: { dotDmgPct: 0.10, cdrPct: 0.15 },
  },
  {
    id: "witchStitch", name: "巫祝缝线", tag: "dot",
    desc: "缝合怨灵的丝线，越缠越紧。持续伤害 +20%，攻击速度 +8%",
    mods: { dotDmgPct: 0.20, aspdPct: 0.08 },
  },
  {
    id: "salamanderCore", name: "火蜥蜴核心", tag: "dot",
    desc: "火蜥蜴永燃的内丹。持续伤害 +30%，攻击力 +5%",
    mods: { dotDmgPct: 0.30, atkPct: 0.05 },
  },

  // ---- 生存 ----
  {
    id: "ironShell", name: "铁壳护符", tag: "survive",
    desc: "千年巨龟的背甲磨成。防御 +15%",
    mods: { defPct: 0.15 },
  },
  {
    id: "bloodAmulet", name: "血玉护符", tag: "survive",
    desc: "浸满勇士鲜血的古玉。生命偷取 +10%",
    mods: { lifestealPct: 0.10 },
  },
  {
    id: "thornMail", name: "荆棘锁甲", tag: "survive",
    desc: "缠满毒刺的锁甲残片。反伤 +20%，防御 +10%",
    mods: { thornsPct: 0.20, defPct: 0.10 },
  },
  {
    id: "stoneSkin", name: "石肤刻印", tag: "survive",
    desc: "将血肉化为岩石的古刻印。防御 +25%",
    mods: { defPct: 0.25 },
  },
  {
    id: "guardianSigil", name: "守护者纹章", tag: "survive",
    desc: "古骑士团代代相传的家徽。防御 +15%，生命偷取 +10%，反伤 +10%",
    mods: { defPct: 0.15, lifestealPct: 0.10, thornsPct: 0.10 },
  },

  // ---- 经济 ----
  {
    id: "merchantsRing", name: "商人戒指", tag: "economy",
    desc: "深渊商会的信用戒指。金币获取 +15%",
    mods: { goldPct: 0.15 },
  },
  {
    id: "luckyClover", name: "四叶草发饰", tag: "economy",
    desc: "地表仅存的幸运四叶草。掉落品质 +15%",
    mods: { dropLuck: 0.15 },
  },
  {
    id: "goldenGoblet", name: "鎏金圣杯", tag: "economy",
    desc: "盛过龙王之血的酒杯。金币获取 +25%",
    mods: { goldPct: 0.25 },
  },
  {
    id: "dreamCandle", name: "长梦之烛", tag: "economy",
    desc: "英雄离线时仍在燃烧的烛火。离线收益 +25%",
    mods: { offlineMult: 0.25 },
  },
  {
    id: "treasureFragment", name: "藏宝图残页", tag: "economy",
    desc: "指向深渊宝库的残破地图。金币获取 +10%，掉落品质 +10%",
    mods: { goldPct: 0.10, dropLuck: 0.10 },
  },
];

// id → 遗物 快速索引（内部使用，不导出）
const RELIC_INDEX = new Map(RELICS.map((r) => [r.id, r]));

// 遗物 mod 的全部合法键（relicMods 汇总时零初始化，保证返回形状稳定）
const RELIC_MOD_KEYS = [
  "atkPct", "aspdPct", "critChance", "critDmgPct", "lifestealPct", "thornsPct",
  "cdrPct", "dotDmgPct", "goldPct", "defPct", "dropLuck", "offlineMult",
];

// ---------------------------------------------------------------------------
// 三选一抽取：从不与 state.relics 重复的池里给 3 个遗物 id。
// 保底规则：玩家已持有遗物时，已持有的每个 tag 优先各给 1 个候选
// （至多占满 3 席）——保证「同 tag 至少 1 个」可深化流派；
// 剩余席位优先补未出现过的 tag（选项多样性），不足再任意补齐。
// 池子耗尽时返回不足 3 个（最多 3 个）的剩余结果；全选完返回 []。
// rng 可注入（测试用种子），默认 Math.random。
// ---------------------------------------------------------------------------
function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

export function rollRelicChoices(state, rng = Math.random) {
  const owned = Array.isArray(state && state.relics) ? state.relics : [];
  const ownedSet = new Set(owned);
  const pool = shuffled(RELICS.filter((r) => !ownedSet.has(r.id)), rng);
  if (pool.length === 0) return [];

  const picks = [];
  const pickedIds = new Set();
  const take = (r) => {
    if (!r || picks.length >= 3 || pickedIds.has(r.id)) return false;
    picks.push(r.id);
    pickedIds.add(r.id);
    return true;
  };

  // 保底：已持有 tag 各优先 1 个候选
  const ownedTags = [];
  for (const t of RELIC_TAGS) {
    const has = owned.some((id) => {
      const r = RELIC_INDEX.get(id);
      return !!r && r.tag === t.id;
    });
    if (has) ownedTags.push(t.id);
  }
  for (const tag of ownedTags) {
    if (picks.length >= 3) break;
    take(pool.find((r) => r.tag === tag));
  }

  // 剩余席位：先按 tag 多样性补，再任意补齐
  const seenTags = new Set();
  for (const id of picks) {
    const r = RELIC_INDEX.get(id);
    if (r) seenTags.add(r.tag);
  }
  for (const r of pool) {
    if (picks.length >= 3) break;
    if (seenTags.has(r.tag)) continue;
    if (take(r)) seenTags.add(r.tag);
  }
  for (const r of pool) {
    if (picks.length >= 3) break;
    take(r);
  }
  return picks;
}

// ---------------------------------------------------------------------------
// 已选遗物词条汇总：全部 12 个 mod 键零初始化后逐个累加（数值形状稳定）。
// 未知遗物 id 忽略；未知 mod 键也会合并进结果（向前兼容）。
// ---------------------------------------------------------------------------
export function relicMods(state) {
  const out = {};
  for (const k of RELIC_MOD_KEYS) out[k] = 0;
  const relics = Array.isArray(state && state.relics) ? state.relics : [];
  for (const id of relics) {
    const r = RELIC_INDEX.get(id);
    if (!r || !r.mods) continue;
    for (const k of Object.keys(r.mods)) {
      const v = Number(r.mods[k]);
      if (!Number.isFinite(v)) continue;
      out[k] = (typeof out[k] === "number" ? out[k] : 0) + v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 永久天赋树（余烬消耗，跨轮回保留在 state.talents = {天赋id: 等级}）。
// cost(level)：从 level 升到 level+1 的余烬价格（level 为当前等级，0 起）。
// mods(level)：该天赋在 level 级时提供的词条（与 relicMods 同类小数语义）。
// ---------------------------------------------------------------------------
export const TALENTS = [
  {
    id: "emberBlessing", name: "余烬赐福", desc: "掉落品质提升：每级掉落品质 +8%",
    maxLevel: 5, cost: (level) => 5 + level * 5,
    mods: (lv) => ({ dropLuck: lv * 0.08 }),
  },
  {
    id: "floorMemory", name: "深渊记忆", desc: "初始跳层：每级开局直接进入 +2 层",
    maxLevel: 5, cost: (level) => 10 + level * 10,
    mods: (lv) => ({ startFloor: lv * 2 }),
  },
  {
    id: "emberLamp", name: "余烬长明灯", desc: "离线收益：每级离线收益 +15%",
    maxLevel: 5, cost: (level) => 8 + level * 8,
    mods: (lv) => ({ offlineMult: lv * 0.15 }),
  },
  {
    id: "critBreak", name: "暴击界限突破", desc: "暴击上限突破：每级暴击率上限 +2%",
    maxLevel: 5, cost: (level) => 15 + level * 15,
    mods: (lv) => ({ critCap: lv * 0.02 }),
  },
  {
    id: "aspdBreak", name: "攻速界限突破", desc: "攻速上限突破：每级攻速上限 +5%",
    maxLevel: 5, cost: (level) => 15 + level * 15,
    mods: (lv) => ({ aspdCap: lv * 0.05 }),
  },
  {
    id: "goldenTouch", name: "点金之手", desc: "金币加成：每级金币获取 +10%",
    maxLevel: 5, cost: (level) => 6 + level * 6,
    mods: (lv) => ({ goldPct: lv * 0.10 }),
  },
  {
    id: "partyHarmony", name: "共鸣誓约", desc: "伙伴全属性：每级伙伴全属性 +8%",
    maxLevel: 5, cost: (level) => 8 + level * 8,
    mods: (lv) => ({ partyPct: lv * 0.08 }),
  },
  {
    id: "relicReforge", name: "词条重铸", desc: "词条重铸：每级获得 1 次重铸机会",
    maxLevel: 3, cost: (level) => 20 + level * 20,
    mods: (lv) => ({ rerollCount: lv * 1 }),
  },
];

const TALENT_INDEX = new Map(TALENTS.map((t) => [t.id, t]));

// talentMods 汇总的全部键（零初始化，保证返回形状稳定）
const TALENT_MOD_KEYS = [
  "dropLuck", "startFloor", "offlineMult", "critCap", "aspdCap",
  "goldPct", "partyPct", "rerollCount",
];

// ---------------------------------------------------------------------------
// 天赋词条汇总：state.talents 各等级 → mods(level) 累加。
// ---------------------------------------------------------------------------
export function talentMods(state) {
  const out = {};
  for (const k of TALENT_MOD_KEYS) out[k] = 0;
  const learned = state && typeof state.talents === "object" && state.talents ? state.talents : {};
  for (const t of TALENTS) {
    const lv = Math.floor(Number(learned[t.id]) || 0);
    if (lv <= 0) continue;
    const m = t.mods(lv) || {};
    for (const k of Object.keys(m)) {
      const v = Number(m[k]);
      if (!Number.isFinite(v)) continue;
      out[k] = (typeof out[k] === "number" ? out[k] : 0) + v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 天赋购买：canAfford 只判不扣；applyTalent 原地扣 embers 并 +1 级。
// 两种失败都不改 state：未知 id / 已满级 / 余烬不足 → 返回 false。
// ---------------------------------------------------------------------------
export function canAffordTalent(state, id) {
  const t = TALENT_INDEX.get(id);
  if (!t || !state || typeof state !== "object") return false;
  const lv = Math.floor(Number(state.talents && state.talents[id]) || 0);
  if (lv >= t.maxLevel) return false;
  return (Number(state.embers) || 0) >= t.cost(lv);
}

export function applyTalent(state, id) {
  const t = TALENT_INDEX.get(id);
  if (!t || !state || typeof state !== "object") return false;
  if (!state.talents || typeof state.talents !== "object") state.talents = {};
  const lv = Math.floor(Number(state.talents[id]) || 0);
  if (lv >= t.maxLevel) return false;
  const price = t.cost(lv);
  if ((Number(state.embers) || 0) < price) return false;
  state.embers = (Number(state.embers) || 0) - price;
  state.talents[id] = lv + 1;
  return true;
}

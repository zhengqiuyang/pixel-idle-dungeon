// ============================================================================
// 《勇者闯地下城》V2.0 · js/state.js
// 存档与英雄数值合成：v2 state 创建 / v1→v2 迁移 / 读写 / 导出导入 /
// 属性派生（含 遗物·天赋·羁绊 三条乘区）/ 金币批量升级 / 离线结算。
// 数值一律取自 data.js（项目唯一数据源），本文件不自带平衡数值。
// ----------------------------------------------------------------------------
// state 形状（v2 存档结构契约，M0 起固定，全部模块按此读写，不得漂移）：
// {
//   // —— V1 字段原样保留 ——
//   gold, floor, killsOnFloor, stayFloor,
//   hero: { level, xp, hpNow, maxHp, atk, def, critChance, aspd },
//   upgrades: { atk, hp, def, crit, aspd },
//   inventory: [item], equipped: { weapon, head, armor, trinket },
//   muted, lastSaved,
//   // —— V2 新增 ——
//   saveVersion: 2,
//   embers: 0,               // 灵魂余烬（永久货币）
//   prestigeCount: 0, bestFloor: 1,
//   talents: {},             // {天赋id: 等级}
//   skills: { crack: 0, shield: 0, warcry: 0 },  // 0=未解锁 1=已解锁
//   party: { unlocked: {vera,irene,kai}, active: [], levels: {vera,irene,kai} },
//   relics: [],              // 本轮已选遗物 id[]
//   pendingRelics: [],       // [{id:"roll-N", options:[3个遗物id]}]（生产方上限 10）
//   pendingEvents: [],       // [{id:"ev-N", eventId}]（生产方上限 5）
//   lootFilter: { autoSellBelow: null },  // null=关闭；1/2/3=自动出售档位
//   chronicle: [],           // [{time, text}]
//   seenIntro: false,
//   stats: { kills: 0, bossKills: 0, totalGold: 0 },
// }
// 迁移规则（saveGame/loadGame 实现）：
//   - 读 key SAVE_KEY（"pixel-idle-dungeon-v1"，v2 沿用同 key，不换 key）；
//   - saveVersion 缺失即 v1 档 → 字段逐个补默认值（v1 数据一律保留）→ 存回同 key；
//   - 坏档（JSON 解析失败 / 结构性损坏）回退新档。
// M3 装备字段（affixes / uniqueId / uniqueDesc）在 sanitizeItem 透传清洗，
// 存读档/导入导出不丢（详见 sanitizeItem 内注释）。
// 永久字段（轮回保留）：embers / prestigeCount / bestFloor / talents / party /
//   chronicle / seenIntro / inventory / equipped（+ muted / hero 等 V1 基础字段）。
// 轮回重置字段：floor / killsOnFloor / gold / upgrades / relics / pendingRelics /
//   pendingEvents / stats（轮回执行归后续里程碑，本文件只保证字段就位）。
// 单位约定（与 data.js「下游集成约定」一致）：
//   - upgrades / 装备 stats 中的 crit、aspd 为「百分点」（crit:2.5 = +2.5%）；
//   - hero.critChance 为派生后的 0~0.5 小数（= 总百分点/100，封顶 CRIT_CAP=50）；
//   - hero.aspd 为派生后的攻速倍率 次/秒（= 1 + 总百分点/100，封顶 ASPD_CAP=3.0）。
// ============================================================================

import {
  SAVE_KEY, BALANCE, HERO_BASE, LEVEL_BONUS, UPGRADES, CRIT_CAP, ASPD_CAP,
  xpNeeded, upgradeCost, estimateOffline, rollOfflineDrops,
  AFFIXES, uniqueById,
} from "./data.js";
// narrative.js 零依赖（data.js 同样引用它），无环：M3 暗金载入时按 uniqueId
// 重查 UNIQUE_FLAVOR 补齐 uniqueDesc（风味小字唯一文案源在 narrative.js）。
import { UNIQUE_FLAVOR } from "./narrative.js";
// ---- 并行里程碑模块（relics.js，零依赖，已交付）--------------------------------
// 词条汇总函数（加性小数语义：0.10 = +10%，见 relics.js 文件头约定）：
//   relicMods(state)  由 state.relics 汇总  → RELIC_MOD_KEYS
//   talentMods(state) 由 state.talents 汇总 → TALENT_MOD_KEYS（天赋树也在 relics.js）
// computeDerived 只消费英雄面板属性相关的键：
//   atkPct/defPct → 属性乘区 (1+X)；critChance → 暴击百分点 +X×100；
//   aspdPct → 攻速百分点 +X×100；critCap/aspdCap → 上限提升量（扩展封顶）。
// 其余词条（critDmgPct/lifestealPct/thornsPct/cdrPct/dotDmgPct/goldPct/dropLuck/
// offlineMult/startFloor/partyPct/rerollCount）由战斗/掉落/离线/伙伴等消费方
// 在各自里程碑读取，不属于英雄属性派生。
// skills.js 的 bondMods(state) 为战斗层羁绊词条（吸血/减伤/爆伤/灼烧/护盾），
// 不进入英雄面板属性，由 combat 里程碑消费 —— 故 state.js 不 import skills.js。
import { relicMods, talentMods } from "./relics.js";

const SLOTS = ["weapon", "head", "armor", "trinket"];
const PARTY_MEMBERS = ["vera", "irene", "kai"];
const SKILL_IDS = ["crack", "shield", "warcry"];
const RELIC_TAGS_VALID = new Set(["crit", "dot", "survive", "economy"]);
// M3 副词条合法键集合（key 必须 ∈ data.AFFIXES；value 与遗物/天赋词条同语义，
// 一律 0~1 小数）；同件装备内键不重复、条数上限 3（= 传说档条数契约上限）。
const AFFIX_KEYS = new Set(AFFIXES.map((a) => a.key));
const AFFIX_MAX = 3;

// ---------------------------------------------------------------------------
// 新档（v2 完整形状）
// ---------------------------------------------------------------------------
export function newGame() {
  return {
    gold: 0,
    floor: 1,
    killsOnFloor: 0,
    stayFloor: false,
    hero: {
      level: 1,
      xp: 0,
      hpNow: HERO_BASE.maxHp,
      maxHp: HERO_BASE.maxHp,
      atk: HERO_BASE.atk,
      def: HERO_BASE.def,
      critChance: HERO_BASE.crit / 100, // 5 百分点 → 0.05
      aspd: HERO_BASE.aspd,             // 1.0 次/秒
    },
    upgrades: { atk: 0, hp: 0, def: 0, crit: 0, aspd: 0 },
    inventory: [],
    equipped: { weapon: null, head: null, armor: null, trinket: null },
    muted: false,
    lastSaved: Date.now(),
    // ---- v2 新增字段 ----
    saveVersion: 2,
    embers: 0,
    prestigeCount: 0,
    bestFloor: 1,
    talents: {},
    skills: { crack: 0, shield: 0, warcry: 0 },
    party: {
      unlocked: { vera: false, irene: false, kai: false },
      active: [],
      levels: { vera: 1, irene: 1, kai: 1 },
    },
    relics: [],
    pendingRelics: [],
    pendingEvents: [],
    runBuffs: { atkPct: 0, allPct: 0, curses: 0 },
    relicAutoTag: null,
    lootFilter: { autoSellBelow: null },
    chronicle: [],
    seenIntro: false,
    stats: { kills: 0, bossKills: 0, totalGold: 0 },
  };
}

// ---------------------------------------------------------------------------
// 数值清洗：坏档/外部导入的数据不可信，逐字段钳制，结构残缺才抛错
// ---------------------------------------------------------------------------
function toNum(v, def, min = -Infinity, max = Infinity) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function sanitizeItem(it) {
  if (!it || typeof it !== "object" || Array.isArray(it)) return null;
  if (!SLOTS.includes(it.slot)) return null;
  const src = it.stats && typeof it.stats === "object" && !Array.isArray(it.stats) ? it.stats : {};
  const stats = {};
  for (const k of ["atk", "hp", "def", "crit", "aspd"]) {
    const v = toNum(src[k], 0, 0, 1e9);
    if (v > 0) stats[k] = v;
  }
  if (Object.keys(stats).length === 0) return null;

  // ---- M3 副词条透传清洗：key ∈ AFFIXES 才收、value 钳制 0~1（零值丢弃，
  //      与上方 stats 的 v>0 约定一致）、同件内键去重、条数封顶 3 ----
  const affixes = [];
  if (Array.isArray(it.affixes)) {
    for (const a of it.affixes) {
      if (!a || typeof a !== "object" || Array.isArray(a)) continue;
      const key = typeof a.key === "string" ? a.key : "";
      if (!AFFIX_KEYS.has(key) || affixes.some((x) => x.key === key)) continue;
      const v = toNum(a.value, 0, 0, 1);
      if (v <= 0) continue;
      affixes.push({ key, value: v });
      if (affixes.length >= AFFIX_MAX) break;
    }
  }

  // ---- M3 传说暗金透传清洗：uniqueId 必须能被 data.uniqueById 命中且部位
  //      匹配才保留；命中即按 narrative.UNIQUE_FLAVOR 重查补齐 uniqueDesc，
  //      并按暗金契约清空随机副词条（固有 hooks 取代，见 data.js UNIQUES 段）----
  const uDef = typeof it.uniqueId === "string" ? uniqueById(it.uniqueId) : null;
  const isUnique = !!uDef && uDef.slot === it.slot;

  return {
    uid:
      typeof it.uid === "string" && it.uid
        ? it.uid.slice(0, 64)
        : "imp-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36),
    slot: it.slot,
    name: typeof it.name === "string" && it.name ? String(it.name).slice(0, 40) : "未知装备",
    rarity: Math.floor(toNum(it.rarity, 0, 0, 3)),
    stats,
    value: Math.max(1, Math.floor(toNum(it.value, 1, 1, 1e12))),
    affixes: isUnique ? [] : affixes,
    ...(isUnique ? { uniqueId: uDef.id, uniqueDesc: UNIQUE_FLAVOR[uDef.id] || "" } : {}),
  };
}

// ---- v2 字段清洗 ----------------------------------------------------------
function cleanId(v, maxLen = 64) {
  return typeof v === "string" && v ? v.slice(0, maxLen) : null;
}

/** {天赋id: 等级}：非法键值丢弃，等级钳到 ≥1 */
function sanitizeTalents(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const id = cleanId(k);
    const lv = Math.floor(toNum(v, 0, 0, 1e6));
    if (id && lv >= 1) out[id] = lv;
  }
  return out;
}

/** 主勇者技能（crack/shield/warcry）：兼容数字形态 0/1（迁移中间态）与
 *  skills.js 细化契约形态 { unlocked, tactic } —— 两种都无损保留，
 *  数字形态由 skills.js 的 syncHeroSkillUnlocks 在运行时原地升级。
 *  tactic 允许字符串（"auto"|"bossOnly"|"belowHp"，UI cycleTactic 旧写法）
 *  或对象 {mode, threshold?}：字符串归一化为 {mode} 后保留 —— M2 修复：
 *  此前仅保留对象形态，UI 写回的字符串战术经存读档被静默丢弃，刷新后
 *  回退"自动"。非法形态丢弃，读取侧 skills.normalizeTactic 按条目默认兜底。 */
function sanitizeSkills(raw) {
  const out = { crack: 0, shield: 0, warcry: 0 };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const id of SKILL_IDS) {
    const v = raw[id];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const rec = { unlocked: Number(v.unlocked) === 1 || v.unlocked === true ? 1 : 0 };
      if (typeof v.tactic === "string" && v.tactic) {
        rec.tactic = { mode: v.tactic.slice(0, 16) };
      } else if (v.tactic && typeof v.tactic === "object" && !Array.isArray(v.tactic)) {
        rec.tactic = { mode: typeof v.tactic.mode === "string" ? v.tactic.mode.slice(0, 16) : "auto" };
        const th = Number(v.tactic.threshold);
        if (Number.isFinite(th)) rec.tactic.threshold = Math.min(1, Math.max(0, th));
      }
      out[id] = rec;
    } else {
      const n = Number(v);
      out[id] = Number.isFinite(n) && n >= 1 ? 1 : 0;
    }
  }
  return out;
}

/** 同伴队伍：unlocked 布尔表 / active 仅含已解锁成员 / levels ≥1 */
function sanitizeParty(raw) {
  const out = {
    unlocked: { vera: false, irene: false, kai: false },
    active: [],
    levels: { vera: 1, irene: 1, kai: 1 },
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const unl = raw.unlocked && typeof raw.unlocked === "object" ? raw.unlocked : {};
  for (const id of PARTY_MEMBERS) out.unlocked[id] = !!unl[id];
  if (Array.isArray(raw.active)) {
    for (const v of raw.active) {
      const id = cleanId(v, 32);
      if (id && PARTY_MEMBERS.includes(id) && out.unlocked[id] && !out.active.includes(id)) {
        out.active.push(id);
      }
    }
  }
  const lvs = raw.levels && typeof raw.levels === "object" ? raw.levels : {};
  for (const id of PARTY_MEMBERS) out.levels[id] = Math.floor(toNum(lvs[id], 1, 1, 1e6));
  return out;
}

/** 遗物/事件队列共用的「id 字符串列表」清洗 */
function sanitizeIdList(raw, cap = 1000) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const v of raw) {
    const id = cleanId(v, 64);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/** 待选遗物队列：[{id:"roll-N", options:[遗物id]}] */
function sanitizePendingRelics(raw) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const e of raw) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const id = cleanId(e.id, 64);
    const options = sanitizeIdList(e.options, 8);
    if (id && options.length > 0) out.push({ id, options });
    if (out.length >= 100) break; // 生产方上限 10，此处仅防坏档膨胀
  }
  return out;
}

/** 奇遇队列：[{id:"ev-N", eventId}] */
function sanitizePendingEvents(raw) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const e of raw) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const id = cleanId(e.id, 64);
    const eventId = cleanId(e.eventId, 64);
    if (id && eventId) out.push({ id, eventId });
    if (out.length >= 100) break; // 生产方上限 5，此处仅防坏档膨胀
  }
  return out;
}

/** 自动出售过滤：null=关闭，否则 1|2|3 */
function sanitizeLootFilter(raw) {
  const out = { autoSellBelow: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const v = raw.autoSellBelow;
  if (v === 1 || v === 2 || v === 3) out.autoSellBelow = v;
  return out;
}

/** 编年史：[{time, text, key?}]，只保留最近 200 条 */
function sanitizeChronicle(raw) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const e of raw) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const text = typeof e.text === "string" ? e.text.slice(0, 200) : "";
    if (!text) continue;
    const entry = { time: toNum(e.time, Date.now(), 0, 8.64e15), text };
    const k = cleanId(e.key, 64);
    if (k) entry.key = k;
    out.push(entry);
  }
  return out.slice(-200);
}

function sanitizeRunBuffs(raw) {
  const out = { atkPct: 0, allPct: 0, curses: 0 };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  out.atkPct = toNum(raw.atkPct, 0, 0, 100);
  out.allPct = toNum(raw.allPct, 0, 0, 100);
  out.curses = Math.floor(toNum(raw.curses, 0, 0, 100));
  return out;
}

function sanitizeStats(raw) {
  const out = { kills: 0, bossKills: 0, totalGold: 0 };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  out.kills = Math.floor(toNum(raw.kills, 0, 0, 1e12));
  out.bossKills = Math.floor(toNum(raw.bossKills, 0, 0, 1e12));
  out.totalGold = toNum(raw.totalGold, 0, 0, 1e15);
  return out;
}

/** 清洗任意疑似存档对象（v1 或 v2 形状均可）；结构性损坏抛错（调用方回退新档） */
export function sanitizeState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("存档结构无效");
  if (!raw.hero || typeof raw.hero !== "object" || Array.isArray(raw.hero)) throw new Error("存档缺少 hero");
  const s = newGame();
  s.gold = toNum(raw.gold, 0, 0, 1e15);
  s.floor = Math.floor(toNum(raw.floor, 1, 1, 1e9));
  s.killsOnFloor = Math.floor(toNum(raw.killsOnFloor, 0, 0, BALANCE.MONSTERS_PER_FLOOR - 1));
  s.stayFloor = !!raw.stayFloor;
  s.muted = !!raw.muted;
  s.lastSaved = toNum(raw.lastSaved, Date.now(), 0, 1e15);

  const h = raw.hero;
  s.hero.level = Math.floor(toNum(h.level, 1, 1, 1e6));
  s.hero.xp = toNum(h.xp, 0, 0, 1e15);
  s.hero.hpNow = toNum(h.hpNow, HERO_BASE.maxHp, 0, 1e15);
  s.hero.maxHp = toNum(h.maxHp, HERO_BASE.maxHp, 1, 1e15);
  s.hero.atk = toNum(h.atk, HERO_BASE.atk, 1, 1e15);
  s.hero.def = toNum(h.def, HERO_BASE.def, 0, 1e15);
  s.hero.critChance = toNum(h.critChance, HERO_BASE.crit / 100, 0, 1);
  s.hero.aspd = toNum(h.aspd, HERO_BASE.aspd, 0.1, ASPD_CAP);

  const u = raw.upgrades;
  if (u && typeof u === "object" && !Array.isArray(u)) {
    for (const e of UPGRADES) s.upgrades[e.id] = Math.floor(toNum(u[e.id], 0, 0, 1e6));
  }

  if (Array.isArray(raw.inventory)) {
    for (const it of raw.inventory) {
      const v = sanitizeItem(it);
      if (v) s.inventory.push(v);
    }
  }

  const eq = raw.equipped;
  if (eq && typeof eq === "object" && !Array.isArray(eq)) {
    for (const slot of SLOTS) {
      const v = sanitizeItem(eq[slot]);
      s.equipped[slot] = v && v.slot === slot ? v : null;
    }
  }

  // ---- v2 字段（v1 档缺失 → 保留 newGame 默认值，即「逐个补默认」的迁移）----
  // saveVersion 由清洗结果写死为 2：v1 档补默认后即成 v2 形状。
  s.embers = Math.floor(toNum(raw.embers, 0, 0, 1e15));
  s.prestigeCount = Math.floor(toNum(raw.prestigeCount, 0, 0, 1e9));
  // bestFloor：v1 档无此字段 → 以其进度 floor 回填（保留玩家已到达的层数记录）；
  // 并保证 bestFloor ≥ floor 的恒等式。
  s.bestFloor = Math.max(1, Math.floor(toNum(raw.bestFloor, s.floor, 1, 1e9)), s.floor);
  s.talents = sanitizeTalents(raw.talents);
  s.skills = sanitizeSkills(raw.skills);
  s.party = sanitizeParty(raw.party);
  s.relics = sanitizeIdList(raw.relics);
  s.pendingRelics = sanitizePendingRelics(raw.pendingRelics);
  s.pendingEvents = sanitizePendingEvents(raw.pendingEvents);
  s.runBuffs = sanitizeRunBuffs(raw.runBuffs);
  s.relicAutoTag = typeof raw.relicAutoTag === "string" && RELIC_TAGS_VALID.has(raw.relicAutoTag)
    ? raw.relicAutoTag
    : null;
  s.lootFilter = sanitizeLootFilter(raw.lootFilter);
  s.chronicle = sanitizeChronicle(raw.chronicle);
  s.seenIntro = !!raw.seenIntro;
  s.stats = sanitizeStats(raw.stats);
  return s;
}

// ---------------------------------------------------------------------------
// localStorage 存读（key = data.SAVE_KEY，v1/v2 沿用同 key，永不丢弃 v1 数据）
// ---------------------------------------------------------------------------
export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return newGame();
    const parsed = JSON.parse(raw);
    // saveVersion 缺失即 v1 档 → sanitizeState 逐字段补默认 → 立即存回同 key
    const wasV1 =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.saveVersion == null;
    const s = sanitizeState(parsed); // 坏档抛错 → catch 回退新档
    if (wasV1) {
      // 迁移落盘：直接写 JSON、保留 v1 的 lastSaved（它承载离线时长，决定本次
      // 离线结算收益；saveGame 会盖 now 戳，这里不能用）。写失败不致命——
      // 内存中已是 v2 形状，下次自动存档自然落盘。
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(s));
      } catch {
        /* 隐私模式/配额满：静默 */
      }
    }
    return s;
  } catch {
    return newGame();
  }
}

export function saveGame(state) {
  if (!state || typeof state !== "object") return false;
  try {
    state.lastSaved = Date.now();
    state.saveVersion = 2; // 每次落盘都盖当前版本戳
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // 隐私模式 / 配额满：静默失败，不打断游戏
  }
}

// ---------------------------------------------------------------------------
// 导出/导入：JSON → UTF-8 字节 → base64（中文装备名安全）
// 导入串可以是 v1 或 v2 导出的存档：sanitizeState 统一补默认成 v2 形状
// ---------------------------------------------------------------------------
export function exportSaveString(state) {
  const json = JSON.stringify(state && typeof state === "object" ? state : newGame());
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

export function importSaveString(str) {
  try {
    const bin = atob(String(str ?? "").trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    return sanitizeState(JSON.parse(json));
  } catch {
    return null; // 无效串 → null，调用方提示
  }
}

// ---------------------------------------------------------------------------
// 遗物/天赋词条合并（relics.js 汇总函数，加性小数语义）：
// 两张 mods 表逐键求和成一张；未知键保留（向前兼容）。零遗物/零天赋时
// 全键为 0，computeDerived 结果与 v1 完全一致。
// ---------------------------------------------------------------------------
function collectStatMods(state) {
  const out = {};
  for (const m of [relicMods(state), talentMods(state)]) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    for (const k of Object.keys(m)) {
      const v = Number(m[k]);
      if (Number.isFinite(v)) out[k] = (Number(out[k]) || 0) + v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 属性派生：HERO_BASE + LEVEL_BONUS×(lv-1) + UPGRADES.per×级数 + 装备 stats，
// 再叠加遗物/天赋词条乘区（relics.js：atkPct/defPct 乘数、critChance/aspdPct
// 加百分点）。crit/aspd 封顶含词条上限提升量（critCap/aspdCap）在这里统一生效。
// ---------------------------------------------------------------------------
export function computeDerived(state) {
  const h = state.hero;
  const lv = Math.max(1, Math.floor(Number(h.level) || 1));
  const u = state.upgrades || {};
  const up = (id) => {
    const e = UPGRADES.find((x) => x.id === id);
    return e ? e.per : 0;
  };

  let atk = HERO_BASE.atk + LEVEL_BONUS.atk * (lv - 1) + up("atk") * (u.atk || 0);
  let maxHp = HERO_BASE.maxHp + LEVEL_BONUS.maxHp * (lv - 1) + up("hp") * (u.hp || 0);
  let def = HERO_BASE.def + LEVEL_BONUS.def * (lv - 1) + up("def") * (u.def || 0);
  let critPts = HERO_BASE.crit + up("crit") * (u.crit || 0); // 百分点
  let aspdPts = up("aspd") * (u.aspd || 0);                  // 百分点（基础 1.0 即 0 点）

  const eq = state.equipped || {};
  for (const slot of SLOTS) {
    const it = eq[slot];
    if (!it || !it.stats) continue;
    atk += Number(it.stats.atk) || 0;
    maxHp += Number(it.stats.hp) || 0;
    def += Number(it.stats.def) || 0;
    critPts += Number(it.stats.crit) || 0;
    aspdPts += Number(it.stats.aspd) || 0;
  }

  // ---- 遗物/天赋词条与奇遇单轮增益乘区（加性小数 → 属性/上限；零词条时等价 v1）----
  const mods = collectStatMods(state);
  const rb = state.runBuffs && typeof state.runBuffs === "object" ? state.runBuffs : {};
  const runAtkPct = Math.max(0, Number(rb.atkPct) || 0);
  const runAllPct = Math.max(0, Number(rb.allPct) || 0);
  const curses = Math.max(0, Math.floor(Number(rb.curses) || 0));
  const curseDefPenalty = Math.min(0.3, curses * 0.05);

  atk *= 1 + (Number(mods.atkPct) || 0) + runAtkPct + runAllPct;
  maxHp *= 1 + runAllPct;
  def *= Math.max(0.1, (1 + (Number(mods.defPct) || 0) + runAllPct) * (1 - curseDefPenalty));
  critPts += (Number(mods.critChance) || 0) * 100; // 暴击率小数 → 百分点
  aspdPts += (Number(mods.aspdPct) || 0) * 100;    // 攻速小数 → 百分点（×1.15 = +15 点）

  h.level = lv;
  h.atk = Math.max(1, Math.round(atk));
  h.maxHp = Math.max(1, Math.round(maxHp));
  h.def = Math.max(0, Math.round(def * 10) / 10);
  // 封顶含「上限提升量」词条：critBreak 每级 critCap 0.02 = 暴击上限 +2 百分点；
  // aspdBreak 每级 aspdCap 0.05 = 攻速上限 +0.05 倍/秒（relics.js 文件头约定 2）
  const critCapPts = CRIT_CAP + (Number(mods.critCap) || 0) * 100;
  const aspdCapMul = ASPD_CAP + (Number(mods.aspdCap) || 0);
  h.critChance = Math.min(critCapPts, Math.max(0, critPts)) / 100;
  h.aspd = Math.min(aspdCapMul, Math.max(0.1, 1 + aspdPts / 100));

  // hpNow 只钳制不重置（升级/换装不回血，回血由 combat 规则处理）
  if (!Number.isFinite(h.hpNow) || h.hpNow <= 0) h.hpNow = h.maxHp;
  else h.hpNow = Math.min(h.maxHp, h.hpNow);
  return h;
}

// ---------------------------------------------------------------------------
// 金币升级（批量）：循环购买直至次数用尽 / 金币不足 / 达上限。
// 返回 { bought, spent, reason }（reason ∈ null|"cap"|"gold"|"unknown"，供日志用）。
// 上限判断读英雄最终值（含装备合计），单位与 data.js 契约一致：
//   aspd: hero.aspd（倍率）vs 有效上限 u.cap(=ASPD_CAP)+天赋 aspdCap；
//   crit: hero.critChance×100（百分点）vs 有效上限 u.cap(=CRIT_CAP)+天赋 critCap×100。
// 每次购买后 computeDerived，保证下一次上限/费用判断基于最新属性。
// ---------------------------------------------------------------------------
export function buyUpgrade(state, id, count = 1) {
  const res = { bought: 0, spent: 0, reason: null };
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) {
    res.reason = "unknown";
    return res;
  }
  const n = Math.max(0, Math.floor(Number(count) || 0));
  for (let i = 0; i < n; i++) {
    if (u.cap != null) {
      // 有效总上限 = data.js 基础上限(u.cap) + 天赋「上限提升量」词条
      //（critBreak: critCap 0.02/级；aspdBreak: aspdCap 0.05/级，见 relics.js TALENTS）
      const ext = talentMods(state);
      const effCap =
        u.cap + (id === "aspd" ? Number(ext.aspdCap) || 0 : (Number(ext.critCap) || 0) * 100);
      const cur = id === "aspd" ? Number(state.hero.aspd) || 0 : (Number(state.hero.critChance) || 0) * 100;
      if (cur >= effCap - 1e-9) {
        res.reason = "cap";
        break;
      }
    }
    const lv = Math.max(0, Math.floor(Number(state.upgrades[id]) || 0));
    const cost = upgradeCost(u, lv);
    if ((Number(state.gold) || 0) < cost) {
      res.reason = "gold";
      break;
    }
    state.gold -= cost;
    state.upgrades[id] = lv + 1;
    res.spent += cost;
    res.bought += 1;
    computeDerived(state);
  }
  return res;
}

// ---------------------------------------------------------------------------
// 经验入账 + 升级循环（升级只改等级并重算属性；回血由调用方按规则处理）
// 返回升级次数（main/combat 逐级发 levelup 事件）
// ---------------------------------------------------------------------------
export function applyXp(state, amount) {
  const xp = Number(amount);
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  state.hero.xp = Math.max(0, (Number(state.hero.xp) || 0) + xp);
  let gained = 0;
  while (state.hero.xp >= xpNeeded(state.hero.level) && state.hero.level < 100000) {
    state.hero.xp -= xpNeeded(state.hero.level);
    state.hero.level += 1;
    gained += 1;
  }
  if (gained > 0) computeDerived(state);
  return gained;
}

// ---------------------------------------------------------------------------
// 离线结算：elapsed 超过 OFFLINE_MIN_AWAY(60s) 才结算；
// 时长封顶 8 小时；随机掉落上限 OFFLINE_DROP_CAP(10) 件（data.rollOfflineDrops）。
// 离线期间按「持续击杀」处理：结算后满血回归。
// 返回 { minutes, gold, xp, kills, items, levelsGained } 供 showOfflineModal。
// ---------------------------------------------------------------------------
export function grantOffline(state, elapsedSec) {
  if (!state || typeof state !== "object") return null;
  const away = Number(elapsedSec);
  if (!Number.isFinite(away) || away < BALANCE.OFFLINE_MIN_AWAY) return null;
  const capped = Math.min(BALANCE.OFFLINE_CAP_SEC, away);
  if (!state.stats || typeof state.stats !== "object") {
    state.stats = { kills: 0, bossKills: 0, totalGold: 0 }; // 防御非 newGame/sanitize 产出的 state
  }

  // 粗略 DPS：atk × 攻速倍率 × 暴击期望（1 + 0.5×暴击率）
  const dps = Math.max(1, Math.round(state.hero.atk * state.hero.aspd * (1 + 0.5 * state.hero.critChance)));
  const est = estimateOffline(dps, state.floor, capped);
  const offMult =
    1 +
    Math.max(0, Number(relicMods(state).offlineMult) || 0) +
    Math.max(0, Number(talentMods(state).offlineMult) || 0);
  const kills = Math.floor(est.kills * offMult);
  const offlineGold = Math.round(est.gold * offMult);
  const offlineXp = Math.round(est.xp * offMult);

  const rawDrops = kills > 0 ? rollOfflineDrops(kills, state.floor) : [];
  const tier =
    state.lootFilter && typeof state.lootFilter === "object"
      ? Number(state.lootFilter.autoSellBelow)
      : 0;
  const drops = [];
  let autoSoldCount = 0;
  let autoSoldGold = 0;
  for (const it of rawDrops) {
    const rar = Math.min(3, Math.max(0, Math.floor(Number(it.rarity) || 0)));
    if ((tier === 1 || tier === 2 || tier === 3) && rar < tier) {
      autoSoldCount += 1;
      autoSoldGold += Math.max(1, Math.floor(Number(it.value) || 0));
    } else {
      drops.push(it);
      state.inventory.push(it);
    }
  }

  const totalGoldGain = offlineGold + autoSoldGold;
  const lvBefore = state.hero.level;
  state.gold = (Number(state.gold) || 0) + totalGoldGain;
  state.stats.totalGold += totalGoldGain; // v2 契约字段：离线金币计入累计
  if (offlineXp > 0) applyXp(state, offlineXp);
  state.stats.kills += kills;             // v2 契约字段：离线击杀计入累计
  computeDerived(state);
  state.hero.hpNow = state.hero.maxHp;

  return {
    minutes: Math.max(1, Math.round(capped / 60)),
    gold: totalGoldGain,
    xp: offlineXp,
    kills,
    items: drops,
    autoSoldCount,
    autoSoldGold,
    levelsGained: state.hero.level - lvBefore,
  };
}

// ---------------------------------------------------------------------------
// 编年史记录：追加一条里程碑/大事记；传 milestoneKey 时全局去重，上限 200 条
// ---------------------------------------------------------------------------
export function addChronicle(state, text, milestoneKey = null) {
  if (!state || typeof state !== "object" || !text) return false;
  if (!Array.isArray(state.chronicle)) state.chronicle = [];
  if (milestoneKey && state.chronicle.some((e) => e && e.key === milestoneKey)) {
    return false;
  }
  const entry = { time: Date.now(), text: String(text).slice(0, 200) };
  if (milestoneKey) entry.key = String(milestoneKey).slice(0, 64);
  state.chronicle.push(entry);
  if (state.chronicle.length > 200) {
    state.chronicle.splice(0, state.chronicle.length - 200);
  }
  return true;
}

// ---------------------------------------------------------------------------
// 凯旋回城（轮回）：≥10 层可随时结算灵魂余烬，重置本轮进度，保留装备/伙伴/天赋
// ---------------------------------------------------------------------------
export function calcPrestigeEmbers(floor) {
  const f = Math.floor(Number(floor) || 1);
  if (f < 10) return 0;
  return Math.max(5, Math.floor(Math.pow(f - 5, 1.35)));
}

export function performPrestige(state) {
  if (!state || typeof state !== "object") return null;
  const curFloor = Math.floor(Number(state.floor) || 1);
  if (curFloor < 10) return null;

  const embersGained = calcPrestigeEmbers(curFloor);
  const startFloor = 1 + Math.max(0, Math.floor(Number(talentMods(state).startFloor) || 0));
  const eqCount = state.equipped && typeof state.equipped === "object"
    ? Object.values(state.equipped).filter(Boolean).length
    : 0;
  const invCount = Array.isArray(state.inventory) ? state.inventory.length : 0;

  state.embers = Math.max(0, Math.floor(Number(state.embers) || 0)) + embersGained;
  state.prestigeCount = Math.max(0, Math.floor(Number(state.prestigeCount) || 0)) + 1;
  state.bestFloor = Math.max(1, Math.floor(Number(state.bestFloor) || 1), curFloor);

  // 重置本轮进度
  state.floor = startFloor;
  state.killsOnFloor = 0;
  state.gold = 0;
  state.upgrades = { atk: 0, hp: 0, def: 0, crit: 0, aspd: 0 };
  state.relics = [];
  state.pendingRelics = [];
  state.pendingEvents = [];
  state.runBuffs = { atkPct: 0, allPct: 0, curses: 0 };
  if (!state.hero || typeof state.hero !== "object") state.hero = {};
  state.hero.level = 1;
  state.hero.xp = 0;

  // 技能重置为未解锁，保留玩家选定的战术偏好
  if (!state.skills || typeof state.skills !== "object") {
    state.skills = { crack: 0, shield: 0, warcry: 0 };
  } else {
    for (const id of SKILL_IDS) {
      const rec = state.skills[id];
      if (rec && typeof rec === "object" && !Array.isArray(rec)) {
        state.skills[id] = { unlocked: 0, tactic: rec.tactic || "auto" };
      } else {
        state.skills[id] = 0;
      }
    }
  }

  computeDerived(state);
  state.hero.hpNow = state.hero.maxHp;

  return {
    prevFloor: curFloor,
    embersGained,
    prestigeCount: state.prestigeCount,
    startFloor,
    keptItems: invCount + eqCount,
  };
}

// ---------------------------------------------------------------------------
// 原地替换 state 内容（顶层字段逐个搬入）：
// ui/combat 持有的是同一个 state 引用，导入存档/重开时必须保持引用稳定。
// ---------------------------------------------------------------------------
export function replaceStateInPlace(dst, src) {
  if (!src || typeof src !== "object" || Array.isArray(src)) throw new Error("replaceStateInPlace: src 非对象");
  for (const k of Object.keys(dst)) if (!(k in src)) delete dst[k];
  for (const k of Object.keys(src)) dst[k] = src[k];
  return dst;
}

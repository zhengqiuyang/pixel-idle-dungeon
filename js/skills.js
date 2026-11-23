// ============================================================================
// 《余烬深渊》(pixel-idle-dungeon) · js/skills.js
// 英雄技能 / 伙伴与伙伴技能 / 羁绊 —— V2 数据与判定层。
// 纯数据 + 纯函数：无 DOM、无音频、无第三方依赖、不读不写 localStorage。
// main / combat / ui / 存档迁移模块按下方契约直接 import 使用。
// ----------------------------------------------------------------------------
// 【state.skills 字段契约（对 STATE_V2 skills 字段的细化，全模块按此读写）】
//   state.skills = {
//     crack:  { unlocked: 0|1, tactic: "auto"|"bossOnly"|"belowHp" },
//     shield: { unlocked: 0|1, tactic: ... },
//     warcry: { unlocked: 0|1, tactic: ... },
//   }
//   - unlocked：0=未解锁 1=已解锁；英雄等级达到 unlockHeroLevel 时自动置 1
//     （syncHeroSkillUnlocks，供升级流程调用）。
//   - tactic：战术由 UI 写回（legacy 写法 state.skillsTactics[id] 仍兼容读取，
//     优先级低于 skills[id].tactic）。tactic 允许为字符串，或带阈值的对象
//     { mode:"belowHp", threshold:0~1 }；非法值一律回退默认 {mode:"auto"}。
//   - 兼容：迁移中间态允许 skills[id] 为数字 0/1（0=未解锁 1=已解锁、无战术），
//     所有读取函数一律兼容；记录缺失、数字 0、布尔 false 或对象 {unlocked:0}
//     均按 unlockHeroLevel 用英雄等级推断解锁（解锁纯等级驱动、无显式上锁
//     入口；等级跳变绕过 syncHeroSkillUnlocks 钩子时读取侧仍即时生效）。
//   - 注意命名：HERO_SKILLS 条目上的默认战术字段叫 tactics，存档里叫 tactic。
// 【羁绊判定】hero 恒在场；伙伴成员须在 state.party.active 中（上阵）才激活，
//   仅解锁未上阵不激活。party.active 缺失/非数组时视为只有 hero 在场。
// 【数值单位】技能/羁绊百分比一律用 0~1 小数（0.15 = 15%），与 HERO_SKILLS
//   规格一致；与 data.js 装备 stats 的「百分点」约定区分，勿混用。
// ============================================================================

// ---------------------------------------------------------------------------
// 英雄技能（主勇者）：cd 秒；数值含义见各字段名与 desc
// ---------------------------------------------------------------------------
export const HERO_SKILLS = [
  {
    id: "crack", name: "裂地重斩", unlockHeroLevel: 3, cd: 8,
    desc: "造成 180% 攻击伤害并破甲 30%（5 秒）",
    dmgMult: 1.8, armorBreak: 0.3,
    tactics: { mode: "auto" },
  },
  {
    id: "shield", name: "圣火护盾", unlockHeroLevel: 8, cd: 15,
    desc: "吸收 15% 最大生命的护盾并反弹 20% 伤害（6 秒）",
    shieldPct: 0.15, reflect: 0.2, dur: 6,
    tactics: { mode: "auto" },
  },
  {
    id: "warcry", name: "战吼狂暴", unlockHeroLevel: 12, cd: 18,
    desc: "全队攻速 +20%、暴击 +10%（8 秒）",
    aspdPct: 0.2, critFlat: 0.10, dur: 8,
    tactics: { mode: "auto" },
  },
];

export const HERO_SKILL_MAP = Object.fromEntries(HERO_SKILLS.map((s) => [s.id, s]));

// 战术模式与默认值（UI 写回 state.skills[id].tactic 时按此校验）
export const TACTIC_MODES = ["auto", "bossOnly", "belowHp"];
export const DEFAULT_BELOW_HP = 0.5; // belowHp 模式的默认触发阈值（血量 ≤ 50%）
export const DEFAULT_TACTIC = { mode: "auto" };

/** 新档 state.skills：细化契约形状（与 HERO_SKILLS 的默认 tactics 对齐） */
export function defaultSkillState() {
  const skills = {};
  for (const s of HERO_SKILLS) {
    skills[s.id] = { unlocked: 0, tactic: normalizeTactic(s.tactics, s).mode };
  }
  return skills;
}

/**
 * 按英雄等级自动解锁技能，并把数字形态（迁移中间态）原地升级为
 * 细化契约形态 { unlocked, tactic }；已有战术不覆盖。
 * 返回本次新解锁的技能 id 数组（供日志/特效，如 levelup 时调用）。
 */
export function syncHeroSkillUnlocks(state) {
  const newly = [];
  if (!state || typeof state !== "object") return newly;
  if (!state.skills || typeof state.skills !== "object") state.skills = defaultSkillState();
  const level = Math.max(1, Math.floor(Number(state.hero && state.hero.level) || 1));
  for (const entry of HERO_SKILLS) {
    const rec = normalizeSkillRecord(state.skills[entry.id], entry);
    const wasUnlocked = !!rec.unlocked;
    if (!wasUnlocked && level >= entry.unlockHeroLevel) rec.unlocked = 1;
    state.skills[entry.id] = rec;
    if (!wasUnlocked && rec.unlocked) newly.push(entry.id);
  }
  return newly;
}

/** 技能是否已解锁（兼容对象/数字/布尔记录与记录缺失四种情况） */
export function skillUnlocked(state, id) {
  const entry = HERO_SKILL_MAP[id];
  if (!entry) return false;
  const raw = state && typeof state === "object" && state.skills ? state.skills[id] : undefined;
  if (raw !== undefined && raw !== null) {
    if (typeof raw === "object") {
      if (raw.unlocked) return true; // 细化形态：unlocked 真值即已解锁
    } else if (raw) {
      return true; // 数字 >0 / 布尔 true（迁移中间态已解锁）
    }
  }
  // 未解锁记录（对象 {unlocked:0}、数字 0、布尔 false、缺失如 v1 档尚未迁移）：
  // 解锁是纯等级驱动、无任何显式上锁入口 —— 统一按英雄等级与 unlockHeroLevel
  // 推断。等级变化绕过 syncHeroSkillUnlocks 钩子（load/init/升级/导入）时——
  // 控制台跳级、手改档——读取侧仍即时生效，不出现陈旧锁定态（M2 二次修复：
  // 对象形态 {unlocked:0} 此前直接 return !!raw.unlocked，不落等级推断，
  // 等级达标后 HUD 三槽仍 locked、强化页 chips 仍显示 Lv.N 解锁）。
  const lv = Math.max(1, Math.floor(Number(state && state.hero && state.hero.level) || 1));
  return lv >= entry.unlockHeroLevel;
}

/** 读取某技能的归一化战术 { mode, threshold }（非法值回退默认） */
export function skillTactic(state, id) {
  const entry = HERO_SKILL_MAP[id];
  const raw = state && typeof state === "object" && state.skills ? state.skills[id] : undefined;
  let t = null;
  if (raw && typeof raw === "object" && raw.tactic) t = raw.tactic;
  else if (state && typeof state === "object" && state.skillsTactics && state.skillsTactics[id]) {
    t = state.skillsTactics[id]; // legacy 字段兜底
  }
  return normalizeTactic(t, entry);
}

// ---------------------------------------------------------------------------
// 技能释放判定：冷却转好 + 已解锁 + 按战术放行
//   heroHpPct：0~1 小数（hpNow/maxHp），非有限值按 1（满血）处理
//   isBoss：当前目标是否 Boss
// ---------------------------------------------------------------------------
export function skillReady(skill, cooldownLeft, state, heroHpPct, isBoss) {
  if (!skill || typeof skill !== "object" || !HERO_SKILL_MAP[skill.id]) return false;
  const cd = Number(cooldownLeft);
  if (Number.isFinite(cd) && cd > 0) return false;   // 冷却未转好
  if (!skillUnlocked(state, skill.id)) return false; // 未解锁不放

  const t = skillTactic(state, skill.id);
  if (t.mode === "bossOnly") return !!isBoss;
  if (t.mode === "belowHp") {
    const hp = Number(heroHpPct);
    const pct = Number.isFinite(hp) ? Math.min(1, Math.max(0, hp)) : 1;
    return pct <= t.threshold;
  }
  return true; // "auto"（未知模式兜底为 auto）
}

// ---- 战术归一化（内部）：接受 "auto"|"bossOnly"|"belowHp" 或 {mode,threshold} ----
function normalizeTactic(t, entry) {
  const fallback = entry && entry.tactics ? entry.tactics : DEFAULT_TACTIC;
  const def = normalizeTacticShape(fallback);
  const shape = normalizeTacticShape(t);
  if (!shape) return def; // 缺失/非法 → 条目默认（条目默认也非法则 {mode:"auto"}）
  if (!TACTIC_MODES.includes(shape.mode)) return def;
  const out = { mode: shape.mode };
  if (shape.mode === "belowHp") {
    const th = Number(shape.threshold);
    out.threshold = Number.isFinite(th) ? Math.min(1, Math.max(0, th)) : DEFAULT_BELOW_HP;
  }
  return out;
}

function normalizeTacticShape(t) {
  if (typeof t === "string") return { mode: t };
  if (t && typeof t === "object" && typeof t.mode === "string") return { mode: t.mode, threshold: t.threshold };
  return null;
}

// ---- 技能记录归一化（内部）：数字 0/1 / 对象 / 缺失 → { unlocked, tactic } ----
function normalizeSkillRecord(raw, entry) {
  const defTactic = normalizeTactic(entry && entry.tactics, entry).mode;
  let unlocked = 0;
  let tactic = defTactic;
  if (raw !== undefined && raw !== null) {
    if (typeof raw === "object") {
      unlocked = raw.unlocked ? 1 : 0;
      const t = normalizeTactic(raw.tactic, entry);
      if (raw.tactic !== undefined && raw.tactic !== null) tactic = t.mode === "belowHp" ? t : t.mode;
    } else if (typeof raw === "boolean") {
      unlocked = raw ? 1 : 0;
    } else {
      const n = Number(raw);
      if (Number.isFinite(n)) unlocked = n > 0 ? 1 : 0;
    }
  }
  return { unlocked, tactic };
}

// ---------------------------------------------------------------------------
// 伙伴（队伍 x 定位为 320x180 帧内坐标，站在英雄 x=110 与怪物 x=225 之间）：
//   atkPct：以主勇者攻击为基准的倍率；irene 为 healBased（治疗/护盾按生命基准）
//   unlock：解锁方式 { type:"bossKill", cost:{gold:500} } 或 { type:"embers", cost:N }
//   等级成长：每级 +10% 数值（companionLevelMult）；升级消耗余烬 5×当前级
// ---------------------------------------------------------------------------
export const COMPANIONS = {
  vera: {
    name: "秘法使·薇拉", x: 24, atkPct: 0.9, aspd: 0.8,
    unlock: { type: "bossKill", cost: { gold: 500 } }, desc: "法术爆发+灼烧",
  },
  irene: {
    name: "圣愈者·艾琳", x: 50, healBased: true,
    unlock: { type: "embers", cost: 10 }, desc: "治疗+护盾+净化",
  },
  kai: {
    name: "影刃·凯", x: 78, atkPct: 0.55, aspd: 1.6,
    unlock: { type: "embers", cost: 25 }, desc: "连击+流血+斩杀",
  },
};

export const COMPANION_SKILLS = {
  vera: [
    { id: "arcaneBolt", cd: 4, desc: "130% 法强奥术弹" },
    { id: "chainNova", cd: 12, desc: "链式新星 90% x3 目标(单体BOSS则全额)" },
  ],
  irene: [
    { id: "healWave", cd: 8, desc: "治疗血量最低者 12% 其最大生命" },
    { id: "aegis", cd: 14, desc: "全队护盾 6% 最大生命" },
    { id: "purify", cd: 20, desc: "净化全队中毒/流血" },
  ],
  kai: [
    { id: "flurry", cd: 6, desc: "连击 3 x 60%" },
    { id: "bleedingStrike", cd: 9, desc: "施加流血 每秒25%攻击 5秒" },
    { id: "execute", cd: 15, desc: "对低于 20% 血目标 300% 斩杀" },
  ],
};

export const COMPANION_LEVEL_GROWTH = 0.10; // 伙伴每级 +10% 数值

/** 伙伴等级数值倍率：等级 L → 1 + 0.10×(L-1)（1 级 = ×1，逐级线性） */
export function companionLevelMult(level) {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  return 1 + COMPANION_LEVEL_GROWTH * (lv - 1);
}

/** 伙伴从当前等级升到下一级的余烬消耗：5 × 当前级 */
export function companionUpgradeCost(level) {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  return 5 * lv;
}

// ---------------------------------------------------------------------------
// 羁绊：members 全部在场（hero 恒在场，伙伴须上阵）才激活。
// mods 为 bondMods 汇总的数值来源；带成员范围的加成（如铁血前哨仅 hero/kai
// 吸血）由战斗层按 activeBonds(state) 自行取 BONDS 条目做成员级判定。
// ---------------------------------------------------------------------------
export const BONDS = [
  {
    id: "undyingFlame", name: "不灭微火", members: ["hero", "irene"],
    desc: "治疗溢出转护盾（上限 20% 最大生命）",
    mods: { overflowShield: true, healShieldCapPct: 0.2 },
  },
  {
    id: "arcaneResonance", name: "奥术共鸣", members: ["vera", "kai"],
    desc: "凯的攻击附加 15% 灼烧",
    mods: { burnOnHitPct: 0.15 },
  },
  {
    id: "ironVanguard", name: "铁血前哨", members: ["hero", "kai"],
    desc: "两人吸血 +8%", // 仅 hero 与 kai 生效
    mods: { lifestealPct: 0.08 },
  },
  {
    id: "sanctuary", name: "圣光庇护", members: ["irene", "vera"],
    desc: "全队受伤 -8%",
    mods: { dmgReducePct: 0.08 },
  },
  {
    id: "emberLegion", name: "余烬远征军", members: ["hero", "vera", "irene", "kai"],
    desc: "全队爆伤 +25%",
    mods: { critDmgPct: 0.25 },
  },
];

/** 当前在场成员集合（内部）：hero 恒在场；伙伴须在 party.active 中 */
function fieldMembers(state) {
  const set = new Set(["hero"]);
  const party = state && typeof state === "object" ? state.party : null;
  if (party && Array.isArray(party.active)) {
    for (const id of party.active) {
      if (typeof id === "string" && COMPANIONS[id]) set.add(id);
    }
  }
  return set;
}

/** 激活的羁绊数组（members 全部在场才激活） */
export function activeBonds(state) {
  const present = fieldMembers(state);
  return BONDS.filter((b) => Array.isArray(b.members) && b.members.every((m) => present.has(m)));
}

/**
 * 羁绊数值汇总（把激活羁绊的 mods 逐项累加）：
 *   lifestealPct     吸血加成（铁血前哨仅对 hero/kai 生效，成员范围见 BONDS）
 *   dmgReducePct     全队受伤减免
 *   critDmgPct       全队暴击伤害加成（叠加到暴击倍率上，如 1.5 → 1.75）
 *   burnOnHitPct     凯的攻击附加灼烧（占其攻击比例，奥术共鸣）
 *   overflowShield   治疗溢出转护盾开关（不灭微火）
 *   healShieldCapPct 溢出护盾上限（占最大生命比例）
 *   bonds            激活羁绊 id 列表（战斗层做成员级判定的依据）
 */
export function bondMods(state) {
  const mods = {
    lifestealPct: 0,
    dmgReducePct: 0,
    critDmgPct: 0,
    burnOnHitPct: 0,
    overflowShield: false,
    healShieldCapPct: 0,
    bonds: [],
  };
  for (const bond of activeBonds(state)) {
    mods.bonds.push(bond.id);
    const m = bond.mods || {};
    for (const key of ["lifestealPct", "dmgReducePct", "critDmgPct", "burnOnHitPct", "healShieldCapPct"]) {
      const v = Number(m[key]);
      if (Number.isFinite(v) && v > 0) mods[key] += v;
    }
    if (m.overflowShield) mods.overflowShield = true;
  }
  return mods;
}

// ============================================================================
// 《勇者闯地下城》V2.0 · js/combat.js
// 战斗模拟核心：怪物生成/走入动画、双方攻击计时、伤害与暴击、掉落/金币/经验
// 入账、升级检查、层数推进、Boss 30 秒倒计时、英雄死亡 3 秒复活、停留本层开关。
//
// 纯逻辑模块（无 DOM / 无音频）：表现经 hooks.onEvent(type, payload) 上抛给
// main（main 再映射特效与音效），渲染所需的展示状态经 view 暴露（main 每帧读）。
// view.hero.anim{name,t,dur}/clock：英雄动作计时与动画时钟，供 main 的主题层
// 按攻击进度选 前摇→挥砍→收招 3 帧、按时钟循环 4 帧待机（combat 自身仍按 V1
// 2 帧规则写 view.hero.sprite，作为未接入新帧时的兜底，行为不变）。
//
// ---- 事件类型（引擎↔界面契约）----
//   hit{x,y,dmg}  crit{x,y,dmg}  kill{x,y,monster,gold}  gold{amount,from}
//   drop{item}  levelup{x,y,newLevel}  bossSpawn{x,y,name}  bossFail{x,y}
//   respawn{x,y}  floorAdvance{floor}  heroHurt{x,y,dmg}  poison{x,y}
//   autosell{x,y,item,amount}  skillUnlock{x,y,skillId,name}
//   （gold.from 为附加信息字段；kill.gold 为含乘区的实际入账，供日志取数）
// ---- M3 新增事件（旧 main 缺 case 时走 default 无害）----
//   skillCast{x,y,skillId,name,dmg?,shield?,dur?}   主勇者技能施放
//     crack→dmg/shield→shield/dur、warcry→dur（表现层按 skillId 映射特效音效）
//   lightning{x,y,dmg,name}     暗金 chainLightning/lightningOnHit 闪电追加伤害
//   dotTick{x,y,dmg,kind:"burn"|"bleed"}   灼烧/流血 DoT 每秒跳字
//   dotApply{x,y,kind,dur}      DoT 首次施加/刷新（表现层起 status 循环特效）
//   chill{x,y}                  暗金 chillOnCrit：怪物攻速被缓（首次施加时）
//   reflect{x,y,dmg}            反伤（护盾反伤/荆棘/暗金 reflect）结算
//   lifesteal{x,y,amount}       吸血回血飘字（含羁绊「不灭微火」溢出转护盾部分）
//   cheatDeath{x,y,hp}          暗金 cheatDeath：致命伤免死并回血
//
// ---- HUD 数据接口（getHudState）----
//   monster {name, hpPct, maxHp, tags, isBoss, bossTimerPct}
//     tags：精英（data.monsterFor 15 层起 20% 概率产出，combat 消费 data.isElite/
//           tags，不再自行掷点）/ 剧毒（毒蘑菇）/ 高甲（def≥10）
//     bossTimerPct：Boss 接战期（fight/heroDead）剩余时间比例 1→0，否则 null
//   heroes [{role, hpPct, shieldPct, buffs}]  主勇者恒第 0 位；伙伴随
//     party.active 上报（M4 实装伙伴战斗，本里程碑伙伴恒满血展示位）；
//     护盾为实时值（圣火护盾/护盾暴击/治疗溢出），buffs 为激活增益 id
//     （"shield"/"warcry"/"berserk"）
//   skills [{id, name, cd, cdMax, cdPct, ready, unlocked, tactic}]  3 个主勇者
//     技能全量常驻（含未解锁：ready=false）；cd=剩余冷却秒、cdMax=本期冷却
//     （relic/副词条 cdrPct 缩减后）、cdPct=剩余比例（1=刚释放→0=转好）；
//     tactic={mode:"auto"|"bossOnly"|"belowHp"}，belowHp 另带 threshold(0~1)
//   pendingRelics/pendingEvents：state 对应队列长度
//   dps {dps, total, peak, cumulative, sources{attack,skill,companion,dot}}  滚动 10 秒
//     伤害窗口统计（总 DPS=窗口伤害/10；dps 为 total 的别名，供 ui 读取）；
//     cumulative 为本场累计输出（init 起全部入怪伤害求和，ui「累计输出」口径）
//
// ---- M3 机制总览 ----
//   1) 主勇者技能：HERO_SKILLS（skills.js）等级解锁（onKill → syncHeroSkillUnlocks
//      → skillUnlock 事件）；冷却按墙钟走表（relic/副词条 cdrPct 缩减，封顶 60%）；
//      skillReady 战术判定（tactic 存 state.skills[id].tactic，UI 可改）；
//      效果——crack：180% 攻击伤害 + 破甲 30% 5 秒（怪物 def ×0.7）；shield：
//      护盾 15% maxHp（吸收优先，上限 30% maxHp）+ 反伤 20% 6 秒；warcry：
//      全队攻速 +20%、暴击 +10% 8 秒（战斗内派生值，不改英雄面板）。
//      同增益在身时不重复施放（shield/warcry）；技能伤害可暴击、吃爆伤乘区。
//   2) 暗金 hooks 引擎（data.js UNIQUES 契约已交付）：装备栏 4 部位物品的
//      uniqueId → data.uniqueById(id).hooks 按 {on, effect, value} 触发（持有者
//      =英雄视角）。on 触发点：crit/onHit/onHurt/onKill/onHpLoss10/onDeath/
//      passive（大小写不敏感；缺省按 effect 语义推导）。effect 全量实现：
//      chainLightning（暴击闪电链真伤 value×攻）、lightningOnHit（命中 value×攻
//      落雷，可选 chance）、lifesteal（攻击吸血 value）、berserkOnHpLoss
//      （onHpLoss10：每损 10% maxHp 一档、攻速 +value×档位，治疗回落降档）、
//      partyCdrOnCrit（暴击记伙伴 CD 信用 value 秒，M4 伙伴实装前仅累计，
//      getMechanicsDebug 可读）、reflect/thorns（反弹所受伤害 value 比例）、
//      shieldOnCrit（暴击得 value×maxHp 护盾）、burnOnHit（点燃每秒 value×攻，
//      持续 dur 秒）、bleedTouch（叠层流血每层每秒 value×攻，至多 stack 层）、
//      execute（目标血量 <threshold 时伤害 +value）、goldPct（金币 +value）、
//      goldOnKill（击杀额外金币 = 怪物金币 × value）、chillOnCrit（暴击缓速
//      value，持续 dur 秒）、critDmg（爆伤 +value）、hpCostOnCrit（暴击自损
//      value×maxHp，不致死）、cheatDeath（致命伤原地满血复活 value 次/场，
//      每场 Boss 战限 1 次——按「每只怪入场重置次数」实现）。
//   3) 词条乘区（relics.relicMods / relics.talentMods / 装备 affixes /
//      skills.bondMods）：critDmgPct 爆伤、lifestealPct 吸血、thornsPct 反伤、
//      goldPct/goldOnKill 金币、dropLuck 掉落品质（低于稀有整件重掷取优）、
//      cdrPct 技能冷却缩减、dotDmgPct/poisonDmgPct/bleedDmgPct DoT 增伤、
//      critCap/aspdCap 上限已由 state.computeDerived 消费、bond dmgReducePct
//      受伤减免、bond overflowShield 治疗溢出转护盾（上限 healShieldCapPct）。
//   4) DPS 统计：滚动 10 秒伤害窗口按来源 attack/skill/companion(占位)/dot
//      分桶，getHudState().dps 填真实值（总 DPS=窗口伤害/10）。
// ============================================================================

import {
  BALANCE, CRIT_CAP, BOSS_ROSTER, monsterFor, rollDamage, rollItem,
} from "./data.js";
// 命名空间导入：UNIQUES / uniqueById 由 M3 刷宝里程碑并行交付到 data.js，
// 缺失导出时访问得到 undefined（ESM 命名空间取属性不抛错），引擎静默空转。
import * as dataNs from "./data.js";
import { computeDerived, applyXp, addChronicle } from "./state.js";
import { RELICS, relicMods, talentMods, rollRelicChoices } from "./relics.js";
import { EVENTS, MILESTONE_TEXTS } from "./narrative.js";
import {
  HERO_SKILLS, HERO_SKILL_MAP, COMPANIONS, COMPANION_SKILLS,
  companionLevelMult, skillUnlocked, skillTactic, skillReady, syncHeroSkillUnlocks, bondMods,
} from "./skills.js";

// ---- 场景常量（320x180 帧；美术定位：英雄脚底 (110,150)，怪物脚底 (225,150)）----
export const HERO_X = 110;
export const MONSTER_X = 225;
export const GROUND_Y = 150;

const WALK_SPEED = 150;        // 怪物走入速度（px/s，340→225 约 0.77s）
const ENTER_X = 340;           // 走入起点（屏外）
const HERO_SWING_TIME = 0.24;  // 英雄攻击动画时长（atk0→atk1 各半）
const HERO_HURT_TIME = 0.30;   // 英雄受击动画时长
const FLASH_TIME = 0.12;       // 受击闪白时长
const MON_IDLE_FRAME_SEC = 0.4;  // 怪物待机两帧切换周期
const MON_WALK_FRAME_SEC = 0.14; // 怪物走入时切换周期（碎步感）
const HERO_IDLE_FRAME_SEC = 0.45;

const HIGH_ARMOR_DEF = 10;  // 怪物 def≥10 判「高甲」（data.js: def=f×0.5 → 20 层起）
                            // 注：精英化由 data.monsterFor 统一产出（ELITE_FLOOR/
                            // ELITE_CHANCE），combat 只消费 data.isElite/tags，不再自行掷点

// ---- M3 技能/机制常量 ----
const DPS_WINDOW = 10;         // DPS 统计滚动窗口（秒）
const SHIELD_CAP_PCT = 0.30;   // 英雄护盾总量上限（占 maxHp；圣火护盾/暴击护盾共享）
const ARMOR_BREAK_DUR = 5;     // 裂地重斩破甲持续时间（秒，任务规格）
const DOT_TICK = 1.0;          // DoT 结算周期（秒）
const CDR_MAX = 0.6;           // 冷却缩减总封顶（60%）
const HP_TIER_STEP = 0.1;      // berserkOnHpLoss 档位步长：每损 10% maxHp 一档
const BLEED_DUR_DEF = 5;       // bleedTouch 未给 dur 时每层流血持续时间（秒）
const CRIT_ZONE_MAX = 5;       // 爆伤乘区加成封顶（+500%，防坏档数值爆炸）
const REFLECT_MAX = 2;         // 反伤比例封顶（200%）
const EXECUTE_BONUS_MAX = 5;   // 斩杀加成封顶
const EXECUTE_THRESHOLD_DEF = 0.25; // execute 未给阈值时的默认血线

// ---- 运行时（init 时重置）----
let S = null;        // state 引用（原地读写）
let hooks = null;    // { onEvent(type, payload) }
let phase = "idle";  // idle | enter | fight | kill | heroDead
let monster = null;  // { data, hpNow, maxHp, index, tags, elite }
let heroTimer = 0;   // 英雄下次攻击倒计时
let monTimer = 0;    // 怪物下次攻击倒计时
let phaseTimer = 0;  // kill/heroDead 阶段倒计时
let bossTimer = 0;   // Boss 战剩余秒数
let heroClock = 0;   // 动画时钟
let monClock = 0;
let nowT = 0;        // 墙钟（秒，update 累计；DPS 窗口/冷却/计时共用时间轴）
const heroAnim = { name: "idle", t: 0, dur: 0 }; // dur=本次动作总时长（供 main 选前摇/挥砍/收招帧）

// ---- 英雄战斗状态 ----
let heroShieldHp = 0; // 当前护盾值（伤害优先扣减；圣火护盾/暴击护盾/溢出护盾共享）
let heroBuffs = [];   // 主勇者增益 [{id:"shield"|"warcry", t:剩余秒}]；berserk 按已损血档位实时推导
let heroPoisonT = 0;  // 英雄中毒剩余秒数（毒蘑菇攻击施加，艾琳净化可清除）
let heroPoisonAcc = 0;
const skillCd = {};   // 主勇者技能剩余冷却（秒），键 = HERO_SKILLS 的 id
let cheatCharges = 0; // cheatDeath 剩余免死次数（每只怪入场重置为暗金 value；Boss 战限 1 次）

// ---- 伙伴运行时（M4 实战）----
const COMPANION_ORDER = ["vera", "irene", "kai"];
const COMP_ACT_TIME = 0.28;
const COMP_IDLE_FRAME_SEC = 0.45;
const compState = {
  vera: { atkTimer: 0.4, skillCds: {}, anim: { name: "idle", t: 0, dur: COMP_ACT_TIME }, clock: 0 },
  irene: { atkTimer: 0.4, skillCds: {}, anim: { name: "idle", t: 0, dur: COMP_ACT_TIME }, clock: 0.15 },
  kai: { atkTimer: 0.4, skillCds: {}, anim: { name: "idle", t: 0, dur: COMP_ACT_TIME }, clock: 0.3 },
};

// ---- 怪物减益状态（spawnMonster 重置）----
const monDebuff = {
  armorBreakT: 0, armorBreakPct: 0,                    // 裂地重斩破甲：def ×(1-pct)
  chillT: 0, chillPct: 0,                              // chillOnCrit：怪物攻速缓 pct
  burn: { t: 0, dps: 0, acc: 0 },                      // 灼烧 DoT：每秒 dps（带小数累积）
  bleed: { t: 0, dps: 0, acc: 0, layers: 0, perLayer: 0, stack: 1 }, // 流血叠层：每层每秒 perLayer
};
let dotAcc = 0;      // DoT 秒节拍累积器

// ---- DPS 统计（滚动窗口）----
let dpsLog = [];     // [{t, n, src}] src ∈ attack|skill|companion|dot
let dpsPeak = 0;     // 窗口 DPS 峰值（0.5s 采样）
let dpsSampleAcc = 0;
let dpsCumulative = 0; // 本场累计输出（init 起全部入怪伤害求和；HUD「累计输出」口径）

// ---- 暗金 hooks 缓存（装备签名变化才重建；partyCdrOnCrit 记录累计）----
let hookCache = [];  // [{id, effect, trigger, value, chance, dur, threshold, maxStacks}]
let hookSig = "";
const uniqueRuntime = { partyCdrCredit: 0, partyCdrProcs: 0 };

// ---- 渲染展示状态（main 每帧读取；坐标为 320x180 帧内坐标）----
export const view = {
  // anim/clock：动画计时暴露给 main（主题层驱动 3 帧攻击/4 帧待机选帧用）
  hero: { x: HERO_X, y: GROUND_Y, sprite: "hero_idle0", flash: 0, alpha: 1, anim: { name: "idle", t: 0, dur: 0 }, clock: 0 },
  companions: [], // [{ id, x, y, anim:{name,t,dur}, clock, alpha }]
  monster: { x: ENTER_X, y: GROUND_Y, sprite: "slime0", flash: 0, alpha: 1, visible: false },
  // 附加信息（契约之外，供调试/潜在 HUD）：
  monsterHp: 0,
  monsterMaxHp: 0,
  monsterName: "",
  bossTimeLeft: 0,
  phase: "idle",
};

function emit(type, payload) {
  if (!hooks || typeof hooks.onEvent !== "function") return;
  try {
    hooks.onEvent(type, payload);
  } catch (e) {
    // 表现层异常不允许打断战斗模拟
    console.error(`combat: 事件 "${type}" 处理失败`, e);
  }
}

function setHeroAnim(name, dur) {
  heroAnim.name = name;
  heroAnim.t = dur;
  heroAnim.dur = dur;
}

// ---------------------------------------------------------------------------
// 数值小工具
// ---------------------------------------------------------------------------
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
/** 取第一个有限正数值，否则默认值（暗金/词条字段容错读取） */
function pos(v, def) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}
/** 依次取对象中第一个有限数值字段（并行交付 schema 的键名容错） */
function upick(obj, keys, def) {
  for (const k of keys) {
    const n = Number(obj && obj[k]);
    if (Number.isFinite(n)) return n;
  }
  return def;
}

// ---------------------------------------------------------------------------
// 暗金 hooks 引擎：装备 uniqueId → data.UNIQUES/uniqueById 查条目 → 归一化 hooks
// （data.js M3 段并行交付中：优先 uniqueById(id) 函数；缺失时按数组/对象
//   兜底查 UNIQUES；全缺失则空转，零开销等待交付）
// ---------------------------------------------------------------------------
const SLOTS = ["weapon", "head", "armor", "trinket"];

function equippedUniqueIds() {
  const eq = (S && S.equipped) || {};
  const ids = [];
  for (const slot of SLOTS) {
    const it = eq[slot];
    // item.uniqueId/unique 为暗金标识（narrative.UNIQUE_FLAVOR 键）；item.uid 是
    // 实例 id，绝不可参与匹配。
    const uid = it && (it.uniqueId || it.unique);
    if (typeof uid === "string" && uid) ids.push(uid);
  }
  return ids;
}

function resolveUnique(id) {
  if (typeof dataNs.uniqueById === "function") {
    try {
      const u = dataNs.uniqueById(id);
      if (u && typeof u === "object") return u;
    } catch { /* 数据层异常按未知暗金处理 */ }
  }
  const raw = dataNs.UNIQUES;
  if (Array.isArray(raw)) {
    return raw.find((u) => u && typeof u === "object" && (u.id === id || u.uid === id)) || null;
  }
  if (raw && typeof raw === "object") {
    const u = raw[id];
    return u && typeof u === "object" ? u : null;
  }
  return null;
}

/** 条目 → 归一化 hook 列表：支持 hooks:[{on,effect,value}] 与直挂 {effect,value} 两种形状 */
function hooksOf(u) {
  const out = [];
  const list = u.hooks ?? u.effects;
  if (Array.isArray(list)) {
    for (const h of list) {
      if (h && typeof h === "object" && typeof h.effect === "string") out.push(h);
    }
  } else if (typeof u.effect === "string") {
    out.push({ on: u.on, effect: u.effect, value: u.value, chance: u.chance, dur: u.dur, threshold: u.threshold, maxStacks: u.maxStacks });
  }
  return out;
}

// on 触发点归一（data.js UNIQUES 契约：crit/onHit/onHurt/onKill/onHpLoss10/
// onDeath/passive；大小写不敏感，on 缺省按 effect 语义推导）
const ON_MAP = {
  hit: "strike", onhit: "strike", attack: "strike", onattack: "strike", strike: "strike",
  crit: "crit", oncrit: "crit",
  kill: "kill", onkill: "kill",
  hurt: "hurt", onhurt: "hurt", hploss: "hurt", onhploss: "hurt", damaged: "hurt",
  hptier: "hptier", onhpolss10: "hptier", hpolss10: "hptier", hpolss: "hptier",
  death: "death", ondeath: "death", lethal: "death",
  passive: "passive", static: "passive", always: "passive", equip: "passive",
};
const DEFAULT_TRIGGER = {
  chainLightning: "crit", lightningOnHit: "strike", lifesteal: "passive",
  berserkOnHpLoss: "hptier", partyCdrOnCrit: "crit", reflect: "passive", thorns: "passive",
  shieldOnCrit: "crit", burnOnHit: "strike", bleedTouch: "strike", execute: "passive",
  goldPct: "passive", goldOnKill: "kill", chillOnCrit: "crit", critDmg: "passive",
  hpCostOnCrit: "crit", cheatDeath: "death",
};

function refreshHooks() {
  const ids = equippedUniqueIds();
  const sig = ids.join(",");
  if (sig === hookSig) return;
  hookSig = sig;
  hookCache = [];
  for (const id of ids) {
    const u = resolveUnique(id);
    if (!u) continue;
    for (const raw of hooksOf(u)) {
      const effect = String(raw.effect);
      const onKey = String(raw.on ?? raw.trigger ?? "").toLowerCase().trim();
      hookCache.push({
        id,
        effect,
        trigger: ON_MAP[onKey] || DEFAULT_TRIGGER[effect] || "passive",
        value: Number(raw.value),
        chance: clamp01(upick(raw, ["chance", "proc", "rate"], 1)),
        dur: upick(raw, ["dur", "duration", "seconds"], 0),
        threshold: upick(raw, ["threshold", "belowHp", "hpPct"], 0),
        stack: Math.max(1, Math.round(upick(raw, ["stack", "maxStacks", "stacks"], 1))),
      });
    }
  }
}

/** 同 effect 的暗金 hook 数值求和（value 缺省给 def） */
function uniqSum(effect, def = 0) {
  let sum = 0;
  for (const h of hookCache) if (h.effect === effect) sum += pos(h.value, def);
  return sum;
}

// ---------------------------------------------------------------------------
// 词条乘区汇总（每次结算即时计算：遗物 22 项 + 天赋 8 项 + 羁绊 5 项的纯函数
//   遍历，每秒至多数次调用，成本可忽略）
// ---------------------------------------------------------------------------
function affixMods() {
  const out = {};
  const eq = (S && S.equipped) || {};
  for (const slot of SLOTS) {
    const it = eq[slot];
    const ax = it && Array.isArray(it.affixes) ? it.affixes : [];
    for (const a of ax) {
      if (!a || typeof a !== "object") continue;
      const k = String(a.key || "");
      const v = Number(a.value);
      if (k && Number.isFinite(v)) out[k] = (Number(out[k]) || 0) + v;
    }
  }
  return out;
}

function collectMods() {
  refreshHooks();
  return {
    relic: relicMods(S) || {},
    talent: talentMods(S) || {},
    bond: bondMods(S) || {},
    affix: affixMods(),
  };
}

/** 爆伤乘区加成（暴击伤害 ×(1+zone)；基础 1.5 由 data.rollDamage 承担） */
function critDmgZone(mods) {
  const v = (Number(mods.relic.critDmgPct) || 0) + (Number(mods.bond.critDmgPct) || 0) +
    (Number(mods.affix.critDmgPct) || 0) + uniqSum("critDmg", 0);
  return Math.min(CRIT_ZONE_MAX, Math.max(0, v));
}

/** 吸血比例（普攻/技能直接伤害结算；遗物+羁绊+副词条+暗金） */
function lifestealPct(mods) {
  const v = (Number(mods.relic.lifestealPct) || 0) + (Number(mods.bond.lifestealPct) || 0) +
    (Number(mods.affix.lifestealPct) || 0) + uniqSum("lifesteal", 0);
  return Math.min(1, Math.max(0, v));
}

/** 反伤比例（荆棘遗物/副词条 + 暗金 reflect/thorns + 圣火护盾增益 20%） */
function reflectPct(mods) {
  let v = (Number(mods.relic.thornsPct) || 0) + (Number(mods.affix.thornsPct) || 0) +
    uniqSum("reflect", 0) + uniqSum("thorns", 0);
  if (buffLeft("shield") > 0) v += pos(HERO_SKILL_MAP.shield && HERO_SKILL_MAP.shield.reflect, 0.2);
  return Math.min(REFLECT_MAX, Math.max(0, v));
}

/** 金币乘区（goldPct 词条/暗金）+ goldOnKill（击杀额外金币 = 怪物金币 × value） */
function goldZones(mods) {
  const pct = Math.max(0, (Number(mods.relic.goldPct) || 0) + (Number(mods.talent.goldPct) || 0) +
    (Number(mods.affix.goldPct) || 0) + uniqSum("goldPct", 0));
  const onKillPct = Math.max(0, uniqSum("goldOnKill", 0));
  return { pct, onKillPct };
}

/** 掉落品质（dropLuck：遗物+天赋；onKill 掉落重掷用） */
function dropLuck(mods) {
  return Math.min(1, Math.max(0, (Number(mods.relic.dropLuck) || 0) + (Number(mods.talent.dropLuck) || 0)));
}

/** 技能冷却倍率（relic/副词条 cdrPct，封顶 60% 缩减） */
function cdrMul(mods) {
  const cdr = Math.max(0, (Number(mods.relic.cdrPct) || 0) + (Number(mods.affix.cdrPct) || 0));
  return 1 - Math.min(CDR_MAX, cdr);
}

/** DoT 增伤乘数：通用 dotDmgPct + 细分 poison/bleedDmgPct（副词条词汇） */
function dotMult(mods, kind) {
  const base = Math.max(0, Number(mods.relic.dotDmgPct) || 0);
  const sub = kind === "bleed"
    ? Math.max(0, Number(mods.affix.bleedDmgPct) || 0)
    : Math.max(0, Number(mods.affix.poisonDmgPct) || 0);
  return Math.max(0.1, 1 + base + sub);
}

/** execute 斩杀：{bonus, threshold}（多件同效果：加成求和、血线取最高） */
function executeMod() {
  let bonus = 0;
  let thr = 0;
  let any = false;
  for (const h of hookCache) {
    if (h.effect !== "execute") continue;
    any = true;
    bonus += pos(h.value, 0.5);
    thr = Math.max(thr, pos(h.threshold, EXECUTE_THRESHOLD_DEF));
  }
  return any ? { bonus: Math.min(EXECUTE_BONUS_MAX, bonus), threshold: Math.min(0.9, thr) } : null;
}

// ---------------------------------------------------------------------------
// 战斗内派生值（不改英雄面板：warcry/berserk 只在本模块生效）
// ---------------------------------------------------------------------------
function buffLeft(id) {
  const b = heroBuffs.find((x) => x.id === id);
  return b ? b.t : 0;
}

function addBuff(id, dur) {
  const b = heroBuffs.find((x) => x.id === id);
  if (b) b.t = Math.max(b.t, dur);
  else heroBuffs.push({ id, t: dur });
}

/** 有效攻速（次/秒）= 面板攻速 × 战吼(1+20%) × 狂战档位(1+value×已损血档位) */
function effAspd() {
  let mul = Math.max(0.1, Number(S.hero.aspd) || 1);
  if (buffLeft("warcry") > 0) mul *= 1 + pos(HERO_SKILL_MAP.warcry && HERO_SKILL_MAP.warcry.aspdPct, 0.2);
  const bk = berserkInfo();
  if (bk.tier > 0) mul *= 1 + bk.pct;
  return Math.min(10, mul);
}

/**
 * berserkOnHpLoss（bloodOath，on:onHpLoss10）：每累计损失 10% maxHp 一个档位，
 * 攻速 +value×档位；治疗回落（击杀回满血）自然降档。多件求和。
 * 返回 {tier, pct}（tier=0 时 pct=0；HUD buff/调试口同源）。
 */
function berserkInfo() {
  const maxHp = Math.max(1, Number(S.hero.maxHp) || 1);
  const missing = Math.min(maxHp, Math.max(0, maxHp - (Number(S.hero.hpNow) || 0)));
  const tier = Math.floor(missing / (maxHp * HP_TIER_STEP));
  if (tier <= 0) return { tier: 0, pct: 0 };
  let pct = 0;
  for (const h of hookCache) if (h.effect === "berserkOnHpLoss") pct += pos(h.value, 0.12) * tier;
  return { tier: Math.min(10, tier), pct: Math.min(3, Math.max(0, pct)) };
}

/** 有效暴击率 = 面板暴击 + 战吼 10%（封顶含天赋 critCap 上限扩容） */
function effCrit(mods) {
  const capPts = CRIT_CAP + (Number(mods.talent.critCap) || 0) * 100;
  let crit = Math.max(0, Number(S.hero.critChance) || 0);
  if (buffLeft("warcry") > 0) crit += pos(HERO_SKILL_MAP.warcry && HERO_SKILL_MAP.warcry.critFlat, 0.1);
  return Math.min(capPts / 100, Math.max(0, crit));
}

/** 怪物有效防御（破甲期 def ×(1-30%)） */
function effMonDef(m) {
  const def = Math.max(0, Number(m.def) || 0);
  if (monDebuff.armorBreakT > 0) return def * (1 - Math.min(0.9, Math.max(0, monDebuff.armorBreakPct)));
  return def;
}

// ---------------------------------------------------------------------------
// DPS 统计（滚动 10 秒窗口）
// ---------------------------------------------------------------------------
function pushDps(n, src) {
  const v = Math.max(0, Number(n) || 0);
  if (v <= 0) return;
  dpsLog.push({ t: nowT, n: v, src: src === "skill" || src === "companion" || src === "dot" ? src : "attack" });
  dpsCumulative += v; // 累计口径与滚动窗口同源（同为 dealToMonster 入血口，不重复计数）
}

function pruneDps() {
  const cut = nowT - DPS_WINDOW;
  let i = 0;
  while (i < dpsLog.length && dpsLog[i].t < cut) i++;
  if (i > 0) dpsLog.splice(0, i);
}

function sampleDpsPeak(dt) {
  dpsSampleAcc += dt;
  if (dpsSampleAcc < 0.5) return;
  dpsSampleAcc = 0;
  let sum = 0;
  for (const e of dpsLog) sum += e.n;
  dpsPeak = Math.max(dpsPeak, sum / DPS_WINDOW);
}

function dpsWindow() {
  let total = 0;
  const sources = { attack: 0, skill: 0, companion: 0, dot: 0 };
  for (const e of dpsLog) {
    total += e.n;
    if (sources[e.src] !== undefined) sources[e.src] += e.n;
  }
  return {
    dps: total / DPS_WINDOW,
    total: total / DPS_WINDOW,
    peak: dpsPeak,
    cumulative: dpsCumulative, // 本场累计输出（伤害原值求和，非均值）
    sources: {
      attack: sources.attack / DPS_WINDOW,
      skill: sources.skill / DPS_WINDOW,
      companion: sources.companion / DPS_WINDOW,
      dot: sources.dot / DPS_WINDOW,
    },
  };
}

// ---------------------------------------------------------------------------
// 伤害入怪管线：唯一入血口（普攻/技能/闪电/反伤/DoT 全走这里）——
// 闪白、DPS 分桶、事件上抛、击杀检查一处收口
// ---------------------------------------------------------------------------
function dealToMonster(dmg, source, evt, extra) {
  if (phase !== "fight" || !monster) return false;
  const v = Math.max(0, Math.round(Number(dmg) || 0));
  if (v <= 0) return false;
  monster.hpNow -= v;
  view.monster.flash = FLASH_TIME;
  pushDps(v, source);
  const dead = monster.hpNow <= 0;
  if (evt) emit(evt, { x: MONSTER_X, y: GROUND_Y, dmg: v, ...(extra || {}) });
  if (dead) onKill();
  return dead;
}

/** 治疗入英雄（含羁绊「不灭微火」溢出转护盾）；heal 来源统一上抛 lifesteal 飘字 */
function healHero(amount, mods, emitEvt = "lifesteal") {
  const maxHp = Math.max(1, Number(S.hero.maxHp) || 1);
  const before = Math.max(0, Number(S.hero.hpNow) || 0);
  if (amount <= 0) return { healed: 0, shieldAdded: 0 };
  const canHeal = before < maxHp;
  if (canHeal) S.hero.hpNow = Math.min(maxHp, before + amount);
  const healed = canHeal ? S.hero.hpNow - before : 0;
  // 溢出转护盾（不灭微火：上限 healShieldCapPct × maxHp，总护盾共享 SHIELD_CAP_PCT）
  const overflow = amount - healed;
  let shieldAdded = 0;
  if (overflow > 0 && mods && mods.bond && mods.bond.overflowShield) {
    const cap = maxHp * Math.max(0, Number(mods.bond.healShieldCapPct) || 0);
    if (cap > 0) {
      const next = Math.min(maxHp * SHIELD_CAP_PCT, heroShieldHp + Math.min(overflow, cap));
      shieldAdded = Math.max(0, next - heroShieldHp);
      heroShieldHp = next;
    }
  }
  if (emitEvt && (Math.round(healed) > 0 || (emitEvt !== "lifesteal" && Math.round(shieldAdded) > 0))) {
    emit(emitEvt, { x: HERO_X, y: GROUND_Y, amount: Math.round(healed), shield: Math.round(shieldAdded) });
  }
  return { healed: Math.round(healed), shieldAdded: Math.round(shieldAdded) };
}

// ---------------------------------------------------------------------------
// 暗金 hook 结算（普攻/技能直击后调用；berserkOnHpLoss 走 berserkInfo 档位
// 模型——按已损生命档位实时推导，受伤叠档、治疗回落，无需事件挂点）
// ---------------------------------------------------------------------------
function onStrikeHooks(dmg, mods) {
  const atk = Math.max(1, Number(S.hero.atk) || 0);
  let burnDps = 0, burnDur = 0, burnHit = false;
  let bleedPerLayer = 0, bleedStack = 1, bleedDur = 0, bleedHit = false;
  for (const h of hookCache) {
    if (h.trigger !== "strike" || Math.random() > h.chance) continue;
    switch (h.effect) {
      case "chainLightning":
      case "lightningOnHit": {
        // 单体战斗：闪电链目标坍缩为全额单体真伤（与伙伴 chainNova「单体全额」同约定）
        const d = Math.max(1, Math.round(atk * pos(h.value, 1)));
        dealToMonster(d, "attack", "lightning", { name: h.id });
        break;
      }
      case "burnOnHit":
        burnDps += atk * pos(h.value, 0.2);
        burnDur = Math.max(burnDur, pos(h.dur, 4));
        burnHit = true;
        break;
      case "bleedTouch":
        // 叠层流血：每层每秒 value × 攻击力，至多 stack 层（层共享持续时间）
        bleedPerLayer += atk * pos(h.value, 0.08);
        bleedStack = Math.max(bleedStack, Math.max(1, h.stack || 1));
        bleedDur = Math.max(bleedDur, pos(h.dur, BLEED_DUR_DEF));
        bleedHit = true;
        break;
      default:
        break; // 其余 effect 不在直击触发点（trigger 归一已分流）
    }
  }
  if (burnHit) applyBurn(burnDps, burnDur, mods);
  if (bleedHit) applyBleedStack(bleedPerLayer, bleedStack, bleedDur, mods);
}

function onCritHooks(mods) {
  const atk = Math.max(1, Number(S.hero.atk) || 0);
  for (const h of hookCache) {
    if (h.trigger !== "crit" || Math.random() > h.chance) continue;
    switch (h.effect) {
      case "chainLightning":
      case "lightningOnHit": {
        // 暴击闪电链（thunderDawn）：value × 攻击力真实伤害
        const d = Math.max(1, Math.round(atk * pos(h.value, 1)));
        dealToMonster(d, "attack", "lightning", { name: h.id });
        break;
      }
      case "shieldOnCrit": {
        const add = Math.max(1, Number(S.hero.maxHp) || 1) * pos(h.value, 0.05);
        const cap = Math.max(1, Number(S.hero.maxHp) || 1) * SHIELD_CAP_PCT;
        heroShieldHp = Math.min(cap, heroShieldHp + add);
        break;
      }
      case "hpCostOnCrit": {
        // 暴击自损 value × maxHp（不致死：至少留 1 血）
        const cost = Math.max(1, Math.round(Math.max(1, Number(S.hero.maxHp) || 1) * pos(h.value, 0.02)));
        S.hero.hpNow = Math.max(1, (Number(S.hero.hpNow) || 0) - cost);
        break;
      }
      case "chillOnCrit": {
        const slow = Math.min(0.9, pos(h.value, 0.3));
        if (monDebuff.chillT <= 0) emit("chill", { x: MONSTER_X, y: GROUND_Y });
        monDebuff.chillPct = Math.max(monDebuff.chillPct, slow);
        monDebuff.chillT = Math.max(monDebuff.chillT, pos(h.dur, 3));
        break;
      }
      case "partyCdrOnCrit":
        // M4 伙伴实装前先记录：全队伙伴技能 CD -value 秒的信用累计 + 触发次数
        uniqueRuntime.partyCdrCredit += pos(h.value, 0.6);
        uniqueRuntime.partyCdrProcs += 1;
        break;
      default:
        break;
    }
  }
}

/**
 * 免死判定（英雄 hpNow≤0 时调用）：cheatDeath（phoenixFeather，on:onDeath）
 * 原地满血复活 value 次/场；次数在每只怪入场时重置（spawnMonster），每场
 * Boss 战限 1 次由 value=1 + 按场重置自然满足。次数耗尽返回 false → heroDown。
 */
function tryCheatDeath() {
  if (cheatCharges <= 0) return false;
  const h = hookCache.find((x) => x.effect === "cheatDeath");
  if (!h) return false;
  cheatCharges -= 1;
  S.hero.hpNow = Math.max(1, Number(S.hero.maxHp) || 1); // 原地满血复活
  emit("cheatDeath", { x: HERO_X, y: GROUND_Y, hp: S.hero.hpNow, left: cheatCharges });
  return true;
}

// ---------------------------------------------------------------------------
// DoT（灼烧/叠层流血）：每 1 秒结算一跳，小数伤害累积防吞；可击杀（onKill 收口）
// ---------------------------------------------------------------------------
/** 点燃（cinderHeart，on:onHit）：每秒 value×攻，持续 dur 秒；重复命中取最高 dps、刷新时长 */
function applyBurn(dps, dur, mods) {
  const val = Math.max(0, Number(dps) || 0) * dotMult(mods, "burn");
  if (val <= 0 || !(dur > 0)) return;
  const d = monDebuff.burn;
  const fresh = d.t <= 0;
  const increased = val > d.dps;
  d.dps = Math.max(d.dps, val);
  d.t = Math.max(d.t, dur);
  if (fresh || increased) emit("dotApply", { x: MONSTER_X, y: GROUND_Y, kind: "burn", dur: Math.round(d.t) });
}

/** 叠层流血（executionerScythe，on:onHit）：每层每秒 perLayer，至多 stack 层；命中 +1 层并刷新层时长 */
function applyBleedStack(perLayer, stack, dur, mods) {
  const layer = Math.max(0, Number(perLayer) || 0) * dotMult(mods, "bleed");
  if (layer <= 0 || !(dur > 0)) return;
  const d = monDebuff.bleed;
  const fresh = d.t <= 0;
  d.layers = Math.min(Math.max(1, stack), d.layers + 1);
  d.perLayer = Math.max(d.perLayer, layer); // 多件同效果：单层取最高
  d.stack = Math.max(d.stack, Math.max(1, stack));
  d.dps = d.layers * d.perLayer;
  d.t = Math.max(d.t, dur);
  if (fresh || d.layers > 1) emit("dotApply", { x: MONSTER_X, y: GROUND_Y, kind: "bleed", dur: Math.round(d.t), layers: d.layers });
}

function tickMonDebuffs(dt) {
  if (monDebuff.armorBreakT > 0) monDebuff.armorBreakT = Math.max(0, monDebuff.armorBreakT - dt);
  if (monDebuff.chillT > 0) {
    monDebuff.chillT = Math.max(0, monDebuff.chillT - dt);
    if (monDebuff.chillT <= 0) monDebuff.chillPct = 0;
  }
  {
    const b = monDebuff.burn;
    if (b.t > 0) {
      b.t = Math.max(0, b.t - dt);
      if (b.t <= 0) { b.dps = 0; b.acc = 0; }
    }
  }
  {
    const d = monDebuff.bleed;
    if (d.t > 0) {
      d.t = Math.max(0, d.t - dt);
      if (d.t <= 0) { d.dps = 0; d.acc = 0; d.layers = 0; d.perLayer = 0; }
    }
  }
}

function tickDots(dt) {
  dotAcc += dt;
  while (dotAcc >= DOT_TICK) {
    dotAcc -= DOT_TICK;
    for (const kind of ["burn", "bleed"]) {
      const d = monDebuff[kind];
      if (d.t <= 0 || d.dps <= 0) continue;
      d.acc += d.dps * DOT_TICK;
      const dmg = Math.floor(d.acc);
      if (dmg > 0) {
        d.acc -= dmg;
        dealToMonster(dmg, "dot", "dotTick", { kind });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 怪物生成：index = killsOnFloor（0..9），Boss 层 index 0 即 Boss。
// 精英由 data.monsterFor 统一产出（isElite/tags/hp×2/gold×3），此处只消费。
// ---------------------------------------------------------------------------
function spawnMonster() {
  const idx = Math.max(0, Math.min(BALANCE.MONSTERS_PER_FLOOR - 1, Math.floor(S.killsOnFloor) || 0));
  const data = monsterFor(S.floor, idx);

  // ---- HUD tags 契约：精英/剧毒/高甲（精英与 isElite 来自 data 层）----
  const tags = Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string" && t) : [];
  if (data.id === "mushroom" && !tags.includes("剧毒")) tags.push("剧毒");
  if (Number(data.def) >= HIGH_ARMOR_DEF && !tags.includes("高甲")) tags.push("高甲");
  monster = { data, hpNow: data.hp, maxHp: Math.max(1, Number(data.hp) || 1), index: idx, tags, elite: !!data.isElite };

  // 新怪入场：减益/DoT 清空（不跨怪继承）；cheatDeath 免死次数按场重置
  refreshHooks();
  cheatCharges = 0;
  for (const h of hookCache) {
    if (h.effect === "cheatDeath") cheatCharges += Math.max(1, Math.round(pos(h.value, 1)));
  }
  monDebuff.armorBreakT = 0;
  monDebuff.armorBreakPct = 0;
  monDebuff.chillT = 0;
  monDebuff.chillPct = 0;
  monDebuff.burn = { t: 0, dps: 0, acc: 0 };
  monDebuff.bleed = { t: 0, dps: 0, acc: 0, layers: 0, perLayer: 0, stack: 1 };
  dotAcc = 0;

  view.monster.visible = true;
  view.monster.x = ENTER_X;
  view.monster.y = GROUND_Y;
  view.monster.sprite = data.sprite + "0";
  view.monster.flash = 0;
  view.monster.alpha = 1;

  heroTimer = 0.3;                              // 怪物到位后英雄很快出手
  monTimer = BALANCE.MONSTER_ATTACK_INTERVAL;
  bossTimer = 0;
  phase = "enter";

  if (data.isBoss) emit("bossSpawn", { x: MONSTER_X, y: GROUND_Y, name: data.name });
}

function advanceFloor() {
  S.floor += 1;
  S.killsOnFloor = 0;
  S.bestFloor = Math.max(1, Math.floor(Number(S.bestFloor) || 1), S.floor);
  if (S.floor >= 20) addChronicle(S, MILESTONE_TEXTS.floor20, "floor20");
  if (S.floor >= 50) addChronicle(S, MILESTONE_TEXTS.floor50, "floor50");
  emit("floorAdvance", { floor: S.floor });

  // M5 奇遇入队：非 Boss 层、第 2 层起推层时 28% 概率触发，上限 5 不卡挂机
  if (
    S.floor >= 2 &&
    S.floor % BALANCE.BOSS_EVERY !== 0 &&
    Array.isArray(S.pendingEvents) &&
    S.pendingEvents.length < 5 &&
    Array.isArray(EVENTS) &&
    EVENTS.length > 0 &&
    Math.random() < 0.28
  ) {
    const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    const uid = "ev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 5);
    S.pendingEvents.push({ id: uid, eventId: ev.id });
    emit("eventQueued", { eventId: ev.id, name: ev.name, count: S.pendingEvents.length });
  }
}

// ---------------------------------------------------------------------------
// 击杀结算：金币（goldPct 乘区 + goldOnKill 固定）/经验/升级/掉落（dropLuck
// 重掷）/智能过滤 → 英雄回满血 → 层数推进 → 下一只走入 → v2 统计入账
// ---------------------------------------------------------------------------
function onKill() {
  const m = monster.data;
  const mods = collectMods();
  const goldBefore = Number(S.gold) || 0;

  // 金币：怪物体表金币 ×(1+goldPct 乘区 + goldOnKill 暗金比例)（最低 1）
  const gz = goldZones(mods);
  const goldGain = Math.max(1, Math.round(Math.max(0, Number(m.gold) || 0) * (1 + gz.pct + gz.onKillPct)));

  // 金币 + 经验（升级逐级回满血，见 LEVEL_BONUS 约定）
  S.gold = goldBefore + goldGain;
  const lvBefore = S.hero.level;
  applyXp(S, m.xp); // 内部已 computeDerived
  if (S.hero.level > lvBefore) {
    // 升级钩子（M2 修复）：按新英雄等级推进技能解锁（skills.js 契约的运行时
    // 调用点；数字 0 记录原地升级为细化形态），新解锁逐个上抛供日志/音效。
    for (const id of syncHeroSkillUnlocks(S)) {
      const entry = HERO_SKILL_MAP[id];
      emit("skillUnlock", { x: HERO_X, y: GROUND_Y, skillId: id, name: entry ? entry.name : id });
    }
    for (let lv = lvBefore + 1; lv <= S.hero.level; lv++) {
      emit("levelup", { x: HERO_X, y: GROUND_Y, newLevel: lv });
    }
  }

  // 掉落：Boss 必掉（rollItem 内部保证至少史诗），小怪 12%。
  // dropLuck 词条（遗物/天赋）：低于稀有的掉落按概率整件重掷一次取优
  // （稀有以上权重随 luck 提升；Boss 件已 ≥ 史诗不参与重掷）。
  // 智能过滤（M2 实装）：state.lootFilter.autoSellBelow = 1|2|3 时，rarity
  // 低于档位的掉落立即变现（+value 金币、不入背包、不发 drop 事件）；
  // 达到档位及以上的保留入包（档位 1=普通以下全留，2=稀有以上保留，
  // 3=史诗以上保留）；null=关闭。装备页过滤栏 UI 直写该字段（ui.js 契约）。
  let item = null;
  if (m.isBoss || Math.random() < BALANCE.DROP_CHANCE) {
    item = rollItem(S.floor, m.isBoss);
    const luck = dropLuck(mods);
    if (luck > 0 && item.rarity < 2 && Math.random() < luck) {
      const rerolled = rollItem(S.floor, m.isBoss);
      if (rerolled.rarity > item.rarity) item = rerolled;
    }
    const tier =
      S.lootFilter && typeof S.lootFilter === "object" ? Number(S.lootFilter.autoSellBelow) : 0;
    const rar = Math.min(3, Math.max(0, Math.floor(Number(item.rarity) || 0)));
    if ((tier === 1 || tier === 2 || tier === 3) && rar < tier) {
      const amount = Math.max(1, Math.floor(Number(item.value) || 0));
      const goldBeforeSell = Number(S.gold) || 0;
      S.gold = goldBeforeSell + amount;
      if (S.stats && typeof S.stats === "object") {
        S.stats.totalGold = (Number(S.stats.totalGold) || 0) + amount;
      }
      emit("autosell", { x: MONSTER_X, y: GROUND_Y, item, amount, from: goldBeforeSell });
      item = null; // 已变现：不入背包、不再走 drop 表现
    } else {
      S.inventory.push(item);
    }
  }

  // 英雄每次击杀后回满血（护盾值保留）
  S.hero.hpNow = S.hero.maxHp;

  // 事件（先 kill 后 gold/drop，日志顺序自然；kill.gold 为实际入账供日志取数）
  emit("kill", { x: MONSTER_X, y: GROUND_Y, monster: m, gold: goldGain });
  emit("gold", { amount: goldGain, from: goldBefore });
  if (item) emit("drop", { item });

  // v2 统计（state.stats 契约字段；离线结算同口径）
  if (S.stats && typeof S.stats === "object") {
    S.stats.kills = (Number(S.stats.kills) || 0) + 1;
    if (m.isBoss) S.stats.bossKills = (Number(S.stats.bossKills) || 0) + 1;
    S.stats.totalGold = (Number(S.stats.totalGold) || 0) + goldGain;
  }
  S.bestFloor = Math.max(1, Math.floor(Number(S.bestFloor) || 1), S.floor);

  // M5 Boss 击杀奖励：编年史首杀记录 + 三选一遗物入队（或按自动偏好标签直接选取）
  if (m.isBoss) {
    addChronicle(S, MILESTONE_TEXTS.firstBoss, "firstBoss");
    const opts = rollRelicChoices(S);
    if (opts.length > 0) {
      const autoTag = typeof S.relicAutoTag === "string" && S.relicAutoTag ? S.relicAutoTag : null;
      if (autoTag) {
        const picked =
          opts.find((id) => {
            const r = RELICS.find((x) => x.id === id);
            return r && r.tag === autoTag;
          }) || opts[0];
        if (!Array.isArray(S.relics)) S.relics = [];
        if (!S.relics.includes(picked)) S.relics.push(picked);
        computeDerived(S);
        const rObj = RELICS.find((x) => x.id === picked);
        emit("relicAutoPick", { relicId: picked, name: rObj ? rObj.name : picked });
      } else {
        if (!Array.isArray(S.pendingRelics)) S.pendingRelics = [];
        if (S.pendingRelics.length < 10) {
          const rid = "roll-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 5);
          S.pendingRelics.push({ id: rid, options: opts });
          emit("relicQueued", { options: opts, count: S.pendingRelics.length });
        }
      }
    }
  }

  // 层数推进：每层 10 只；停留本层开关打开则不推进（计数归零循环）
  S.killsOnFloor += 1;
  if (S.killsOnFloor >= BALANCE.MONSTERS_PER_FLOOR) {
    if (S.stayFloor) S.killsOnFloor = 0;
    else advanceFloor();
  } else if (m.isBoss && !S.stayFloor) {
    advanceFloor(); // Boss 层杀完 Boss 即便不足 10 只也进下一层
  }

  // 1 秒后下一只走入
  view.monster.visible = false;
  phase = "kill";
  phaseTimer = BALANCE.NEXT_MONSTER_DELAY;
}

// ---------------------------------------------------------------------------
// Boss 超时：退回上一层重刷
// ---------------------------------------------------------------------------
function bossFail() {
  emit("bossFail", { x: MONSTER_X, y: GROUND_Y });
  S.floor = Math.max(1, S.floor - 1);
  S.killsOnFloor = 0;
  view.monster.visible = false;
  phase = "kill";
  phaseTimer = BALANCE.NEXT_MONSTER_DELAY;
}

// ---------------------------------------------------------------------------
// 英雄阵亡：当前怪物血量回满，3 秒后满血复活
// ---------------------------------------------------------------------------
function heroDown() {
  S.hero.hpNow = 0;
  heroPoisonT = 0;
  heroPoisonAcc = 0;
  phase = "heroDead";
  phaseTimer = BALANCE.HERO_REVIVE_DELAY;
  monster.hpNow = monster.data.hp; // 当前怪物血量回满
  view.hero.alpha = 0.4;           // 濒死残影
  view.monster.flash = 0;
  monTimer = BALANCE.MONSTER_ATTACK_INTERVAL;
}

function reviveHero() {
  S.hero.hpNow = S.hero.maxHp;
  view.hero.alpha = 1;
  phase = "fight";
  heroTimer = 0.4;
  monTimer = BALANCE.MONSTER_ATTACK_INTERVAL;
  emit("respawn", { x: HERO_X, y: GROUND_Y });
}

// ---------------------------------------------------------------------------
// 主勇者技能（M3）：冷却走表 + skillReady 战术判定 + 效果实现
// ---------------------------------------------------------------------------
function tryCastSkills() {
  for (const entry of HERO_SKILLS) {
    if (phase !== "fight") return;   // 前一个技能的结算可能已击杀切阶段
    const cdLeft = Math.max(0, Number(skillCd[entry.id]) || 0);
    if (cdLeft > 0) continue;
    const hpPct = clamp01((Number(S.hero.hpNow) || 0) / Math.max(1, Number(S.hero.maxHp) || 1));
    if (!skillReady(entry, cdLeft, S, hpPct, !!monster.data.isBoss)) continue;
    // 同增益在身时不重复施放（战术 auto 下防无意义空转；冷却不进入）
    if (entry.id === "shield" && buffLeft("shield") > 0) continue;
    if (entry.id === "warcry" && buffLeft("warcry") > 0) continue;
    castSkill(entry);
  }
}

function castSkill(entry) {
  const mods = collectMods();
  skillCd[entry.id] = Math.max(0.5, (Number(entry.cd) || 1) * cdrMul(mods));
  if (entry.id === "crack") {
    // 裂地重斩：180% 攻击伤害（可暴击吃爆伤乘区）→ 命中后破甲 30% 5 秒
    const dmg = heroStrike(pos(entry.dmgMult, 1.8), "skill", { skillId: entry.id });
    monDebuff.armorBreakPct = Math.max(monDebuff.armorBreakPct, Math.min(0.9, pos(entry.armorBreak, 0.3)));
    monDebuff.armorBreakT = Math.max(monDebuff.armorBreakT, ARMOR_BREAK_DUR);
    emit("skillCast", {
      x: MONSTER_X, y: GROUND_Y, skillId: entry.id, name: entry.name,
      dmg, crit: false,
    });
  } else if (entry.id === "shield") {
    // 圣火护盾：+15% maxHp 护盾（总量封顶 30% maxHp）+ 反伤 20% 6 秒
    const dur = pos(entry.dur, 6);
    const cap = Math.max(1, Number(S.hero.maxHp) || 1) * SHIELD_CAP_PCT;
    heroShieldHp = Math.min(cap, heroShieldHp + Math.max(1, Number(S.hero.maxHp) || 1) * pos(entry.shieldPct, 0.15));
    addBuff("shield", dur);
    emit("skillCast", {
      x: HERO_X, y: GROUND_Y, skillId: entry.id, name: entry.name,
      shield: Math.round(heroShieldHp), dur,
    });
  } else if (entry.id === "warcry") {
    // 战吼狂暴：全队攻速 +20%、暴击 +10% 8 秒（effAspd/effCrit 战斗内生效）
    const dur = pos(entry.dur, 8);
    addBuff("warcry", dur);
    emit("skillCast", { x: HERO_X, y: GROUND_Y, skillId: entry.id, name: entry.name, dur });
  }
}

// ---------------------------------------------------------------------------
// 直击结算：普攻/技能共用——暴击爆伤乘区、execute 斩杀、暗金 hooks、吸血
// 返回实际伤害（castSkill 日志取数用）
// ---------------------------------------------------------------------------
function heroStrike(mult, source, opts = {}) {
  if (phase !== "fight" || !monster) return 0;
  const m = monster.data;
  const mods = collectMods();
  const atk = Math.max(0, Number(S.hero.atk) || 0) * Math.max(0, mult);
  const r = rollDamage(atk, effMonDef(m), effCrit(mods)); // critChance 0~1 小数
  let dmg = r.damage;
  if (r.crit) dmg = Math.max(1, Math.round(dmg * (1 + critDmgZone(mods))));
  // execute 低血斩杀：目标血线以下加成
  const ex = executeMod();
  if (ex && monster.maxHp > 0 && monster.hpNow / monster.maxHp <= ex.threshold) {
    dmg = Math.max(1, Math.round(dmg * (1 + ex.bonus)));
  }
  dealToMonster(dmg, source, r.crit ? "crit" : "hit", { skillId: opts.skillId });
  // 命中/暴击 hook（击杀后不再追加：DoT 与 proc 对尸体无意义）
  if (phase === "fight") {
    onStrikeHooks(dmg, mods);
    if (r.crit) onCritHooks(mods);
    const ls = lifestealPct(mods);
    if (ls > 0) healHero(dmg * ls, mods);
  }
  return dmg;
}

// ---------------------------------------------------------------------------
// 攻击结算
// ---------------------------------------------------------------------------
function heroAttack() {
  if (!monster || phase !== "fight") return;
  setHeroAnim("atk", HERO_SWING_TIME);
  heroStrike(1, "attack", {});
}

function monsterAttack() {
  if (!monster || phase !== "fight") return;
  const m = monster.data;
  const mods = collectMods();
  const r = rollDamage(m.atk, S.hero.def, 0); // 怪物不暴击
  // 羁绊「圣光庇护」：全队受伤减免（封顶 80%）
  const reduce = Math.min(0.8, Math.max(0, Number(mods.bond.dmgReducePct) || 0));
  const dmg = Math.max(1, Math.round(r.damage * (1 - reduce)));
  // 护盾优先吸收（圣火护盾/暴击护盾/治疗溢出护盾共用池）
  const absorbed = Math.min(heroShieldHp, dmg);
  if (absorbed > 0) heroShieldHp -= absorbed;
  const toHp = dmg - absorbed;
  if (toHp > 0) {
    S.hero.hpNow -= toHp;
    view.hero.flash = FLASH_TIME;
    setHeroAnim("hurt", HERO_HURT_TIME);
    emit("heroHurt", { x: HERO_X, y: GROUND_Y, dmg: toHp });
  }
  if (m.id === "mushroom") {
    heroPoisonT = Math.max(heroPoisonT, 3);
    emit("poison", { x: MONSTER_X, y: GROUND_Y }); // 毒蘑菇攻击时施加 3 秒中毒
  }
  if (S.hero.hpNow <= 0) {
    if (tryCheatDeath()) return;   // 免死：满血原地复活，继续战斗（次数耗尽则阵亡）
    heroDown();
    return;
  }
  // 反伤（英雄存活时结算）：护盾反伤/荆棘/暗金 reflect、thorns；可击杀怪物
  const rp = reflectPct(mods);
  if (rp > 0) {
    const refl = Math.max(1, Math.round(dmg * rp));
    dealToMonster(refl, "attack", "reflect", { name: "reflect" });
  }
}

// ---------------------------------------------------------------------------
// 伙伴战斗模拟（M4）：小队成员独立计时/普攻/技能/羁绊联动，不占勇者动作轨
// ---------------------------------------------------------------------------
function syncCompanionView() {
  const active = S && S.party && Array.isArray(S.party.active) ? S.party.active : [];
  const out = [];
  for (const id of COMPANION_ORDER) {
    if (!active.includes(id)) continue;
    const cDef = COMPANIONS[id];
    const cs = compState[id];
    if (!cDef || !cs) continue;
    out.push({
      id,
      x: cDef.x,
      y: GROUND_Y,
      anim: { name: cs.anim.name, t: Math.max(0, cs.anim.t), dur: cs.anim.dur },
      clock: cs.clock,
      alpha: phase === "heroDead" ? 0.65 : 1,
    });
  }
  view.companions = out;
}

function setCompAnim(id, name) {
  const cs = compState[id];
  if (!cs) return;
  cs.anim.name = name;
  cs.anim.t = COMP_ACT_TIME;
  cs.anim.dur = COMP_ACT_TIME;
}

function rollCompanionHit(baseAtk, mult, mods) {
  const r = rollDamage(baseAtk * mult, effMonDef(monster.data), effCrit(mods));
  let dmg = r.damage;
  if (r.crit) dmg = Math.max(1, Math.round(dmg * (1 + critDmgZone(mods))));
  return { dmg, crit: r.crit };
}

function updateCompanionsFight(dt) {
  if (phase !== "fight" || !monster || !S || !S.party || !Array.isArray(S.party.active)) return;
  const active = COMPANION_ORDER.filter((id) => S.party.active.includes(id));
  if (!active.length) return;

  // 暗金 partyCdrOnCrit 信用：主勇者暴击直接扣减全队上阵伙伴的技能剩余冷却
  if (uniqueRuntime.partyCdrCredit > 0) {
    const credit = uniqueRuntime.partyCdrCredit;
    uniqueRuntime.partyCdrCredit = 0;
    for (const id of active) {
      const cds = compState[id].skillCds;
      for (const skId of Object.keys(cds)) {
        if (cds[skId] > 0) cds[skId] = Math.max(0, cds[skId] - credit);
      }
    }
  }

  const mods = collectMods();
  const cdr = cdrMul(mods);
  const warcryOn = buffLeft("warcry") > 0;
  const partyTalentMult = 1 + Math.max(0, Number(mods.talent.partyPct) || 0);
  const runAllMult = 1 + Math.max(0, Number(S.runBuffs && S.runBuffs.allPct) || 0);
  const cdOf = (id, skId) => {
    const entry = (COMPANION_SKILLS[id] || []).find((x) => x.id === skId);
    return Math.max(0.5, ((entry && entry.cd) || 6) * cdr);
  };

  for (const id of active) {
    if (phase !== "fight" || !monster) break;
    const cDef = COMPANIONS[id];
    const cs = compState[id];
    const lv = Math.max(1, Math.floor(Number((S.party.levels && S.party.levels[id]) || 1)));
    const powerMult = companionLevelMult(lv) * partyTalentMult * runAllMult;

    for (const sk of COMPANION_SKILLS[id] || []) {
      if ((cs.skillCds[sk.id] || 0) > 0) cs.skillCds[sk.id] = Math.max(0, cs.skillCds[sk.id] - dt);
    }

    if (id === "vera") {
      const baseAtk = Math.max(1, Number(S.hero.atk) || 1) * cDef.atkPct * powerMult;
      if ((cs.skillCds.chainNova || 0) <= 0) {
        cs.skillCds.chainNova = cdOf("vera", "chainNova");
        setCompAnim("vera", "cast");
        const hit = rollCompanionHit(baseAtk, 2.7, mods);
        dealToMonster(hit.dmg, "companion", "companionSkill", { id: "vera", skillId: "chainNova", crit: hit.crit, casterX: cDef.x });
      } else if ((cs.skillCds.arcaneBolt || 0) <= 0) {
        cs.skillCds.arcaneBolt = cdOf("vera", "arcaneBolt");
        setCompAnim("vera", "cast");
        const hit = rollCompanionHit(baseAtk, 1.3, mods);
        dealToMonster(hit.dmg, "companion", "companionSkill", { id: "vera", skillId: "arcaneBolt", crit: hit.crit, casterX: cDef.x });
      } else {
        cs.atkTimer -= dt;
        if (cs.atkTimer <= 0) {
          cs.atkTimer += 1 / Math.max(0.1, cDef.aspd * (warcryOn ? 1.2 : 1));
          setCompAnim("vera", "cast");
          const hit = rollCompanionHit(baseAtk, 1.0, mods);
          dealToMonster(hit.dmg, "companion", "companionAtk", { id: "vera", crit: hit.crit, casterX: cDef.x });
        }
      }
    } else if (id === "irene") {
      const maxHp = Math.max(1, Number(S.hero.maxHp) || 1);
      const hpNow = Math.max(0, Number(S.hero.hpNow) || 0);
      const canOverflow = !!(mods.bond && mods.bond.overflowShield && heroShieldHp < maxHp * SHIELD_CAP_PCT);
      if ((cs.skillCds.purify || 0) <= 0 && heroPoisonT > 0) {
        cs.skillCds.purify = cdOf("irene", "purify");
        setCompAnim("irene", "cast");
        heroPoisonT = 0;
        heroPoisonAcc = 0;
        const healAmt = Math.max(1, Math.round(maxHp * 0.04 * powerMult));
        healHero(healAmt, mods, "companionHeal");
        emit("companionSkill", { id: "irene", skillId: "purify", x: HERO_X, y: GROUND_Y, heal: healAmt });
      } else if ((cs.skillCds.healWave || 0) <= 0 && (hpNow < maxHp || canOverflow)) {
        cs.skillCds.healWave = cdOf("irene", "healWave");
        setCompAnim("irene", "cast");
        const healAmt = Math.max(1, Math.round(maxHp * 0.12 * powerMult));
        const res = healHero(healAmt, mods, "companionHeal");
        emit("companionSkill", { id: "irene", skillId: "healWave", x: HERO_X, y: GROUND_Y, heal: res.healed, shield: res.shieldAdded });
      } else if ((cs.skillCds.aegis || 0) <= 0 && heroShieldHp < maxHp * SHIELD_CAP_PCT) {
        cs.skillCds.aegis = cdOf("irene", "aegis");
        setCompAnim("irene", "cast");
        const cap = maxHp * SHIELD_CAP_PCT;
        const add = Math.max(1, Math.round(maxHp * 0.06 * powerMult));
        const next = Math.min(cap, heroShieldHp + add);
        const gained = Math.max(0, Math.round(next - heroShieldHp));
        heroShieldHp = next;
        if (gained > 0) emit("companionSkill", { id: "irene", skillId: "aegis", x: HERO_X, y: GROUND_Y, shield: gained });
      }
    } else if (id === "kai") {
      const baseAtk = Math.max(1, Number(S.hero.atk) || 1) * cDef.atkPct * powerMult;
      const monRatio = monster.maxHp > 0 ? monster.hpNow / monster.maxHp : 1;
      if ((cs.skillCds.execute || 0) <= 0 && monRatio < 0.2) {
        cs.skillCds.execute = cdOf("kai", "execute");
        setCompAnim("kai", "atk");
        const hit = rollCompanionHit(baseAtk, 3.0, mods);
        dealToMonster(hit.dmg, "companion", "companionSkill", { id: "kai", skillId: "execute", crit: hit.crit, casterX: cDef.x });
      } else if ((cs.skillCds.bleedingStrike || 0) <= 0) {
        cs.skillCds.bleedingStrike = cdOf("kai", "bleedingStrike");
        setCompAnim("kai", "atk");
        applyBleedStack(baseAtk * 0.25, 5, 5, mods);
        emit("companionSkill", { id: "kai", skillId: "bleedingStrike", x: MONSTER_X, y: GROUND_Y, casterX: cDef.x });
      } else if ((cs.skillCds.flurry || 0) <= 0) {
        cs.skillCds.flurry = cdOf("kai", "flurry");
        setCompAnim("kai", "atk");
        let total = 0;
        let anyCrit = false;
        for (let k = 0; k < 3; k++) {
          const hit = rollCompanionHit(baseAtk, 0.6, mods);
          total += hit.dmg;
          if (hit.crit) anyCrit = true;
        }
        dealToMonster(total, "companion", "companionSkill", { id: "kai", skillId: "flurry", crit: anyCrit, casterX: cDef.x });
      } else {
        cs.atkTimer -= dt;
        if (cs.atkTimer <= 0) {
          cs.atkTimer += 1 / Math.max(0.1, cDef.aspd * (warcryOn ? 1.2 : 1));
          setCompAnim("kai", "atk");
          const hit = rollCompanionHit(baseAtk, 1.0, mods);
          dealToMonster(hit.dmg, "companion", "companionAtk", { id: "kai", crit: hit.crit, casterX: cDef.x });
          if (phase === "fight") {
            if (mods.bond && mods.bond.burnOnHitPct > 0) {
              applyBurn(baseAtk * mods.bond.burnOnHitPct, 4, mods);
            }
            if (mods.bond && Array.isArray(mods.bond.bonds) && mods.bond.bonds.includes("ironVanguard")) {
              healHero(hit.dmg * 0.08, mods);
            }
          }
        }
      }
    }
  }
}

/** 奇遇「深渊应答」触发：立即在当前层迎战一位深渊之主 */
export function triggerBossRush() {
  if (!S) return false;
  const f = Math.max(1, Math.floor(Number(S.floor) || 1));
  const bossIdx = Math.max(0, Math.ceil(f / BALANCE.BOSS_EVERY) - 1) % BOSS_ROSTER.length;
  const bDef = BOSS_ROSTER[bossIdx];
  const base = monsterFor(f, 0);
  const data = {
    id: bDef.id,
    name: bDef.name,
    sprite: bDef.sprite,
    hp: Math.round(base.hp * (base.isBoss ? 1 : BALANCE.BOSS_HP_MULT)),
    atk: base.atk,
    def: base.def,
    gold: Math.round(base.gold * (base.isBoss ? 1 : BALANCE.BOSS_GOLD_MULT)),
    xp: Math.round(base.xp * (base.isBoss ? 1 : BALANCE.BOSS_XP_MULT)),
    isBoss: true,
    isElite: false,
    tags: [],
  };
  monster = { data, hpNow: data.hp, maxHp: Math.max(1, data.hp), index: 0, tags: [], elite: false };
  refreshHooks();
  cheatCharges = 0;
  for (const h of hookCache) {
    if (h.effect === "cheatDeath") cheatCharges += Math.max(1, Math.round(pos(h.value, 1)));
  }
  monDebuff.armorBreakT = 0;
  monDebuff.armorBreakPct = 0;
  monDebuff.chillT = 0;
  monDebuff.chillPct = 0;
  monDebuff.burn = { t: 0, dps: 0, acc: 0 };
  monDebuff.bleed = { t: 0, dps: 0, acc: 0, layers: 0, perLayer: 0, stack: 1 };
  dotAcc = 0;
  view.monster.visible = true;
  view.monster.x = ENTER_X;
  view.monster.y = GROUND_Y;
  view.monster.sprite = data.sprite + "0";
  view.monster.flash = 0;
  view.monster.alpha = 1;
  heroTimer = 0.3;
  monTimer = BALANCE.MONSTER_ATTACK_INTERVAL;
  bossTimer = 0;
  phase = "enter";
  emit("bossSpawn", { x: MONSTER_X, y: GROUND_Y, name: data.name });
  return true;
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
export function init(state, h) {
  S = state || null;
  hooks = h || null;
  phase = "idle";
  monster = null;
  heroTimer = monTimer = phaseTimer = bossTimer = 0;
  heroClock = monClock = nowT = 0;
  heroAnim.name = "idle";
  heroAnim.t = 0;
  heroAnim.dur = 0;
  heroShieldHp = 0;
  heroBuffs = [];
  heroPoisonT = 0;
  heroPoisonAcc = 0;
  cheatCharges = 0;
  dotAcc = 0;
  dpsLog = [];
  dpsPeak = 0;
  dpsSampleAcc = 0;
  dpsCumulative = 0;
  hookCache = [];
  hookSig = "";
  uniqueRuntime.partyCdrCredit = 0;
  uniqueRuntime.partyCdrProcs = 0;
  monDebuff.armorBreakT = 0;
  monDebuff.armorBreakPct = 0;
  monDebuff.chillT = 0;
  monDebuff.chillPct = 0;
  monDebuff.burn = { t: 0, dps: 0, acc: 0 };
  monDebuff.bleed = { t: 0, dps: 0, acc: 0, layers: 0, perLayer: 0, stack: 1 };
  for (const s of HERO_SKILLS) skillCd[s.id] = 0; // 技能冷却清零（键随 HERO_SKILLS 增减自适应）
  for (const id of COMPANION_ORDER) {
    compState[id].atkTimer = 0.4;
    compState[id].skillCds = {};
    compState[id].anim = { name: "idle", t: 0, dur: COMP_ACT_TIME };
    compState[id].clock = id === "vera" ? 0 : id === "irene" ? 0.15 : 0.3;
  }

  view.hero.x = HERO_X;
  view.hero.y = GROUND_Y;
  view.hero.sprite = "hero_idle0";
  view.hero.flash = 0;
  view.hero.alpha = 1;
  view.hero.anim.name = "idle";
  view.hero.anim.t = 0;
  view.hero.anim.dur = 0;
  view.hero.clock = 0;
  view.companions = [];
  view.monster.x = ENTER_X;
  view.monster.y = GROUND_Y;
  view.monster.sprite = "slime0";
  view.monster.flash = 0;
  view.monster.alpha = 1;
  view.monster.visible = false;
  view.monsterHp = view.monsterMaxHp = 0;
  view.monsterName = "";
  view.bossTimeLeft = 0;
  view.phase = "idle";

  if (S) spawnMonster(); // 载入即开战（含读档续层：index = killsOnFloor）
  syncCompanionView();

  // 展示字段立刻与运行时对齐（首次渲染在首个 update 之前）
  view.monsterHp = monster ? Math.max(0, monster.hpNow) : 0;
  view.monsterMaxHp = monster ? monster.data.hp : 0;
  view.monsterName = monster ? monster.data.name : "";
  view.phase = phase;
}

export function update(dt) {
  if (!S || !monster) return;
  dt = Math.max(0, Math.min(0.5, Number(dt) || 0)); // 后台回来/掉帧兜底

  // ---- 墙钟与计时 ----
  nowT += dt;
  for (let i = heroBuffs.length - 1; i >= 0; i--) {
    heroBuffs[i].t -= dt;
    if (heroBuffs[i].t <= 0) heroBuffs.splice(i, 1);
  }
  if (heroPoisonT > 0 && phase === "fight") {
    heroPoisonT = Math.max(0, heroPoisonT - dt);
    heroPoisonAcc += dt * Math.max(1, Number(S.hero.maxHp) || 1) * 0.015;
    const pDmg = Math.floor(heroPoisonAcc);
    if (pDmg > 0) {
      heroPoisonAcc -= pDmg;
      const next = Math.max(1, (Number(S.hero.hpNow) || 1) - pDmg);
      S.hero.hpNow = next;
    }
    if (heroPoisonT <= 0) heroPoisonAcc = 0;
  }
  // 技能冷却走表（cdrPct 缩减在施放时折算进 cdMax）
  for (const s of HERO_SKILLS) {
    if (skillCd[s.id] > 0) skillCd[s.id] = Math.max(0, skillCd[s.id] - dt);
  }
  tickMonDebuffs(dt); // 破甲/缓速/DoT 剩余时间
  pruneDps();
  sampleDpsPeak(dt);

  // ---- 动画与闪白计时 ----
  if (heroAnim.name !== "idle") {
    heroAnim.t -= dt;
    if (heroAnim.t <= 0) heroAnim.name = "idle";
  }
  for (const id of COMPANION_ORDER) {
    const cs = compState[id];
    cs.clock += dt;
    if (cs.anim.name !== "idle") {
      cs.anim.t -= dt;
      if (cs.anim.t <= 0) cs.anim.name = "idle";
    }
  }
  heroClock += dt;
  monClock += dt;
  // 动画计时同步给 main（前摇/挥砍/收招 3 帧与 4 帧待机由表现层按此选帧）
  view.hero.anim.name = heroAnim.name;
  view.hero.anim.t = Math.max(0, heroAnim.t);
  view.hero.anim.dur = heroAnim.dur;
  view.hero.clock = heroClock;
  view.hero.flash = Math.max(0, view.hero.flash - dt);
  view.monster.flash = Math.max(0, view.monster.flash - dt);

  // 英雄精灵帧：hurt > atk > idle
  if (heroAnim.name === "hurt") view.hero.sprite = "hero_hurt";
  else if (heroAnim.name === "atk") view.hero.sprite = heroAnim.t > HERO_SWING_TIME / 2 ? "hero_atk0" : "hero_atk1";
  else view.hero.sprite = Math.floor(heroClock / HERO_IDLE_FRAME_SEC) % 2 ? "hero_idle1" : "hero_idle0";

  // 怪物精灵帧：走入时碎步快切，站定时待机慢切
  if (view.monster.visible) {
    const per = phase === "enter" ? MON_WALK_FRAME_SEC : MON_IDLE_FRAME_SEC;
    view.monster.sprite = monster.data.sprite + (Math.floor(monClock / per) % 2 ? "1" : "0");
  }

  // ---- 阶段推进 ----
  switch (phase) {
    case "enter": {
      view.monster.x -= WALK_SPEED * dt;
      if (view.monster.x <= MONSTER_X) {
        view.monster.x = MONSTER_X;
        phase = "fight";
        heroTimer = 0.3;
        monTimer = BALANCE.MONSTER_ATTACK_INTERVAL;
        if (monster.data.isBoss) bossTimer = BALANCE.BOSS_TIME_LIMIT; // 倒计时从接战起算
      }
      break;
    }
    case "fight": {
      if (monster.data.isBoss) {
        bossTimer -= dt;
        if (bossTimer <= 0) {
          bossFail();
          break;
        }
      }
      tickDots(dt);             // 灼烧/流血每秒跳（可击杀切阶段）
      tryCastSkills();          // 技能自动释放（冷却转好 + 战术放行）
      updateCompanionsFight(dt); // 伙伴攻击与技能（M4）
      heroTimer -= dt;
      if (phase === "fight" && heroTimer <= 0) {
        heroAttack();
        heroTimer += 1 / Math.max(0.1, effAspd()); // 有效攻速 = 面板 ×战吼 ×狂战
      }
      if (phase === "fight") {
        // heroAttack 可能击杀并切换阶段，怪物不再出手
        const chillMul = monDebuff.chillT > 0 ? Math.max(0.1, 1 - monDebuff.chillPct) : 1;
        monTimer -= dt * chillMul; // chillOnCrit：怪物攻速缓（累积变慢）
        if (monTimer <= 0) {
          monsterAttack();
          monTimer += BALANCE.MONSTER_ATTACK_INTERVAL;
        }
      }
      break;
    }
    case "kill":
      phaseTimer -= dt;
      if (phaseTimer <= 0) spawnMonster();
      break;
    case "heroDead": {
      // Boss 倒计时按墙钟走：英雄阵亡期间同样计时，防止「死亡循环」拖住 Boss 战
      if (monster.data.isBoss) {
        bossTimer -= dt;
        if (bossTimer <= 0) {
          S.hero.hpNow = S.hero.maxHp;
          view.hero.alpha = 1;
          bossFail();
          break;
        }
      }
      phaseTimer -= dt;
      if (phaseTimer <= 0) reviveHero();
      break;
    }
  }

  // ---- 展示字段同步 ----
  syncCompanionView();
  view.monsterHp = Math.max(0, monster.hpNow);
  view.monsterMaxHp = monster.data.hp;
  view.monsterName = monster.data.name;
  view.bossTimeLeft = monster.data.isBoss && (phase === "fight" || phase === "heroDead") ? Math.max(0, bossTimer) : 0;
  view.phase = phase;
}

// ---------------------------------------------------------------------------
// HUD 数据接口（M1）：无参实时快照，供 window.__GAME.combat.getHudState()
// 消费（ui/验收/调试）。只读，不修改任何战斗/存档状态；未 init（S=null）时
// 返回空闲结构（无怪、英雄空血、技能全未解锁）。结构见文件头注释。
// ---------------------------------------------------------------------------

export function getHudState() {
  // ---- monster（无怪 = 战斗未 init / 首帧前：空闲结构）----
  let mon;
  if (S && monster) {
    const maxHp = Math.max(1, Number(monster.data.hp) || 1);
    const hpNow = Math.max(0, Number(monster.hpNow) || 0);
    const isBoss = !!monster.data.isBoss;
    const inBossFight = isBoss && (phase === "fight" || phase === "heroDead"); // 与 view.bossTimeLeft 同语义
    mon = {
      name: String(monster.data.name || ""),
      hpPct: clamp01(hpNow / maxHp),
      maxHp,
      tags: Array.isArray(monster.tags) ? monster.tags.slice() : [],
      isBoss,
      bossTimerPct: inBossFight ? clamp01(bossTimer / Math.max(1, BALANCE.BOSS_TIME_LIMIT)) : null,
    };
  } else {
    mon = { name: "", hpPct: 0, maxHp: 0, tags: [], isBoss: false, bossTimerPct: null };
  }

  // ---- heroes（主勇者恒第 0 位；伙伴展示位见下）----
  const heroMaxHp = S && S.hero ? Math.max(1, Number(S.hero.maxHp) || 1) : 1;
  const heroHpNow = S && S.hero ? Math.max(0, Number(S.hero.hpNow) || 0) : 0;
  const buffs = heroBuffs.map((b) => String(b && b.id)).filter(Boolean);
  if (berserkInfo().tier > 0) buffs.push("berserk"); // HUD 增益 id（档位数走 debug 口）
  if (heroPoisonT > 0) buffs.push("poison");
  const heroes = [{
    role: "hero",
    hpPct: S && S.hero ? clamp01(heroHpNow / heroMaxHp) : 0,
    shieldPct: clamp01(heroShieldHp / heroMaxHp), // 圣火护盾/暴击护盾/溢出护盾实时值
    buffs,
  }];
  // 伙伴展示位：M4 才把伙伴接进战斗模拟，本里程碑按满血上报（契约字段就位，
  // HUD 可先行渲染队伍栏）。仅上报已上阵成员，顺序固定 vera/irene/kai。
  if (S && S.party && Array.isArray(S.party.active)) {
    for (const id of COMPANION_ORDER) {
      if (S.party.active.includes(id)) heroes.push({ role: id, hpPct: 1, shieldPct: 0, buffs: [] });
    }
  }

  // ---- skills（3 个主勇者技能全量常驻，含未解锁：ready=false / cdPct=0）----
  refreshHooks();
  const hudMods = { relic: {}, talent: {}, bond: {}, affix: {} };
  try {
    hudMods.relic = relicMods(S) || {};
    hudMods.talent = talentMods(S) || {};
    hudMods.affix = affixMods();
  } catch { /* 词条层异常按零词条处理 */ }
  const cdr = cdrMul(hudMods);
  const skills = HERO_SKILLS.map((entry) => {
    const cdLeft = Math.max(0, Number(skillCd[entry.id]) || 0);
    const cdMax = Math.max(0.001, (Number(entry.cd) || 1) * cdr);
    const t = skillTactic(S, entry.id); // skills.js 归一化；auto 形态带 threshold:undefined 键
    const tactic = { mode: t.mode };    // HUD 契约整理：仅 belowHp 带 threshold（0~1，已钳制）
    if (t.mode === "belowHp") tactic.threshold = clamp01(t.threshold);
    const unlocked = skillUnlocked(S, entry.id);
    return {
      id: entry.id,
      name: entry.name,
      cd: cdLeft,
      cdMax,
      cdPct: clamp01(cdLeft / cdMax), // 1 = 刚释放（满冷却）→ 0 = 转好
      unlocked,
      ready: unlocked && cdLeft <= 0,
      tactic,
    };
  });

  // ---- pending 队列长度（HUD 待处理角标）----
  const pendingRelics = S && Array.isArray(S.pendingRelics) ? S.pendingRelics.length : 0;
  const pendingEvents = S && Array.isArray(S.pendingEvents) ? S.pendingEvents.length : 0;

  // ---- dps：滚动 10 秒窗口真实统计（dps 为 total 别名，ui 两种读法都成立）----
  const dps = dpsWindow();

  return { monster: mon, heroes, skills, pendingRelics, pendingEvents, dps };
}

// ---------------------------------------------------------------------------
// 机制调试口（验收/调试；非 UI 契约）：暗金 hooks 装载、partyCdrOnCrit 信用
// 累计（M4 伙伴实装前的记录）、DoT/破甲/缓速/狂战/护盾运行时快照。
// ---------------------------------------------------------------------------
export function getMechanicsDebug() {
  return {
    uniques: equippedUniqueIds(),
    hooks: hookCache.map((h) => ({ id: h.id, effect: h.effect, on: h.trigger, value: h.value, chance: h.chance, stack: h.stack })),
    partyCdrCredit: Math.round(uniqueRuntime.partyCdrCredit * 100) / 100,
    partyCdrProcs: uniqueRuntime.partyCdrProcs,
    dps: dpsWindow(),
    shield: Math.round(heroShieldHp),
    buffs: heroBuffs.map((b) => ({ id: b.id, t: Math.round(b.t * 10) / 10 })),
    berserk: berserkInfo(), // {tier, pct}：已损血档位与攻速加成
    monDebuff: {
      armorBreakT: Math.round(monDebuff.armorBreakT * 10) / 10,
      chillT: Math.round(monDebuff.chillT * 10) / 10,
      chillPct: monDebuff.chillPct,
      burn: { t: Math.round(monDebuff.burn.t * 10) / 10, dps: Math.round(monDebuff.burn.dps * 10) / 10 },
      bleed: {
        t: Math.round(monDebuff.bleed.t * 10) / 10,
        dps: Math.round(monDebuff.bleed.dps * 10) / 10,
        layers: monDebuff.bleed.layers,
      },
    },
    cheatCharges,
    skillCd: { ...skillCd },
  };
}

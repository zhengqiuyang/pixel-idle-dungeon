// ============================================================================
// 《余烬深渊》(pixel-idle-dungeon) · js/ui.js —— 界面重塑层（RPG 化 UI）
//
// 职责：
//   A. 画布内嵌像素 HUD（#hud 绝对定位盖在 .stage-frame 上，pointer-events 仅
//      放行交互件，不挡角色）：
//        · 顶部中央：怪物名牌 + 分段像素血条 + 特性标签；
//        · Boss 战：血条下方红色狂暴倒计时条（剩 ≤5s 进入急促脉冲）；
//        · Boss 登场：头顶像素对话气泡（narrative.BOSS_LINES，2.5s 淡出）；
//        · 底部中央：技能快捷栏（HERO_SKILLS，像素字图标 + 冷却遮罩，点击循环
//          战术 auto→bossOnly→belowHp，写回 state.skills[id].tactic）；
//        · 右上角角标：待选遗物 xN（relics.js 风格化宝石图标）+ 奇遇角标骨架；
//        · 左上角：折叠式实时 DPS 统计条（本里程碑 0 值骨架，M3 填充）。
//   B. 右侧面板 5 标签：强化（×1/×10/MAX + 技能解锁状态）/ 装备（同部位自动
//      对比 + 暗金微光风味文 + 智能过滤栏）/ 小队（招募卡 + 羁绊区）/ 远征
//      （本轮遗物 + 初火祭坛天赋树 + 凯旋回城）/ 典籍（编年史 + 序章重看 +
//      原设置项）。每个标签带红点逻辑。
//   C. 顶栏（金币/灵魂余烬/层数/等级·经验·血量）、战斗日志、弹窗
//      （离线收益/导出/导入/重置/序章）。
//
// 契约（与 state.js / main.js 约定，不得偏离）：
//   导出  initUI(ctx)          ctx={state, actions}；构建全部 DOM 并绑定事件
//         refreshUI()          从 state 重读刷新面板（调用方约 150ms 节流调用）
//         addLog(text)         战斗日志追加一行，保留最近 12 条
//         showOfflineModal(g)  g={minutes,gold,xp,kills,items}；离线收益弹窗
//         fmtNum(n)            大数格式化 1.2K / 3.4M / 1.2B（等宽数字口径）
//   state 只读为主；以下三处为任务书明确指定由 UI 直写（其余数值改动走 actions）：
//     1) state.skills[id].tactic        —— HUD 技能战术写回
//     2) state.lootFilter.autoSellBelow —— 装备页智能过滤栏
//     3) relics.applyTalent(state,id)   —— 远征页初火祭坛点亮（随后 computeDerived）
//   HUD 数据：每 100ms 从 window.__GAME.combat.getHudState() 拉取；字段缺失时
//   逐级回退 combat.view / state（接口工程师并行实现期不崩、不空白）。
//   本层消费的 getHudState 形状（全部字段可缺省，缺省走回退）：
//     { monster:{name,hp,maxHp,isBoss,id,sprite,tags[]},
//       monsterName, monsterHp, monsterMaxHp, isBoss,
//       bossTimeLeft, bossTimeTotal,
//       skills: { [id]:{cd,cdMax,unlocked,tactic} } | [{id,cd,cdMax,unlocked,tactic}],
//       dps: number | {dps} | {value} }
//   展示性文案（技能图标字 / 战术标签 / 怪物特性兜底表）为本层 UI 文案，
//   不含任何平衡数值；平衡与规则数据一律取自 data/skills/relics/narrative 导出。
// ============================================================================

import {
  UPGRADES,
  upgradeCost,
  xpNeeded,
  floorName,
  SLOT_NAMES,
  RARITY_NAMES,
  CRIT_CAP,
  ASPD_CAP,
  BALANCE,
  BOSS_ROSTER,
  AFFIXES,
} from './data.js';
import { initAudio, setMuted, isMuted, sfx } from './audio.js';
import {
  HERO_SKILLS,
  HERO_SKILL_MAP,
  COMPANIONS,
  COMPANION_SKILLS,
  BONDS,
  activeBonds,
  TACTIC_MODES,
  skillUnlocked,
  skillTactic,
  companionUpgradeCost,
  companionLevelMult,
} from './skills.js';
import { RELICS, RELIC_TAGS, TALENTS, applyTalent, talentMods } from './relics.js';
import { INTRO_LINES, BOSS_LINES, UNIQUE_FLAVOR, EVENTS } from './narrative.js';
import { computeDerived, calcPrestigeEmbers } from './state.js';

// ---------------------------------------------------------------------------
// 模块内部状态
// ---------------------------------------------------------------------------
let C = null;         // initUI 收到的 { state, actions }
let R = null;         // 全部 DOM 引用
let docBound = false; // document 级监听只绑一次（防 initUI 重复调用后重复触发）
let hudTimer = null;  // HUD 100ms 心跳（initUI 重复调用时先清旧的）

let buyMode = '1';    // 强化购买档位：'1' | '10' | 'max'
let dpsOpen = false;  // DPS 统计条展开状态
let bubbleTimer = 0;  // Boss 气泡隐藏计时
let bubblePrimed = false; // 首次 HUD 拉取只静默记录 Boss，不弹气泡（避免载入中途误弹）
let lastBossKey = null;   // 上一次弹过气泡的 Boss 标识

const HUD_POLL_MS = 100;      // HUD 数据拉取周期（契约）
const BUY_MAX_COUNT = 10000;  // MAX 档传给 buyUpgrade 的批量上限（内层会按金币/上限截停）

const TAB_DEFS = [
  ['up', '⚒', '强化'],
  ['eq', '✚', '装备'],
  ['party', '⚑', '小队'],
  ['exp', '◈', '远征'],
  ['codex', '☰', '典籍'],
];
const SLOT_ORDER = ['weapon', 'head', 'armor', 'trinket'];
const PARTY_ORDER = ['vera', 'irene', 'kai'];

// 展示性映射（纯文案，无数值）
const STAT_LABELS = { atk: '攻击', hp: '生命', def: '防御', crit: '暴击', aspd: '攻速' };
// 副词条展示词汇（data.AFFIXES 的 name；value 一律 0~1 小数 → ×100 百分比显示）
const AFFIX_NAMES = new Map(AFFIXES.map((a) => [a.key, a.name]));
const SKILL_ICONS = { crack: '斩', shield: '盾', warcry: '吼' };
const TACTIC_LABELS = { auto: '自动', bossOnly: '仅Boss', belowHp: '残血' };
const UPGRADE_ICONS = { atk: '⚔', hp: '♥', def: '▣', crit: '✦', aspd: '⚡' };
// 怪物特性兜底表（getHudState 未带 tags 时的展示文案；Boss 由 HUD 主动标「首领」）
const FALLBACK_TRAITS = {
  slime: '粘液', bat: '迅捷', goblin: '贪婪', skeleton: '白骨',
  mushroom: '剧毒', gargoyle: '石肤', imp: '狡诈', ghost: '虚无',
};

// 数据索引（模块加载时构建一次）
const RELIC_MAP = new Map(RELICS.map((r) => [r.id, r]));
const TALENT_MAP = new Map(TALENTS.map((t) => [t.id, t]));
const RELIC_TAG_MAP = new Map(RELIC_TAGS.map((t) => [t.id, t.name]));
const BOSS_ID_BY_NAME = new Map(BOSS_ROSTER.map((b) => [b.name, b.id]));

// 像素小图标（内联 SVG，无外部资源）
const ICON_GEM =
  '<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">' +
  '<rect x="2" y="0" width="4" height="1" fill="#ffe27a"/><rect x="1" y="1" width="6" height="1" fill="#f5b92c"/>' +
  '<rect x="0" y="2" width="8" height="2" fill="#f5b92c"/><rect x="1" y="4" width="6" height="1" fill="#d89a1e"/>' +
  '<rect x="2" y="5" width="4" height="1" fill="#d89a1e"/><rect x="3" y="6" width="2" height="1" fill="#a86e12"/></svg>';
const ICON_SCROLL =
  '<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">' +
  '<rect x="1" y="0" width="6" height="1" fill="#8a80a8"/><rect x="1" y="7" width="6" height="1" fill="#8a80a8"/>' +
  '<rect x="0" y="1" width="8" height="6" fill="#cfc6e8"/><rect x="2" y="2" width="4" height="1" fill="#3a2f52"/>' +
  '<rect x="2" y="4" width="4" height="1" fill="#3a2f52"/></svg>';

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 安全取数：Number 化，非法值回退 d */
function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** 逐个尝试取第一个合法数字（HUD 多源回退用） */
function firstNum(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** 逐个尝试取第一个非空字符串 */
function firstStr(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

/** 紧凑数：>=100 去小数、>=10 一位小数，其余两位；去尾零 */
function compactNum(x, suffix) {
  let s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
  if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
  return s + suffix;
}

/**
 * 大数格式化（契约导出）：1234→1.23K、3400000→3.4M、1.2e9→1.2B、1.2e12→1.2T。
 * 1000 以下：整数原样、小数保留至 2 位；负数带符号；非法值回退 "0"。
 */
export function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e12) return sign + compactNum(a / 1e12, 'T');
  if (a >= 1e9) return sign + compactNum(a / 1e9, 'B');
  if (a >= 1e6) return sign + compactNum(a / 1e6, 'M');
  if (a >= 1e3) return sign + compactNum(a / 1e3, 'K');
  return sign + (Number.isInteger(v) ? String(Math.round(a)) : compactNum(a, ''));
}

/** 整数显示（离线弹窗等小数值仍要精确全数） */
function fmt(v) {
  return Math.floor(num(v)).toLocaleString('zh-CN');
}

/** 百分点显示：5→"5"、12.5→"12.5"（crit/def 等半步长属性） */
function fmtPts(v) {
  return String(Math.round(num(v) * 10) / 10);
}

/** 倍率显示：1→"1.0"、1.15→"1.15"（攻速倍率） */
function fmtMul(v) {
  const n = Math.round(num(v) * 100) / 100;
  return n % 1 === 0 ? n.toFixed(1) : String(n);
}

/** 创建元素 */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

/** 带 innerHTML 的元素（本层仅注入常量图标/受控文案，不拼用户数据） */
function elHtml(tag, cls, html) {
  const n = el(tag, cls);
  n.innerHTML = String(html == null ? '' : html);
  return n;
}

/** 按 id 取元素；不存在则在 parent 下补建（对 HTML 骨架缺件兜底） */
function need(parent, id, tag, cls) {
  let n = id ? document.getElementById(id) : null;
  if (!n) {
    n = el(tag || 'div', cls || '');
    if (id) n.id = id;
    (parent || document.body).appendChild(n);
  }
  return n;
}

/** 调用 actions 时吞异常：挂机游戏不能因 UI 崩 */
function safeCall(fn) {
  try {
    return fn();
  } catch (err) {
    console.warn('[ui] action 调用失败:', err);
    return undefined;
  }
}

/** 调用 ctx.actions[name]（透传任意参数），缺 action 时静默返回 undefined */
function act(name, ...args) {
  if (!C || !C.actions || typeof C.actions[name] !== 'function') return undefined;
  return C.actions[name](...args);
}

/** actions 是否提供某能力（招募/上阵等后续里程碑按钮的可用性依据） */
function hasAction(name) {
  return !!(C && C.actions && typeof C.actions[name] === 'function');
}

function rarityOf(r) {
  return Math.min(3, Math.max(0, Math.floor(num(r))));
}

function rarityClass(r) {
  return `r${rarityOf(r)}`;
}

/** JSON 签名：用于高频 refreshUI 下的 DOM diff（异常时退化为每次重建） */
function sigOf(v) {
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(Math.random());
  }
}

function clampPct(r) {
  return Math.max(0, Math.min(100, (num(r) || 0) * 100));
}

/** 装备属性一行文案：攻击+2 生命+25 暴击+2.5% 攻速+4% */
function statsText(item) {
  const st = (item && item.stats) || {};
  const parts = [];
  if (st.atk) parts.push(`攻击+${fmt(st.atk)}`);
  if (st.hp) parts.push(`生命+${fmt(st.hp)}`);
  if (st.def) parts.push(`防御+${fmtPts(st.def)}`);
  if (st.crit) parts.push(`暴击+${fmtPts(st.crit)}%`);
  if (st.aspd) parts.push(`攻速+${fmtPts(st.aspd)}%`);
  return parts.length ? parts.join(' ') : '无加成';
}

/**
 * 装备副词条一行文案（M3）：吸血 +5% · 金币加成 +8%（value×100 百分比）。
 * 只消费 key ∈ data.AFFIXES 的词条，零值/未知键忽略；无可见词条返回 null。
 * （暗金 affixes 恒空 → 返回 null，其风味走 flavorOf，互不挤占。）
 */
function affixesText(item) {
  const ax = item && Array.isArray(item.affixes) ? item.affixes : [];
  const parts = [];
  for (const a of ax) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
    const name = AFFIX_NAMES.get(a.key);
    const v = num(a.value);
    if (!name || v <= 0) continue;
    parts.push(`${name} +${Math.round(v * 100)}%`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** 装备风味小字（narrative.UNIQUE_FLAVOR）；无 uniqueId 或未收录时返回 null */
function flavorOf(item) {
  const uid = item && (item.uniqueId || item.unique);
  if (typeof uid !== 'string' || !uid) return null;
  return Object.prototype.hasOwnProperty.call(UNIQUE_FLAVOR, uid) ? UNIQUE_FLAVOR[uid] : null;
}

/** 装备名称类：暗金（有风味文案的 unique）加呼吸微光 */
function itemNameClass(item) {
  const cls = [rarityClass(item && item.rarity)];
  if (flavorOf(item)) cls.push('unique-name');
  return cls.join(' ');
}

/**
 * 红点用粗略装备评分（仅 UI 提示启发式，非战斗数值）：
 * 权重把不同量纲折到同一标尺：生命/10 ≈ 同层攻击当量、防御×2、暴击百分点×2。
 */
function gearScore(item) {
  const st = (item && item.stats) || {};
  return num(st.atk) + num(st.hp) / 10 + num(st.def) * 2 + num(st.crit) * 2 + num(st.aspd);
}

/** 背包里是否有比已穿戴更强的装备（红点逻辑：装备标签页） */
function hasStrongerEquip(s) {
  const eq = s.equipped || {};
  const inv = Array.isArray(s.inventory) ? s.inventory : [];
  return inv.some((it) => {
    if (!it || !it.slot) return false;
    const cur = eq[it.slot];
    return !cur ? true : gearScore(it) > gearScore(cur) + 1e-9;
  });
}

/** 时间戳 → "MM-DD HH:mm"（编年史时间轴） */
function fmtTime(ts) {
  const d = new Date(num(ts, 0));
  if (isNaN(d.getTime())) return '--';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 成员显示名：hero→勇者；伙伴取「·」后短名（秘法使·薇拉→薇拉） */
function memberName(m) {
  if (m === 'hero') return '勇者';
  const c = COMPANIONS[m];
  if (!c) return String(m);
  const i = String(c.name).indexOf('·');
  return i >= 0 ? String(c.name).slice(i + 1) : String(c.name);
}

/** 战术值归一为模式字符串（getHudState 可能给字符串或 {mode} 对象） */
function normTacticMode(t) {
  if (typeof t === 'string' && t) return t;
  if (t && typeof t === 'object' && typeof t.mode === 'string') return t.mode;
  return 'auto';
}

// ---------------------------------------------------------------------------
// DOM 构建
// ---------------------------------------------------------------------------

function buildShell() {
  const app = need(document.body, 'app', 'div', '');
  const top = need(app, 'topbar', 'header', 'topbar px-frame');

  // —— 顶栏：金币 / 余烬 / 层数 / 英雄（等级·经验条·血条） ——
  const goldBox = need(top, 'tb-gold', 'div', 'tb-box tb-gold');
  goldBox.innerHTML = '';
  goldBox.append(el('span', 'tb-ico gold-ico'), el('span', 'tb-cap', '金币'));
  R.goldVal = el('b', 'tb-num num', '0');
  goldBox.appendChild(R.goldVal);

  const emberBox = need(top, 'tb-embers', 'div', 'tb-box tb-embers');
  emberBox.innerHTML = '';
  emberBox.append(elHtml('span', 'tb-ico ember-ico', ICON_GEM), el('span', 'tb-cap', '余烬'));
  R.emberVal = el('b', 'tb-num num ember-num', '0');
  emberBox.appendChild(R.emberVal);

  const floorBox = need(top, 'tb-floor', 'div', 'tb-box tb-floor');
  floorBox.innerHTML = '';
  R.floorVal = el('b', 'tb-floorname', '第 1 层');
  R.floorProg = el('span', 'tb-sub num', '');
  floorBox.append(R.floorVal, R.floorProg);

  const heroBox = need(top, 'tb-hero', 'div', 'tb-box tb-hero');
  heroBox.innerHTML = '';
  const lvRow = el('div', 'tb-line');
  R.lvVal = el('b', 'tb-lv', 'Lv.1');
  R.xpText = el('span', 'tb-sub num', '经验 0/20');
  lvRow.append(R.lvVal, R.xpText);
  const xpBar = el('div', 'bar xp-bar');
  R.xpFill = el('div', 'bar-fill');
  xpBar.appendChild(R.xpFill);
  const hpRow = el('div', 'tb-line');
  R.hpText = el('span', 'tb-sub num', '生命 100/100');
  hpRow.appendChild(R.hpText);
  const hpBar = el('div', 'bar hp-bar');
  R.hpFill = el('div', 'bar-fill hp-hi');
  hpBar.appendChild(R.hpFill);
  heroBox.append(lvRow, xpBar, hpRow, hpBar);

  // —— 主区：战斗画布 + 内嵌 HUD（index.html 提供 .stage-frame/#hud，缺件兜底） ——
  const mainArea = need(app, 'main-area', 'main', 'main-area');
  const stage = need(mainArea, 'stage', 'section', 'stage px-frame');
  const frameEl = need(stage, 'stage-frame', 'div', 'stage-frame');
  const canvas = need(frameEl, 'game-canvas', 'canvas', '');
  if (!canvas.getAttribute('width')) {
    canvas.width = 320;
    canvas.height = 180;
  }
  const hud = need(frameEl, 'hud', 'div', 'hud');
  buildHud(hud);

  const panel = need(mainArea, 'panel', 'aside', 'panel px-frame');
  panel.innerHTML = '';
  buildPanel(panel);

  // —— 底部战斗日志 ——
  const logArea = need(app, 'log-area', 'footer', 'log-area px-frame');
  if (!logArea.firstChild) logArea.appendChild(el('div', 'log-title', '◈ 远征纪事'));
  R.logList = need(logArea, 'log-list', 'div', 'log-list');

  // —— 弹窗骨架（挂 body，不进 #app） ——
  const overlay = el('div', 'modal-overlay hidden');
  overlay.id = 'modal-overlay';
  const box = el('div', 'modal-box px-frame');
  const head = el('div', 'modal-head');
  R.mTitle = el('h3', '', '');
  const mClose = el('button', 'modal-x', '✕');
  mClose.type = 'button';
  mClose.title = '关闭';
  head.append(R.mTitle, mClose);
  R.mBody = el('div', 'modal-body');
  R.mBody.id = 'modal-body';
  box.append(head, R.mBody);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  R.overlay = overlay;
  R.mClose = mClose;
}

// ---------------------------------------------------------------------------
// HUD 构建（画布内嵌像素浮层；定位/字号走 cqw 随画布等比缩放）
// ---------------------------------------------------------------------------

function buildHud(hud) {
  hud.innerHTML = '';

  // 左上角：折叠式实时 DPS 统计条（本里程碑 0 值骨架，M3 填充）
  const dps = el('div', 'hud-dps');
  dps.id = 'hud-dps';
  R.dpsHead = el('button', 'hud-dps-head');
  R.dpsHead.type = 'button';
  R.dpsHead.append(el('span', 'hud-dps-cap', '⚔ 实时输出'));
  R.dpsCaret = el('span', 'hud-dps-caret', '▸');
  R.dpsHead.appendChild(R.dpsCaret);
  const dpsBody = el('div', 'hud-dps-body');
  const rowVal = el('div', 'hud-dps-row');
  rowVal.append(el('span', '', '每秒伤害'), (R.dpsVal = el('b', 'hud-dps-val num', '0')));
  const rowPeak = el('div', 'hud-dps-row dim');
  rowPeak.append(el('span', '', '峰值'), (R.dpsPeakVal = el('b', 'num', '—')));
  const rowTotal = el('div', 'hud-dps-row dim');
  rowTotal.append(el('span', '', '累计输出'), (R.dpsTotalVal = el('b', 'num', '—')));
  // 来源占比四行（M3+M4）：滚动窗口内 普攻/技能/伙伴/持续伤害 的 DPS 与占比
  const rowSrcAtk = el('div', 'hud-dps-row dim');
  rowSrcAtk.append(el('span', '', '普攻'), (R.dpsSrcAtk = el('b', 'num', '—')));
  const rowSrcSkill = el('div', 'hud-dps-row dim');
  rowSrcSkill.append(el('span', '', '技能'), (R.dpsSrcSkill = el('b', 'num', '—')));
  const rowSrcComp = el('div', 'hud-dps-row dim');
  rowSrcComp.append(el('span', '', '伙伴'), (R.dpsSrcComp = el('b', 'num', '—')));
  const rowSrcDot = el('div', 'hud-dps-row dim');
  rowSrcDot.append(el('span', '', '持续伤害'), (R.dpsSrcDot = el('b', 'num', '—')));
  dpsBody.append(rowVal, rowPeak, rowTotal, rowSrcAtk, rowSrcSkill, rowSrcComp, rowSrcDot);
  dps.append(R.dpsHead, dpsBody);
  hud.appendChild(dps);
  R.hudDps = dps;

  // 顶部中央：怪物名牌 + 像素血条 +（Boss）狂暴倒计时条
  const plate = el('div', 'hud-plate');
  plate.id = 'hud-plate';
  const monLine = el('div', 'hud-mon-line');
  R.monName = el('span', 'hud-mon-name', '');
  R.monTags = el('span', 'hud-mon-tags');
  monLine.append(R.monName, R.monTags);
  const hpWrap = el('div', 'hud-hp');
  R.monHpFill = el('div', 'hud-hp-fill hp-hi');
  R.monHpText = el('span', 'hud-hp-text num', '');
  hpWrap.append(R.monHpFill, R.monHpText);
  const rage = el('div', 'hud-rage hidden');
  rage.id = 'hud-rage';
  R.rageFill = el('div', 'hud-rage-fill');
  R.rageTxt = el('span', 'hud-rage-txt num', '');
  rage.append(R.rageFill, R.rageTxt);
  plate.append(monLine, hpWrap, rage);
  hud.appendChild(plate);
  R.hudPlate = plate;
  R.hudRage = rage;

  // Boss 登场头顶像素对话气泡（narrative.BOSS_LINES，2.5s 淡出）
  R.bubble = el('div', 'hud-bubble hidden');
  R.bubble.id = 'hud-bubble';
  hud.appendChild(R.bubble);

  // 底部中央：技能快捷栏（技能/战术数据来自 skills.js 契约）
  const skills = el('div', 'hud-skills');
  skills.id = 'hud-skills';
  R.skillBtns = {};
  R.skillCds = {};
  R.skillCdTxts = {};
  R.skillTacs = {};
  for (const entry of HERO_SKILLS) {
    const btn = el('button', 'hud-skill');
    btn.type = 'button';
    btn.dataset.skill = entry.id;
    btn.title = `${entry.name}（${entry.desc}）`;
    btn.append(el('span', 'hud-skill-ico', SKILL_ICONS[entry.id] || '?'));
    const cd = el('span', 'hud-skill-cd');
    const cdTxt = el('span', 'hud-skill-cdtxt num', '');
    const tac = el('span', 'hud-skill-tac', '自动');
    btn.append(cd, cdTxt, tac);
    skills.appendChild(btn);
    R.skillBtns[entry.id] = btn;
    R.skillCds[entry.id] = cd;
    R.skillCdTxts[entry.id] = cdTxt;
    R.skillTacs[entry.id] = tac;
  }
  hud.appendChild(skills);
  R.hudSkills = skills;

  // 右上角角标：待选遗物 xN / 深渊奇遇 xN
  const badges = el('div', 'hud-badges');
  badges.id = 'hud-badges';
  R.badgeRelic = el('button', 'badge');
  R.badgeRelic.type = 'button';
  R.badgeRelic.title = '待抉择的遗物（点击抽取或前往远征）';
  R.badgeRelic.append(elHtml('span', 'badge-ico', ICON_GEM));
  R.badgeRelicCount = el('span', 'bnum num', '0');
  R.badgeRelic.appendChild(R.badgeRelicCount);
  R.badgeEvent = el('button', 'badge soon');
  R.badgeEvent.type = 'button';
  R.badgeEvent.title = '深渊奇遇（探索推进时随机触发）';
  R.badgeEvent.append(elHtml('span', 'badge-ico', ICON_SCROLL));
  R.badgeEventCount = el('span', 'bnum num', '0');
  R.badgeEvent.appendChild(R.badgeEventCount);
  badges.append(R.badgeRelic, R.badgeEvent);
  hud.appendChild(badges);
}

// ---------------------------------------------------------------------------
// 右侧面板构建：5 标签 + 5 面板
// ---------------------------------------------------------------------------

function buildPanel(panel) {
  // 标签页按钮（带红点位）
  const tabs = el('nav', 'tabs');
  R.tabBtns = {};
  for (const [key, ico, label] of TAB_DEFS) {
    const b = el('button', 'tab-btn' + (key === 'up' ? ' active' : ''));
    b.type = 'button';
    b.dataset.tab = key;
    b.append(el('span', 'tico', ico), el('span', 'tlabel', label));
    b.appendChild(el('i', 'dot'));
    tabs.appendChild(b);
    R.tabBtns[key] = b;
  }
  panel.appendChild(tabs);
  R.tabsEl = tabs;

  // —— 面板① 强化：购买档位 + 升级列表 + 技能解锁状态 ——
  const paneUp = el('div', 'pane');
  paneUp.id = 'pane-up';
  const modes = el('div', 'buy-modes');
  R.buyModeBtns = {};
  for (const m of ['1', '10', 'max']) {
    const b = el('button', 'bm' + (m === buyMode ? ' active' : ''), m === 'max' ? 'MAX' : `×${m}`);
    b.type = 'button';
    b.dataset.mode = m;
    b.title = m === 'max' ? '一键强化到金币不足或达上限' : `每次强化 ${m} 级`;
    modes.appendChild(b);
    R.buyModeBtns[m] = b;
  }
  R.upList = el('div', 'upgrade-list');
  const skSec = el('section', 'sub-sec');
  skSec.appendChild(el('h3', 'sec-title', '技能解锁'));
  R.skillStatus = el('div', 'skill-status');
  skSec.appendChild(R.skillStatus);
  paneUp.append(modes, R.upList, skSec);
  R.paneUp = paneUp;

  // —— 面板② 装备：智能过滤栏 + 属性总览 + 已装备 + 背包 ——
  const paneEq = el('div', 'pane hidden');
  paneEq.id = 'pane-eq';
  const filter = el('div', 'loot-filter');
  R.filterCheck = el('input');
  R.filterCheck.type = 'checkbox';
  R.filterCheck.id = 'filter-check';
  const filterLabel = el('label', 'filter-label');
  filterLabel.append(R.filterCheck, el('span', '', '自动出售低质'));
  R.filterSel = el('select', 'filter-sel');
  R.filterSel.id = 'filter-sel';
  R.filterSel.title = '自动出售的品质阈值（新掉落立即生效）';
  for (const [v, label] of [[1, '普通及以下'], [2, '稀有及以下'], [3, '史诗及以下']]) {
    const opt = el('option', '', label);
    opt.value = String(v);
    R.filterSel.appendChild(opt);
  }
  filter.append(filterLabel, R.filterSel);
  const filterHint = el('p', 'hint filter-hint', '关闭时所有掉落保留在背包，由你手动处置。');
  R.heroStats = el('div', 'hero-stats');
  R.eqTitle = el('h3', 'sec-title', '已装备');
  R.eqGrid = el('div', 'equipped-grid');
  R.invTitle = el('h3', 'sec-title', '背包');
  R.invList = el('div', 'inventory');
  paneEq.append(filter, filterHint, R.heroStats, R.eqTitle, R.eqGrid, R.invTitle, R.invList);
  R.paneEq = paneEq;

  // —— 面板③ 小队：余烬余额 + 伙伴招募卡 + 羁绊区 ——
  const paneParty = el('div', 'pane hidden');
  paneParty.id = 'pane-party';
  const emberLine = el('div', 'ember-line');
  emberLine.append(elHtml('span', 'badge-ico', ICON_GEM), el('span', '', '灵魂余烬'));
  R.partyEmbers = el('b', 'num', '0');
  emberLine.appendChild(R.partyEmbers);
  R.partyCards = el('div', 'party-cards');
  const bondSec = el('section', 'sub-sec');
  bondSec.appendChild(el('h3', 'sec-title', '羁绊'));
  R.bondList = el('div', 'bond-list');
  bondSec.appendChild(R.bondList);
  paneParty.append(emberLine, R.partyCards, bondSec);
  R.paneParty = paneParty;

  // —— 面板④ 远征：本轮遗物 + 自动偏好 + 待选计数 + 初火祭坛 + 凯旋回城 ——
  const paneExp = el('div', 'pane hidden');
  paneExp.id = 'pane-exp';
  const expHead = el('div', 'exp-head');
  R.expRelicCount = el('span', 'exp-count num', '');
  R.expPendingChip = el('button', 'pending-chip num hidden');
  R.expPendingChip.type = 'button';
  R.expPendingChip.title = '点击抽取待选遗物';
  expHead.append(R.expRelicCount, R.expPendingChip);
  const autoBar = el('div', 'auto-relic-bar');
  autoBar.appendChild(el('span', '', '遗物自动偏好'));
  R.relicAutoSel = el('select', 'filter-sel');
  R.relicAutoSel.title = '开启后，击败 Boss 的遗物三选一将自动按偏好流派选取（不再排队）';
  for (const [val, label] of [
    ['', '手动三选一'],
    ['crit', '暴击流'],
    ['dot', '持续伤害流'],
    ['survive', '生存向'],
    ['economy', '经济发育'],
  ]) {
    const opt = el('option', '', label);
    opt.value = val;
    R.relicAutoSel.appendChild(opt);
  }
  autoBar.appendChild(R.relicAutoSel);
  R.relicList = el('div', 'relic-list');
  const altarSec = el('section', 'sub-sec');
  altarSec.appendChild(el('h3', 'sec-title', '初火祭坛 · 永久天赋'));
  R.talentGrid = el('div', 'talent-grid');
  altarSec.appendChild(R.talentGrid);
  R.btnTriumph = el('button', 'btn btn-wide btn-triumph', '⌂ 凯旋回城');
  R.btnTriumph.type = 'button';
  R.btnTriumph.disabled = true;
  R.btnTriumph.title = '火种归座：本轮抵达第 10 层后可携余烬凯旋回城';
  paneExp.append(expHead, autoBar, R.relicList, altarSec, R.btnTriumph);
  R.paneExp = paneExp;

  // —— 面板⑤ 典籍：编年史 + 序章重看 + 设置 ——
  const paneCodex = el('div', 'pane hidden');
  paneCodex.id = 'pane-codex';
  const chrSec = el('section', 'sub-sec');
  chrSec.appendChild(el('h3', 'sec-title', '编年史'));
  R.chrList = el('div', 'chronicle');
  chrSec.appendChild(R.chrList);
  R.btnIntro = el('button', 'btn btn-wide', '↻ 序章重看');
  R.btnIntro.type = 'button';
  const setSec = el('section', 'sub-sec');
  setSec.appendChild(el('h3', 'sec-title', '设置'));
  const muteLabel = el('label', 'toggle');
  R.muteCheck = el('input');
  R.muteCheck.type = 'checkbox';
  R.muteCheck.id = 'mute-check';
  muteLabel.append(R.muteCheck, el('span', 'toggle-text', '静音'));
  const stayLabel = el('label', 'toggle');
  R.stayCheck = el('input');
  R.stayCheck.type = 'checkbox';
  R.stayCheck.id = 'stay-check';
  stayLabel.append(
    R.stayCheck,
    el('span', 'toggle-text', `停留本层（杀满 ${BALANCE.MONSTERS_PER_FLOOR} 只不自动进入下一层）`),
  );
  R.btnExport = el('button', 'btn btn-wide', '▤ 导出存档');
  R.btnImport = el('button', 'btn btn-wide', '▥ 导入存档');
  R.btnReset = el('button', 'btn btn-wide btn-danger', '✖ 重置游戏');
  R.btnExport.id = 'btn-export';
  R.btnImport.id = 'btn-import';
  R.btnReset.id = 'btn-reset';
  R.btnExport.type = 'button';
  R.btnImport.type = 'button';
  R.btnReset.type = 'button';
  const setHint = el(
    'p',
    'hint',
    '进度每 5 秒自动保存到浏览器本地；导出的存档文本可备份到别处，导入会覆盖当前进度。',
  );
  setSec.append(muteLabel, stayLabel, R.btnExport, R.btnImport, R.btnReset, setHint);
  paneCodex.append(chrSec, R.btnIntro, setSec);
  R.paneCodex = paneCodex;

  panel.append(paneUp, paneEq, paneParty, paneExp, paneCodex);
}

// ---------------------------------------------------------------------------
// 事件绑定
// ---------------------------------------------------------------------------

function switchTab(key) {
  for (const k of Object.keys(R.tabBtns)) {
    R.tabBtns[k].classList.toggle('active', k === key);
  }
  R.paneUp.classList.toggle('hidden', key !== 'up');
  R.paneEq.classList.toggle('hidden', key !== 'eq');
  R.paneParty.classList.toggle('hidden', key !== 'party');
  R.paneExp.classList.toggle('hidden', key !== 'exp');
  R.paneCodex.classList.toggle('hidden', key !== 'codex');
}

function bindEvents() {
  // 标签页切换（委托）
  R.tabsEl.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.tab-btn') : null;
    if (!btn) return;
    initAudio();
    sfx.click();
    switchTab(btn.dataset.tab);
  });

  // 强化：购买档位切换
  R.paneUp.addEventListener('click', (e) => {
    const bm = e.target && e.target.closest ? e.target.closest('.bm') : null;
    if (!bm) return;
    initAudio();
    sfx.click();
    buyMode = bm.dataset.mode === '10' || bm.dataset.mode === 'max' ? bm.dataset.mode : '1';
    for (const m of Object.keys(R.buyModeBtns)) {
      R.buyModeBtns[m].classList.toggle('active', m === buyMode);
    }
    refreshUI();
  });

  // 强化：购买（委托到列表容器；次数由档位决定，MAX 传批量上限由内层截停）
  R.upList.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-buy]') : null;
    if (!btn || btn.disabled) return;
    initAudio();
    const count = buyMode === 'max' ? BUY_MAX_COUNT : buyMode === '10' ? 10 : 1;
    const res = safeCall(() => act('buyUpgrade', btn.dataset.buy, count));
    if (res === false) sfx.fail();
    else sfx.click();
    refreshUI();
  });

  // 装备：智能过滤栏（任务书指定 UI 直写 state.lootFilter）
  R.filterCheck.addEventListener('change', () => {
    initAudio();
    sfx.click();
    const s = C && C.state ? C.state : null;
    if (!s) return;
    if (!s.lootFilter || typeof s.lootFilter !== 'object') s.lootFilter = { autoSellBelow: null };
    s.lootFilter.autoSellBelow = R.filterCheck.checked
      ? Math.max(1, Math.min(3, Number(R.filterSel.value) || 1))
      : null;
    refreshUI();
  });
  R.filterSel.addEventListener('change', () => {
    initAudio();
    sfx.click();
    const s = C && C.state ? C.state : null;
    if (!s || !R.filterCheck.checked) return;
    if (!s.lootFilter || typeof s.lootFilter !== 'object') s.lootFilter = { autoSellBelow: null };
    s.lootFilter.autoSellBelow = Math.max(1, Math.min(3, Number(R.filterSel.value) || 1));
    refreshUI();
  });

  // 背包：装备 / 出售（委托）
  R.invList.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!btn || btn.disabled) return;
    initAudio();
    const uid = btn.dataset.uid;
    const isEquip = btn.dataset.act === 'equip';
    const res = safeCall(() => (isEquip ? act('equipItem', uid) : act('sellItem', uid)));
    if (res === false) sfx.fail();
    else if (isEquip) sfx.click();
    else sfx.coin();
    refreshUI();
  });

  // 小队：招募 / 上阵 / 休息 / 升级（动作由 main 后续里程碑接入，缺 action 时按钮置灰）
  R.paneParty.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-party]') : null;
    if (!btn || btn.disabled) return;
    initAudio();
    const kind = btn.dataset.party;
    const id = btn.dataset.id;
    const res = safeCall(() => act(`${kind}Companion`, id));
    if (res === false) sfx.fail();
    else sfx.click();
    refreshUI();
  });

  // 远征：初火祭坛点亮（任务书指定：relics.applyTalent + computeDerived）
  R.paneExp.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-talent]') : null;
    if (!btn || btn.disabled) return;
    initAudio();
    const id = btn.dataset.talent;
    const ok = safeCall(() => applyTalent(C.state, id));
    if (!ok) {
      sfx.fail();
      refreshUI();
      return;
    }
    safeCall(() => computeDerived(C.state)); // 天赋词条乘区即刻生效（攻防暴攻速）
    const t = TALENT_MAP.get(id);
    addLog(`初火祭坛：${t ? t.name : id} 点亮至 Lv.${num(C.state.talents[id], 1)}`);
    sfx.click();
    refreshUI();
  });

  // 远征：待选遗物快捷芯片 + 自动偏好下拉 + 凯旋回城按钮
  R.expPendingChip.addEventListener('click', () => {
    initAudio();
    sfx.click();
    if (C && C.state && Array.isArray(C.state.pendingRelics) && C.state.pendingRelics.length > 0) {
      openRelicModal();
    }
  });
  R.relicAutoSel.addEventListener('change', () => {
    initAudio();
    const tag = R.relicAutoSel.value || null;
    safeCall(() => act('setRelicAutoTag', tag));
    refreshUI();
  });
  R.btnTriumph.addEventListener('click', () => {
    if (R.btnTriumph.disabled) return;
    initAudio();
    sfx.click();
    openPrestigeModal();
  });

  // 典籍：序章重看 / 设置三按钮
  R.btnIntro.addEventListener('click', () => {
    initAudio();
    sfx.click();
    openIntroModal();
  });
  R.btnExport.addEventListener('click', () => {
    initAudio();
    sfx.click();
    openExportModal();
  });
  R.btnImport.addEventListener('click', () => {
    initAudio();
    sfx.click();
    openImportModal();
  });
  R.btnReset.addEventListener('click', () => {
    initAudio();
    sfx.click();
    openResetModal();
  });

  // 静音开关：直接走 audio.js（契约未提供 setMuted action），同步写回 state.muted
  R.muteCheck.addEventListener('change', () => {
    initAudio();
    const m = !!R.muteCheck.checked;
    setMuted(m);
    if (C && C.state) C.state.muted = m; // 随存档持久化（见文件头说明）
    if (!m) sfx.click();
    refreshUI();
  });

  // 停留本层开关：走 actions
  R.stayCheck.addEventListener('change', () => {
    initAudio();
    sfx.click();
    safeCall(() => act('setStayFloor', !!R.stayCheck.checked));
    refreshUI();
  });

  // HUD：技能快捷栏 —— 点击循环战术 auto→bossOnly→belowHp，写回 state.skills[id].tactic
  R.hudSkills.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.hud-skill') : null;
    if (!btn) return;
    initAudio();
    const id = btn.dataset.skill;
    if (!HERO_SKILL_MAP[id]) return;
    if (!skillUnlocked(C.state, id)) {
      const entry = HERO_SKILL_MAP[id];
      addLog(`${entry.name}尚未解锁（英雄 Lv.${entry.unlockHeroLevel} 解锁）`);
      sfx.fail();
      return;
    }
    cycleTactic(id);
  });

  // HUD：DPS 统计条折叠开关
  R.dpsHead.addEventListener('click', () => {
    initAudio();
    dpsOpen = !dpsOpen;
    R.hudDps.classList.toggle('open', dpsOpen);
    R.dpsCaret.textContent = dpsOpen ? '▾' : '▸';
    sfx.click();
  });

  // HUD：遗物角标 → 有待选则打开三选一弹窗，否则前往远征页
  R.badgeRelic.addEventListener('click', () => {
    initAudio();
    sfx.click();
    if (C && C.state && Array.isArray(C.state.pendingRelics) && C.state.pendingRelics.length > 0) {
      openRelicModal();
    } else {
      switchTab('exp');
    }
  });

  // HUD：奇遇角标 → 有待处理奇遇则打开抉择弹窗
  R.badgeEvent.addEventListener('click', () => {
    initAudio();
    if (C && C.state && Array.isArray(C.state.pendingEvents) && C.state.pendingEvents.length > 0) {
      sfx.click();
      openEventModal();
    } else {
      sfx.fail();
      addLog('深渊风平浪静，推层探索时将随机遭遇奇遇事件。');
    }
  });

  // 弹窗关闭
  R.mClose.addEventListener('click', () => closeModal());
  R.overlay.addEventListener('click', (e) => {
    if (e.target === R.overlay) closeModal();
  });

  // document 级：Esc 关弹窗（只绑一次）
  if (!docBound) {
    docBound = true;
    document.addEventListener('keydown', (e) => {
      if (e && (e.key === 'Escape' || e.key === 'Esc')) closeModal();
    });
  }
}

/** 技能战术循环写回（任务书契约：state.skills[id].tactic）。
 *  M2 修复：统一写对象形态 {mode, threshold?} —— 旧实现写字符串，而 loadGame
 *  的 sanitizeSkills 曾只保留对象形态，字符串战术经存读档被静默丢弃，刷新后
 *  回退"自动"。belowHp 切换时沿用当前阈值（skillTactic 已归一化，缺省 0.5）。 */
function cycleTactic(id) {
  const s = C.state;
  if (!s.skills || typeof s.skills !== 'object') s.skills = {};
  const cur = skillTactic(s, id);
  const idx = TACTIC_MODES.indexOf(cur.mode);
  const next = TACTIC_MODES[(idx < 0 ? 0 : idx + 1) % TACTIC_MODES.length];
  // belowHp 沿用当前阈值（skillTactic 已归一化）；缺省时不写键，
  // 读取侧 skills.normalizeTactic 回默认 DEFAULT_BELOW_HP=0.5
  const tactic = { mode: next };
  if (next === 'belowHp' && Number.isFinite(cur.threshold)) tactic.threshold = cur.threshold;
  const rec = s.skills[id];
  if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
    rec.tactic = tactic; // 细化契约形态：只改战术，解锁位不动
  } else {
    // 迁移中间态（数字 0/1）或缺失：升级为细化契约形状
    s.skills[id] = { unlocked: skillUnlocked(s, id) ? 1 : 0, tactic };
  }
  const entry = HERO_SKILL_MAP[id];
  addLog(`战术调整：${entry ? entry.name : id} → ${TACTIC_LABELS[next] || next}`);
  sfx.click();
  updateHud();
}

// ---------------------------------------------------------------------------
// HUD 数据拉取与渲染（100ms 心跳）
// ---------------------------------------------------------------------------

/**
 * 归一化 HUD 数据：优先 getHudState 契约字段，逐级回退 combat.view / 常量。
 * 返回 { monName, monHp, monMaxHp, isBoss, monId, tags, bossTimeLeft,
 *        bossTimeTotal, skills:{[id]:{cd,cdMax,unlocked,tactic}}, dps,
 *        dpsPeak, dpsCum, dpsSources, phase }（M3 DPS 三项来自 raw.dps 缺省回退 0）
 */
function readHud() {
  const g = typeof window !== 'undefined' ? window.__GAME : null;
  const cb = g && g.combat ? g.combat : null;
  let raw = null;
  if (cb && typeof cb.getHudState === 'function') {
    try {
      raw = cb.getHudState();
    } catch (e) {
      raw = null;
    }
  }
  if (!raw || typeof raw !== 'object') raw = {};
  const view = cb && cb.view ? cb.view : null;
  const m = raw.monster && typeof raw.monster === 'object' ? raw.monster : {};
  const s = C && C.state ? C.state : {};

  const monName = firstStr(m.name, raw.monsterName, view ? view.monsterName : '');
  const monHp = firstNum(m.hp, raw.monsterHp, view ? view.monsterHp : 0);
  const monMaxHp = firstNum(m.maxHp, raw.monsterMaxHp, view ? view.monsterMaxHp : 0);
  const bossTimeLeft = firstNum(m.bossTimeLeft, raw.bossTimeLeft, view ? view.bossTimeLeft : 0);
  const bossTimeTotal = firstNum(m.bossTimeTotal, raw.bossTimeTotal, BALANCE.BOSS_TIME_LIMIT);
  const isBoss =
    m.isBoss != null ? !!m.isBoss : raw.isBoss != null ? !!raw.isBoss : bossTimeLeft > 0;

  let monId = firstStr(m.id, m.sprite, raw.monsterId);
  if (!monId && isBoss && BOSS_ID_BY_NAME.has(monName)) monId = BOSS_ID_BY_NAME.get(monName);

  // 特性标签：契约 tags[] → 兜底表（Boss 恒标「首领」）
  let tags = null;
  const rawTags = m.tags || m.traits || raw.monsterTags;
  if (Array.isArray(rawTags)) {
    tags = rawTags
      .map((t) => (t && typeof t === 'object' ? firstStr(t.label, t.name) : typeof t === 'string' ? t : ''))
      .filter(Boolean);
  }
  if (isBoss) tags = ['首领', ...(tags || []).filter((t) => t !== '首领')];
  else if (!tags || !tags.length) {
    const fb = FALLBACK_TRAITS[monId];
    tags = fb ? [fb] : [];
  }

  // 技能冷却/解锁（数组或映射两种形状都收）
  const sk = {};
  const rs = raw.skills;
  const eatSkill = (id, e) => {
    if (!id || !e || typeof e !== 'object') return;
    sk[id] = { cd: num(e.cd), cdMax: num(e.cdMax), unlocked: e.unlocked, tactic: e.tactic };
  };
  if (Array.isArray(rs)) {
    for (const e of rs) eatSkill(e && e.id, e);
  } else if (rs && typeof rs === 'object') {
    for (const id of Object.keys(rs)) eatSkill(id, rs[id]);
  }

  const dpsRaw = raw.dps;
  const dpsObj = dpsRaw && typeof dpsRaw === 'object' ? dpsRaw : {};
  const dps =
    typeof dpsRaw === 'number' ? dpsRaw : firstNum(dpsObj.dps, dpsObj.value);
  // M3：峰值 / 本场累计输出 / 来源分桶（combat.dpsWindow 产出；缺省回退 0/空）
  const dpsPeak = firstNum(dpsObj.peak);
  const dpsCum = firstNum(dpsObj.cumulative);
  const dpsSources =
    dpsObj.sources && typeof dpsObj.sources === 'object' && !Array.isArray(dpsObj.sources)
      ? dpsObj.sources
      : {};

  return {
    monName,
    monHp,
    monMaxHp,
    isBoss,
    monId,
    tags,
    bossTimeLeft,
    bossTimeTotal,
    skills: sk,
    dps,
    dpsPeak,
    dpsCum,
    dpsSources,
    phase: firstStr(raw.phase, view ? view.phase : ''),
  };
}

/** HUD 心跳：拉数据 → 名牌/血条/狂暴条/气泡/技能栏/角标/DPS 条 */
function updateHud() {
  if (!R || !R.hudPlate || !C) return;
  const H = readHud();
  const s = C.state || {};

  // —— 怪物名牌 + 血条 ——
  const monVisible = !!H.monName && H.monMaxHp > 0;
  R.hudPlate.classList.toggle('hidden', !monVisible);
  if (monVisible) {
    const tagSig = `${H.monName}|${H.isBoss ? 1 : 0}|${H.tags.join(',')}`;
    if (tagSig !== R.monTagSig) {
      R.monTagSig = tagSig;
      R.monName.textContent = H.monName;
      R.monTags.innerHTML = '';
      for (const t of H.tags) {
        R.monTags.appendChild(el('span', 'hud-tag' + (H.isBoss ? ' boss' : ''), t));
      }
    }
    const pct = clampPct(H.monHp / Math.max(1, H.monMaxHp));
    R.monHpFill.style.width = `${pct}%`;
    R.monHpFill.className = `hud-hp-fill ${pct <= 25 ? 'hp-lo' : pct <= 50 ? 'hp-mid' : 'hp-hi'}`;
    R.monHpText.textContent = `${fmtNum(H.monHp)} / ${fmtNum(H.monMaxHp)}`;
  } else {
    R.monTagSig = null;
  }

  // —— Boss 狂暴倒计时条（血条下方） ——
  const rageOn = H.isBoss && H.bossTimeLeft > 0;
  R.hudRage.classList.toggle('hidden', !rageOn);
  if (rageOn) {
    R.rageFill.style.width = `${clampPct(H.bossTimeLeft / Math.max(1, H.bossTimeTotal))}%`;
    R.rageTxt.textContent = `${Math.ceil(H.bossTimeLeft)}s`;
    R.hudRage.classList.toggle('urgent', H.bossTimeLeft <= 5);
  }

  // —— Boss 登场气泡（narrative.BOSS_LINES，2.5s 淡出） ——
  //   首次拉取只静默记录当前 Boss（载入即处于 Boss 战时不补播气泡）；
  //   其后 Boss 标识变化即视为新一场登场；Boss 离场复位，重刷再登场可再次触发。
  {
    const key = H.isBoss ? H.monId || H.monName || 'boss' : null;
    if (!bubblePrimed) {
      bubblePrimed = true;
      lastBossKey = key;
    } else if (!key) {
      lastBossKey = null;
    } else if (key !== lastBossKey) {
      lastBossKey = key;
      showBubble(H.monId, H.monName);
    }
  }

  // —— 技能快捷栏（冷却遮罩 + 战术标签） ——
  for (const entry of HERO_SKILLS) {
    const btn = R.skillBtns[entry.id];
    if (!btn) continue;
    const rec = H.skills[entry.id] || {};
    const unlocked = rec.unlocked != null ? !!rec.unlocked : skillUnlocked(s, entry.id);
    const cd = num(rec.cd);
    const cdMax = num(rec.cdMax) || entry.cd;
    btn.classList.toggle('locked', !unlocked);
    btn.classList.toggle('ready', unlocked && cd <= 0);
    R.skillCds[entry.id].style.height = `${cd > 0 ? clampPct(cd / Math.max(0.1, cdMax)) : 0}%`;
    R.skillCdTxts[entry.id].textContent = cd > 0 ? String(Math.ceil(cd)) : '';
    const tac = normTacticMode(rec.tactic != null ? rec.tactic : skillTactic(s, entry.id).mode);
    R.skillTacs[entry.id].textContent = TACTIC_LABELS[tac] || '自动';
  }

  // —— 右上角角标（待选遗物 xN / 深渊奇遇 xN） ——
  const pendingRelics = Array.isArray(s.pendingRelics) ? s.pendingRelics.length : 0;
  R.badgeRelicCount.textContent = String(pendingRelics);
  R.badgeRelic.classList.toggle('hot', pendingRelics > 0);
  R.badgeRelic.title = pendingRelics > 0 ? `有 ${pendingRelics} 次遗物三选一待抽取，点击抽取` : '待抉择的遗物（点击前往远征）';
  const pendingEvents = Array.isArray(s.pendingEvents) ? s.pendingEvents.length : 0;
  R.badgeEventCount.textContent = String(pendingEvents);
  R.badgeEvent.classList.toggle('soon', pendingEvents === 0);
  R.badgeEvent.classList.toggle('hot', pendingEvents > 0);
  R.badgeEvent.title = pendingEvents > 0 ? `有 ${pendingEvents} 项深渊奇遇待抉择，点击处理` : '深渊奇遇（探索推进时随机触发）';

  // —— DPS 统计条（总 DPS / 峰值 / 累计输出 / 来源占比，M3+M4） ——
  R.dpsVal.textContent = fmtNum(H.dps);
  const peak = num(H.dpsPeak);
  if (R.dpsPeakVal) R.dpsPeakVal.textContent = peak > 0 ? fmtNum(peak) : '—';
  const cum = num(H.dpsCum);
  if (R.dpsTotalVal) R.dpsTotalVal.textContent = cum > 0 ? fmtNum(cum) : '—';
  if (R.dpsSrcAtk && R.dpsSrcSkill && R.dpsSrcDot) {
    const win = num(H.dps);
    const src = H.dpsSources || {};
    const srcLine = (v) =>
      win > 0 && v > 0 ? `${fmtNum(v)} ·${Math.round((v / win) * 100)}%` : '—';
    R.dpsSrcAtk.textContent = srcLine(num(src.attack));
    R.dpsSrcSkill.textContent = srcLine(num(src.skill));
    if (R.dpsSrcComp) R.dpsSrcComp.textContent = srcLine(num(src.companion));
    R.dpsSrcDot.textContent = srcLine(num(src.dot));
  }
}

/** Boss 气泡：取 narrative.BOSS_LINES[id]；未知 Boss 用名字兜底一句 */
function showBubble(bossId, bossName) {
  const text =
    (bossId && Object.prototype.hasOwnProperty.call(BOSS_LINES, bossId) && BOSS_LINES[bossId]) ||
    (bossName ? `「${bossName}」挡在火把的光里。` : null);
  if (!text || !R.bubble) return;
  R.bubble.innerHTML = '';
  R.bubble.appendChild(el('span', 'hud-bubble-txt', text));
  R.bubble.classList.remove('hidden');
  R.bubble.classList.remove('play');
  void R.bubble.offsetWidth; // 重启动画
  R.bubble.classList.add('play');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (R && R.bubble) R.bubble.classList.add('hidden');
  }, 2600); // 动画 2.5s + 0.1s 余量
}

// ---------------------------------------------------------------------------
// 面板渲染（refreshUI 内部，按签名 diff 避免高频重建）
// ---------------------------------------------------------------------------

function renderTopbar(s) {
  R.goldVal.textContent = fmtNum(s.gold);
  R.emberVal.textContent = fmtNum(s.embers);

  const f = Math.max(1, Math.floor(num(s.floor, 1)));
  R.floorVal.textContent = `第 ${f} 层 · ${floorName(f)}`;
  R.floorProg.textContent = `击杀 ${Math.max(0, Math.floor(num(s.killsOnFloor)))}/${BALANCE.MONSTERS_PER_FLOOR}`;

  const h = s.hero || {};
  const lv = Math.max(1, Math.floor(num(h.level, 1)));
  const needXp = xpNeeded(lv);
  const xp = Math.max(0, num(h.xp));
  R.lvVal.textContent = `Lv.${lv}`;
  R.xpText.textContent = `经验 ${fmtNum(xp)}/${fmtNum(needXp)}`;
  R.xpFill.style.width = `${clampPct(xp / Math.max(1, needXp))}%`;

  const hpNow = Math.max(0, num(h.hpNow));
  const maxHp = Math.max(1, num(h.maxHp, 1));
  const pct = hpNow / maxHp;
  R.hpText.textContent = `生命 ${fmtNum(hpNow)}/${fmtNum(maxHp)}`;
  R.hpFill.className = 'bar-fill ' + (pct <= 0.25 ? 'hp-lo' : pct <= 0.5 ? 'hp-mid' : 'hp-hi');
  R.hpFill.style.width = `${clampPct(pct)}%`;
}

/**
 * 英雄总暴击率（百分点）。
 * state.hero.critChance 为 0~0.5 小数（= 总百分点/100，见 state.js 派生规则），
 * CRIT_CAP 是百分点口径（50），比较前换算一致。
 */
function critPtsOf(hero) {
  return num(hero && hero.critChance) * 100;
}

/** crit/aspd 升级是否已到总上限（读英雄最终值，封顶含装备与天赋扩容） */
function isUpgradeCapped(u, s) {
  const hero = (s && s.hero) || {};
  const tMods = talentMods(s) || {};
  if (u.id === 'crit') return critPtsOf(hero) >= CRIT_CAP + num(tMods.critCap) * 100 - 1e-9;
  if (u.id === 'aspd') return num(hero.aspd) >= ASPD_CAP + num(tMods.aspdCap) - 1e-9;
  return false;
}

function capSuffix(u, s) {
  const tMods = talentMods(s) || {};
  if (u.id === 'crit') return `（总上限 ${Math.round((CRIT_CAP + num(tMods.critCap) * 100) * 10) / 10}%）`;
  if (u.id === 'aspd') return `（总上限 ${(ASPD_CAP + num(tMods.aspdCap)).toFixed(2).replace(/\.?0+$/, '')} 倍/秒）`;
  return '';
}

/** 从当前已购级数起，连买 n 次的金币总价（×10 档展示用，纯计算） */
function bulkCost(u, lv, n) {
  let c = 0;
  for (let i = 0; i < n; i++) c += upgradeCost(u, lv + i);
  return c;
}

function renderUpgrades(s) {
  const ups = s.upgrades || {};
  const gold = num(s.gold);
  const lv = Math.max(1, Math.floor(num((s.hero || {}).level, 1)));

  // 技能解锁状态（含当前等级对比）
  const skSig = `${lv}|${HERO_SKILLS.map((e) => (skillUnlocked(s, e.id) ? 1 : 0)).join(',')}`;
  if (skSig !== R.skSig) {
    R.skSig = skSig;
    R.skillStatus.innerHTML = '';
    for (const entry of HERO_SKILLS) {
      const row = el('div', 'sk-row');
      row.append(el('b', 'sk-name', `${SKILL_ICONS[entry.id] || ''} ${entry.name}`));
      const meta = el('span', 'sk-meta', entry.desc);
      row.appendChild(meta);
      const unlocked = skillUnlocked(s, entry.id);
      row.appendChild(
        el('span', unlocked ? 'sk-chip on' : 'sk-chip off', unlocked ? '已解锁' : `Lv.${entry.unlockHeroLevel} 解锁`),
      );
      R.skillStatus.appendChild(row);
    }
  }

  // 升级行（按当前购买档位显示总价）
  const sig =
    UPGRADES.map((u) => {
      const l = Math.max(0, Math.floor(num(ups[u.id])));
      return `${u.id}:${l}:${gold}:${isUpgradeCapped(u, s) ? 1 : 0}:${buyMode}`;
    }).join('|') + `|${gold}`;
  if (sig === R.upSig) return;
  R.upSig = sig;

  R.upList.innerHTML = '';
  for (const u of UPGRADES) {
    const l = Math.max(0, Math.floor(num(ups[u.id])));
    const cost1 = upgradeCost(u, l);
    const capped = isUpgradeCapped(u, s);
    const n = buyMode === 'max' ? BUY_MAX_COUNT : buyMode === '10' ? 10 : 1;
    const shown = buyMode === '1' ? cost1 : buyMode === '10' ? bulkCost(u, l, 10) : cost1;

    const row = el('div', 'up-row');
    const info = el('div', 'up-info');
    const nameRow = el('div', 'up-name');
    nameRow.append(
      el('span', 'up-ico', UPGRADE_ICONS[u.id] || '◆'),
      el('b', '', u.name),
      el('span', 'up-lv num', `已购 ${l} 级`),
    );
    const desc = el('div', 'up-desc', u.desc + capSuffix(u, s));
    info.append(nameRow, desc);

    const btn = el('button', 'btn btn-buy num');
    btn.type = 'button';
    btn.dataset.buy = u.id;
    if (capped) {
      btn.textContent = '已满级';
      btn.disabled = true;
    } else {
      btn.textContent = buyMode === 'max' ? `⚒ MAX · ${fmtNum(shown)}` : `⚒ ×${n === 1 ? '1' : '10'} · ${fmtNum(shown)}`;
      btn.title =
        buyMode === 'max'
          ? `点按自动强化到金币不足或达上限（单次 ${fmt(cost1)} 金币）`
          : buyMode === '10'
            ? `连买 10 级共 ${fmt(shown)} 金币（单次 ${fmt(cost1)}）`
            : `${fmt(cost1)} 金币`;
      btn.disabled = gold < cost1;
    }

    row.append(info, btn);
    R.upList.appendChild(row);
  }
}

function renderEquipment(s) {
  const h = s.hero || {};

  // 智能过滤栏与 state.lootFilter 双向对齐（任务书指定 UI 直写）
  const lf = (s.lootFilter && typeof s.lootFilter === 'object' ? s.lootFilter.autoSellBelow : null) || null;
  const filterSig = String(lf);
  if (filterSig !== R.filterSig) {
    R.filterSig = filterSig;
    R.filterCheck.checked = lf != null;
    R.filterSel.disabled = lf == null;
    if (lf != null) R.filterSel.value = String(lf);
  }

  // 属性总览（攻击/生命/防御/暴击/攻速；critChance 小数 → 百分比显示）
  const heroSig = `${fmt(h.atk)}|${fmt(h.maxHp)}|${fmtPts(h.def)}|${fmtPts(critPtsOf(h))}|${fmtMul(h.aspd)}`;
  if (heroSig !== R.heroSig) {
    R.heroSig = heroSig;
    R.heroStats.innerHTML = '';
    const cells = [
      ['攻击', fmt(h.atk)],
      ['生命', fmt(h.maxHp)],
      ['防御', fmtPts(h.def)],
      ['暴击', `${fmtPts(critPtsOf(h))}%`],
      ['攻速', `${fmtMul(h.aspd)} 倍/秒`],
    ];
    for (const [k, v] of cells) {
      const c = el('span', 'stat-cell');
      c.append(el('span', 'stat-k', k), el('b', 'stat-v num', v));
      R.heroStats.appendChild(c);
    }
  }

  const equipped = s.equipped || {};
  const inv = Array.isArray(s.inventory) ? s.inventory : [];
  const eqSig = sigOf([equipped, inv]);
  if (eqSig === R.eqSig) return;
  R.eqSig = eqSig;

  // 已装备 4 部位概览（暗金名称呼吸微光；M3：副词条行随属性行展示）
  R.eqGrid.innerHTML = '';
  for (const slot of SLOT_ORDER) {
    const cell = el('div', 'eq-cell');
    cell.appendChild(el('div', 'eq-slot', SLOT_NAMES[slot] || slot));
    const it = equipped[slot];
    if (it && it.name) {
      const line = el('div', 'eq-item');
      line.appendChild(el('b', itemNameClass(it), it.name));
      cell.append(line, el('div', 'eq-stats num', statsText(it)));
      const ax = affixesText(it);
      if (ax) cell.appendChild(el('div', 'affix-line', ax));
    } else {
      cell.appendChild(el('div', 'eq-item eq-empty', '—— 空 ——'));
    }
    R.eqGrid.appendChild(cell);
  }

  // 背包列表（同部位自动对比：▲更强 / ▼更弱）
  R.invTitle.textContent = `背包（${inv.length}）`;
  R.invList.innerHTML = '';
  if (!inv.length) {
    R.invList.appendChild(
      el(
        'div',
        'inv-empty',
        `背包空空如也 · 击杀怪物有 ${Math.round(BALANCE.DROP_CHANCE * 100)}% 概率掉落装备`,
      ),
    );
    return;
  }
  for (const it of inv) {
    if (!it || !it.uid) continue;
    const rar = rarityOf(it.rarity);
    const row = el('div', 'inv-row');
    const info = el('div', 'inv-info');
    const nameLine = el('div', 'inv-name');
    nameLine.append(
      el('b', itemNameClass(it), it.name || '未知装备'),
      el('span', 'inv-slot', `${RARITY_NAMES[rar]}·${SLOT_NAMES[it.slot] || '?'}`),
    );
    info.append(nameLine, el('div', 'inv-stats num', statsText(it)));

    // 副词条行（M3：稀有 1 / 史诗 2 / 传说 3 条；暗金恒空走风味文案）
    const ax = affixesText(it);
    if (ax) info.appendChild(el('div', 'affix-line', ax));

    // 同部位对比行（含空部位：全部按新增计）
    const diffs = compareLine(it, equipped[it.slot]);
    if (diffs.length) {
      const cmp = el('div', 'cmp-line');
      for (const [txt, up] of diffs) cmp.appendChild(el('span', up ? 'cmp-up num' : 'cmp-down num', txt));
      info.appendChild(cmp);
    }

    // 暗金风味文案（narrative.UNIQUE_FLAVOR）
    const flavor = flavorOf(it);
    if (flavor) info.appendChild(el('div', 'flavor', flavor));

    const ops = el('div', 'inv-ops');
    const bEq = el('button', 'btn btn-sm', '✚ 装备');
    bEq.type = 'button';
    bEq.dataset.act = 'equip';
    bEq.dataset.uid = it.uid;
    const bSell = el('button', 'btn btn-sm', `➤ 出售 ${fmtNum(it.value)}`);
    bSell.type = 'button';
    bSell.dataset.act = 'sell';
    bSell.dataset.uid = it.uid;
    ops.append(bEq, bSell);

    row.append(info, ops);
    R.invList.appendChild(row);
  }
}

/** 同部位属性对比：返回 [[文案, 是否更强], ...]（数值与已穿戴逐项相减） */
function compareLine(item, equippedItem) {
  const a = (item && item.stats) || {};
  const b = (equippedItem && equippedItem.stats) || {};
  const out = [];
  for (const k of Object.keys(STAT_LABELS)) {
    const va = num(a[k]);
    const vb = num(b[k]);
    if (va === 0 && vb === 0) continue;
    const d = Math.round((va - vb) * 10) / 10;
    if (d > 0) out.push([`${STAT_LABELS[k]} ▲+${fmtPts(d)}`, true]);
    else if (d < 0) out.push([`${STAT_LABELS[k]} ▼${fmtPts(d)}`, false]);
  }
  return out;
}

function canRecruitCompanion(id, s) {
  const c = COMPANIONS[id];
  if (!c) return false;
  const party = s.party || {};
  if (party.unlocked && party.unlocked[id]) return false;
  const u = c.unlock || {};
  if (u.type === 'bossKill') {
    return num(s.stats && s.stats.bossKills) >= 1 && num(s.gold) >= num(u.cost && u.cost.gold);
  }
  if (u.type === 'embers') {
    return num(s.embers) >= num(u.cost);
  }
  return false;
}

function renderParty(s) {
  const party = s.party || { unlocked: {}, active: [], levels: {} };
  const unlocked = party.unlocked || {};
  const active = Array.isArray(party.active) ? party.active : [];
  const levels = party.levels || {};
  const embers = num(s.embers);
  const gold = num(s.gold);
  const bossKills = num(s.stats && s.stats.bossKills);
  const bondIds = activeBonds(s).map((b) => b.id);
  const sig = sigOf([unlocked, active, levels, embers, Math.floor(gold), bossKills >= 1, bondIds]);
  if (sig === R.partySig) return;
  R.partySig = sig;

  R.partyEmbers.textContent = fmtNum(embers);

  // —— 伙伴招募卡 ——
  R.partyCards.innerHTML = '';
  for (const id of PARTY_ORDER) {
    const c = COMPANIONS[id];
    if (!c) continue;
    const isUnlocked = !!unlocked[id];
    const isActive = active.includes(id);
    const lv = Math.max(1, Math.floor(num(levels[id], 1)));
    const upCost = companionUpgradeCost(lv);
    const mult = companionLevelMult(lv);

    const card = el('div', 'pcard' + (isActive ? ' deployed' : ''));
    const head = el('div', 'pcard-head');
    head.append(el('b', 'pcard-name', c.name));
    head.appendChild(
      el(
        'span',
        isUnlocked ? (isActive ? 'chip deploy' : 'chip on') : 'chip off',
        isUnlocked ? (isActive ? '上阵中' : '候补') : '未招募',
      ),
    );
    card.appendChild(head);

    card.appendChild(el('div', 'pcard-desc', `${c.desc} · Lv.${lv}（数值 ×${mult.toFixed(2)}）`));

    // 技能清单（skills.js COMPANION_SKILLS 契约）
    const skills = el('div', 'pcard-skills');
    for (const sk of COMPANION_SKILLS[id] || []) {
      skills.appendChild(el('span', 'sk-chip plain', sk.desc));
    }
    card.appendChild(skills);

    // 解锁条件（skills.js COMPANIONS.unlock 契约）
    const u = c.unlock || {};
    const cond =
      u.type === 'bossKill'
        ? `解锁条件：击杀任意深渊之主${u.cost && u.cost.gold ? `，并支付 ${fmt(u.cost.gold)} 金币` : ''}`
        : `解锁条件：消耗 ${fmt(num(u.cost, 0))} 灵魂余烬`;
    card.appendChild(el('div', 'pcard-cond', cond));

    // 操作区
    const ops = el('div', 'pcard-ops');
    if (!isUnlocked) {
      const b = el('button', 'btn btn-sm', `✦ 招募`);
      b.type = 'button';
      b.dataset.party = 'recruit';
      b.dataset.id = id;
      const canRec = canRecruitCompanion(id, s);
      b.disabled = !hasAction('recruitCompanion') || !canRec;
      b.title = canRec ? `点击招募 ${c.name}` : cond;
      ops.appendChild(b);
    } else {
      const bDeploy = el('button', 'btn btn-sm', isActive ? '▽ 休息' : '➤ 上阵');
      bDeploy.type = 'button';
      bDeploy.dataset.party = isActive ? 'undeploy' : 'deploy';
      bDeploy.dataset.id = id;
      const fullTeam = !isActive && active.length >= 3;
      bDeploy.disabled = !hasAction(isActive ? 'undeployCompanion' : 'deployCompanion') || fullTeam;
      bDeploy.title = fullTeam ? '小队最多同时上阵 3 名伙伴' : '';
      const bUp = el('button', 'btn btn-sm', `▲ 升级 · ${fmtNum(upCost)} 余烬`);
      bUp.type = 'button';
      bUp.dataset.party = 'upgrade';
      bUp.dataset.id = id;
      bUp.disabled = !hasAction('upgradeCompanion') || embers < upCost;
      bUp.title = `升到 Lv.${lv + 1}`;
      ops.append(bDeploy, bUp);
    }
    card.appendChild(ops);
    R.partyCards.appendChild(card);
  }

  // —— 羁绊区 ——
  R.bondList.innerHTML = '';
  for (const b of BONDS) {
    const on = bondIds.includes(b.id);
    const row = el('div', 'bond' + (on ? ' on' : ''));
    const head = el('div', 'bond-head');
    head.append(el('b', 'bond-name', `${on ? '◆' : '◇'} ${b.name}`), el('span', 'bond-mods', b.desc));
    row.appendChild(head);
    row.appendChild(el('div', 'bond-members', `成员：${b.members.map(memberName).join(' + ')}`));
    R.bondList.appendChild(row);
  }
}

function renderExpedition(s) {
  const relicsOwned = Array.isArray(s.relics) ? s.relics : [];
  const pending = Array.isArray(s.pendingRelics) ? s.pendingRelics.length : 0;
  const embers = num(s.embers);
  const talents = s.talents && typeof s.talents === 'object' ? s.talents : {};
  const floor = Math.max(1, Math.floor(num(s.floor, 1)));
  const best = Math.max(1, Math.floor(num(s.bestFloor, 1)));
  const autoTag = s.relicAutoTag || '';
  const sig = sigOf([relicsOwned, pending, embers, talents, floor, best, autoTag]);
  if (sig === R.expSig) return;
  R.expSig = sig;

  R.expRelicCount.textContent = `本轮遗物 ${relicsOwned.length}`;
  R.expPendingChip.textContent = pending > 0 ? `✦ 待抉择 ×${pending}` : '';
  R.expPendingChip.classList.toggle('hidden', pending === 0);
  if (R.relicAutoSel && R.relicAutoSel.value !== autoTag) {
    R.relicAutoSel.value = autoTag;
  }

  // —— 本轮已选遗物 ——
  R.relicList.innerHTML = '';
  if (!relicsOwned.length) {
    R.relicList.appendChild(el('div', 'inv-empty', '本轮尚未携带遗物——击败深渊之主后将迎来三选一抉择。'));
  } else {
    for (const id of relicsOwned) {
      const r = RELIC_MAP.get(id);
      const row = el('div', 'relic-row');
      const head = el('div', 'relic-head');
      head.append(
        el('b', 'relic-name', r ? r.name : id),
        el('span', 'relic-tag', r && RELIC_TAG_MAP.get(r.tag) ? RELIC_TAG_MAP.get(r.tag) : '?'),
      );
      row.append(head, el('div', 'relic-desc', r ? r.desc : '去向不明的遗物。'));
      R.relicList.appendChild(row);
    }
  }

  // —— 初火祭坛天赋树（余烬消耗；applyTalent 由本页直接接入） ——
  R.talentGrid.innerHTML = '';
  for (const t of TALENTS) {
    const lv = Math.max(0, Math.floor(num(talents[t.id], 0)));
    const maxed = lv >= t.maxLevel;
    const price = t.cost(lv);
    const cell = el('div', 'talent' + (lv > 0 ? ' lit' : ''));
    const head = el('div', 'talent-head');
    head.append(el('b', 'talent-name', t.name), el('span', 'talent-pips num', '◆'.repeat(lv) + '◇'.repeat(Math.max(0, t.maxLevel - lv))));
    cell.append(head, el('div', 'talent-desc', t.desc));
    const btn = el('button', 'btn btn-sm btn-talent num');
    btn.type = 'button';
    btn.dataset.talent = t.id;
    if (maxed) {
      btn.textContent = '已满级';
      btn.disabled = true;
    } else {
      btn.textContent = `◆ 点亮 · ${fmtNum(price)} 余烬`;
      btn.disabled = embers < price;
      btn.title = `当前 Lv.${lv} → Lv.${lv + 1}`;
    }
    cell.appendChild(btn);
    R.talentGrid.appendChild(cell);
  }

  // —— 凯旋回城（当前层 ≥ 10 且接通 prestige action 时激活） ——
  const canTriumph = floor >= 10 && hasAction('prestige');
  const gain = calcPrestigeEmbers(floor);
  R.btnTriumph.disabled = !canTriumph;
  R.btnTriumph.classList.toggle('ready', canTriumph);
  R.btnTriumph.textContent = canTriumph
    ? `⌂ 凯旋回城（第 ${floor} 层 → +${fmtNum(gain)} 余烬）`
    : '⌂ 凯旋回城（本轮需达第 10 层）';
  R.btnTriumph.title = canTriumph
    ? `火种归座：携 +${gain} 灵魂余烬与所有装备安全撤回营地，重燃新一轮远征`
    : '本轮推进至第 10 层后即可随时凯旋轮回';
}

function renderCodex(s) {
  const chr = Array.isArray(s.chronicle) ? s.chronicle : [];
  const lastEntry = chr.length ? `${chr.length}:${num(chr[chr.length - 1].time)}:${chr[chr.length - 1].text}` : '0';
  const sig = `${chr.length}|${lastEntry}`;
  if (sig === R.chrSig) return;
  R.chrSig = sig;

  // 编年史时间轴（最新在上，最多渲染 80 条）
  R.chrList.innerHTML = '';
  if (!chr.length) {
    R.chrList.appendChild(el('div', 'inv-empty', '编年史还是白纸——去写下第一笔。'));
  } else {
    for (let i = chr.length - 1; i >= 0 && i >= chr.length - 80; i--) {
      const e = chr[i];
      const row = el('div', 'chr-item');
      row.append(el('span', 'chr-dot', '◆'), el('span', 'chr-time num', fmtTime(e.time)), el('span', 'chr-text', e.text));
      R.chrList.appendChild(row);
    }
  }
}

function renderSettings(s) {
  const muted = !!isMuted() || !!s.muted;
  if (R.muteCheck.checked !== muted) R.muteCheck.checked = muted;
  const stay = !!s.stayFloor;
  if (R.stayCheck.checked !== stay) R.stayCheck.checked = stay;
}

/** 标签红点：装备=背包有更强装备；小队=有伙伴满足招募条件；远征=待选遗物/奇遇或当前层≥10 */
function renderDots(s) {
  R.tabBtns.eq.classList.toggle('has-dot', hasStrongerEquip(s));
  const partyDot = PARTY_ORDER.some((id) => canRecruitCompanion(id, s));
  if (R.tabBtns.party) R.tabBtns.party.classList.toggle('has-dot', partyDot);
  const expDot =
    (Array.isArray(s.pendingRelics) && s.pendingRelics.length > 0) ||
    (Array.isArray(s.pendingEvents) && s.pendingEvents.length > 0) ||
    Math.floor(num(s.floor, 1)) >= 10;
  R.tabBtns.exp.classList.toggle('has-dot', expDot);
}

// ---------------------------------------------------------------------------
// 契约导出
// ---------------------------------------------------------------------------

/**
 * 构建全部面板 DOM 并绑定事件。
 * @param {{state:object, actions:object}} ctx
 */
export function initUI(ctx) {
  C = ctx && typeof ctx === 'object' ? ctx : {};
  R = {};
  bubblePrimed = false;
  lastBossKey = null;
  buildShell();
  bindEvents();
  switchTab('up');
  refreshUI();
  if (hudTimer != null) clearInterval(hudTimer);
  hudTimer = setInterval(updateHud, HUD_POLL_MS); // HUD 心跳：100ms 拉取（契约）
}

/** 从 state 重读并刷新面板（调用方约 150ms 节流调用；HUD 心跳独立 100ms） */
export function refreshUI() {
  if (!R || !C) return;
  const s = C.state || {};

  renderTopbar(s);
  renderUpgrades(s);
  renderEquipment(s);
  renderParty(s);
  renderExpedition(s);
  renderCodex(s);
  renderSettings(s);
  renderDots(s);
  updateHud(); // 与主刷新同步一次（另有 100ms 独立心跳兜底）
}

/** 战斗日志追加一行，保留最近 12 条 */
export function addLog(text) {
  if (!R || !R.logList) return;
  const line = el('div', 'log-line', text == null ? '' : String(text));
  R.logList.appendChild(line);
  while (R.logList.children.length > 12) {
    R.logList.removeChild(R.logList.firstChild);
  }
  R.logList.scrollTop = R.logList.scrollHeight;
}

// ---------------------------------------------------------------------------
// 弹窗
// ---------------------------------------------------------------------------

function openModal(title, bodyNode) {
  R.mTitle.textContent = title;
  R.mBody.innerHTML = '';
  R.mBody.appendChild(bodyNode);
  R.overlay.classList.remove('hidden');
}

function closeModal() {
  if (!R || !R.overlay) return;
  R.overlay.classList.add('hidden');
  R.mBody.innerHTML = '';
}

async function copyText(text, ta) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    /* 走降级方案 */
  }
  try {
    if (ta && typeof ta.focus === 'function') {
      ta.focus();
      ta.select();
    }
    return !!document.execCommand('copy');
  } catch (e) {
    return false;
  }
}

function openExportModal() {
  let text = '';
  try {
    text = String(act('exportSave') || '');
  } catch (e) {
    console.warn('[ui] exportSave 失败:', e);
  }
  const wrap = el('div', 'modal-form');
  wrap.appendChild(el('p', 'hint', '复制下面的存档文本并妥善保存（可用于换浏览器/换机器续玩）：'));
  const ta = el('textarea', 'save-text');
  ta.readOnly = true;
  ta.rows = 6;
  ta.spellcheck = false;
  ta.value = text;
  const row = el('div', 'modal-btns');
  const copy = el('button', 'btn btn-primary', '复制全部');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    const ok = await copyText(text, ta);
    copy.textContent = ok ? '已复制 ✓' : '复制失败，请手动全选复制';
    setTimeout(() => {
      copy.textContent = '复制全部';
    }, 1500);
  });
  row.appendChild(copy);
  wrap.append(ta, row);
  openModal('导出存档', wrap);
  if (typeof ta.focus === 'function') {
    ta.focus();
    ta.select();
  }
}

function openImportModal() {
  const wrap = el('div', 'modal-form');
  wrap.appendChild(el('p', 'hint', '粘贴之前导出的存档文本（导入会覆盖当前进度）：'));
  const ta = el('textarea', 'save-text');
  ta.rows = 6;
  ta.spellcheck = false;
  ta.placeholder = '在此粘贴存档文本…';
  const err = el('p', 'modal-err hidden', '');
  const row = el('div', 'modal-btns');
  const cancel = el('button', 'btn', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => closeModal());
  const ok = el('button', 'btn btn-primary', '确认导入');
  ok.type = 'button';
  ok.addEventListener('click', () => {
    const str = ta.value.trim();
    if (!str) {
      err.textContent = '请先粘贴存档文本。';
      err.classList.remove('hidden');
      return;
    }
    const res = safeCall(() => act('importSave', str));
    if (res) {
      closeModal();
      addLog('存档导入成功，继续冒险！');
      refreshUI();
    } else {
      err.textContent = '导入失败：存档文本无效或已损坏。';
      err.classList.remove('hidden');
    }
  });
  row.append(cancel, ok);
  wrap.append(ta, err, row);
  openModal('导入存档', wrap);
}

function openResetModal() {
  const wrap = el('div', 'modal-form');
  wrap.appendChild(
    el('p', '', '确定要重置游戏吗？金币、等级、升级与装备都会被清空，且无法恢复。'),
  );
  const row = el('div', 'modal-btns');
  const cancel = el('button', 'btn', '再想想');
  cancel.type = 'button';
  cancel.addEventListener('click', () => closeModal());
  const ok = el('button', 'btn btn-danger', '确认重置');
  ok.type = 'button';
  ok.addEventListener('click', () => {
    safeCall(() => act('resetGame'));
    closeModal();
    addLog('游戏已重置，重新开始冒险！');
    refreshUI();
  });
  row.append(cancel, ok);
  wrap.appendChild(row);
  openModal('危险操作', wrap);
}

/** 序章重看（典籍页/首次启动；narrative.INTRO_LINES 逐句浮现） */
function openIntroModal() {
  const wrap = el('div', 'intro');
  wrap.appendChild(el('p', 'intro-cap', '—— 序章 ——'));
  INTRO_LINES.forEach((line, i) => {
    const p = el('p', 'intro-line', line);
    p.style.animationDelay = `${0.15 + i * 0.7}s`;
    wrap.appendChild(p);
  });
  const row = el('div', 'modal-btns');
  const ok = el('button', 'btn btn-primary', '火把在手，继续走下去');
  ok.type = 'button';
  ok.addEventListener('click', () => {
    initAudio();
    sfx.click();
    safeCall(() => act('markIntroSeen'));
    closeModal();
  });
  row.appendChild(ok);
  wrap.appendChild(row);
  openModal('余烬深渊', wrap);
}

export function showIntroModal() {
  if (!R || !R.overlay) return;
  openIntroModal();
}

/** 三选一遗物弹窗（M5）：不暂停战斗，依次抽取待选队列中的遗物 */
function openRelicModal() {
  const s = C && C.state ? C.state : {};
  const queue = Array.isArray(s.pendingRelics) ? s.pendingRelics : [];
  if (!queue.length) {
    closeModal();
    return;
  }
  const roll = queue[0];
  const opts = Array.isArray(roll.options) ? roll.options : [];
  const wrap = el('div', 'modal-form');
  wrap.appendChild(
    el('p', 'hint', `深渊之主遗留的余烬凝成了选择（剩余 ${queue.length} 组待选，战斗仍在后台进行中）：`),
  );
  const grid = el('div', 'relic-picker-grid');
  for (const rId of opts) {
    const r = RELIC_MAP.get(rId);
    if (!r) continue;
    const card = el('button', 'relic-pick-card');
    card.type = 'button';
    const head = el('div', 'relic-head');
    head.append(
      el('b', 'relic-name', r.name),
      el('span', 'relic-tag', RELIC_TAG_MAP.get(r.tag) || r.tag),
    );
    card.append(head, el('div', 'relic-pick-desc', r.desc));
    card.addEventListener('click', () => {
      initAudio();
      safeCall(() => act('pickRelic', roll.id, r.id));
      if (C.state.pendingRelics && C.state.pendingRelics.length > 0) {
        openRelicModal();
      } else {
        closeModal();
      }
      refreshUI();
    });
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  openModal('遗物抉择 · 三选一', wrap);
}

/** 深渊奇遇弹窗（M5）：展示随机地牢事件与风险选项 */
function openEventModal() {
  const s = C && C.state ? C.state : {};
  const queue = Array.isArray(s.pendingEvents) ? s.pendingEvents : [];
  if (!queue.length) {
    closeModal();
    return;
  }
  const pending = queue[0];
  const ev = EVENTS.find((e) => e.id === pending.eventId);
  if (!ev) {
    queue.shift();
    if (queue.length > 0) openEventModal();
    else closeModal();
    return;
  }

  const wrap = el('div', 'modal-form');
  wrap.appendChild(el('div', 'event-text', ev.text));
  const list = el('div', 'event-choices');
  ev.choices.forEach((ch, idx) => {
    const btn = el('button', 'event-choice-btn');
    btn.type = 'button';
    const top = el('div', 'event-choice-top');
    const riskCls = ch.risk === '高' ? 'high' : ch.risk === '中' ? 'mid' : 'low';
    top.append(
      el('b', 'event-choice-label', ch.label),
      el('span', `risk-badge ${riskCls}`, `风险·${ch.risk || '低'}`),
    );
    btn.append(top, el('div', 'event-choice-desc', ch.desc));
    btn.addEventListener('click', () => {
      initAudio();
      const effType = ch.effect && ch.effect.type;
      safeCall(() => act('resolveEvent', pending.id, idx));
      if (effType === 'bossRush' || effType === 'floorSkip' || !C.state.pendingEvents || C.state.pendingEvents.length === 0) {
        closeModal();
      } else {
        openEventModal();
      }
      refreshUI();
    });
    list.appendChild(btn);
  });
  wrap.appendChild(list);
  if (queue.length > 1) {
    wrap.appendChild(el('p', 'hint', `队列中还有 ${queue.length - 1} 项奇遇等待处理。`));
  }
  openModal(`奇遇 · ${ev.name}`, wrap);
}

/** 凯旋回城（轮回确认弹窗，M5） */
function openPrestigeModal() {
  const s = C && C.state ? C.state : {};
  const floor = Math.max(1, Math.floor(num(s.floor, 1)));
  if (floor < 10) return;
  const gain = calcPrestigeEmbers(floor);
  const startFloor = 1 + Math.max(0, Math.floor(num(talentMods(s).startFloor, 0)));
  const keptCount =
    (Array.isArray(s.inventory) ? s.inventory.length : 0) +
    (s.equipped ? Object.values(s.equipped).filter(Boolean).length : 0);

  const wrap = el('div', 'modal-form');
  const box = el('div', 'prestige-summary');
  const rows = [
    ['当前推进层数', `第 ${floor} 层`, ''],
    ['可获灵魂余烬', `+${fmtNum(gain)}`, 'gold-text'],
    ['下轮起跑层数', `第 ${startFloor} 层`, 'xp-text'],
    ['永久保留装备', `${keptCount} 件（已穿戴+背包）`, ''],
  ];
  for (const [k, v, cls] of rows) {
    const r = el('div', 'offline-row');
    r.append(el('span', '', k), el('b', cls, v));
    box.appendChild(r);
  }
  wrap.appendChild(box);
  wrap.appendChild(
    el('p', 'hint', '凯旋将重置：当前层数、本轮金币、金币强化、勇者等级与本轮临时遗物。\n永久保留：全部装备、灵魂余烬、已招募伙伴、永久天赋与编年史。'),
  );
  const row = el('div', 'modal-btns');
  const cancel = el('button', 'btn', '继续深入');
  cancel.type = 'button';
  cancel.addEventListener('click', () => closeModal());
  const ok = el('button', 'btn btn-primary', `✦ 凯旋回城（+${fmtNum(gain)} 余烬）`);
  ok.type = 'button';
  ok.addEventListener('click', () => {
    initAudio();
    safeCall(() => act('prestige'));
    closeModal();
    refreshUI();
  });
  row.append(cancel, ok);
  wrap.appendChild(row);
  openModal('凯旋回城 · 火种归座', wrap);
}

/**
 * 离线收益弹窗。
 * @param {{minutes:number, gold:number, xp:number, kills:number, items:Array}} gains
 */
export function showOfflineModal(gains) {
  if (!R || !R.overlay) return;
  const g = gains || {};
  const minutes = Math.max(0, Math.floor(num(g.minutes)));
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const away = hh > 0 ? `${hh} 小时 ${mm} 分钟` : `${mm} 分钟`;
  const items = Array.isArray(g.items) ? g.items.filter(Boolean) : [];

  const wrap = el('div', 'offline');
  wrap.appendChild(el('p', 'offline-lead', `英雄离线修炼了 ${away}，战果如下：`));

  const grid = el('div', 'offline-grid');
  const rows = [
    ['击杀怪物', `${fmt(g.kills)} 只`, ''],
    ['获得金币', `+${fmt(g.gold)}`, 'gold-text'],
    ['获得经验', `+${fmt(g.xp)}`, 'xp-text'],
  ];
  const levels = Math.max(0, Math.floor(num(g.levelsGained))); // state.grantOffline 附带，有则展示
  if (levels > 0) rows.push(['提升等级', `+${levels}`, 'xp-text']);
  const autoSold = Math.max(0, Math.floor(num(g.autoSoldCount)));
  if (autoSold > 0) rows.push(['自动过滤出售', `${fmt(autoSold)} 件 (+${fmt(g.autoSoldGold)} 金币)`, 'gold-text']);
  for (const [k, v, cls] of rows) {
    const line = el('div', 'offline-row');
    line.append(el('span', '', k), el('b', cls, v));
    grid.appendChild(line);
  }
  wrap.appendChild(grid);

  wrap.appendChild(el('h4', '', `装备掉落（${items.length} 件）`));
  if (!items.length) {
    wrap.appendChild(el('p', 'hint', '这次没有装备掉落。'));
  } else {
    const list = el('div', 'offline-items');
    for (const it of items) {
      const rar = rarityOf(it.rarity);
      const line = el('div', 'offline-item');
      line.appendChild(el('b', itemNameClass(it), it.name || '未知装备'));
      line.appendChild(
        el(
          'span',
          'offline-item-sub',
          `${RARITY_NAMES[rar]}·${SLOT_NAMES[it.slot] || '?'} ${statsText(it)} 售价${fmtNum(it.value)}`,
        ),
      );
      const ax = affixesText(it); // M3：离线掉落弹窗同步展示副词条
      if (ax) line.appendChild(el('span', 'offline-item-sub affix-line', ax));
      list.appendChild(line);
    }
    wrap.appendChild(list);
  }

  const row = el('div', 'modal-btns');
  const ok = el('button', 'btn btn-primary', '收下');
  ok.type = 'button';
  ok.addEventListener('click', () => {
    initAudio();
    sfx.coin();
    closeModal();
  });
  row.appendChild(ok);
  wrap.appendChild(row);

  openModal('离线收益', wrap);
}

// ============================================================
// audio.js — 像素挂机地牢 · 纯 WebAudio 合成的 8-bit 复古音效
// 零外部文件:全部由 OscillatorNode(square/triangle)+ GainNode 包络
// + 少量白噪声(AudioBufferSourceNode)实时合成。
//
// 用法:
//   import { initAudio, setMuted, isMuted, sfx } from './audio.js';
//
//   // 在首次用户手势(点击/按键)回调里调用一次(之后重复调用无副作用):
//   initAudio();
//
//   // 之后任意时机、任意频率触发,重复触发会叠加互不干扰:
//   sfx.hit(); sfx.coin(); sfx.levelup();
//
// 行为约定:
//   - AudioContext 惰性创建;未 initAudio() 前,所有 sfx 调用静默跳过
//   - setMuted(true) 后同样静默跳过,且已在播放的声音立即压到 0
//   - 主音量总线固定 0.12(下限),压低合成器峰值,避免刺耳
//   - 每个音效时长 0.08–0.4 秒
//   - 每次触发都新建节点,无复用状态 → 音效可任意叠加
//   - 音频内部异常被吞掉,绝不打断游戏逻辑
// ============================================================

const MASTER_VOLUME = 0.12; // 主音量总线:0.12 下限,避免 8-bit 方波直连刺耳

let ctx = null;         // AudioContext,惰性创建(见 initAudio)
let master = null;      // 主音量 GainNode,所有音效汇入后再进 destination
let noiseBuffer = null; // 共享白噪声池(惰性生成;每次触发仍是新建 BufferSource)
let muted = false;

// ---------- 初始化 / 静音 ----------

// 在首次用户手势时调用:创建 AudioContext(若未创建)并恢复播放状态。
// 幂等:重复调用只做 resume,不重建节点。环境不支持时静默失败。
export function initAudio() {
  if (typeof window === 'undefined') return; // 非浏览器环境,静默跳过
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_VOLUME;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
      master = null;
      return;
    }
  }
  if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
    const p = ctx.resume();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
}

export function setMuted(m) {
  muted = !!m;
  if (ctx && master) {
    // 已在播放的声音立即淡到 0 / 恢复;后续 sfx 由 guard 直接跳过
    master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.01);
  }
}

export function isMuted() {
  return muted;
}

// ---------- 合成基元 ----------

// 白噪声池:生成一次,之后每次触发新建 BufferSource 引用它
function getNoiseBuffer() {
  if (!noiseBuffer) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.5)); // 0.5s 覆盖最长突发
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return noiseBuffer;
}

// 单音符:osc(square/triangle)+ GainNode 指数包络。
// from→to 传 null 则保持频率;hold>0 时峰值保持后快速释放(号角感)。
function beep(type, from, to, t0, dur, vol, hold = 0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to && to !== from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  }
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  if (hold > 0) {
    gain.gain.setValueAtTime(vol, t0 + Math.min(hold, dur * 0.8));
  }
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// 白噪声突发:经 BiquadFilter 染色;f1 非空时滤波频率扫频。
// 随机起点 + loop,保证多次叠加时听感不机械重复。
function noise(t0, dur, vol, filterType, f0, f1 = null) {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(f0, t0);
  if (f1) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t0, Math.random() * 0.3);
  src.stop(t0 + dur + 0.03);
}

// ---------- 十个音效(内部实现,时长均在 0.08–0.4s) ----------

// 普通命中:短噪声 + 低频敲击(~0.10s)
function hit(t) {
  noise(t, 0.08, 0.35, 'lowpass', 900, 300);
  beep('triangle', 160, 70, t, 0.10, 0.5);
}

// 暴击:更高音调 + 金属感(基音上扫 + 2.75x 非谐泛音 + 高频噪声火花)(~0.14s)
function crit(t) {
  beep('square', 650, 1400, t, 0.14, 0.28);
  beep('square', 1790, 3300, t, 0.12, 0.16);
  noise(t, 0.10, 0.25, 'highpass', 3200);
}

// 击杀:下行滑音(~0.28s)
function kill(t) {
  beep('square', 420, 55, t, 0.28, 0.32);
  noise(t, 0.10, 0.15, 'lowpass', 600, 150);
}

// 金币:双音叮,B5 → E6(~0.17s)
function coin(t) {
  beep('square', 987.77, null, t, 0.07, 0.35);
  beep('square', 1318.51, null, t + 0.07, 0.10, 0.35);
}

// 掉落:宝物闪光琶音 E6-G6-B6-E7 + 高频微光(~0.27s)
function drop(t) {
  const notes = [1318.51, 1567.98, 1975.53, 2637.02];
  notes.forEach((f, i) => beep('triangle', f, null, t + i * 0.06, 0.09, 0.25));
  noise(t, 0.12, 0.10, 'highpass', 6000);
}

// 升级:上行琶音 C5-E5-G5-C6,4 音(~0.37s)
function levelup(t) {
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((f, i) => beep('square', f, null, t + i * 0.09, 0.10, 0.28));
}

// Boss 登场:低音号角两声(方波 + 低八度三角波衬底,峰值保持)(~0.34s)
function boss(t) {
  for (let i = 0; i < 2; i++) {
    const t0 = t + i * 0.18;
    beep('square', 110, 98, t0, 0.16, 0.30, 0.10);
    beep('triangle', 55, 49, t0, 0.16, 0.30, 0.10);
  }
}

// 复活/重生:柔和上行 A3→D4→G4 三角波(~0.30s)
function respawn(t) {
  const notes = [220.00, 293.66, 392.00];
  notes.forEach((f, i) => beep('triangle', f, null, t + i * 0.09, 0.12, 0.22));
}

// UI 点击:短促呔哒(~0.08s)
function click(t) {
  beep('square', 1200, 900, t, 0.08, 0.18);
}

// 失败:下行小二度 A4 → G#4(第二音再微降弯音,增强泄气感)(~0.32s)
function fail(t) {
  beep('square', 440.00, null, t, 0.14, 0.25);
  beep('square', 415.30, 392.00, t + 0.16, 0.16, 0.25);
}

// ---------- 导出的 sfx 对象 ----------

// 统一守卫:未初始化 / 静音 → 静默跳过;异常不外抛,不影响游戏逻辑。
// 每次调用都执行内部实现 → 每次新建节点,可叠加。
function guard(fn) {
  return () => {
    if (!ctx || muted) return;
    try {
      fn(ctx.currentTime);
    } catch (e) {
      /* 音频失败静默:不阻塞游戏逻辑 */
    }
  };
}

export const sfx = {
  hit: guard(hit),
  crit: guard(crit),
  kill: guard(kill),
  coin: guard(coin),
  drop: guard(drop),
  levelup: guard(levelup),
  boss: guard(boss),
  respawn: guard(respawn),
  click: guard(click),
  fail: guard(fail),
};

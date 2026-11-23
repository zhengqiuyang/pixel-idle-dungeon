// ============================================================================
// 《余烬深渊》· js/assets.js —— 32-bit 像素图片资源加载与受击闪白绘制辅助
//
// 职责：异步预加载 assets/bg/dungeon_base.png 与 assets/sprites/<id>.png。
// 资源未就绪或不存在时 getSprite/getBg 返回 null，渲染层平滑回退 sprites.js。
// ============================================================================

// 全量 16 个高清 PNG 精灵清单（4 主角 + 8 小怪 + 4 Boss）
const SPRITE_IDS = [
  "hero", "vera", "irene", "kai",
  "slime", "bat", "goblin", "skeleton", "mushroom", "gargoyle", "imp", "ghost",
  "goblinKing", "boneLord", "golem", "dragon",
];

let bgAsset = null;
const spriteCache = new Map();

// 复用离屏画布用于白色受击剪影闪烁（globalCompositeOperation = "source-atop"）
const flashCanvas = document.createElement("canvas");
const flashCtx = flashCanvas.getContext("2d");

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function initAssets() {
  loadImage("assets/bg/dungeon_base.png").then((img) => {
    if (img && img.naturalWidth > 0) {
      bgAsset = { img, w: img.naturalWidth, h: img.naturalHeight };
    }
  });
  for (const id of SPRITE_IDS) {
    loadImage(`assets/sprites/${id}.png`).then((img) => {
      if (img && img.naturalWidth > 0) {
        spriteCache.set(id, { img, w: img.naturalWidth, h: img.naturalHeight });
      }
    });
  }
}

export function getBg() {
  return bgAsset;
}

export function getSprite(id) {
  if (!id) return null;
  const key = String(id).split("_")[0].replace(/\d+$/, "");
  return spriteCache.get(key) || null;
}

/**
 * 在 2D Canvas 上以「脚底中心 (x, y)」为锚点绘制角色图片，支持呼吸缩放、倾斜、透明度与受击纯白闪白。
 */
export function drawAssetSprite(ctx, asset, x, y, opts = {}) {
  if (!asset || !asset.img) return false;
  const { img, w, h } = asset;
  const scaleX = opts.scaleX ?? 1;
  const scaleY = opts.scaleY ?? 1;
  const tilt = opts.tilt ?? 0;
  const alpha = opts.alpha ?? 1;
  const flash = opts.flash ?? 0;

  ctx.save();
  ctx.translate(x, y);
  if (tilt) ctx.rotate(tilt);
  ctx.scale(scaleX, scaleY);
  if (alpha < 1) ctx.globalAlpha = Math.max(0, alpha);

  if (flash > 0 && flashCtx) {
    if (flashCanvas.width !== w || flashCanvas.height !== h) {
      flashCanvas.width = w;
      flashCanvas.height = h;
    }
    flashCtx.globalCompositeOperation = "source-over";
    flashCtx.clearRect(0, 0, w, h);
    flashCtx.drawImage(img, 0, 0, w, h);
    flashCtx.globalCompositeOperation = "source-atop";
    flashCtx.fillStyle = "rgba(255, 255, 255, 0.85)";
    flashCtx.fillRect(0, 0, w, h);
    ctx.drawImage(flashCanvas, -w / 2, -h, w, h);
  } else {
    ctx.drawImage(img, -w / 2, -h, w, h);
  }
  ctx.restore();
  return true;
}

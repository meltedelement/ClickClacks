// Text that is drawn every frame (HP numbers, name labels, floating damage
// numbers), rendered once into a small canvas and then blitted. fillText, and
// strokeText even more (it strokes the outline of every glyph as a path), are
// among the slowest Canvas 2D calls, and every `font` assignment parses a CSS
// font string. HP only changes on a hit and labels never change, so nearly
// every draw is a cache hit: one drawImage.
//
// Sprites are rendered at the arena's current pixel scale (device pixels per
// arena unit, Renderer.scale) so they stay as sharp as the text they replace.
// The cache is page-wide, since display screens mostly share one size, and
// bounded because damage numbers vary.
const MAX_SPRITES = 256; // up to ~100 KB each at display-page sizes
const PAD = 2; // arena units around the text, so antialiasing isn't clipped
const LINE_HEIGHT = 1.3; // sprite height per font size

const sprites = new Map();

// Draws `text` at (x, y) in arena units, like fillText with textAlign 'center'
// and the style's textBaseline ('middle', 'top' or 'bottom'). The style:
//   { weight, size, family, fill, stroke?, strokeWidth?, baseline }
// The outline is stroked under the fill, as the old strokeText/fillText pairs did.
export function drawText(ctx, text, x, y, style, pixelScale) {
  const sprite = spriteFor(text, style, pixelScale);
  if (sprite) {
    ctx.drawImage(sprite.canvas, x - sprite.anchorX, y - sprite.anchorY, sprite.width, sprite.height);
    return;
  }
  // No offscreen canvas (Node without a DOM): draw it directly.
  ctx.font = fontString(style, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = style.baseline;
  if (style.stroke) {
    ctx.lineWidth = style.strokeWidth;
    ctx.strokeStyle = style.stroke;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = style.fill;
  ctx.fillText(text, x, y);
}

function fontString({ weight = '', size, family }, scale) {
  return `${weight} ${size * scale}px ${family}`.trim();
}

function spriteFor(text, style, pixelScale) {
  // Resolution changes in small steps (Quality); round so near-equal scales share sprites.
  const scale = Math.round(pixelScale * 100) / 100;
  const key = `${scale}|${style.weight}|${style.size}|${style.family}|${style.fill}|${style.stroke}|${style.strokeWidth}|${style.baseline}|${text}`;
  let sprite = sprites.get(key);
  if (sprite !== undefined) {
    // Refresh its place, so the eviction below drops the least recently used.
    sprites.delete(key);
    sprites.set(key, sprite);
    return sprite;
  }
  if (sprites.size >= MAX_SPRITES) sprites.delete(sprites.keys().next().value);
  sprite = renderSprite(text, style, scale);
  sprites.set(key, sprite); // null = no 2D canvas here, draw text directly
  return sprite;
}

function renderSprite(text, style, scale) {
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return null;

  const outline = style.stroke ? style.strokeWidth : 0;
  ctx.font = fontString(style, scale);
  const textWidth = ctx.measureText(text).width / scale;
  const width = textWidth + outline + PAD * 2;
  const height = style.size * LINE_HEIGHT + outline + PAD * 2;
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));

  // Where the text's anchor point sits in the sprite, in arena units.
  const anchorX = width / 2;
  const anchorY = style.baseline === 'top' ? PAD + outline / 2 : style.baseline === 'bottom' ? height - PAD - outline / 2 : height / 2;

  // Resizing the canvas reset the context, so set everything now.
  ctx.scale(scale, scale);
  ctx.font = fontString(style, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = style.baseline;
  if (style.stroke) {
    ctx.lineWidth = style.strokeWidth;
    ctx.strokeStyle = style.stroke;
    ctx.strokeText(text, anchorX, anchorY);
  }
  ctx.fillStyle = style.fill;
  ctx.fillText(text, anchorX, anchorY);

  return { canvas, width: canvas.width / scale, height: canvas.height / scale, anchorX, anchorY };
}

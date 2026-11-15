// Ritar ett rum: bakgrundsfärg, bakgrunder, tiles, instanser (efter djup), förgrunder.
import { gmColor } from './loader.js';

function drawBackgroundLayer(ctx, project, def, roomW, roomH) {
  const bg = project.backgrounds[def.bg];
  if (!bg || !bg.img) return;
  const img = bg.img;
  if (def.stretch) {
    ctx.drawImage(img, def.x, def.y, roomW, roomH);
    return;
  }
  const w = img.width, h = img.height;
  let x0 = def.x, y0 = def.y;
  if (def.tile_h) x0 = ((x0 % w) + w) % w - w;
  if (def.tile_v) y0 = ((y0 % h) + h) % h - h;
  const x1 = def.tile_h ? roomW : x0 + 1;
  const y1 = def.tile_v ? roomH : y0 + 1;
  for (let y = y0; y < y1; y += h) {
    for (let x = x0; x < x1; x += w) ctx.drawImage(img, x, y);
  }
}

export function drawSprite(ctx, project, spriteId, frame, x, y, alpha = 1, scale = 1) {
  const spr = project.sprites[spriteId];
  if (!spr || !spr.images.length) return;
  const n = spr.images.length;
  const img = spr.images[((Math.floor(frame) % n) + n) % n];
  if (!img) return;
  if (alpha !== 1) ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (scale === 1) ctx.drawImage(img, Math.round(x - spr.xorigin), Math.round(y - spr.yorigin));
  else ctx.drawImage(img, Math.round(x - spr.xorigin * scale), Math.round(y - spr.yorigin * scale), img.width * scale, img.height * scale);
  if (alpha !== 1) ctx.globalAlpha = 1;
}

// view = {x, y, w, h}: den del av rummet som visas. Canvas har view-storlek.
export function drawRoom(ctx, project, room, instances, view) {
  ctx.save();
  ctx.translate(-view.x, -view.y);
  if (room.draw_color) {
    ctx.fillStyle = gmColor(room.color);
    ctx.fillRect(view.x, view.y, view.w, view.h);
  }
  for (const def of room.backgrounds) {
    if (def.visible && !def.foreground) drawBackgroundLayer(ctx, project, def, room.width, room.height);
  }
  // Tiles och instanser: högre djup ritas först. Lika djup: skapandeordning.
  const items = [];
  for (const t of room.tiles) items.push({ depth: t.depth, order: -1, tile: t });
  instances.forEach((inst, i) => {
    if (inst.visible) items.push({ depth: inst.depth, order: i, inst });
  });
  items.sort((a, b) => (b.depth - a.depth) || (a.order - b.order));
  for (const it of items) {
    if (it.tile) {
      const bg = project.backgrounds[it.tile.bg];
      if (bg && bg.img) {
        const t = it.tile;
        ctx.drawImage(bg.img, t.bg_x, t.bg_y, t.w, t.h, t.x, t.y, t.w, t.h);
      }
    } else {
      const i = it.inst;
      drawSprite(ctx, project, i.sprite_index, i.image_index, i.x, i.y, i.image_alpha ?? 1, i.image_scale ?? 1);
    }
  }
  for (const def of room.backgrounds) {
    if (def.visible && def.foreground) drawBackgroundLayer(ctx, project, def, room.width, room.height);
  }
  ctx.restore();
}

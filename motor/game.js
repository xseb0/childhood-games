// Game Maker 5-motor: rum, instanser, stegloop, kollisioner, händelser och handlingar.
// Ordning och regler följer OpenGMK (trogen GM8-omskrivning), som ligger närmast GM5:
//   https://github.com/OpenGMK/OpenGMK (game.rs frame(), events.rs, movement.rs, kernel.rs)
// Se ../PLAN.md för beslut och avvikelser.
import { parse, parseExpr, compile, run, truthy, GmlError } from './gml.js';
import { FUNCS } from './funcs.js';
import { ACTIONS } from './actions.js';

const EV = { create: 0, destroy: 1, alarm: 2, step: 3, collision: 4, keyboard: 5, mouse: 6,
  other: 7, draw: 8, keypress: 9, keyrelease: 10 };
const EV_NAMES = Object.keys(EV);

export const CONSTANTS = {
  true: 1, false: 0, pi: Math.PI, self: -1, other: -2, all: -3, noone: -4, global: -5,
  mb_any: -1, mb_none: 0, mb_left: 1, mb_right: 2, mb_middle: 3,
  vk_nokey: 0, vk_anykey: 1, vk_left: 37, vk_right: 39, vk_up: 38, vk_down: 40, vk_enter: 13,
  vk_escape: 27, vk_space: 32, vk_shift: 16, vk_control: 17, vk_alt: 18, vk_backspace: 8,
  vk_tab: 9, vk_home: 36, vk_end: 35, vk_delete: 46, vk_insert: 45, vk_pageup: 33,
  vk_pagedown: 34, vk_pause: 19, vk_printscreen: 44, vk_f1: 112, vk_f2: 113, vk_f3: 114,
  vk_f4: 115, vk_f5: 116, vk_f6: 117, vk_f7: 118, vk_f8: 119, vk_f9: 120, vk_f10: 121,
  vk_f11: 122, vk_f12: 123, vk_numpad0: 96,
  c_black: 0, c_white: 0xffffff, c_red: 0x0000ff, c_green: 0x008000, c_blue: 0xff0000,
  c_yellow: 0x00ffff, c_gray: 0x808080, c_aqua: 0xffff00, c_lime: 0x00ff00,
};

const INSTANCE_BUILTINS = new Set(['x', 'y', 'xprevious', 'yprevious', 'xstart', 'ystart',
  'hspeed', 'vspeed', 'speed', 'direction', 'gravity', 'gravity_direction', 'friction',
  'sprite_index', 'image_index', 'image_speed', 'image_alpha', 'image_scale', 'image_xscale',
  'image_yscale', 'image_single', 'image_number', 'mask_index', 'solid', 'visible', 'depth',
  'persistent', 'object_index', 'id', 'alarm', 'sprite_width', 'sprite_height',
  'sprite_xoffset', 'sprite_yoffset', 'bbox_left', 'bbox_right', 'bbox_top', 'bbox_bottom']);
const GLOBAL_BUILTINS = new Set(['score', 'lives', 'health', 'room', 'room_width', 'room_height',
  'room_speed', 'room_caption', 'room_first', 'room_last', 'mouse_x', 'mouse_y', 'fps',
  'current_time', 'instance_count', 'keyboard_key', 'keyboard_lastkey', 'show_score',
  'show_lives', 'show_health', 'caption_score', 'caption_lives', 'caption_health', 'view_xview',
  'view_yview', 'view_wview', 'view_hview', 'view_enabled', 'background_color']);

let nextInstanceId = 1000000;

export class Instance {
  constructor(game, objId, x, y, id) {
    const obj = game.project.objects[objId];
    this.game = game;
    this.id = id ?? ++nextInstanceId;
    this.object_index = objId;
    this.x = x; this.y = y;
    this.xstart = x; this.ystart = y;
    this.xprevious = x; this.yprevious = y;
    this._h = 0; this._v = 0; this._speed = 0; this._dir = 0;
    this.gravity = 0; this.gravity_direction = 270; this.friction = 0;
    this.sprite_index = obj.sprite;
    this.mask_index = obj.mask;
    this.image_index = 0; this.image_speed = 1; this.image_alpha = 1; this.image_scale = 1;
    this.image_single = -1;
    this.solid = obj.solid; this.visible = obj.visible; this.depth = obj.depth;
    this.persistent = obj.persistent;
    this.alarm = new Array(12).fill(-1);
    this.vars = Object.create(null);
    this.deleted = false;
  }
  get hspeed() { return this._h; }
  set hspeed(v) { this.setHV(v, this._v); }
  get vspeed() { return this._v; }
  set vspeed(v) { this.setHV(this._h, v); }
  setHV(h, v) {
    this._h = h; this._v = v;
    this._speed = Math.hypot(h, v);
    if (h !== 0 || v !== 0) {
      let d = Math.atan2(-v, h) * 180 / Math.PI;
      if (d < 0) d += 360;
      this._dir = d;
    }
  }
  get speed() { return this._speed; }
  set speed(s) { this.setSpeedDir(s, this._dir); }
  get direction() { return this._dir; }
  set direction(d) { this.setSpeedDir(this._speed, d); }
  setSpeedDir(s, d) {
    d = ((d % 360) + 360) % 360;
    this._speed = s; this._dir = d;
    const r = d * Math.PI / 180;
    this._h = Math.cos(r) * s; this._v = -Math.sin(r) * s;
    if (Math.abs(this._h) < 1e-10) this._h = 0;
    if (Math.abs(this._v) < 1e-10) this._v = 0;
  }
  get sprite() { return this.game.project.sprites[this.sprite_index] || null; }
}

export class Game {
  constructor(project, canvas, ui) {
    this.project = project;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ui = ui;  // { setCaption(text), showMessage(text) -> Promise, audio }
    this.audio = ui.audio;
    this.warned = new Set();
    this.names = this.buildNames();
    this.prepareSprites();
    this.compileAll();
    this.keys = new Set(); this.pressed = new Set(); this.released = new Set();
    this.mouse = { x: 0, y: 0, buttons: new Set(), pressed: new Set() };
    this.score = 0; this.lives = -1; this.health = 100;
    this.scoreCap = 'Score: '; this.livesCap = 'Lives: '; this.healthCap = 'Health: ';
    this.showScore = true; this.showLives = false; this.showHealth = false; this.hasSetShowScore = false;
    this.globals = Object.create(null);
    this.instances = [];
    this.sceneChange = null;
    this.frozenUntil = 0;  // action_sleep: ingen logik och ingen ny bild före denna tid
    this.modal = false;    // meddelanderuta öppen
    this.stepCount = 0;
  }

  warnOnce(msg) {
    if (this.warned.has(msg)) return;
    this.warned.add(msg);
    console.warn('[motor]', msg);
  }

  // ---------- resurser ----------
  buildNames() {
    const map = Object.create(null);
    const add = (list) => list.forEach((r) => { if (r && /^[A-Za-z_][A-Za-z0-9_]*$/.test(r.name)) map[r.name] = r.id; });
    const p = this.project;
    for (const k of ['sprites', 'sounds', 'backgrounds', 'paths', 'scripts', 'objects', 'rooms']) add(p[k]);
    return map;
  }

  prepareSprites() {
    for (const spr of this.project.sprites) {
      if (!spr) continue;
      spr.number = spr.frames.length;
      if (!spr.precise || !spr.images.length) { spr.mask = null; continue; }
      const w = spr.width, h = spr.height;
      const mask = new Uint8Array(w * h);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      for (const img of spr.images) {
        if (!img) continue;
        g.clearRect(0, 0, w, h);
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, w, h).data;
        for (let k = 0; k < w * h; k++) if (d[k * 4 + 3] > 0) mask[k] = 1;
      }
      spr.mask = mask;  // GM5: en mask för alla bildrutor (union)
    }
  }

  // ---------- kompilering ----------
  compileCode(src, where) {
    try { return compile(parse(src), this.rt); } catch (e) {
      throw new GmlError(`${where}: ${e.message}`);
    }
  }
  compileExpr(src, where) {
    try { return compile(parseExpr(src), this.rt); } catch (e) {
      throw new GmlError(`${where}: ${e.message}\n  uttryck: ${src}`);
    }
  }

  compileAll() {
    this.rt = makeRuntime(this);
    const p = this.project;
    this.scripts = [];
    p.scripts.forEach((s) => { if (s) this.scripts[s.id] = this.compileCode(s.code, `script ${s.name}`); });
    // events[obj][type][sub] = körbar funktion
    this.events = [];
    this.collisionTargets = [];
    for (const o of p.objects) {
      if (!o) continue;
      const ev = (this.events[o.id] = {});
      for (const [type, list] of Object.entries(o.events)) {
        const t = EV[type];
        ev[t] = {};
        for (const e of list) {
          ev[t][e.sub] = this.compileActions(e.actions, `${o.name} ${type} ${e.sub}`);
          // Uppackaren lägger händelserna i editorns ordning (som LateralGM, insert(0)).
          // Runnern går i filens ordning, alltså omvänt. Det avgör vilken krock som körs först
          // när två sker i samma steg, t.ex. Rör_up/Next_room_up i Goombas underjord.
          if (t === EV.collision) (this.collisionTargets[o.id] ||= []).unshift(e.sub);
        }
      }
    }
    for (const r of p.rooms) {
      if (!r) continue;
      r._code = r.creation_code.trim() ? this.compileCode(r.creation_code, `rum ${r.name}`) : null;
      for (const i of r.instances) {
        i._code = i.creation_code.trim() ? this.compileCode(i.creation_code, `instans ${i.id}`) : null;
      }
    }
  }

  // Bygger ett träd av handlingslistan: frågor, block, else och repeat.
  compileActions(acts, where) {
    let i = 0;
    const one = () => {
      const a = acts[i++];
      if (!a) return () => {};
      if (a.id === 422 && a.kind === 1) {  // början på block
        const body = [];
        while (i < acts.length && !(acts[i].id === 424 && acts[i].kind === 2)) body.push(one());
        i++;
        return (ctx) => { for (const f of body) f(ctx); };
      }
      if (a.id === 424 || a.id === 421) return () => {};
      if (a.kind === 5) {  // repeat
        const count = this.argEval(a, 0, where);
        const body = one();
        return (ctx) => { const n = Math.round(count(ctx)); for (let k = 0; k < n; k++) body(ctx); };
      }
      const exec = this.compileAction(a, where);
      if (a.question) {
        const then = one();
        let els = null;
        if (i < acts.length && acts[i].kind === 3) { i++; els = one(); }
        return (ctx) => { if (exec(ctx)) then(ctx); else if (els) els(ctx); };
      }
      return exec;
    };
    const list = [];
    while (i < acts.length) list.push(one());
    return (ctx) => { for (const f of list) f(ctx); };
  }

  argEval(a, k, where) {
    const kind = a.arg_kinds[k];
    const raw = a.args[k] ?? '';
    if (kind === 0) return this.compileExpr(raw, `${where} (${a.function || a.id}, arg ${k})`);
    if (kind === 1) return () => raw;
    if (kind === 2) {
      if (/^["']/.test(raw)) return this.compileExpr(raw, where);
      return () => raw;
    }
    const v = Number(raw);
    return () => v;
  }

  compileAction(a, where) {
    if (a.id === 605) return () => 0;  // kommentar
    let body;
    if (a.kind === 7) {  // kod
      const code = this.compileCode(a.args[0], `${where} (kod)`);
      body = (ctx) => { run(code, ctx); return 1; };
    } else {
      const fn = ACTIONS[a.function];
      if (!fn) {
        this.warnOnce(`Handling saknas: ${a.function || a.id} (${where})`);
        return () => 0;
      }
      const args = a.arg_kinds.map((_, k) => this.argEval(a, k, where));
      const rel = a.relative;
      body = (ctx) => fn(this, ctx, args.map((f) => f(ctx)), rel);
    }
    const not = a.not;
    const target = a.applies_to;
    return (ctx) => {
      let list;
      if (target === -1) list = [ctx.self];
      else if (target === -2) list = ctx.other ? [ctx.other] : [];
      else list = this.instancesOf(target);
      let result = list.length > 0;
      for (const inst of list) {
        if (inst.deleted) continue;
        const sub = target === -1 ? ctx : { ...ctx, self: inst, other: ctx.self, locals: {} };
        const r = truthy(body(sub) ?? 0);
        if (!r) result = false;
      }
      return not ? !result : result;
    };
  }

  // ---------- instanser ----------
  instancesOf(obj) {
    if (obj === -3) return this.instances.filter((i) => !i.deleted);
    return this.instances.filter((i) => !i.deleted && i.object_index === obj);
  }
  findInstance(id) { return this.instances.find((i) => i.id === id && !i.deleted) || null; }

  createInstance(objId, x, y, runCreate = true) {
    if (!this.project.objects[objId]) throw new GmlError(`Objekt ${objId} finns inte`);
    const inst = new Instance(this, objId, x, y);
    this.instances.push(inst);
    if (runCreate) this.event(inst, EV.create, 0, inst);
    return inst;
  }

  destroyInstance(inst) {
    if (inst.deleted) return;
    this.event(inst, EV.destroy, 0, inst);
    inst.deleted = true;
  }

  changeInstance(inst, objId, perform) {
    if (perform) this.event(inst, EV.destroy, 0, inst);
    const obj = this.project.objects[objId];
    inst.object_index = objId;
    inst.sprite_index = obj.sprite; inst.mask_index = obj.mask;
    inst.solid = obj.solid; inst.visible = obj.visible; inst.depth = obj.depth;
    inst.persistent = obj.persistent;
    if (perform) this.event(inst, EV.create, 0, inst);
  }

  // ---------- händelser ----------
  hasEvent(objId, type, sub) {
    const e = this.events[objId];
    return !!(e && e[type] && e[type][sub]);
  }
  event(inst, type, sub, other) {
    if (inst.deleted) return;
    const e = this.events[inst.object_index];
    const fn = e && e[type] && e[type][sub];
    if (!fn) return;
    const ctx = { self: inst, other: other || inst, game: this, locals: Object.create(null), args: [] };
    try { fn(ctx); } catch (err) { this.reportError(err, `${this.project.objects[inst.object_index].name} ${EV_NAMES[type]} ${sub}`); }
  }
  eventAll(type, sub) {
    for (const inst of this.instances.slice()) {
      if (this.sceneChange) return;
      if (!inst.deleted && this.hasEvent(inst.object_index, type, sub)) this.event(inst, type, sub, inst);
    }
  }
  reportError(err, where) {
    console.error(`[motor] fel i ${where}:`, err);
    this.warnOnce(`Fel i ${where}: ${err.message}`);
  }

  setLives(v) {
    const old = this.lives;
    this.lives = v;
    if (old > 0 && v <= 0) this.eventAll(EV.other, 6);  // inga liv kvar
  }
  setHealth(v) {
    const old = this.health;
    this.health = v;
    if (old > 0 && v <= 0) this.eventAll(EV.other, 9);
  }

  // ---------- rum ----------
  get room() { return this.roomData; }

  restart() {
    for (const inst of this.instances) if (!inst.deleted) this.event(inst, EV.other, 5, inst);
    for (const inst of this.instances) if (!inst.deleted) this.event(inst, EV.other, 3, inst);
    this.instances = [];
    this.globals = Object.create(null);
    this.gameStart = true;
    this.loadRoom(this.project.room_order[0]);
  }

  loadRoom(id) {
    const room = this.project.rooms[id];
    if (!room) throw new Error('Rum saknas: ' + id);
    // rumsslut för alla
    if (this.roomData) {
      for (const inst of this.instances.slice()) if (!inst.deleted) this.event(inst, EV.other, 5, inst);
    }
    this.sceneChange = null;
    const keep = this.instances.filter((i) => !i.deleted && i.persistent);
    this.instances = keep;
    this.roomData = room;
    this.roomId = id;
    this.view = null;
    if (room.views_enabled) {
      const v = room.views.find((v) => v.visible);
      if (v) this.view = { ...v };
    }
    this.backgrounds = room.backgrounds.map((b) => ({ ...b }));
    this.ui.resize(this.view ? this.view.w : room.width, this.view ? this.view.h : room.height);
    const fresh = [];
    for (const ri of room.instances) {
      if (this.instances.some((i) => i.id === ri.id)) continue;
      if (!this.project.objects[ri.object]) continue;
      const inst = new Instance(this, ri.object, ri.x, ri.y, ri.id);
      this.instances.push(inst);
      fresh.push([inst, ri]);
    }
    for (const [inst, ri] of fresh) {
      if (inst.deleted) continue;
      if (ri._code) this.runCode(ri._code, inst);
      this.event(inst, EV.create, 0, inst);
    }
    if (this.gameStart) { this.gameStart = false; this.eventAll(EV.other, 2); }
    if (room._code) this.runCode(room._code, this.instances[0] || null);
    this.eventAll(EV.other, 4);
    this.keys.clear(); this.pressed.clear(); this.released.clear();
    this.updateCaption();
  }

  runCode(fn, inst) {
    try { run(fn, { self: inst, other: inst, game: this, locals: Object.create(null), args: [] }); } catch (e) { this.reportError(e, 'skapandekod'); }
  }

  applySceneChange() {
    const sc = this.sceneChange;
    this.sceneChange = null;
    if (!sc) return;
    if (sc.restart) this.restart();
    else this.loadRoom(sc.room);
  }

  // Omstart vinner över rumsbyte: i spelen kommer "GAME OVER + omstart" före "starta om rummet"
  // i samma händelse (se PLAN.md, logg).
  requestRoom(id) {
    if (this.sceneChange && this.sceneChange.restart) return;
    if (!this.project.rooms[id]) { this.warnOnce('room_goto till okänt rum ' + id); return; }
    this.sceneChange = { room: id };
  }
  requestRestart() { this.sceneChange = { restart: true }; }

  nextRoomId(delta) {
    const order = this.project.room_order;
    const i = order.indexOf(this.roomId);
    return order[i + delta];
  }

  // ---------- kollision ----------
  maskOf(inst) {
    const id = inst.mask_index >= 0 ? inst.mask_index : inst.sprite_index;
    return this.project.sprites[id] || null;
  }

  bbox(inst) {
    const spr = this.maskOf(inst);
    if (!spr) return null;
    const s = inst.image_scale;
    const x = Math.round(inst.x), y = Math.round(inst.y);
    if (s === 1) {
      return { l: x - spr.xorigin + spr.bbox_left, r: x - spr.xorigin + spr.bbox_right,
        t: y - spr.yorigin + spr.bbox_top, b: y - spr.yorigin + spr.bbox_bottom, spr, x, y, s };
    }
    return { l: Math.floor(x + (spr.bbox_left - spr.xorigin) * s), r: Math.floor(x + (spr.bbox_right + 1 - spr.xorigin) * s) - 1,
      t: Math.floor(y + (spr.bbox_top - spr.yorigin) * s), b: Math.floor(y + (spr.bbox_bottom + 1 - spr.yorigin) * s) - 1, spr, x, y, s };
  }

  pointIn(bb, px, py) {
    const spr = bb.spr;
    if (!spr.mask) return true;  // inte precis: hela bbox
    const lx = Math.floor((px - bb.x) / bb.s + spr.xorigin);
    const ly = Math.floor((py - bb.y) / bb.s + spr.yorigin);
    if (lx < 0 || ly < 0 || lx >= spr.width || ly >= spr.height) return false;
    return spr.mask[ly * spr.width + lx] === 1;
  }

  // allowDeleted: en förstörd instans ligger kvar tills steget är slut och räknas fortfarande
  // i kollisionstester (bounce, place_free, move_contact). Utan det studsar spelaren inte efter
  // att ha trampat på ett monster ("kill other" kommer före "bounce" i spelen). Händelser körs
  // däremot aldrig för förstörda instanser.
  collide(a, b, allowDeleted = false) {
    if (a === b || a.deleted || (b.deleted && !allowDeleted)) return false;
    const A = this.bbox(a), B = this.bbox(b);
    if (!A || !B) return false;
    if (A.r < B.l || B.r < A.l || A.b < B.t || B.b < A.t) return false;
    if (!A.spr.mask && !B.spr.mask) return true;
    const t = Math.max(A.t, B.t), bo = Math.min(A.b, B.b), l = Math.max(A.l, B.l), r = Math.min(A.r, B.r);
    for (let y = t; y <= bo; y++) {
      for (let x = l; x <= r; x++) {
        if (this.pointIn(A, x, y) && this.pointIn(B, x, y)) return true;
      }
    }
    return false;
  }

  collidesWith(inst, pred) {
    for (const o of this.instances) {
      if (o === inst || !pred(o)) continue;
      if (this.collide(inst, o, true)) return o;
    }
    return null;
  }

  placeAt(inst, x, y, test) {
    const ox = inst.x, oy = inst.y;
    inst.x = x; inst.y = y;
    const r = test();
    inst.x = ox; inst.y = oy;
    return r;
  }

  placeFree(inst, x, y) { return this.placeAt(inst, x, y, () => !this.collidesWith(inst, (o) => o.solid)); }
  placeEmpty(inst, x, y) { return this.placeAt(inst, x, y, () => !this.collidesWith(inst, () => true)); }
  placeMeeting(inst, x, y, obj) {
    return this.placeAt(inst, x, y, () => !!this.collidesWith(inst, (o) => obj === -3 || o.object_index === obj || o.id === obj));
  }

  // GM5 move_contact(dir): flyttar 1 px i taget tills den rör en annan instans (vilken som helst).
  moveContact(inst, dir, max = 1000, solidsOnly = false) {
    const pred = solidsOnly ? (o) => o.solid : () => true;
    if (this.collidesWith(inst, pred)) return;
    const r = dir * Math.PI / 180;
    const sx = Math.cos(r), sy = -Math.sin(r);
    for (let k = 0; k < max; k++) {
      const ox = inst.x, oy = inst.y;
      inst.x += sx; inst.y += sy;
      if (this.collidesWith(inst, pred)) { inst.x = ox; inst.y = oy; break; }
    }
  }

  bounce(inst, solidsOnly) {
    const pred = solidsOnly ? (o) => o.solid : () => true;
    const hit = () => !!this.collidesWith(inst, pred);
    // GM8 (OpenGMK) backar till xprevious vid varje överlapp. Här backar vi bara ur solida
    // föremål: annars missar studsen monstret man trampar på när man samtidigt går i sidled
    // (Tomtenissar: håll → och landa på en nisse → ingen studs i var tredje landning).
    if (this.collidesWith(inst, (o) => o.solid)) { inst.x = inst.xprevious; inst.y = inst.yprevious; }
    const ox = inst.x, oy = inst.y;
    inst.x = ox + inst.hspeed;
    const xb = hit();
    inst.x = ox; inst.y = oy + inst.vspeed;
    const yb = hit();
    if (xb) inst.hspeed = -inst.hspeed;
    if (yb) inst.vspeed = -inst.vspeed;
    if (!xb && !yb) {
      inst.x = ox + inst.hspeed;
      if (hit()) inst.setHV(-inst.hspeed, -inst.vspeed);
    }
    inst.x = ox; inst.y = oy;
  }

  // ---------- stegloop (GM8/OpenGMK-ordning) ----------
  step() {
    this.stepCount++;
    const live = () => this.instances.filter((i) => !i.deleted);
    for (const i of this.instances) { i.xprevious = i.x; i.yprevious = i.y; }

    this.eventAll(EV.step, 1);  // begin step
    if (this.sceneChange) return this.endStep();

    for (const inst of live()) {  // alarm
      for (let n = 0; n < 12; n++) {
        if (inst.deleted) break;
        if (inst.alarm[n] > 0) {
          inst.alarm[n] -= 1;
          if (inst.alarm[n] === 0) { inst.alarm[n] = -1; this.event(inst, EV.alarm, n, inst); }
          if (this.sceneChange) return this.endStep();
        }
      }
    }

    this.keyEvents(EV.keyboard, this.keys);
    if (this.sceneChange) return this.endStep();
    this.keyEvents(EV.keypress, this.pressed);
    if (this.sceneChange) return this.endStep();
    this.keyEvents(EV.keyrelease, this.released);
    if (this.sceneChange) return this.endStep();

    this.eventAll(EV.step, 0);  // step
    if (this.sceneChange) return this.endStep();

    for (const inst of live()) {  // friktion och gravitation
      if (inst.friction !== 0) {
        const s = inst.speed;
        if (s >= 0) inst.speed = inst.friction > s ? 0 : s - inst.friction;
        else inst.speed = inst.friction > -s ? 0 : s + inst.friction;
      }
      if (inst.gravity !== 0) {
        const r = inst.gravity_direction * Math.PI / 180;
        inst.setHV(inst.hspeed + Math.cos(r) * inst.gravity, inst.vspeed - Math.sin(r) * inst.gravity);
      }
    }
    for (const inst of live()) { inst.x += inst.hspeed; inst.y += inst.vspeed; }

    this.boundEvents();
    if (this.sceneChange) return this.endStep();

    this.collisions();
    if (this.sceneChange) return this.endStep();

    this.eventAll(EV.step, 2);  // end step
    if (this.sceneChange) return this.endStep();

    this.instances = this.instances.filter((i) => !i.deleted);
    for (const inst of this.instances) {  // animation
      const spr = inst.sprite;
      const n = spr ? spr.number : 0;
      if (inst.image_single >= 0) { inst.image_index = inst.image_single; continue; }
      inst.image_index += inst.image_speed;
      if (n > 0 && inst.image_index >= n) {
        inst.image_index -= n;
        this.event(inst, EV.other, 7, inst);
      }
    }
    for (const b of this.backgrounds) { b.x += b.hspeed; b.y += b.vspeed; }
    return this.endStep();
  }

  endStep() {
    this.pressed.clear(); this.released.clear(); this.mouse.pressed.clear();
    this.instances = this.instances.filter((i) => !i.deleted);
    if (this.sceneChange) this.applySceneChange();
    this.updateCaption();
  }

  keyEvents(type, set) {
    const subs = new Set();
    for (const evs of this.events) if (evs && evs[type]) for (const k of Object.keys(evs[type])) subs.add(Number(k));
    for (const k of [...subs].sort((a, b) => a - b)) {
      let fire;
      if (k === 0) fire = set.size === 0;
      else if (k === 1) fire = set.size > 0;
      else fire = set.has(k);
      if (!fire) continue;
      for (const inst of this.instances.slice()) {
        if (inst.deleted || !this.hasEvent(inst.object_index, type, k)) continue;
        this.event(inst, type, k, inst);
        if (this.sceneChange) return;
      }
    }
  }

  boundEvents() {
    const W = this.roomData.width, H = this.roomData.height;
    for (const inst of this.instances.slice()) {
      if (inst.deleted) continue;
      const out = this.hasEvent(inst.object_index, EV.other, 0);
      const bnd = this.hasEvent(inst.object_index, EV.other, 1);
      if (!out && !bnd) continue;
      const bb = this.bbox(inst);
      if (out) {
        const o = bb ? (bb.r < 0 || bb.b < 0 || bb.l > W || bb.t > H)
          : (Math.floor(inst.x) < 0 || Math.floor(inst.y) < 0 || Math.ceil(inst.x) > W || Math.ceil(inst.y) > H);
        if (o) this.event(inst, EV.other, 0, inst);
      }
      if (bnd && !inst.deleted && bb && (bb.l < 0 || bb.t < 0 || bb.r > W || bb.b > H)) this.event(inst, EV.other, 1, inst);
      if (this.sceneChange) return;
    }
  }

  collisions() {
    for (let objId = 0; objId < this.collisionTargets.length; objId++) {
      const targets = this.collisionTargets[objId];
      if (!targets) continue;
      for (const a of this.instances.slice()) {
        if (a.deleted || a.object_index !== objId) continue;
        for (const tObj of targets) {
          if (a.deleted) break;
          for (const b of this.instances.slice()) {
            if (a.deleted) break;
            if (b.deleted || b.object_index !== tObj || b === a) continue;
            if (!this.collide(a, b)) continue;
            const solid = a.solid || b.solid;
            if (solid) { a.x = a.xprevious; a.y = a.yprevious; b.x = b.xprevious; b.y = b.yprevious; }
            this.event(a, EV.collision, tObj, b);
            if (!b.deleted) this.event(b, EV.collision, objId, a);
            if (this.sceneChange) return;
            if (solid && !a.deleted && !b.deleted) {
              a.x += a.hspeed; a.y += a.vspeed; b.x += b.hspeed; b.y += b.vspeed;
              if (this.collide(a, b)) { a.x = a.xprevious; a.y = a.yprevious; b.x = b.xprevious; b.y = b.yprevious; }
            }
          }
        }
      }
    }
  }

  // ---------- vy och bild ----------
  updateView() {
    const v = this.view;
    if (!v || v.follow < 0) return;
    // Originalet: följ vyns objekt. En variant kan lägga till fler objekt att följa.
    const follow = this.project.view_follow && this.project.view_follow.includes(v.follow) ? this.project.view_follow : [v.follow];
    const inst = this.instances.find((i) => !i.deleted && follow.includes(i.object_index));
    if (!inst) return;
    const W = this.roomData.width, H = this.roomData.height;
    let vx = v.x, vy = v.y;
    const ix = Math.round(inst.x), iy = Math.round(inst.y);
    if (ix - vx < v.hborder) vx = ix - v.hborder;
    if (vx + v.w - ix < v.hborder) vx = ix + v.hborder - v.w;
    if (iy - vy < v.vborder) vy = iy - v.vborder;
    if (vy + v.h - iy < v.vborder) vy = iy + v.vborder - v.h;
    if (v.hspeed >= 0) vx = Math.max(v.x - v.hspeed, Math.min(v.x + v.hspeed, vx));
    if (v.vspeed >= 0) vy = Math.max(v.y - v.vspeed, Math.min(v.y + v.vspeed, vy));
    v.x = Math.max(0, Math.min(W - v.w, vx));
    v.y = Math.max(0, Math.min(H - v.h, vy));
  }

  viewRect() {
    if (this.view) return { x: this.view.x, y: this.view.y, w: this.view.w, h: this.view.h };
    return { x: 0, y: 0, w: this.roomData.width, h: this.roomData.height };
  }

  caption() {
    let c = this.roomData ? this.roomData.caption : '';
    const showScore = this.showScore && (this.hasSetShowScore || this.score > 0);
    if (showScore) c += ` ${this.scoreCap}${this.score}`;
    if (this.showLives) c += ` ${this.livesCap}${this.lives}`;
    if (this.showHealth) c += ` ${this.healthCap}${Math.round(this.health)}`;
    return c;
  }
  updateCaption() { this.ui.setCaption(this.caption()); }
}

// ---------- runtime-gränssnitt för GML ----------
function makeRuntime(game) {
  const instGet = (inst, name, i) => {
    switch (name) {
      case 'alarm': return inst.alarm[i] ?? -1;
      case 'sprite_width': { const s = inst.sprite; return s ? s.width * inst.image_scale : 0; }
      case 'sprite_height': { const s = inst.sprite; return s ? s.height * inst.image_scale : 0; }
      case 'sprite_xoffset': { const s = inst.sprite; return s ? s.xorigin * inst.image_scale : 0; }
      case 'sprite_yoffset': { const s = inst.sprite; return s ? s.yorigin * inst.image_scale : 0; }
      case 'image_number': { const s = inst.sprite; return s ? s.number : 0; }
      case 'image_xscale': case 'image_yscale': return inst.image_scale;
      case 'bbox_left': { const b = game.bbox(inst); return b ? b.l : inst.x; }
      case 'bbox_right': { const b = game.bbox(inst); return b ? b.r : inst.x; }
      case 'bbox_top': { const b = game.bbox(inst); return b ? b.t : inst.y; }
      case 'bbox_bottom': { const b = game.bbox(inst); return b ? b.b : inst.y; }
      case 'solid': case 'visible': case 'persistent': return inst[name] ? 1 : 0;
      default: return inst[name];
    }
  };
  const instSet = (inst, name, v, i) => {
    switch (name) {
      case 'alarm': inst.alarm[i] = Math.round(v); return;
      case 'solid': case 'visible': case 'persistent': inst[name] = truthy(v); return;
      case 'image_xscale': case 'image_yscale': inst.image_scale = v; return;
      case 'id': case 'object_index': case 'sprite_width': case 'sprite_height': case 'image_number':
      case 'bbox_left': case 'bbox_right': case 'bbox_top': case 'bbox_bottom':
        game.warnOnce(`Försök att skriva skrivskyddad variabel ${name}`); return;
      default: inst[name] = v;
    }
  };
  const globalGet = (name) => {
    const r = game.roomData;
    switch (name) {
      case 'score': return game.score;
      case 'lives': return game.lives;
      case 'health': return game.health;
      case 'room': return game.roomId;
      case 'room_width': return r.width;
      case 'room_height': return r.height;
      case 'room_speed': return r.speed;
      case 'room_caption': return r.caption;
      case 'room_first': return game.project.room_order[0];
      case 'room_last': return game.project.room_order[game.project.room_order.length - 1];
      case 'mouse_x': return game.mouse.x;
      case 'mouse_y': return game.mouse.y;
      case 'fps': return game.fps || r.speed;
      case 'current_time': return Math.floor(performance.now());
      case 'instance_count': return game.instances.filter((i) => !i.deleted).length;
      case 'keyboard_key': return game.keys.size ? [...game.keys].pop() : 0;
      case 'keyboard_lastkey': return game.lastKey || 0;
      case 'show_score': return game.showScore ? 1 : 0;
      case 'show_lives': return game.showLives ? 1 : 0;
      case 'show_health': return game.showHealth ? 1 : 0;
      case 'caption_score': return game.scoreCap;
      case 'caption_lives': return game.livesCap;
      case 'caption_health': return game.healthCap;
      case 'view_xview': return game.viewRect().x;
      case 'view_yview': return game.viewRect().y;
      case 'view_wview': return game.viewRect().w;
      case 'view_hview': return game.viewRect().h;
      case 'view_enabled': return game.view ? 1 : 0;
      case 'background_color': return r.color;
      default: return 0;
    }
  };
  const globalSet = (name, v) => {
    switch (name) {
      case 'score': game.score = v; break;
      case 'lives': game.setLives(v); break;
      case 'health': game.setHealth(v); break;
      case 'room': game.requestRoom(v); break;
      case 'room_caption': game.roomData.caption = String(v); break;
      case 'show_score': game.showScore = truthy(v); game.hasSetShowScore = true; break;
      case 'show_lives': game.showLives = truthy(v); break;
      case 'show_health': game.showHealth = truthy(v); break;
      case 'caption_score': game.scoreCap = String(v); break;
      case 'caption_lives': game.livesCap = String(v); break;
      case 'caption_health': game.healthCap = String(v); break;
      case 'view_xview': if (game.view) game.view.x = v; break;
      case 'view_yview': if (game.view) game.view.y = v; break;
      default: game.warnOnce('Kan inte skriva ' + name);
    }
  };
  const key = (name, i, j) => (i || j ? `${name}[${i},${j}]` : name);

  const resolveTargets = (ctx, target) => {
    if (target === -1) return ctx.self ? [ctx.self] : [];
    if (target === -2) return ctx.other ? [ctx.other] : [];
    if (target === -3) return game.instancesOf(-3);
    if (target === -4) return [];
    if (target >= 100000) { const i = game.findInstance(target); return i ? [i] : []; }
    return game.instancesOf(target);
  };

  const rt = {
    getVar(ctx, name, i = 0, j = 0) {
      if (ctx.locals && name in ctx.locals) return ctx.locals[key(name, i, j)] ?? ctx.locals[name];
      if (ctx.self && INSTANCE_BUILTINS.has(name)) return instGet(ctx.self, name, i);
      if (GLOBAL_BUILTINS.has(name)) return globalGet(name);
      if (/^argument\d+$/.test(name)) return ctx.args[Number(name.slice(8))] ?? 0;
      if (name === 'argument') return ctx.args[i] ?? 0;
      const k = key(name, i, j);
      if (ctx.self && k in ctx.self.vars) return ctx.self.vars[k];
      if (game.declaredGlobals && game.declaredGlobals.has(name) && k in game.globals) return game.globals[k];
      if (name in CONSTANTS) return CONSTANTS[name];
      if (name in game.names) return game.names[name];
      game.warnOnce(`Variabeln ${name} används innan den fått ett värde (räknas som 0)`);
      return 0;
    },
    setVar(ctx, name, v, i = 0, j = 0) {
      if (ctx.locals && name in ctx.locals) { ctx.locals[key(name, i, j)] = v; return; }
      if (ctx.self && INSTANCE_BUILTINS.has(name)) { instSet(ctx.self, name, v, i); return; }
      if (GLOBAL_BUILTINS.has(name)) { globalSet(name, v); return; }
      if (game.declaredGlobals && game.declaredGlobals.has(name)) { game.globals[key(name, i, j)] = v; return; }
      if (ctx.self) ctx.self.vars[key(name, i, j)] = v;
    },
    getField(ctx, target, name) {
      if (target === -5) {
        if (GLOBAL_BUILTINS.has(name)) return globalGet(name);
        if (name in game.globals) return game.globals[name];
        game.warnOnce(`global.${name} används innan den fått ett värde`);
        return 0;
      }
      const list = resolveTargets(ctx, target);
      const inst = list[0];
      if (!inst) { game.warnOnce(`Ingen instans för ${target}.${name}`); return 0; }
      if (INSTANCE_BUILTINS.has(name)) return instGet(inst, name, 0);
      if (GLOBAL_BUILTINS.has(name)) return globalGet(name);
      if (name in inst.vars) return inst.vars[name];
      game.warnOnce(`${name} saknas i instans`);
      return 0;
    },
    setField(ctx, target, name, v) {
      if (target === -5) {
        if (GLOBAL_BUILTINS.has(name)) globalSet(name, v); else game.globals[name] = v;
        return;
      }
      for (const inst of resolveTargets(ctx, target)) {
        if (INSTANCE_BUILTINS.has(name)) instSet(inst, name, v, 0);
        else if (GLOBAL_BUILTINS.has(name)) globalSet(name, v);
        else inst.vars[name] = v;
      }
    },
    call(ctx, name, args) {
      const f = FUNCS[name];
      if (f) return f(game, ctx, args) ?? 0;
      const a = ACTIONS[name];
      if (a) return a(game, ctx, args, false) ?? 0;
      if (name in game.names) {
        const sid = game.names[name];
        const s = game.project.scripts[sid];
        if (s && s.name === name) return game.callScript(sid, ctx, args);
      }
      throw new GmlError(`Okänd funktion ${name}()`);
    },
    withTargets: resolveTargets,
    declareGlobal(name) { (game.declaredGlobals ||= new Set()).add(name); if (!(name in game.globals)) game.globals[name] = 0; },
  };
  return rt;
}

// action_sleep: rita nu (om redraw), frys sedan logik och bild i ms millisekunder.
Game.prototype.sleep = function sleep(ms, redraw) {
  if (redraw) this.ui.render();
  this.frozenUntil = performance.now() + Math.max(0, ms);
};

// Meddelanderuta: spelet står still (senast ritade bild syns) tills rutan stängs.
Game.prototype.showMessage = function showMessage(text) {
  this.modal = true;
  this.ui.showMessage(text).then(() => {
    this.modal = false;
    this.keys.clear(); this.pressed.clear(); this.released.clear(); this.mouse.buttons.clear();
  });
};

Game.prototype.callScript = function callScript(sid, ctx, args) {
  const fn = this.scripts[sid];
  if (!fn) { this.warnOnce('Script saknas: ' + sid); return 0; }
  return run(fn, { ...ctx, locals: Object.create(null), args });
};

export { EV };

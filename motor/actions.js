// Drag-and-drop-handlingar i GM5. Signatur: (game, ctx, args, relative) => värde (frågor: sant/falskt)
// Implementationerna följer OpenGMK kernel.rs (action_*).

const rad = (d) => (d * Math.PI) / 180;
// action_move: nio rutor "000000000", ordning enligt GM: 225, 270, 315, 180, stopp, 0, 135, 90, 45
const MOVE_DIRS = [225, 270, 315, 180, null, 0, 135, 90, 45];

export const ACTIONS = {
  action_move(g, ctx, [dirs, speed], rel) {
    const opts = [];
    for (let k = 0; k < 9; k++) if (String(dirs)[k] === '1') opts.push(k);
    if (!opts.length) return 0;
    const k = opts[Math.floor(Math.random() * opts.length)];
    const dir = MOVE_DIRS[k];
    const s = dir === null ? 0 : speed;
    const d = dir === null ? 0 : dir;
    const inst = ctx.self;
    if (rel) inst.setHV(Math.cos(rad(d)) * s + inst.hspeed, -Math.sin(rad(d)) * s + inst.vspeed);
    else inst.setSpeedDir(s, d);
    return 0;
  },
  action_set_motion(g, ctx, [dir, speed], rel) {
    const inst = ctx.self;
    if (rel) inst.setHV(Math.cos(rad(dir)) * speed + inst.hspeed, -Math.sin(rad(dir)) * speed + inst.vspeed);
    else inst.setSpeedDir(speed, dir);
    return 0;
  },
  action_set_gravity(g, ctx, [dir, grav], rel) {
    const inst = ctx.self;
    if (rel) { inst.gravity += grav; inst.gravity_direction += dir; } else { inst.gravity = grav; inst.gravity_direction = dir; }
    return 0;
  },
  action_bounce(g, ctx, [precise, against]) {
    g.bounce(ctx.self, Number(against) === 0);
    return 0;
  },
  action_create_object(g, ctx, [obj, x, y], rel) {
    const ox = rel ? ctx.self.x : 0, oy = rel ? ctx.self.y : 0;
    g.createInstance(obj, x + ox, y + oy);
    return 0;
  },
  action_change_object(g, ctx, [obj, perform]) {
    g.changeInstance(ctx.self, obj, Number(perform) === 1);
    return 0;
  },
  action_kill_object(g, ctx) { g.destroyInstance(ctx.self); return 0; },
  action_set_sprite(g, ctx, [spr, scale]) {
    ctx.self.sprite_index = spr;
    ctx.self.image_scale = scale === undefined ? 1 : scale;
    return 0;
  },
  action_sound(g, ctx, [snd, loop]) { g.audio.play(snd, Number(loop) === 1); return 0; },
  action_next_room(g) { g.requestRoom(g.nextRoomId(1)); return 0; },
  action_previous_room(g) { g.requestRoom(g.nextRoomId(-1)); return 0; },
  action_current_room(g) { g.requestRoom(g.roomId); return 0; },
  action_another_room(g, ctx, [room]) { g.requestRoom(room); return 0; },
  action_set_alarm(g, ctx, [steps, n], rel) {
    const a = ctx.self.alarm;
    a[n] = Math.round(rel ? Math.max(a[n], 0) + steps : steps);
    return 0;
  },
  action_sleep(g, ctx, [ms, redraw]) { g.sleep(ms, Number(redraw) === 1); return 0; },
  action_message(g, ctx, [text]) { g.showMessage(String(text)); return 0; },
  action_restart_game(g) { g.requestRestart(); return 0; },
  action_end_game(g) { g.requestRestart(); return 0; },
  action_if_number(g, ctx, [obj, num, cmp]) {
    const n = g.instancesOf(obj).length;
    if (cmp === 1) return n < num;
    if (cmp === 2) return n > num;
    return n === num;
  },
  action_if_dice(g, ctx, [sides]) { return Math.random() * sides < 1; },
  action_if(g, ctx, [value]) { return typeof value === 'string' ? value.length > 0 : value > 0.5; },
  action_execute_script(g, ctx, [script, ...args]) { return g.callScript(script, ctx, args); },
  action_set_score(g, ctx, [v], rel) { g.score = rel ? g.score + v : v; return 0; },
  action_set_life(g, ctx, [v], rel) { g.setLives(rel ? g.lives + v : v); return 0; },
  action_set_health(g, ctx, [v], rel) { g.setHealth(rel ? g.health + v : v); return 0; },
  action_set_caption(g, ctx, [sc, scap, lv, lcap, hl, hcap]) {
    g.hasSetShowScore = true;
    g.showScore = Number(sc) === 1; g.showLives = Number(lv) === 1; g.showHealth = Number(hl) === 1;
    g.scoreCap = scap; g.livesCap = lcap; g.healthCap = hcap;
    return 0;
  },
};

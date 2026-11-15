// GML-funktioner. Bara det spelen använder plus vanliga grundfunktioner.
// Signatur: (game, ctx, args) => värde
import { GmlError, truthy } from './gml.js';

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const self = (ctx) => {
  if (!ctx.self) throw new GmlError('Funktionen behöver en instans');
  return ctx.self;
};

export const FUNCS = {
  // matte
  random: (g, c, [n]) => Math.random() * n,
  floor: (g, c, [x]) => Math.floor(x),
  ceil: (g, c, [x]) => Math.ceil(x),
  round: (g, c, [x]) => Math.round(x),
  frac: (g, c, [x]) => x - Math.trunc(x),
  abs: (g, c, [x]) => Math.abs(x),
  sign: (g, c, [x]) => Math.sign(x),
  sqr: (g, c, [x]) => x * x,
  sqrt: (g, c, [x]) => Math.sqrt(x),
  power: (g, c, [x, y]) => Math.pow(x, y),
  exp: (g, c, [x]) => Math.exp(x),
  ln: (g, c, [x]) => Math.log(x),
  sin: (g, c, [x]) => Math.sin(x),
  cos: (g, c, [x]) => Math.cos(x),
  tan: (g, c, [x]) => Math.tan(x),
  arctan: (g, c, [x]) => Math.atan(x),
  arctan2: (g, c, [y, x]) => Math.atan2(y, x),
  degtorad: (g, c, [x]) => rad(x),
  radtodeg: (g, c, [x]) => deg(x),
  min: (g, c, a) => Math.min(...a),
  max: (g, c, a) => Math.max(...a),
  mean: (g, c, a) => a.reduce((s, v) => s + v, 0) / a.length,
  choose: (g, c, a) => a[Math.floor(Math.random() * a.length)],
  point_distance: (g, c, [x1, y1, x2, y2]) => Math.hypot(x2 - x1, y2 - y1),
  point_direction: (g, c, [x1, y1, x2, y2]) => { let d = deg(Math.atan2(y1 - y2, x2 - x1)); if (d < 0) d += 360; return d; },
  lengthdir_x: (g, c, [l, d]) => Math.cos(rad(d)) * l,
  lengthdir_y: (g, c, [l, d]) => -Math.sin(rad(d)) * l,
  is_real: (g, c, [v]) => (typeof v === 'number' ? 1 : 0),
  is_string: (g, c, [v]) => (typeof v === 'string' ? 1 : 0),
  real: (g, c, [v]) => (typeof v === 'number' ? v : parseFloat(v) || 0),
  string: (g, c, [v]) => (typeof v === 'string' ? v : (Number.isInteger(v) ? String(v) : v.toFixed(2))),
  string_length: (g, c, [s]) => String(s).length,

  // kollision och rörelse
  place_free: (g, c, [x, y]) => (g.placeFree(self(c), x, y) ? 1 : 0),
  place_empty: (g, c, [x, y]) => (g.placeEmpty(self(c), x, y) ? 1 : 0),
  place_meeting: (g, c, [x, y, o]) => (g.placeMeeting(self(c), x, y, o) ? 1 : 0),
  move_contact: (g, c, [d]) => { g.moveContact(self(c), d); return 0; },
  move_contact_solid: (g, c, [d, m]) => { g.moveContact(self(c), d, m > 0 ? Math.round(m) : 1000, true); return 0; },
  move_contact_all: (g, c, [d, m]) => { g.moveContact(self(c), d, m > 0 ? Math.round(m) : 1000, false); return 0; },
  move_bounce_solid: (g, c) => { g.bounce(self(c), true); return 0; },
  move_bounce_all: (g, c) => { g.bounce(self(c), false); return 0; },
  motion_set: (g, c, [d, s]) => { self(c).setSpeedDir(s, d); return 0; },
  distance_to_object: (g, c, [o]) => {
    const me = self(c);
    let best = 1e9;
    for (const i of g.instancesOf(o)) if (i !== me) best = Math.min(best, Math.hypot(i.x - me.x, i.y - me.y));
    return best;
  },

  // instanser
  instance_create: (g, c, [x, y, o]) => g.createInstance(o, x, y).id,
  instance_destroy: (g, c) => { g.destroyInstance(self(c)); return 0; },
  instance_number: (g, c, [o]) => g.instancesOf(o).length,
  instance_exists: (g, c, [o]) => (o >= 100000 ? (g.findInstance(o) ? 1 : 0) : (g.instancesOf(o).length ? 1 : 0)),
  instance_find: (g, c, [o, n]) => { const l = g.instancesOf(o); return l[n] ? l[n].id : -4; },
  instance_change: (g, c, [o, p]) => { g.changeInstance(self(c), o, truthy(p)); return 0; },

  // rum och spel
  room_goto: (g, c, [r]) => { g.requestRoom(r); return 0; },
  room_goto_next: (g) => { g.requestRoom(g.nextRoomId(1)); return 0; },
  room_goto_previous: (g) => { g.requestRoom(g.nextRoomId(-1)); return 0; },
  room_restart: (g) => { g.requestRoom(g.roomId); return 0; },
  game_restart: (g) => { g.requestRestart(); return 0; },
  game_end: (g) => { g.requestRestart(); return 0; },
  show_message: (g, c, [s]) => { g.showMessage(String(s)); return 0; },
  sleep: (g, c, [ms]) => { g.sleep(ms, false); return 0; },
  script_execute: (g, c, [s, ...a]) => g.callScript(s, c, a),

  // input
  keyboard_check: (g, c, [k]) => (k === 0 ? (g.keys.size === 0 ? 1 : 0) : k === 1 ? (g.keys.size ? 1 : 0) : (g.keys.has(k) ? 1 : 0)),
  keyboard_check_pressed: (g, c, [k]) => (g.pressed.has(k) ? 1 : 0),
  keyboard_check_released: (g, c, [k]) => (g.released.has(k) ? 1 : 0),
  mouse_check_button: (g, c, [b]) => (b === -1 ? (g.mouse.buttons.size ? 1 : 0) : b === 0 ? (g.mouse.buttons.size ? 0 : 1) : (g.mouse.buttons.has(b) ? 1 : 0)),
  mouse_check_button_pressed: (g, c, [b]) => (g.mouse.pressed.has(b) ? 1 : 0),

  // ljud
  sound_play: (g, c, [s]) => { g.audio.play(s, false); return 0; },
  sound_loop: (g, c, [s]) => { g.audio.play(s, true); return 0; },
  sound_stop: (g, c, [s]) => { g.audio.stop(s); return 0; },
  sound_stop_all: (g) => { g.audio.stopAll(); return 0; },
  sound_isplaying: (g, c, [s]) => (g.audio.isPlaying(s) ? 1 : 0),
};

// Startar ett spel: laddning, fast tidssteg (room_speed steg/s), ritning, tangentbord och mus.
import { loadGame } from './loader.js';
import { drawRoom } from './render.js';
import { Game } from './game.js';
import { Audio } from './audio.js';

// Webbläsarens tangentnamn -> Windows virtual key codes (som GM använder)
const VK = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, ' ': 32, Enter: 13,
  Escape: 27, Shift: 16, Control: 17, Alt: 18, Backspace: 8, Tab: 9, Home: 36, End: 35,
  Delete: 46, Insert: 45, PageUp: 33, PageDown: 34 };
function vkOf(e) {
  if (VK[e.key] !== undefined) return VK[e.key];
  if (/^F([1-9]|1[0-2])$/.test(e.key)) return 111 + Number(e.key.slice(1));
  if (e.code && /^Key[A-Z]$/.test(e.code)) return e.code.charCodeAt(3);
  if (e.code && /^Digit[0-9]$/.test(e.code)) return e.code.charCodeAt(5);
  return null;
}

export async function startGame(name, canvas, ui, variant) {
  const project = await loadGame(name, variant);
  const audio = new Audio(project, `data/${name}/`);
  await audio.load();
  let scale = 1;
  const view = { w: 640, h: 480 };
  const fit = () => {
    const extra = ui.chromeHeight();
    const res = ui.reserve ? ui.reserve() : { w: 0, h: 0 };  // plats för pekknappar
    const s = Math.min((innerWidth - res.w) / view.w, (innerHeight - extra - res.h) / view.h);
    scale = s >= 1 ? Math.floor(s) : s;  // heltal ger skarpa pixlar
    canvas.style.width = `${view.w * scale}px`;
    canvas.style.height = `${view.h * scale}px`;
  };
  const ctx = canvas.getContext('2d');
  let game;
  const render = () => {
    game.updateView();
    const v = game.viewRect();
    drawRoom(ctx, project, { ...game.roomData, backgrounds: game.backgrounds }, game.instances.filter((i) => !i.deleted), v);
  };
  game = new Game(project, canvas, {
    audio,
    setCaption: ui.setCaption,
    showMessage: ui.showMessage,
    render: () => render(),
    resize: (w, h) => { view.w = w; view.h = h; canvas.width = w; canvas.height = h; ctx.imageSmoothingEnabled = false; fit(); },
  });
  addEventListener('resize', fit);

  // tangentbord
  const gameKeys = new Set([32, 37, 38, 39, 40]);
  addEventListener('keydown', (e) => {
    audio.unlock();
    if (game.modal) return;
    const k = vkOf(e);
    if (k === null) return;
    if (gameKeys.has(k)) e.preventDefault();
    if (!game.keys.has(k)) game.pressed.add(k);
    game.keys.add(k);
    game.lastKey = k;
  });
  addEventListener('keyup', (e) => {
    const k = vkOf(e);
    if (k === null) return;
    if (game.keys.delete(k)) game.released.add(k);
  });
  addEventListener('blur', () => { for (const k of game.keys) game.released.add(k); game.keys.clear(); });

  // mus (koordinater i rummet)
  const toRoom = (e) => {
    const r = canvas.getBoundingClientRect();
    const v = game.viewRect();
    game.mouse.x = Math.floor((e.clientX - r.left) / (r.width / canvas.width)) + v.x;
    game.mouse.y = Math.floor((e.clientY - r.top) / (r.height / canvas.height)) + v.y;
  };
  const btn = (e) => (e.button === 0 ? 1 : e.button === 2 ? 2 : 3);
  // Pekarhändelser i stället för mushändelser: ett tryck på mobilen räknas som ett vänsterklick.
  // Ett kort tryck hålls nere minst ett steg, annars hinner GO!-knappens stegkod inte se det.
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointermove', toRoom);
  canvas.addEventListener('pointerdown', (e) => { audio.unlock(); toRoom(e); if (game.modal) return; const b = btn(e); game.mouse.buttons.add(b); game.mouse.pressed.add(b); game.mouseDownStep = game.stepCount; });
  addEventListener('pointerup', (e) => {
    const b = btn(e);
    if (game.stepCount > (game.mouseDownStep ?? -1)) game.mouse.buttons.delete(b);
    else setTimeout(() => game.mouse.buttons.delete(b), 70);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // stegloop
  const fps = { frames: 0, steps: 0, t: performance.now(), shown: 0, stepsShown: 0 };
  let acc = 0;
  let last = performance.now();
  game.restart();
  render();
  const tick = (now) => {
    let dt = now - last;
    last = now;
    if (game.modal || now < game.frozenUntil) { acc = 0; requestAnimationFrame(tick); return; }
    const stepMs = 1000 / (game.roomData.speed || 30);
    acc += Math.min(dt, 250);
    let stepped = false;
    let n = 0;
    while (acc >= stepMs && n < 4) {
      game.step();
      fps.steps++;
      acc -= stepMs;
      n++;
      stepped = true;
      if (game.modal || performance.now() < game.frozenUntil) { acc = 0; break; }
    }
    if (n >= 4) acc = 0;
    if (stepped && !game.modal && performance.now() >= game.frozenUntil) { render(); fps.frames++; }
    if (now - fps.t >= 1000) {
      fps.shown = Math.round(fps.frames * 1000 / (now - fps.t));
      fps.stepsShown = Math.round(fps.steps * 1000 / (now - fps.t));
      fps.frames = 0; fps.steps = 0; fps.t = now;
      ui.setFps && ui.setFps(fps.stepsShown, fps.shown);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__spel = { game, project, fps };
  // Felsökning: window.__skarmbild('namn') sparar canvas till nybygge/felsok/namn.png
  window.__skarmbild = (namn) => fetch(`/__skarmbild/${namn}`, { method: 'POST', body: canvas.toDataURL('image/png') });
  return game;
}

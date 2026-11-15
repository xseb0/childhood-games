// Laddar project.json och alla bilder för ett spel. Se ../PLAN.md.

// variant (valfri): varianter/<name>-<variant>.json lägger till instanser i rum m.m. utan att
// röra originaldatan. Se varianter/*.json och PLAN.md.
export async function loadGame(name, variant) {
  const base = `data/${name}/`;
  const res = await fetch(base + 'project.json');
  if (!res.ok) throw new Error(`Hittar inte ${base}project.json (${res.status})`);
  const project = await res.json();
  if (variant) await applyVariant(project, name, variant);

  const jobs = [];
  const loadImg = (file) => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('Kunde inte ladda ' + file));
    img.src = base + encodeURI(file);
  });

  for (const spr of project.sprites) {
    if (!spr) continue;
    spr.images = new Array(spr.frames.length).fill(null);
    spr.frames.forEach((f, i) => {
      if (f) jobs.push(loadImg(f).then((img) => { spr.images[i] = img; }));
    });
  }
  for (const bg of project.backgrounds) {
    if (bg && bg.image) jobs.push(loadImg(bg.image).then((img) => { bg.img = img; }));
  }
  await Promise.all(jobs);
  return project;
}

async function applyVariant(project, name, variant) {
  if (!/^[a-z0-9-]+$/.test(variant)) throw new Error('Ogiltigt variantnamn');
  const res = await fetch(`varianter/${name}-${variant}.json`);
  if (!res.ok) throw new Error(`Hittar inte varianten ${name}-${variant}`);
  const v = await res.json();
  const byName = (list, n, what) => {
    const r = list.find((x) => x && x.name === n);
    if (!r) throw new Error(`Varianten pekar på ${what} ${n} som inte finns`);
    return r;
  };
  // Nya objekt som kopior av befintliga: { namn, kopia_av }. Händelser byts sedan nedan.
  for (const n of v.nya_objekt || []) {
    const src = byName(project.objects, n.kopia_av, 'objektet');
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = project.objects.length;
    copy.name = n.namn;
    project.objects.push(copy);
    // kollisioner mot originalet ska också gälla kopian
    for (const o of project.objects) {
      if (!o || o === copy) continue;
      for (const e of [...(o.events.collision || [])]) {
        if (e.sub === src.id) o.events.collision.push({ sub: copy.id, actions: e.actions });
      }
    }
  }
  let nextId = 900000;
  // Byt objekt på befintliga instanser: { rum, x, y, fran, till }
  for (const b of v.byt_instans || []) {
    const room = byName(project.rooms, b.rum, 'rummet');
    const fran = byName(project.objects, b.fran, 'objektet');
    const till = byName(project.objects, b.till, 'objektet');
    const inst = room.instances.find((i) => i.x === b.x && i.y === b.y && i.object === fran.id);
    if (!inst) throw new Error(`Varianten: ingen ${b.fran} vid ${b.x},${b.y} i ${b.rum}`);
    inst.object = till.id;
  }
  for (const add of v.lagg_till || []) {
    const room = byName(project.rooms, add.rum, 'rummet');
    const obj = byName(project.objects, add.objekt, 'objektet');
    room.instances.push({ x: add.x, y: add.y, object: obj.id, id: nextId++, creation_code: '', locked: false });
  }
  // Ta bort alla instanser av ett objekt i ett rum: { rum, objekt }
  for (const t of v.ta_bort_instanser || []) {
    const room = byName(project.rooms, t.rum, 'rummet');
    const obj = byName(project.objects, t.objekt, 'objektet');
    const kvar = room.instances.filter((i) => i.object !== obj.id);
    if (kvar.length === room.instances.length) throw new Error(`Varianten: ingen ${t.objekt} i ${t.rum}`);
    room.instances = kvar;
  }
  // Sätt en bakgrund i ett rumslager: { rum, lager, bakgrund }
  for (const t of v.byt_bakgrund || []) {
    const room = byName(project.rooms, t.rum, 'rummet');
    const bg = byName(project.backgrounds, t.bakgrund, 'bakgrunden');
    const layer = room.backgrounds[t.lager];
    if (!layer) throw new Error(`Varianten: ${t.rum} saknar bakgrundslager ${t.lager}`);
    layer.bg = bg.id;
    layer.visible = true;
  }
  const subOf = (mal) => (typeof mal === 'number' ? mal : byName(project.objects, mal, 'objektet').id);
  // Kopiera en händelse oförändrad till ett annat objekt: { fran, till, typ, mal }
  for (const t of v.kopiera_handelser || []) {
    const fran = byName(project.objects, t.fran, 'objektet');
    const till = byName(project.objects, t.till, 'objektet');
    const e = (fran.events[t.typ] || []).find((x) => x.sub === subOf(t.mal));
    if (!e) throw new Error(`Varianten: ${t.fran} saknar ${t.typ} ${t.mal}`);
    (till.events[t.typ] ||= []).push(JSON.parse(JSON.stringify(e)));
  }
  // Ta bort händelser: { objekt, typ, mal } där mal är ett objektnamn (kollision) eller nummer.
  for (const t of v.ta_bort_handelser || []) {
    const obj = byName(project.objects, t.objekt, 'objektet');
    const list = obj.events[t.typ] || [];
    const sub = subOf(t.mal);
    const kvar = list.filter((e) => e.sub !== sub);
    if (kvar.length === list.length) throw new Error(`Varianten: ${t.objekt} saknar ${t.typ} ${t.mal}`);
    obj.events[t.typ] = kvar;
  }
  // Lägg till händelser med GML-kod: { objekt, typ, mal, kod }
  for (const t of v.lagg_till_handelser || []) {
    const obj = byName(project.objects, t.objekt, 'objektet');
    (obj.events[t.typ] ||= []).push({ sub: subOf(t.mal), actions: [{
      id: 603, lib: 1, kind: 7, exec_type: 2, question: false, function: '', code: '',
      arg_kinds: [1], args: [t.kod], applies_to: -1, relative: false, not: false,
    }] });
  }
  if (v.vy_foljer) project.view_follow = v.vy_foljer.map((n) => byName(project.objects, n, 'objektet').id);
  project.variant = v;
}

// GM sparar färger som 0x00BBGGRR.
export function gmColor(c) {
  const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
  return `rgb(${r},${g},${b})`;
}

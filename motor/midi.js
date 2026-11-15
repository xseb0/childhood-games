// Enkel MIDI-spelare med Web Audio-oscillatorer (ingen soundfont, inget att ladda ner).
// Läser format 0/1, tempoändringar, note on/off, program change och kanal 10 (trummor).
// Ljudet blir chiptune-aktigt, inte som Windows GS-synten. Se PLAN.md beslut 6.

function parseMidi(buf) {
  const d = new DataView(buf);
  let p = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  if (str(4) !== 'MThd') throw new Error('Inte en MIDI-fil');
  const hlen = u32();
  const format = u16(); const ntracks = u16(); const division = u16();
  p = 8 + hlen;
  const events = [];
  for (let t = 0; t < ntracks && p < buf.byteLength; t++) {
    if (str(4) !== 'MTrk') break;
    const len = u32();
    const end = p + len;
    let tick = 0; let status = 0;
    const vlq = () => { let v = 0; let b; do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
    while (p < end) {
      tick += vlq();
      let b = d.getUint8(p);
      if (b & 0x80) { status = b; p++; } else b = status;
      const type = status & 0xf0; const ch = status & 0x0f;
      if (status === 0xff) {
        const mt = d.getUint8(p++); const ml = vlq();
        if (mt === 0x51) events.push({ tick, kind: 'tempo', us: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) });
        p += ml;
      } else if (status === 0xf0 || status === 0xf7) {
        p += vlq();
      } else if (type === 0x90 || type === 0x80) {
        const note = d.getUint8(p++); const vel = d.getUint8(p++);
        events.push({ tick, kind: type === 0x90 && vel > 0 ? 'on' : 'off', ch, note, vel });
      } else if (type === 0xc0) {
        events.push({ tick, kind: 'prog', ch, prog: d.getUint8(p++) });
      } else if (type === 0xd0) { p += 1; } else { p += 2; }  // övriga kanalmeddelanden
    }
    p = end;
  }
  events.sort((a, b) => a.tick - b.tick);
  // Omvandla till sekunder
  let us = 500000; let lastTick = 0; let time = 0;
  for (const e of events) {
    time += ((e.tick - lastTick) * us) / division / 1e6;
    lastTick = e.tick;
    e.time = time;
    if (e.kind === 'tempo') us = e.us;
  }
  return { events, duration: time + 0.5, format };
}

// Grov klangfärg per GM-programgrupp.
function waveFor(prog) {
  const g = prog >> 3;
  if (g === 4 || g === 5 || g === 6) return 'sawtooth';  // stråkar, ensemble, brass
  if (g === 2 || g === 9 || g === 10) return 'square';   // orgel, synth lead/pad
  if (g === 3 || g === 7) return 'triangle';             // gitarr, flöjt
  return 'triangle';                                     // piano m.m.
}

export class MidiPlayer {
  constructor(ac, out, buf, loop) {
    this.ac = ac; this.out = out; this.loop = loop;
    this.song = parseMidi(buf);
    this.gain = ac.createGain();
    this.gain.gain.value = 0.18;
    this.gain.connect(out);
    this.voices = new Map();
    this.prog = new Array(16).fill(0);
    this.timer = null;
    this.stopped = false;
  }

  start() {
    this.t0 = this.ac.currentTime + 0.1;
    this.idx = 0;
    this.timer = setInterval(() => this.pump(), 50);
    this.pump();
  }

  pump() {
    if (this.stopped) return;
    const ahead = this.ac.currentTime + 0.25;
    const ev = this.song.events;
    while (this.idx < ev.length && this.t0 + ev[this.idx].time < ahead) {
      this.handle(ev[this.idx], this.t0 + ev[this.idx].time);
      this.idx++;
    }
    if (this.idx >= ev.length && this.t0 + this.song.duration < ahead) {
      if (this.loop) { this.t0 += this.song.duration; this.idx = 0; } else this.stop();
    }
  }

  handle(e, t) {
    if (e.kind === 'prog') { this.prog[e.ch] = e.prog; return; }
    const key = e.ch * 128 + e.note;
    if (e.kind === 'on') {
      if (e.ch === 9) { this.drum(e.note, e.vel, t); return; }
      this.release(key, t);
      const osc = this.ac.createOscillator();
      osc.type = waveFor(this.prog[e.ch]);
      osc.frequency.value = 440 * Math.pow(2, (e.note - 69) / 12);
      const g = this.ac.createGain();
      const v = (e.vel / 127) * (osc.type === 'triangle' ? 1 : 0.45);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.01);
      g.gain.setTargetAtTime(v * 0.6, t + 0.02, 0.3);
      osc.connect(g); g.connect(this.gain);
      osc.start(t);
      this.voices.set(key, { osc, g });
    } else if (e.kind === 'off') {
      this.release(key, t);
    }
  }

  release(key, t) {
    const v = this.voices.get(key);
    if (!v) return;
    this.voices.delete(key);
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setTargetAtTime(0, t, 0.04);
    v.osc.stop(t + 0.3);
  }

  drum(note, vel, t) {
    const len = note === 35 || note === 36 ? 0.18 : 0.08;
    const n = Math.floor(this.ac.sampleRate * len);
    const buf = this.ac.createBuffer(1, n, this.ac.sampleRate);
    const data = buf.getChannelData(0);
    const kick = note === 35 || note === 36;
    for (let i = 0; i < n; i++) {
      const env = 1 - i / n;
      data[i] = kick ? Math.sin(i / this.ac.sampleRate * 2 * Math.PI * (60 + 90 * env)) * env : (Math.random() * 2 - 1) * env * env;
    }
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    const g = this.ac.createGain();
    g.gain.value = (vel / 127) * (kick ? 1.2 : 0.4);
    src.connect(g); g.connect(this.gain);
    src.start(t);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    const t = this.ac.currentTime;
    for (const key of [...this.voices.keys()]) this.release(key, t);
    this.gain.gain.setTargetAtTime(0, t, 0.05);
  }
}

export { parseMidi };

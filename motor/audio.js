// Ljud: WAV via Web Audio. MIDI via midi.js (enkel egen synt, se PLAN.md beslut 6).
import { MidiPlayer } from './midi.js';

// Onlineversionen (claude.ai-artifact) får inte servera .mid. Där ligger musiken som base64 i
// <fil>.b64.txt bredvid, och den hämtas bara när .mid-filen saknas. Se PLAN.md, logg 2026-11-15.
async function fetchSound(url, file) {
  const r = await fetch(url);
  if (r.ok || !/\.midi?$/i.test(file)) return r.arrayBuffer();
  const t = await (await fetch(url + '.b64.txt')).text();
  const bin = atob(t.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export class Audio {
  constructor(project, base) {
    this.project = project;
    this.base = base;
    this.ac = null;
    this.buffers = [];   // id -> AudioBuffer
    this.midis = [];     // id -> ArrayBuffer
    this.playing = new Map();  // id -> lista av noder/spelare
    this.unlocked = false;
    this.pending = [];
  }

  async load() {
    this.ac = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ac.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ac.destination);
    const jobs = [];
    for (const s of this.project.sounds) {
      if (!s || !s.file) continue;
      const url = this.base + encodeURI(s.file);
      jobs.push(fetchSound(url, s.file).then(async (buf) => {
        if (/\.midi?$/i.test(s.file)) this.midis[s.id] = buf;
        else this.buffers[s.id] = await this.ac.decodeAudioData(buf);
      }).catch((e) => console.warn('[ljud] kunde inte ladda', s.file, e)));
    }
    await Promise.all(jobs);
  }

  // Webbläsare kräver ett klick eller tangenttryck innan ljud får spelas.
  unlock() {
    if (this.unlocked || !this.ac) return;
    this.unlocked = true;
    this.ac.resume();
    for (const [id, loop] of this.pending) this.play(id, loop);
    this.pending = [];
  }

  play(id, loop) {
    if (!this.ac) return;
    if (!this.unlocked) {
      if (loop) this.pending.push([id, loop]);  // bakgrundsmusik startar när spelaren rör något
      return;
    }
    if (this.midis[id]) {
      this.stop(id);
      const p = new MidiPlayer(this.ac, this.master, this.midis[id], loop);
      p.start();
      this.playing.set(id, [p]);
      return;
    }
    const buf = this.buffers[id];
    if (!buf) return;
    if (loop) this.stop(id);
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    src.loop = !!loop;
    src.connect(this.master);
    src.start();
    const list = this.playing.get(id) || [];
    list.push(src);
    this.playing.set(id, list);
    src.onended = () => {
      const l = this.playing.get(id);
      if (l) this.playing.set(id, l.filter((x) => x !== src));
    };
  }

  stop(id) {
    const l = this.playing.get(id);
    if (!l) return;
    for (const n of l) { try { n.stop(); } catch { /* redan stoppad */ } }
    this.playing.delete(id);
  }

  stopAll() { for (const id of [...this.playing.keys()]) this.stop(id); }

  isPlaying(id) { const l = this.playing.get(id); return !!(l && l.length); }
}

/**
 * Sound effects synthesised with WebAudio: no files to download, every sound is a few oscillators and filtered
 * noise. The context is created on the first user gesture (browsers block audio before that).
 */

type Wave = OscillatorType

interface ToneOptions {
  type?: Wave
  gain?: number
  attack?: number
  /** frequency at the end of the sound (exponential slide) */
  slideTo?: number
  delay?: number
  /** low-pass cutoff, Hz */
  cutoff?: number
}

interface NoiseOptions {
  gain?: number
  delay?: number
  filter?: BiquadFilterType
  freq?: number
  freqTo?: number
  q?: number
  attack?: number
}

const NOTES = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093 }

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private charging: { osc: OscillatorNode; gain: GainNode } | null = null
  muted = false

  /** Call from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 4
      comp.connect(ctx.destination)
      const master = ctx.createGain()
      master.gain.value = this.muted ? 0 : 0.55
      master.connect(comp)
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      this.ctx = ctx
      this.master = master
      this.noiseBuf = buf
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.03)
    if (muted) this.chargeStop()
  }

  private get ready(): boolean {
    return !!this.ctx && !!this.master && !this.muted && this.ctx.state === 'running'
  }

  private tone(freq: number, dur: number, o: ToneOptions = {}): void {
    if (!this.ready) return
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const osc = ctx.createOscillator()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(freq, t0)
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur)
    const g = ctx.createGain()
    const peak = o.gain ?? 0.3
    const attack = o.attack ?? 0.008
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    let node: AudioNode = osc
    if (o.cutoff) {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = o.cutoff
      osc.connect(f)
      node = f
    }
    node.connect(g).connect(this.master!)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  }

  private noise(dur: number, o: NoiseOptions = {}): void {
    if (!this.ready) return
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = o.filter ?? 'bandpass'
    f.frequency.setValueAtTime(o.freq ?? 1000, t0)
    if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + dur)
    f.Q.value = o.q ?? 1
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.3, t0 + (o.attack ?? 0.01))
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(f).connect(g).connect(this.master!)
    src.start(t0, Math.random() * 0.5)
    src.stop(t0 + dur + 0.05)
  }

  /** a short buzz on phones that can (silent together with the sound) */
  buzz(pattern: number | number[]): void {
    if (this.muted || typeof navigator === 'undefined' || !('vibrate' in navigator)) return
    try {
      navigator.vibrate(pattern)
    } catch {
      // not allowed before a gesture: skip
    }
  }

  click(): void {
    this.tone(1400, 0.05, { type: 'triangle', gain: 0.08 })
  }

  /** the rubber band creaks a little as it stretches */
  stretch(power: number): void {
    this.tone(180 + power * 420, 0.06, { type: 'triangle', gain: 0.035, cutoff: 1800 })
  }

  launch(power: number): void {
    this.noise(0.55 + power * 0.25, { filter: 'bandpass', freq: 400, freqTo: 2600, q: 0.8, gain: 0.32 + power * 0.2, attack: 0.02 })
    this.tone(90, 0.35, { type: 'sine', gain: 0.4, slideTo: 45 })
    this.tone(320, 0.3, { type: 'triangle', gain: 0.08, slideTo: 900 + power * 600, delay: 0.02 })
  }

  chargeStart(): void {
    if (!this.ready || this.charging) return
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(140, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.75)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 900
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.1)
    osc.connect(f).connect(gain).connect(this.master!)
    osc.start()
    this.charging = { osc, gain }
  }

  chargeStop(): void {
    const c = this.charging
    if (!c || !this.ctx) return
    this.charging = null
    const t = this.ctx.currentTime
    c.gain.gain.cancelScheduledValues(t)
    c.gain.gain.setTargetAtTime(0.0001, t, 0.02)
    c.osc.stop(t + 0.1)
  }

  boost(size: number): void {
    this.chargeStop()
    this.noise(0.3 + size * 0.25, { filter: 'highpass', freq: 900, freqTo: 3000, gain: 0.18 + size * 0.2 })
    this.tone(220, 0.25, { type: 'square', gain: 0.05, slideTo: 660, cutoff: 1500 })
  }

  dust(count: number): void {
    const notes = [NOTES.C6, NOTES.E6, NOTES.G6]
    const n = notes[Math.min(notes.length - 1, Math.max(0, count - 1))]
    this.tone(n, 0.5, { type: 'sine', gain: 0.2 })
    this.tone(n * 2, 0.35, { type: 'sine', gain: 0.06, delay: 0.03 })
    this.tone(n * 1.5, 0.4, { type: 'triangle', gain: 0.05, delay: 0.07 })
  }

  /** the forecast slid into a launch window: a soft rising "now!" */
  window(): void {
    this.tone(NOTES.G5, 0.25, { type: 'sine', gain: 0.1 })
    this.tone(NOTES.C6, 0.4, { type: 'sine', gain: 0.12, delay: 0.09 })
  }

  /** a giant's gravity takes the ship: deep swelling whoosh */
  flyby(): void {
    this.noise(1.4, { filter: 'lowpass', freq: 200, freqTo: 1400, q: 2, gain: 0.25, attack: 0.5 })
    this.tone(55, 1.3, { type: 'sine', gain: 0.25, slideTo: 110, attack: 0.4 })
  }

  slingshot(combo: number): void {
    const base = [NOTES.C5, NOTES.D5, NOTES.E5, NOTES.G5][Math.min(3, combo - 1)]
    ;[1, 1.25, 1.5, 2].forEach((k, i) => this.tone(base * k, 0.45, { type: 'triangle', gain: 0.14, delay: i * 0.06 }))
    this.tone(base * 4, 0.6, { type: 'sine', gain: 0.05, delay: 0.24 })
    this.noise(0.5, { filter: 'highpass', freq: 3000, freqTo: 8000, gain: 0.07 })
  }

  closePass(): void {
    this.noise(0.35, { filter: 'bandpass', freq: 3000, freqTo: 600, q: 3, gain: 0.2 })
  }

  arrive(): void {
    const chord = [NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6]
    chord.forEach((n, i) => this.tone(n, 0.9, { type: 'triangle', gain: 0.14, delay: i * 0.09 }))
    chord.forEach((n) => this.tone(n * 2, 1.4, { type: 'sine', gain: 0.05, delay: 0.45 }))
    this.noise(1.2, { filter: 'highpass', freq: 5000, gain: 0.05, delay: 0.3, attack: 0.2 })
  }

  star(i: number): void {
    const n = [NOTES.E6, NOTES.G6, NOTES.C7][Math.min(2, i)]
    this.tone(n, 0.6, { type: 'sine', gain: 0.18 })
    this.tone(n * 1.5, 0.5, { type: 'triangle', gain: 0.05, delay: 0.04 })
  }

  crash(): void {
    this.noise(0.9, { filter: 'lowpass', freq: 1800, freqTo: 120, gain: 0.55, q: 0.7 })
    this.tone(70, 0.6, { type: 'sine', gain: 0.5, slideTo: 30 })
  }

  lost(): void {
    this.tone(NOTES.E5, 0.5, { type: 'triangle', gain: 0.1, slideTo: NOTES.C5 * 0.7 })
    this.tone(NOTES.C5, 0.7, { type: 'triangle', gain: 0.08, delay: 0.2, slideTo: NOTES.C5 * 0.5 })
  }

  score(): void {
    this.tone(1800, 0.03, { type: 'square', gain: 0.025, cutoff: 3000 })
  }
}

export const sfx = new Sfx()

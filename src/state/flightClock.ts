import { fromDays } from '../game/physics/units'

export type FlightSpeed = 1 | 10 | 100

/** ×1 plays 3 game days per real second. */
export const DAYS_PER_SECOND_AT_X1 = 3

/**
 * Playback clock for the flight screen. Mutable on purpose: the render loop advances it every frame and
 * React reads it at a low rate, so the trajectory never goes through reactive state per frame.
 */
export const flightClock = {
  time: 0,
  startTime: 0,
  endTime: 0,
  playing: false,
  speed: 10 as FlightSpeed,
  finished: false,

  reset(startTime: number, endTime: number): void {
    this.startTime = startTime
    this.endTime = endTime
    this.time = startTime
    this.playing = true
    this.finished = false
  },

  /** Advances by real seconds; returns true on the frame the end is reached. */
  advance(seconds: number): boolean {
    if (!this.playing || this.finished) return false
    this.time += fromDays(DAYS_PER_SECOND_AT_X1 * this.speed) * seconds
    if (this.time >= this.endTime) {
      this.time = this.endTime
      this.playing = false
      this.finished = true
      return true
    }
    return false
  },

  seek(t: number): void {
    this.time = Math.min(this.endTime, Math.max(this.startTime, t))
    if (this.time < this.endTime) this.finished = false
  },
}

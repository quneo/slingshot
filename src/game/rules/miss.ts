import type { MissionSystem } from '../levels/mission'
import type { LevelDef } from '../levels/types'
import { SAMPLE_STRIDE } from '../physics/interpolate'
import type { PropagationResult } from '../physics/propagate'
import { bodyState } from '../physics/system'

/**
 * Why a flight missed its target, in terms the player can act on.
 * - `short` / `long`: the path never reaches the target's orbit (gap = distance to that orbit)
 * - `timing`: the path crosses the orbit, but the planet is elsewhere then; `lag` > 0 means the planet
 *   arrives at the meeting point `lag` time units later (launch later), < 0 means it already passed.
 * - `near`: the planet was close, just outside the goal ring.
 */
export type MissAnalysis =
  | { kind: 'short'; t: number; x: number; y: number; gap: number }
  | { kind: 'long'; t: number; x: number; y: number; gap: number }
  | {
      kind: 'timing'
      t: number
      x: number
      y: number
      lag: number
      distance: number
      /** suggested launch-date change (docked starts with a window), model time; null if not applicable */
      launchShift: number | null
    }
  | { kind: 'near'; t: number; x: number; y: number; distance: number }

export function analyzeMiss(level: LevelDef, mission: MissionSystem, result: PropagationResult): MissAnalysis | null {
  const ti = mission.indexOf(level.target.bodyId)
  const target = mission.system.bodies[ti]
  if (!target.orbit || result.arrival) return null
  const a = target.orbit.a
  const zone = level.target.zoneRadius
  const s = result.samples
  const n = result.sampleCount
  if (n < 2) return null

  // 1) the ship's closest approach to the target itself, if it is a near miss
  const c = result.closest[ti]
  if (c && c.distance <= zone * 3 && c.t > s[0] + 1e-6) {
    return { kind: 'near', t: c.t, x: c.x, y: c.y, distance: c.distance }
  }

  // 2) where does the path come nearest to the target's orbit?
  let best = -1
  let bestGap = Infinity
  let crosses = false
  for (let i = 1; i < n; i++) {
    const o = i * SAMPLE_STRIDE
    const r = Math.hypot(s[o + 1], s[o + 2])
    const gap = Math.abs(r - a)
    const r0 = Math.hypot(s[o - SAMPLE_STRIDE + 1], s[o - SAMPLE_STRIDE + 2])
    if ((r0 - a) * (r - a) <= 0) {
      // first crossing of the orbit is the natural meeting point
      if (!crosses) {
        crosses = true
        best = i
        bestGap = 0
      }
    } else if (!crosses && gap < bestGap) {
      bestGap = gap
      best = i
    }
  }
  const o = best * SAMPLE_STRIDE
  const t = s[o]
  const x = s[o + 1]
  const y = s[o + 2]
  if (!crosses && bestGap > zone) {
    const r = Math.hypot(x, y)
    return r < a ? { kind: 'short', t, x, y, gap: bestGap - zone } : { kind: 'long', t, x, y, gap: bestGap - zone }
  }

  // 3) timing: angle between the planet and the meeting point, converted to time along its orbit
  const p = bodyState(mission.system, ti, t)
  let dAng = Math.atan2(y, x) - Math.atan2(p.y, p.x)
  while (dAng > Math.PI) dAng -= 2 * Math.PI
  while (dAng < -Math.PI) dAng += 2 * Math.PI
  const meanMotion = Math.sqrt(mission.system.centralMu / a ** 3)
  return {
    kind: 'timing',
    t,
    x,
    y,
    lag: dAng / meanMotion,
    distance: Math.hypot(x - p.x, y - p.y),
    launchShift: suggestLaunchShift(level, mission, dAng, meanMotion, result.samples[0]),
  }
}

/**
 * Launching Δt later rotates the whole departure geometry by n_home·Δt while the target advances n_target·Δt,
 * so the meeting point moves relative to the target by (n_home − n_target)·Δt. Undo the angular miss with the
 * smallest shift (± whole synodic periods) that stays inside the launch window.
 */
function suggestLaunchShift(level: LevelDef, mission: MissionSystem, dAng: number, nTarget: number, launchTime: number): number | null {
  const start = level.start
  if (start.kind !== 'docked' || start.launchWindow[1] <= start.launchWindow[0]) return null
  const home = mission.system.bodies[mission.indexOf(start.bodyId)]
  if (!home.orbit) return null
  const nHome = Math.sqrt(mission.system.centralMu / home.orbit.a ** 3)
  const rel = nHome - nTarget
  if (Math.abs(rel) < 1e-9) return null
  const synodic = (2 * Math.PI) / Math.abs(rel)
  const base = -dAng / rel
  let best: number | null = null
  for (let k = -3; k <= 3; k++) {
    const shift = base + k * synodic
    const at = launchTime + shift
    if (at < start.launchWindow[0] - 1e-9 || at > start.launchWindow[1] + 1e-9) continue
    if (best === null || Math.abs(shift) < Math.abs(best)) best = shift
  }
  return best
}

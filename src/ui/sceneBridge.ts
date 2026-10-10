import type { Scene } from '../game/rendering/scene'

/** A point on the map the tutorial can point at (screen px). */
export interface MapAnchor {
  x: number
  y: number
  r: number
  /** direction to drag in (unit vector, screen space), for the handle */
  dir?: { x: number; y: number }
}

export type MapAnchorKey = 'home' | 'target' | 'helper' | 'handle' | 'ship' | 'path'

/** Lets HUD buttons talk to the canvas scene without routing camera state through React. */
export const sceneBridge: {
  scene: Scene | null
  /** set by GameCanvas: re-frames the camera for the current screen */
  refit: () => void
  /** set by GameCanvas: centres on the ship / launch point */
  focusShip: () => void
  /** set by GameCanvas: where a map thing is on screen right now */
  anchor: (key: MapAnchorKey) => MapAnchor | null
} = {
  scene: null,
  refit: () => {},
  focusShip: () => {},
  anchor: () => null,
}

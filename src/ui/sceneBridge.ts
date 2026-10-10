import type { Scene } from '../game/rendering/scene'

/** Lets HUD buttons talk to the canvas scene without routing camera state through React. */
export const sceneBridge: {
  scene: Scene | null
  /** set by GameCanvas: re-frames the camera for the current screen */
  refit: () => void
  /** set by GameCanvas: centres on the ship / launch point */
  focusShip: () => void
} = {
  scene: null,
  refit: () => {},
  focusShip: () => {},
}

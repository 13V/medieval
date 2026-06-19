// ============================================================================
// postfx.js — Post-processing: bloom + output pass via EffectComposer.
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * createPostFX — build an EffectComposer with subtle bloom.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene}         scene
 * @param {THREE.Camera}        camera
 * @returns {{ composer: EffectComposer, setSize: (w: number, h: number) => void }}
 */
export function createPostFX(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);

  // 1. Standard scene render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 2. Subtle bloom — only bright emissive/FX geometry glows.
  //    Low strength + high threshold keeps gameplay art clean.
  const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
  const bloom = new UnrealBloomPass(resolution, 0.4, 0.5, 0.85);
  composer.addPass(bloom);

  // 3. OutputPass handles tone-mapping → sRGB conversion at the end of the chain.
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  /**
   * Resize all passes that need explicit size updates.
   * @param {number} w
   * @param {number} h
   */
  function setSize(w, h) {
    composer.setSize(w, h);
    bloom.setSize(w, h);
  }

  return { composer, setSize };
}

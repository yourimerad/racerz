import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { THREE } from "./core";

// The picture's last steps, in linear HDR: a bloom (the sun, lava, lamps, flames and bright snow glow softly), a vignette and a light colour
// grade (contrast, saturation, warmth), then the renderer's tone mapping and sRGB output. Only at the best quality level: a slower device
// (or a phone) draws straight to the screen as before.

export type PostLook = {
  /** Bloom: strength, radius (0..1), luminance threshold (linear, before tone mapping). */
  bloom: number;
  radius: number;
  threshold: number;
  /** 0 none .. 1 strong. */
  vignette: number;
  /** 1 = unchanged. */
  saturation: number;
  contrast: number;
  /** Tint multiplied in (white = none). */
  tint: string;
};

const GRADE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, vignette: { value: 0.2 }, saturation: { value: 1 }, contrast: { value: 1 }, tint: { value: new THREE.Color("#ffffff") } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette; uniform float saturation; uniform float contrast; uniform vec3 tint; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 rgb = c.rgb * tint;
      float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
      rgb = mix(vec3(l), rgb, saturation);
      rgb = (rgb - 0.18) * contrast + 0.18; // pivot on mid grey (linear)
      vec2 q = vUv - 0.5;
      rgb *= 1.0 - vignette * smoothstep(0.35, 0.95, length(q * vec2(1.15, 1.0)));
      gl_FragColor = vec4(max(rgb, 0.0), c.a);
    }`,
};

export class Post {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private output: OutputPass;
  private target: THREE.WebGLRenderTarget;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number, pixelRatio: number) {
    // A half-float target (HDR: the glow needs values over 1) with MSAA where the GPU has it.
    this.target = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), { type: THREE.HalfFloatType, samples: pixelRatio < 1.75 ? 4 : 0 });
    this.composer = new EffectComposer(renderer, this.target);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.5, 1.2);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
  }

  setLook(l: PostLook) {
    this.bloom.strength = l.bloom;
    this.bloom.radius = l.radius;
    this.bloom.threshold = l.threshold;
    const u = this.grade.uniforms;
    u.vignette.value = l.vignette;
    u.saturation.value = l.saturation;
    u.contrast.value = l.contrast;
    u.tint.value.set(l.tint);
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(dt: number) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
    this.grade.dispose();
    this.output.dispose();
    this.target.dispose();
  }
}

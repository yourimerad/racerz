import { type Disposer, THREE } from "./core";

/**
 * What the paint, glass and chrome reflect: a sky gradient in the mode's own colours (the horizon is the fog's), a dark ground, a bright sun
 * disc and a few soft boxes for the long highlights that make a car's flanks read as curved. Rendered once into a prefiltered cube (PMREM) the
 * materials use as `envMap`; the cars reflect their surroundings, the desert's orange horizon or the volcano's red glow.
 */
export function makeEnvironment(renderer: THREE.WebGLRenderer, d: Disposer, top: string, mid: string, horizon: string, ground: string, sunDir: THREE.Vector3): THREE.Texture {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, horizon: { value: new THREE.Color(horizon) }, ground: { value: new THREE.Color(ground) } },
      vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 ground; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c;
          if (h >= 0.0) { c = mix(horizon, mid, smoothstep(0.0, 0.25, h)); c = mix(c, top, smoothstep(0.2, 0.9, h)); }
          else { c = mix(horizon * 0.6 + ground * 0.4, ground * 0.5, smoothstep(0.0, 0.5, -h)); }
          gl_FragColor = vec4(c * 1.15, 1.0); }`,
    }),
  );
  scene.add(sky);
  const hdr = (v: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v), side: THREE.DoubleSide });
  const face = (m: THREE.Mesh, x: number, y: number, z: number) => {
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  face(new THREE.Mesh(new THREE.PlaneGeometry(26, 9), hdr(5)), -8, 30, -6); // overhead soft box
  face(new THREE.Mesh(new THREE.PlaneGeometry(4, 22), hdr(3.2)), 36, 12, 4); // long strips either side
  face(new THREE.Mesh(new THREE.PlaneGeometry(4, 22), hdr(3.2)), -36, 12, -10);
  face(new THREE.Mesh(new THREE.PlaneGeometry(14, 3), hdr(2.2)), 0, 5, -38); // a low band behind
  const sun = new THREE.Mesh(new THREE.CircleGeometry(3.2, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(16, 14, 10), side: THREE.DoubleSide }));
  const s = sunDir.clone().normalize().multiplyScalar(48);
  face(sun, s.x, s.y, s.z);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.025);
  pm.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  d.add(rt);
  return rt.texture;
}

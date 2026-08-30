import * as THREE from "three";
import { ParticleSimulator } from "../simulator";
const VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute float aOpacity;
  attribute vec3 aColor;
  uniform float uPixelScale;
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    vColor = aColor;
    vOpacity = aOpacity;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPixelScale * aSize / max(-mv.z, 0.001);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = smoothstep(0.5, 0.32, d) * vOpacity;
    if (a <= 0.0) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;
/**
 * A live three.js particle effect: a {@link THREE.Points} cloud of soft round
 * billboards driven by a {@link ParticleSimulator}. The particle analogue of
 * `@test-cabinet/voxel-runtime`'s `VoxelRig` — but where a rig is *posed* from decoded
 * geometry, a system is *simulated* from its definition, so {@link update} steps the
 * simulation forward rather than sampling a clip.
 *
 * Add {@link ParticleSystemPlayer.points} to your scene. Each {@link update} steps the
 * simulator and rewrites the point cloud's per-particle position, color, size, and
 * opacity attributes from the freshly simulated state. The system's `loop` flag is
 * honoured by the simulator; call {@link reset} to replay a one-shot from the start.
 */
export class ParticleSystemPlayer {
    /** The scene node to add to your three.js scene. */
    points;
    /** The underlying pure simulator, exposed for inspection (live count, clock). */
    simulator;
    geometry;
    material;
    capacity;
    constructor(system, opts = {}) {
        this.simulator = new ParticleSimulator(system, { seed: opts.seed });
        this.capacity = Math.max(opts.capacity ?? 4096, 1);
        const extent = Math.max(system.field.width, system.field.height, system.field.depth ?? 0, 1);
        const pixelScale = opts.pixelScale ?? extent * 6;
        this.material = new THREE.ShaderMaterial({
            uniforms: { uPixelScale: { value: pixelScale } },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            blending: opts.blending ?? THREE.AdditiveBlending,
        });
        this.geometry = this.allocate(this.capacity);
        this.points = new THREE.Points(this.geometry, this.material);
        this.points.name = "particle-system";
        this.points.frustumCulled = false;
        this.sync();
    }
    /** Advance the effect by `dtSeconds` and rewrite the GPU buffers from the new state. */
    update(dtSeconds) {
        this.simulator.step(dtSeconds * 1000);
        this.sync();
    }
    /** Restart the effect from the beginning (replay a one-shot) and re-sync. */
    reset() {
        this.simulator.reset();
        this.sync();
    }
    /** Release GPU geometry and the material, and detach the point cloud. */
    dispose() {
        this.geometry.dispose();
        this.material.dispose();
        this.points.removeFromParent();
    }
    allocate(capacity) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute("aOpacity", new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
        return geometry;
    }
    /** Rewrite the point-cloud attributes from the simulator's captured particles. */
    sync() {
        const particles = this.simulator.capture();
        if (particles.length > this.capacity) {
            // Grow to the next power of two past the live count, and swap the geometry.
            this.capacity = 1 << Math.ceil(Math.log2(particles.length));
            const old = this.geometry;
            this.geometry = this.allocate(this.capacity);
            this.points.geometry = this.geometry;
            old.dispose();
        }
        const pos = this.geometry.getAttribute("position");
        const col = this.geometry.getAttribute("aColor");
        const size = this.geometry.getAttribute("aSize");
        const opacity = this.geometry.getAttribute("aOpacity");
        const posArr = pos.array;
        const colArr = col.array;
        const sizeArr = size.array;
        const opArr = opacity.array;
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            posArr[i * 3] = p.position[0];
            posArr[i * 3 + 1] = p.position[1];
            posArr[i * 3 + 2] = p.position[2];
            colArr[i * 3] = p.color[0];
            colArr[i * 3 + 1] = p.color[1];
            colArr[i * 3 + 2] = p.color[2];
            sizeArr[i] = p.size;
            opArr[i] = p.opacity;
        }
        this.geometry.setDrawRange(0, particles.length);
        pos.needsUpdate = true;
        col.needsUpdate = true;
        size.needsUpdate = true;
        opacity.needsUpdate = true;
    }
}
//# sourceMappingURL=ParticleSystemPlayer.js.map
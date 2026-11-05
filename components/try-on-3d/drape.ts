import * as THREE from "three";

/**
 * Cloth draping with XPBD (extended position-based dynamics), after Matthias
 * Müller's "Ten Minute Physics" cloth tutorial and Macklin et al. 2016.
 *
 * Every garment vertex is a particle. Each step:
 *   1. gravity moves the particles (explicit prediction),
 *   2. edge constraints keep the fabric from stretching,
 *   3. bending constraints (across each pair of triangles) keep folds soft but not limp,
 *   4. the mannequin's skin pushes particles back out, with friction.
 * The body stands still, so a garment only needs simulating until it settles
 * (about a second and a half), after which the result is kept.
 */

export interface BodySurface {
  /** World positions and normals of every body vertex, with the current morphs and skin applied. */
  pos: Float32Array;
  nrm: Float32Array;
  /** Vertex neighbours, for walking to the nearest skin point cheaply. */
  adjacency: Uint32Array[];
}

/** Snapshot of the morphed, skinned body in world space, for collisions. */
export function bodySurface(body: THREE.SkinnedMesh): BodySurface {
  const count = body.geometry.getAttribute("position").count;
  const pos = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  body.updateWorldMatrix(true, false);
  for (let i = 0; i < count; i++) {
    body.getVertexPosition(i, v).applyMatrix4(body.matrixWorld);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  // The whole body's triangles: the fitting room hides skin under worn clothes by dropping
  // triangles from the drawn index, but the cloth must still collide with that skin.
  const full = (body.userData.fullIndex as ArrayLike<number> | undefined) ?? body.geometry.getIndex()!.array;
  const index = new THREE.BufferAttribute(Uint32Array.from(full), 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const nrm = new Float32Array((geo.getAttribute("normal") as THREE.BufferAttribute).array);
  // Recomputed normals follow the triangle winding, which may face inward; the exported
  // normals are known to face out, so use them to orient (the recomputed ones follow morphs).
  const exported = body.geometry.getAttribute("normal");
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(exported, i);
    if (v.x * nrm[i * 3] + v.y * nrm[i * 3 + 1] + v.z * nrm[i * 3 + 2] < 0) {
      nrm[i * 3] *= -1; nrm[i * 3 + 1] *= -1; nrm[i * 3 + 2] *= -1;
    }
  }
  geo.dispose();

  const sets: Set<number>[] = Array.from({ length: count }, () => new Set());
  for (let f = 0; f < index.count; f += 3) {
    const a = index.getX(f), b = index.getX(f + 1), c = index.getX(f + 2);
    sets[a].add(b); sets[a].add(c);
    sets[b].add(a); sets[b].add(c);
    sets[c].add(a); sets[c].add(b);
  }
  return { pos, nrm, adjacency: sets.map((s) => Uint32Array.from(s)) };
}

export interface ClothOptions {
  /**
   * Garment faces. Without `start`, these are body vertex indices (a shell cut from the
   * skin); with `start`, they index the garment's own vertices.
   */
  faces: ArrayLike<number>;
  /**
   * A real garment's own starting vertices (world space, already fitted to the body by
   * MPFB). Physics then only adds gravity, hang and folds on top of the fit.
   */
  start?: Float32Array;
  /** Particles held in place (inverse mass 0), e.g. a waistband gripping the waist. */
  pinned?: (particle: number) => boolean;
  /**
   * Soft spring from each particle back to where it started (the MPFB fit), as an XPBD
   * compliance: small keeps a fitted garment's shape (jeans), large lets a loose one
   * hang and fold freely (a dress). Omit for no attachment.
   */
  fitCompliance?: number;
  /** Where each garment vertex starts: body position + normal * ease. */
  ease: number;
  /** How far the garment is lifted before it falls (metres). */
  drop: number;
  /** Skin-to-cloth gap kept by the collision, per body vertex (shorts underneath need more). */
  thickness: (bodyVertex: number) => number;
  /**
   * Which body vertices this garment can touch. A top must ignore the hands and
   * forearms hanging beside the hips, or its hem gets shoved outward by them.
   */
  touches: (bodyVertex: number) => boolean;
  /** XPBD compliance: 0 = inextensible. Bending is far softer than stretching. */
  stretchCompliance?: number;
  bendCompliance?: number;
  friction?: number;
}

const GRAVITY = -9.81;
const MAX_SPEED = 2;

export class ClothSim {
  /** Garment-local particle → body vertex it was cut from. */
  readonly source: Uint32Array;
  /** Body vertex → garment particle, or -1. */
  readonly particleOf: Int32Array;
  readonly pos: Float32Array;
  readonly faces: Uint32Array;
  private prev: Float32Array;
  private vel: Float32Array;
  private edges: Uint32Array;
  private edgeRest: Float32Array;
  private bends: Uint32Array;
  private bendRest: Float32Array;
  private near: Uint32Array;
  private thick: Float32Array;
  private touches: Uint8Array;
  private invMass: Float32Array;
  private fit: Float32Array | null;
  private time = 0;
  readonly duration = 1.6;

  constructor(private body: BodySurface, private opts: ClothOptions) {
    const bodyCount = body.pos.length / 3;
    this.touches = new Uint8Array(bodyCount);
    for (let b = 0; b < bodyCount; b++) this.touches[b] = opts.touches(b) ? 1 : 0;

    let n: number;
    if (opts.start) {
      // A real garment: its own vertices, starting where MPFB fitted them.
      n = opts.start.length / 3;
      this.source = Uint32Array.from({ length: n }, (_, i) => i);
      this.particleOf = Int32Array.from({ length: n }, (_, i) => i);
      this.faces = Uint32Array.from(opts.faces);
      this.pos = opts.start.slice();
      for (let i = 0; i < n; i++) this.pos[i * 3 + 1] += opts.drop;
      this.near = nearestTouchable(body, this.touches, this.pos);
    } else {
      // A shell cut from the skin: particles are body vertices pushed out by the ease.
      this.particleOf = new Int32Array(bodyCount).fill(-1);
      const source: number[] = [];
      for (let i = 0; i < opts.faces.length; i++) {
        const b = opts.faces[i];
        if (this.particleOf[b] < 0) { this.particleOf[b] = source.length; source.push(b); }
      }
      this.source = Uint32Array.from(source);
      this.faces = Uint32Array.from(Array.from(opts.faces, (b) => this.particleOf[b]));
      n = source.length;
      this.pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const b = source[i];
        for (let k = 0; k < 3; k++) this.pos[i * 3 + k] = body.pos[b * 3 + k] + body.nrm[b * 3 + k] * opts.ease;
        this.pos[i * 3 + 1] += opts.drop;
      }
      this.near = this.source.slice();
    }
    this.vel = new Float32Array(n * 3);
    this.thick = new Float32Array(n);
    for (let i = 0; i < n; i++) this.thick[i] = opts.thickness(this.near[i]);
    this.invMass = new Float32Array(n).fill(1);
    if (opts.pinned) for (let i = 0; i < n; i++) if (opts.pinned(i)) this.invMass[i] = 0;
    this.prev = this.pos.slice();
    this.fit = opts.start && opts.fitCompliance !== undefined ? this.pos.slice() : null;

    // Stretch: every triangle edge. Bending: the two far corners of each pair of triangles sharing an edge.
    const edgeKey = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
    const edgeTri = new Map<number, number[]>();
    for (let f = 0; f < this.faces.length; f += 3) {
      for (let k = 0; k < 3; k++) {
        const a = this.faces[f + k], b = this.faces[f + ((k + 1) % 3)], c = this.faces[f + ((k + 2) % 3)];
        const key = edgeKey(a, b);
        const list = edgeTri.get(key);
        if (list) list.push(c); else edgeTri.set(key, [a, b, c]);
      }
    }
    const edges: number[] = [];
    const bends: number[] = [];
    for (const [a, b, c, d] of edgeTri.values()) {
      edges.push(a, b);
      if (d !== undefined) bends.push(c, d);
    }
    this.edges = Uint32Array.from(edges);
    this.bends = Uint32Array.from(bends);
    this.edgeRest = this.restLengths(this.edges);
    this.bendRest = this.restLengths(this.bends);
  }

  get settled() {
    return this.time >= this.duration;
  }

  private restLengths(pairs: Uint32Array) {
    const out = new Float32Array(pairs.length / 2);
    for (let i = 0; i < out.length; i++) {
      const a = pairs[i * 2] * 3, b = pairs[i * 2 + 1] * 3;
      out[i] = Math.hypot(this.pos[a] - this.pos[b], this.pos[a + 1] - this.pos[b + 1], this.pos[a + 2] - this.pos[b + 2]);
    }
    return out;
  }

  /** Advances one frame of 1/60 s in `substeps` small steps (small steps beat many iterations). */
  step(substeps = 20) {
    if (this.settled) return;
    const dt = 1 / 60 / substeps;
    const { pos, prev, vel } = this;
    const n = pos.length / 3;
    for (let s = 0; s < substeps; s++) {
      for (let i = 0; i < n * 3; i++) prev[i] = pos[i];
      for (let i = 0; i < n; i++) {
        if (!this.invMass[i]) continue;
        vel[i * 3 + 1] += GRAVITY * dt;
        for (let k = 0; k < 3; k++) pos[i * 3 + k] += vel[i * 3 + k] * dt;
      }
      this.solveDistances(this.edges, this.edgeRest, this.opts.stretchCompliance ?? 0, dt);
      this.solveDistances(this.bends, this.bendRest, this.opts.bendCompliance ?? 2e-4, dt);
      this.pullToFit(dt);
      this.collide();
      // Velocity from the corrected positions, with a little air damping and a speed
      // limit (cloth settling onto a body never needs more than ~2 m/s).
      for (let i = 0; i < n; i++) {
        const p = i * 3;
        let vx = ((pos[p] - prev[p]) / dt) * 0.99, vy = ((pos[p + 1] - prev[p + 1]) / dt) * 0.99, vz = ((pos[p + 2] - prev[p + 2]) / dt) * 0.99;
        const speed = Math.hypot(vx, vy, vz);
        if (speed > MAX_SPEED) { const k = MAX_SPEED / speed; vx *= k; vy *= k; vz *= k; }
        vel[p] = vx; vel[p + 1] = vy; vel[p + 2] = vz;
      }
    }
    this.time += 1 / 60;
    // Stop dead once settled; the shape is kept from here on.
    if (this.settled) this.vel.fill(0);
  }

  private solveDistances(pairs: Uint32Array, rest: Float32Array, compliance: number, dt: number) {
    const pos = this.pos;
    const w = this.invMass;
    const alpha = compliance / (dt * dt);
    for (let i = 0; i < rest.length; i++) {
      const ia = pairs[i * 2], ib = pairs[i * 2 + 1];
      const wa = w[ia], wb = w[ib];
      if (wa + wb === 0) continue;
      const a = ia * 3, b = ib * 3;
      const dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-9) continue;
      // Split by inverse mass, so a pinned end stays put and the free end takes it all.
      const c = (len - rest[i]) / (len * (wa + wb + alpha));
      pos[a] -= dx * c * wa; pos[a + 1] -= dy * c * wa; pos[a + 2] -= dz * c * wa;
      pos[b] += dx * c * wb; pos[b + 1] += dy * c * wb; pos[b + 2] += dz * c * wb;
    }
  }

  /** XPBD attachment to the fitted shape: each particle is drawn part of the way back. */
  private pullToFit(dt: number) {
    const fit = this.fit;
    if (!fit) return;
    const k = 1 / (1 + (this.opts.fitCompliance ?? 0) / (dt * dt));
    const pos = this.pos;
    for (let i = 0; i < this.invMass.length; i++) {
      if (!this.invMass[i]) continue;
      for (let c = 0; c < 3; c++) pos[i * 3 + c] += (fit[i * 3 + c] - pos[i * 3 + c]) * k;
    }
  }

  /** Pushes particles out of the skin along its normal, then applies friction to the sliding part. */
  private collide() {
    const { pos, prev, near, thick, touches } = this;
    const bp = this.body.pos, bn = this.body.nrm, adj = this.body.adjacency;
    const friction = this.opts.friction ?? 0.4;
    for (let i = 0; i < near.length; i++) {
      if (!this.invMass[i]) continue;
      const p = i * 3;
      // Walk downhill over the skin mesh to the nearest vertex; it's only ever a few steps away.
      let b = near[i];
      let best = dist2(pos, p, bp, b * 3);
      for (let walk = 0; walk < 8; walk++) {
        let moved = false;
        for (const nb of adj[b]) {
          if (!touches[nb]) continue;
          const d = dist2(pos, p, bp, nb * 3);
          if (d < best) { best = d; b = nb; moved = true; }
        }
        if (!moved) break;
      }
      near[i] = b;
      const q = b * 3;
      const depth = (pos[p] - bp[q]) * bn[q] + (pos[p + 1] - bp[q + 1]) * bn[q + 1] + (pos[p + 2] - bp[q + 2]) * bn[q + 2];
      const gap = thick[i];
      if (depth >= gap) continue;
      const push = gap - depth;
      pos[p] += bn[q] * push; pos[p + 1] += bn[q + 1] * push; pos[p + 2] += bn[q + 2] * push;
      // Friction: cancel part of this step's motion along the skin.
      const mx = pos[p] - prev[p], my = pos[p + 1] - prev[p + 1], mz = pos[p + 2] - prev[p + 2];
      const along = mx * bn[q] + my * bn[q + 1] + mz * bn[q + 2];
      pos[p] -= (mx - along * bn[q]) * friction;
      pos[p + 1] -= (my - along * bn[q + 1]) * friction;
      pos[p + 2] -= (mz - along * bn[q + 2]) * friction;
    }
  }
}

/** Nearest touchable skin vertex for each particle, via a coarse grid (3 cm cells). */
function nearestTouchable(body: BodySurface, touches: Uint8Array, pos: Float32Array) {
  const cell = 0.03;
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map<string, number[]>();
  for (let b = 0; b < body.pos.length / 3; b++) {
    if (!touches[b]) continue;
    const k = key(body.pos[b * 3], body.pos[b * 3 + 1], body.pos[b * 3 + 2]);
    const list = grid.get(k);
    if (list) list.push(b); else grid.set(k, [b]);
  }
  const n = pos.length / 3;
  const near = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    let best = -1, bestD = Infinity;
    // Widen the search until something is found (cloth can sit a few cells off the skin).
    for (let r = 1; r <= 4 && best < 0; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        const list = grid.get(key(x + dx * cell, y + dy * cell, z + dz * cell));
        if (!list) continue;
        for (const b of list) {
          const d = dist2(pos, i * 3, body.pos, b * 3);
          if (d < bestD) { bestD = d; best = b; }
        }
      }
    }
    near[i] = best < 0 ? 0 : best;
  }
  return near;
}

function dist2(a: Float32Array, i: number, b: Float32Array, j: number) {
  const x = a[i] - b[j], y = a[i + 1] - b[j + 1], z = a[i + 2] - b[j + 2];
  return x * x + y * y + z * z;
}

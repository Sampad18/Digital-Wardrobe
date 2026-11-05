"use client";

import * as React from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, OrbitControls, useTexture } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { BodyMeasurements } from "@/components/try-on/body";
import type { Garment } from "@/components/try-on/garments";
import {
  body3d, frontAt, grow, loftGeometry, mirrorRings, pointAt, sliceSections, smoothSections, tAtHeight, tubeGeometry,
  type Body3D, type Section,
} from "./body3d";
import { fabricFor, ribFor } from "./fabric";
import { DEFAULT_APPEARANCE, type Appearance } from "./appearance";
import { RealMannequin } from "./mannequin";

/** Circumference ease in cm, matching the 2D renderer; turned into an offset from the skin. */
const EASE_CM = { slim: 2, regular: 5, relaxed: 10 } as const;
const offsetFor = (g: Garment) => 0.004 + EASE_CM[g.fit] / (2 * Math.PI) / 100;

export type View = "front" | "side" | "back";
const AZIMUTH: Record<View, number> = { front: 0, side: Math.PI / 2, back: Math.PI };

/** Frees memoised geometries and materials once they're replaced or unmounted. */
function useDisposeAll(items: { dispose(): void }[]) {
  React.useEffect(() => () => items.forEach((v) => v.dispose()), [items]);
}

function Ellipsoid({ position, scale, rotation, material }: { position: THREE.Vector3Tuple; scale: THREE.Vector3Tuple; rotation?: THREE.Euler | THREE.Quaternion; material: THREE.Material }) {
  const quaternion = rotation instanceof THREE.Quaternion ? rotation : rotation ? new THREE.Quaternion().setFromEuler(rotation) : undefined;
  return (
    <mesh position={position} scale={scale} quaternion={quaternion} material={material} castShadow receiveShadow>
      <sphereGeometry args={[1, 48, 32]} />
    </mesh>
  );
}

function Mannequin({ k, skin }: { k: Body3D; skin: string }) {
  const skinGeos = React.useMemo(
    () => [
      loftGeometry(smoothSections(k.torso)),
      tubeGeometry(k.arm, { capStart: true, capEnd: true }),
      tubeGeometry(mirrorRings(k.arm), { capStart: true, capEnd: true }),
      tubeGeometry(k.leg, { capStart: true, capEnd: true }),
      tubeGeometry(mirrorRings(k.leg), { capStart: true, capEnd: true }),
    ],
    [k],
  );
  useDisposeAll(skinGeos);
  const skinMats = React.useMemo(() => [new THREE.MeshStandardMaterial({ color: skin, roughness: 0.55, metalness: 0 })], [skin]);
  const mat = skinMats[0];
  useDisposeAll(skinMats);

  const { headH, chinY } = k;
  const hands = ([1, -1] as const).map((side) => {
    const rings = side === 1 ? k.arm : mirrorRings(k.arm);
    const { p, tangent } = pointAt(rings, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), tangent);
    const c = p.clone().addScaledVector(tangent, k.handLen * 0.42);
    const thumb = p.clone().addScaledVector(tangent, k.handLen * 0.25).add(new THREE.Vector3(side * 0.03, 0, 0.012));
    const thumbQ = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side * 0.45)));
    return { c, q, thumb, thumbQ, side };
  });
  const ankleX = k.leg[k.leg.length - 1].p.x;

  return (
    <group>
      {skinGeos.map((geo, i) => (
        <mesh key={i} geometry={geo} material={mat} castShadow receiveShadow />
      ))}
      {/* Head: cranium, jaw and a hint of nose. A mannequin keeps the face blank. */}
      <Ellipsoid position={[0, chinY + headH * 0.55, -0.004]} scale={[headH * 0.37, headH * 0.5, headH * 0.44]} material={mat} />
      <Ellipsoid position={[0, chinY + headH * 0.2, headH * 0.13]} scale={[headH * 0.27, headH * 0.22, headH * 0.27]} material={mat} />
      <Ellipsoid position={[0, chinY + headH * 0.42, headH * 0.42]} scale={[headH * 0.06, headH * 0.11, headH * 0.07]} material={mat} />
      {hands.map(({ c, q, thumb, thumbQ, side }) => (
        <group key={side}>
          <Ellipsoid position={c.toArray()} scale={[0.04, k.handLen * 0.5, 0.017]} rotation={q} material={mat} />
          <Ellipsoid position={thumb.toArray()} scale={[0.012, 0.034, 0.012]} rotation={thumbQ} material={mat} />
        </group>
      ))}
      {[1, -1].map((side) => (
        <Ellipsoid key={side} position={[side * ankleX, 0.032, 0.045]} scale={[0.046, 0.033, 0.128]} material={mat} />
      ))}
    </group>
  );
}

function fabricMaterial(map: THREE.Texture) {
  return new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
}

/** Section of the (grown) torso at height y, for placing details on the chest. */
function sectionAt(k: Body3D, y: number, d: number): Section {
  return grow(sliceSections(smoothSections(k.torso), y, y + 0.001), d)[0];
}

function Logo({ src, widthCm, k, d }: { src: string; widthCm: number; k: Body3D; d: number }) {
  const tex = useTexture(src, (t) => { t.colorSpace = THREE.SRGBColorSpace; });
  const img = tex.image as { width: number; height: number };
  const w = widthCm / 100;
  const h = (w * img.height) / img.width;
  // Wearer's left chest (+x), as in the 2D studio.
  const x = k.chestHalf * 0.18 + w / 2;
  const y = k.shoulderY - k.headH * 0.32 - h / 2;
  const { z, slope } = frontAt(sectionAt(k, y, d), x);
  return (
    <mesh position={[x, y, z + 0.0015]} rotation={[0, -Math.atan(slope), 0]}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial map={tex} transparent roughness={0.8} alphaTest={0.05} />
    </mesh>
  );
}

function Top3D({ g, k, d }: { g: Garment; k: Body3D; d: number }) {
  const samples = React.useMemo(() => smoothSections(k.torso), [k]);
  const hemY = k.hipY - k.headH * (g.length === "low-hip" ? 0.48 : 0.3);
  const topY = k.torso[g.neckline === "boat" ? k.trapezius : k.neckBase].y - 0.004;
  const relaxed = g.fit === "relaxed";
  const tEnd = g.sleeve === "long" ? 0.97 : relaxed ? 0.47 : 0.42;
  const sleeveExtra = (t: number) => 0.007 + d * 0.6 + (relaxed ? 0.016 : g.sleeve === "long" ? 0.002 : 0.006) * t;

  const geos = React.useMemo(() => {
    const neck = grow(sliceSections(samples, topY - 0.001, topY), d)[1];
    const neckTrim: Section[] =
      g.neckline === "polo-collar"
        ? [neck, { ...neck, y: topY + 0.022, a: neck.a + 0.003, bf: neck.bf + 0.003, bb: neck.bb + 0.005 }, { y: topY + 0.002, a: neck.a + 0.016, bf: neck.bf + 0.018, bb: neck.bb + 0.02 }]
        : g.neckline === "crew"
          ? [{ ...neck, y: topY - 0.012, a: neck.a + 0.001, bf: neck.bf + 0.001, bb: neck.bb + 0.001 }, { ...neck, y: topY + 0.002 }]
          : [];
    const sleeve = (rings: typeof k.arm) => tubeGeometry(rings, { t1: tEnd, extra: sleeveExtra });
    const cuff = (rings: typeof k.arm) => tubeGeometry(rings, { t0: tEnd - (g.sleeve === "long" ? 0.05 : 0.028), t1: tEnd, extra: () => sleeveExtra(1) + 0.0015 });
    return [
      loftGeometry(grow(sliceSections(samples, hemY, topY), d)),
      sleeve(k.arm), sleeve(mirrorRings(k.arm)),
      cuff(k.arm), cuff(mirrorRings(k.arm)),
      ...(neckTrim.length ? [loftGeometry(neckTrim)] : []),
    ];
  }, [k, g, d]);
  const mats = React.useMemo(() => [fabricMaterial(fabricFor(g)), fabricMaterial(ribFor(g.trim))], [g]);
  useDisposeAll(geos);
  useDisposeAll(mats);
  const [cloth, rib] = mats;
  const [shell, sleeveL, sleeveR, cuffL, cuffR, neckTrim] = geos;

  const placketTop = topY - 0.004;
  const placketH = k.headH * 0.5;
  const placketZ = (y: number) => frontAt(sectionAt(k, y, d), 0).z;

  return (
    <group>
      {[shell, sleeveL, sleeveR].map((geo, i) => <mesh key={i} geometry={geo} material={cloth} castShadow receiveShadow />)}
      {[cuffL, cuffR].map((geo, i) => <mesh key={i} geometry={geo} material={rib} castShadow />)}
      {neckTrim && <mesh geometry={neckTrim} material={g.neckline === "polo-collar" ? cloth : rib} castShadow />}
      {g.neckline === "polo-collar" && (
        <group>
          <mesh position={[0, placketTop - placketH / 2, placketZ(placketTop - placketH / 2) + 0.002]} material={cloth} castShadow>
            <boxGeometry args={[0.026, placketH, 0.004]} />
          </mesh>
          {[0.3, 0.72].map((t) => {
            const y = placketTop - placketH * t;
            return (
              <mesh key={t} position={[0, y, placketZ(y) + 0.0045]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.0055, 0.0055, 0.002, 20]} />
                <meshStandardMaterial color="#C9CCD6" roughness={0.4} />
              </mesh>
            );
          })}
        </group>
      )}
      {g.logo && (
        <React.Suspense fallback={null}>
          <Logo src={g.logo.src} widthCm={g.logo.widthCm} k={k} d={d} />
        </React.Suspense>
      )}
    </group>
  );
}

function Bottom3D({ g, k, d }: { g: Garment; k: Body3D; d: number }) {
  const samples = React.useMemo(() => smoothSections(k.torso), [k]);
  const topY = k.waistY - k.headH * 0.32;
  const hemY = k.crotchY - 0.17;
  const flare = g.fit === "relaxed" ? 0.022 : g.fit === "regular" ? 0.01 : 0.003;

  const geos = React.useMemo(() => {
    const t1 = tAtHeight(k.leg, hemY);
    const leg = (rings: typeof k.leg) => tubeGeometry(rings, { t1, extra: (t) => d + 0.004 + flare * t });
    return [
      loftGeometry(grow(sliceSections(samples, samples[0].y, topY), d)),
      leg(k.leg), leg(mirrorRings(k.leg)),
      loftGeometry(grow(sliceSections(samples, topY - k.headH * 0.15, topY + 0.002), d + 0.003)),
    ];
  }, [k, g, d]);
  const mats = React.useMemo(() => [fabricMaterial(fabricFor(g)), fabricMaterial(ribFor(g.trim))], [g]);
  useDisposeAll(geos);
  useDisposeAll(mats);
  const [cloth, rib] = mats;
  const [shell, legL, legR, band] = geos;

  return (
    <group>
      {[shell, legL, legR].map((geo, i) => <mesh key={i} geometry={geo} material={cloth} castShadow receiveShadow />)}
      <mesh geometry={band} material={rib} castShadow />
    </group>
  );
}

/** Eases the camera round to the chosen view; dragging still works in between. */
function ViewRig({ view, controls }: { view: { name: View; nonce: number }; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const goal = React.useRef<number | null>(null);
  React.useEffect(() => { goal.current = AZIMUTH[view.name]; }, [view]);
  useFrame(() => {
    const c = controls.current;
    if (!c || goal.current === null) return;
    const now = c.getAzimuthalAngle();
    const diff = Math.atan2(Math.sin(goal.current - now), Math.cos(goal.current - now));
    if (Math.abs(diff) < 0.002) { goal.current = null; return; }
    c.setAzimuthalAngle(now + diff * 0.14);
    c.update();
  });
  return null;
}

/** Glides the camera between the full figure and a close-up of the face; the user can still orbit and zoom. */
function FocusRig({ focus, k, controls }: { focus: "body" | "face"; k: Body3D; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const goal = React.useRef<{ target: THREE.Vector3; distance: number } | null>(null);
  React.useEffect(() => {
    goal.current = focus === "face"
      ? { target: new THREE.Vector3(0, k.chinY + k.headH * 0.55, 0), distance: 0.85 }
      : { target: new THREE.Vector3(0, k.H * 0.53, 0), distance: 3.9 };
  }, [focus, k]);
  useFrame(({ camera }) => {
    const c = controls.current;
    const g = goal.current;
    if (!c || !g) return;
    c.target.lerp(g.target, 0.12);
    const offset = camera.position.clone().sub(c.target);
    const distance = THREE.MathUtils.lerp(offset.length(), g.distance, 0.12);
    camera.position.copy(c.target).add(offset.setLength(distance));
    c.update();
    if (c.target.distanceTo(g.target) < 0.002 && Math.abs(distance - g.distance) < 0.005) goal.current = null;
  });
  return null;
}


export interface SceneProps {
  body: BodyMeasurements;
  top: Garment | null;
  bottom: Garment | null;
  view: { name: View; nonce: number };
  spin: boolean;
  appearance?: Appearance;
  focus?: "body" | "face";
  /** Drop the top onto the body with cloth physics. */
  drape?: boolean;
}

export default function TryOnScene({ body, top, bottom, view, spin, appearance = DEFAULT_APPEARANCE, focus = "body", drape = false }: SceneProps) {
  const k = React.useMemo(() => body3d(body), [body]);
  const controls = React.useRef<OrbitControlsImpl | null>(null);
  const bottomD = bottom ? offsetFor(bottom) : 0;
  // A tucked-out top sits over the waistband, so it must clear the bottom's ease.
  const topD = top ? Math.max(offsetFor(top), bottom ? bottomD + 0.007 : 0) : 0;

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, k.H * 0.56, 3.9], fov: 26 }} gl={{ antialias: true }}>
      <color attach="background" args={["#F3F1EC"]} />
      <hemisphereLight args={["#ffffff", "#d9d3c6", 1.1]} />
      <directionalLight position={[1.6, 3.2, 2.6]} intensity={1.7} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}>
        <orthographicCamera attach="shadow-camera" args={[-1.2, 1.2, 2.2, -0.2, 0.1, 8]} />
      </directionalLight>
      <directionalLight position={[-2.2, 1.8, -1.6]} intensity={0.55} />
      <group>
        {/* The hand-built body and its garments stand in until the MPFB model has downloaded. */}
        <React.Suspense
          fallback={
            <>
              <Mannequin k={k} skin={body.skin} />
              {bottom && <Bottom3D g={bottom} k={k} d={bottomD} />}
              {top && <Top3D g={top} k={k} d={topD} />}
            </>
          }
        >
          <RealMannequin appearance={appearance} body={body} top={top} bottom={bottom} drape={drape} />
        </React.Suspense>
      </group>
      <ContactShadows position={[0, 0.001, 0]} opacity={0.38} scale={2.4} blur={2.6} far={1.2} />
      <OrbitControls
        ref={controls}
        target={[0, k.H * 0.53, 0]}
        enablePan={false}
        minDistance={0.5}
        maxDistance={5.5}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2 + 0.05}
        autoRotate={spin}
        autoRotateSpeed={1.6}
        enableDamping
      />
      <ViewRig view={view} controls={controls} />
      <FocusRig focus={focus} k={k} controls={controls} />
    </Canvas>
  );
}

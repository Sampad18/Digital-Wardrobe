// Writes the shipped mannequin's body vertex positions, in its own (meshopt-reordered) order,
// to tools/mpfb/body-order.f32, so garment batches can write their covered-skin masks in that
// order. Run by build.sh after a full build:  node decode_body_order.mjs mannequin.glb body-order.f32
// Needs @gltf-transform/core, @gltf-transform/extensions and meshoptimizer (build.sh installs
// them into tools/mpfb/.node).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import fs from "node:fs";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const node = doc.getRoot().listNodes().find((n) => n.getName() === "Body" && n.getMesh());
const acc = node.getMesh().listPrimitives()[0].getAttribute("POSITION");
const out = new Float32Array(acc.getCount() * 3);
const el = [];
for (let i = 0; i < acc.getCount(); i++) { acc.getElement(i, el); out.set(el, i * 3); }
fs.writeFileSync(process.argv[3], Buffer.from(out.buffer));
console.log(acc.getCount(), acc.getComponentType(), acc.getNormalized(), el);

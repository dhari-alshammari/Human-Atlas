// Smaller, faster model files (2026-11-22, owner request: the model opened slowly, the organs much more slowly).
//
// Reads the male model (public/models/atlas.json and its body-*.bin chunks) and writes it again in a compact form:
// - positions as 16-bit numbers inside each part's own box (a 50 cm part keeps 8 µm steps, far below what a screen
//   shows), normals as 8-bit directions; the same triangles, nothing simplified further;
// - each part's vertices and triangles reordered and compressed with meshoptimizer's codec (the one glTF uses,
//   EXT_meshopt_compression), then gzip;
// - parts grouped by view: the muscles view first (muscles, bones, tendons, eyes and ears), then the organs, then
//   the vessels and nerves, then the rest, so the first view downloads only what it shows;
// - file names carry a content hash, so browsers may keep them for a year (vercel.json).
//
//   node scripts/pack-models.mjs            (run once after the model changes; the old body-*.bin are replaced)
import fs from 'node:fs';
import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {MeshoptEncoder} from 'meshoptimizer';

await MeshoptEncoder.ready;
const base = new URL('../public/models/', import.meta.url);
const manifestPath = new URL('atlas.json', base);
const atlas = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (atlas.format === 'meshopt-1') { console.log('atlas.json is already packed'); process.exit(0); }
const sources = atlas.chunks.map(chunk => fs.readFileSync(new URL(chunk.url.split('/').pop(), base)));

export const GROUPS = [
  ['muscular', 'skeletal', 'connective', 'sensory'],
  ['cardiac', 'respiratory', 'digestive', 'urinary', 'endocrine', 'lymphatic', 'nervous', 'brain'],
  ['arterial', 'venous'],
];
// The liver and the lungs are only vessels, ducts and airways in this source, so their vessels travel with the organs.
const ORGAN_CONCEPTS = new Set(['liver', 'left lung', 'right lung', 'heart', 'left kidney', 'right kidney', 'spleen', 'pancreas', 'stomach', 'gallbladder']);
const organVessels = new Set(atlas.concepts.filter(c => ORGAN_CONCEPTS.has(c.name.toLowerCase())).flatMap(c => c.elements));
const groupOf = (system, id) => { if (organVessels.has(id) && (system === 'arterial' || system === 'venous')) return 1; const index = GROUPS.findIndex(group => group.includes(system)); return index < 0 ? GROUPS.length : index; };
const TARGET = 1.6e6; // about 1.6 MB per file before gzip: small enough to arrive in parallel on a phone

const encoded = atlas.parts.map((part) => {
  const buffer = sources[part.chunk];
  const at = (offset, Type, length) => new Type(buffer.buffer.slice(buffer.byteOffset + offset, buffer.byteOffset + offset + length * Type.BYTES_PER_ELEMENT));
  const positions = at(part.positions, Float32Array, part.vertexCount * 3);
  const normals = at(part.normals, Int16Array, part.vertexCount * 3);
  const indices = at(part.indices, Uint32Array, part.indexCount);
  const [remap, count] = MeshoptEncoder.reorderMesh(indices, true, true);
  const [min, max] = part.bounds;
  const pos = new Uint16Array(count * 4), nor = new Int8Array(count * 4);
  for (let v = 0; v < part.vertexCount; v++) {
    const to = remap[v];
    if (to === 0xffffffff) continue;
    for (let k = 0; k < 3; k++) {
      const span = max[k] - min[k] || 1;
      pos[to * 4 + k] = Math.round(Math.min(1, Math.max(0, (positions[v * 3 + k] - min[k]) / span)) * 65535);
      nor[to * 4 + k] = Math.round(normals[v * 3 + k] / 32767 * 127);
    }
  }
  const v = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(pos.buffer), count, 8, 'ATTRIBUTES');
  const n = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(nor.buffer), count, 4, 'ATTRIBUTES');
  const i = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(indices.buffer), indices.length, 4, 'TRIANGLES');
  return { part, count, v, n, i };
});

// Files by view group, in the order of the parts inside each group.
const order = encoded.map((entry, index) => ({ entry, index, group: groupOf(entry.part.system, entry.part.id) }))
  .sort((a, b) => a.group - b.group || a.index - b.index);
const chunks = [];
let current = null;
const flush = () => {
  if (!current) return;
  const raw = Buffer.concat(current.pieces);
  const zipped = gzipSync(raw, { level: 9 });
  const hash = crypto.createHash('sha256').update(zipped).digest('hex').slice(0, 10);
  const name = `body-${current.group}-${chunks.length}-${hash}.bin.gz`;
  fs.writeFileSync(new URL(name, base), zipped);
  chunks.push({ url: `/models/${name}`, gzip: `/models/${name}`, bytes: raw.length, gzipBytes: zipped.length, group: current.group });
  current = null;
};
for (const { entry, group } of order) {
  if (current && (current.group !== group || current.size >= TARGET)) flush();
  if (!current) current = { group, pieces: [], size: 0 };
  const { part, count, v, n, i } = entry;
  const place = (bytes) => { const offset = current.size; current.pieces.push(Buffer.from(bytes)); current.size += bytes.length; const pad = (4 - (bytes.length % 4)) % 4; if (pad) { current.pieces.push(Buffer.alloc(pad)); current.size += pad; } return offset; };
  part.chunk = chunks.length;
  part.packed = { vertices: count, v: [place(v), v.length], n: [place(n), n.length], i: [place(i), i.length] };
  delete part.positions; delete part.normals; delete part.indices;
  part.vertexCount = count;
}
flush();

const before = atlas.chunks.reduce((sum, chunk) => sum + (chunk.gzipBytes || chunk.bytes), 0);
for (const chunk of atlas.chunks) for (const file of [chunk.url, chunk.gzip].filter(Boolean)) fs.rmSync(new URL(file.split('/').pop(), base), { force: true });
atlas.format = 'meshopt-1';
atlas.chunks = chunks;
fs.writeFileSync(manifestPath, JSON.stringify(atlas));
const after = chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);
const byGroup = chunks.reduce((sums, chunk) => { sums[chunk.group] = (sums[chunk.group] || 0) + chunk.gzipBytes; return sums; }, {});
console.log(`male model: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB in ${chunks.length} files`);
console.log('by view group (MB):', Object.fromEntries(Object.entries(byGroup).map(([group, bytes]) => [group, +(bytes / 1e6).toFixed(2)])));

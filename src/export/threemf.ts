/**
 * 3MF-Export.
 *
 * Ein 3MF ist ein ZIP mit einer XML-Beschreibung des Modells. Gegenueber
 * STL hat es drei Vorteile, die hier zaehlen: die Einheit Millimeter steht
 * ausdruecklich drin, mehrere Teile bleiben getrennte Objekte mit Namen,
 * und die Anordnung auf der Platte wird mitgeliefert. Bambu Studio oeffnet
 * die Datei direkt per Doppelklick.
 */

import { zipSync, strToU8 } from 'fflate';
import { Mesh } from '../geo/mesh.ts';

export interface ThreeMfObject {
  name: string;
  mesh: Mesh;
  /** Verschiebung auf der Druckplatte in mm. */
  offset?: [number, number, number];
}

export interface ThreeMfOptions {
  title?: string;
  designer?: string;
  description?: string;
}

interface IndexedMesh {
  vertices: number[];
  triangles: number[];
}

/** Fasst identische Ecken zusammen - 3MF verlangt Indexlisten. */
function indexMesh(mesh: Mesh): IndexedMesh {
  const map = new Map<string, number>();
  const vertices: number[] = [];
  const triangles: number[] = [];
  const p = mesh.positions;

  for (let i = 0; i < p.length; i += 3) {
    // Auf ein Nanometer runden: feiner als jede Druckaufloesung, aber grob
    // genug, damit Rundungsreste beim Rechnen zusammenfallen.
    const x = Math.round(p[i] * 1e6) / 1e6;
    const y = Math.round(p[i + 1] * 1e6) / 1e6;
    const z = Math.round(p[i + 2] * 1e6) / 1e6;
    const key = `${x},${y},${z}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = vertices.length / 3;
      map.set(key, idx);
      vertices.push(x, y, z);
    }
    triangles.push(idx);
  }
  return { vertices, triangles };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
}

export function buildThreeMf(objects: ThreeMfObject[], opts: ThreeMfOptions = {}): Uint8Array {
  const parts: string[] = [];
  const items: string[] = [];

  objects.forEach((obj, i) => {
    const id = i + 1;
    const { vertices, triangles } = indexMesh(obj.mesh);
    const vs: string[] = [];
    for (let k = 0; k < vertices.length; k += 3) {
      vs.push(`<vertex x="${num(vertices[k])}" y="${num(vertices[k + 1])}" z="${num(vertices[k + 2])}"/>`);
    }
    const ts: string[] = [];
    for (let k = 0; k < triangles.length; k += 3) {
      ts.push(`<triangle v1="${triangles[k]}" v2="${triangles[k + 1]}" v3="${triangles[k + 2]}"/>`);
    }
    parts.push(
      `<object id="${id}" type="model" name="${escapeXml(obj.name)}">` +
        `<mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh>` +
        `</object>`,
    );
    const [tx, ty, tz] = obj.offset ?? [0, 0, 0];
    items.push(
      `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(tx)} ${num(ty)} ${num(tz)}"/>`,
    );
  });

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="de-CH" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Application">Fidget Maker</metadata>` +
    `<metadata name="Title">${escapeXml(opts.title ?? 'Fidget')}</metadata>` +
    (opts.designer ? `<metadata name="Designer">${escapeXml(opts.designer)}</metadata>` : '') +
    (opts.description ? `<metadata name="Description">${escapeXml(opts.description)}</metadata>` : '') +
    `<resources>${parts.join('')}</resources>` +
    `<build>${items.join('')}</build>` +
    `</model>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
    },
    { level: 6 },
  );
}

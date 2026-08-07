/**
 * Ear-Clipping-Triangulierung fuer einfache Polygone mit Loechern.
 *
 * TypeScript-Portierung des bekannten "earcut"-Verfahrens von Mapbox
 * (ISC-Lizenz, Vladimir Agafonkin) - Ohren-Abschneiden mit Z-Order-Hashing
 * fuer grosse Polygone und Bruecken-Verbindung fuer Loecher.
 *
 * Wir brauchen das, weil Pop-It-Platten schnell 200 Dome-Taschen als Loecher
 * in einer Deckflaeche haben. Reines O(n^2)-Ear-Clipping waere dafuer zu langsam.
 */

class PolyNode {
  i: number;
  x: number;
  y: number;
  prev: PolyNode | null = null;
  next: PolyNode | null = null;
  z = 0;
  prevZ: PolyNode | null = null;
  nextZ: PolyNode | null = null;
  steiner = false;

  constructor(i: number, x: number, y: number) {
    this.i = i;
    this.x = x;
    this.y = y;
  }
}

/**
 * @param data  flaches Koordinatenarray [x0,y0, x1,y1, ...]
 * @param holeIndices Startindizes (in Punkten, nicht Zahlen) der Loecher
 * @returns Indexliste, je drei Indizes ein Dreieck
 */
export function earcut(data: number[], holeIndices?: number[]): number[] {
  const dim = 2;
  const hasHoles = !!(holeIndices && holeIndices.length);
  const outerLen = hasHoles ? holeIndices![0] * dim : data.length;
  let outerNode = linkedList(data, 0, outerLen, dim, true);
  const triangles: number[] = [];

  if (!outerNode || outerNode.next === outerNode.prev) return triangles;

  let minX = 0;
  let minY = 0;
  let invSize = 0;

  if (hasHoles) outerNode = eliminateHoles(data, holeIndices!, outerNode, dim);

  if (data.length > 80 * dim) {
    minX = data[0];
    let maxX = data[0];
    minY = data[1];
    let maxY = data[1];
    for (let i = dim; i < outerLen; i += dim) {
      const x = data[i];
      const y = data[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    invSize = Math.max(maxX - minX, maxY - minY);
    invSize = invSize !== 0 ? 32767 / invSize : 0;
  }

  earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
  return triangles;
}

function linkedList(
  data: number[],
  start: number,
  end: number,
  dim: number,
  clockwise: boolean,
): PolyNode | null {
  let last: PolyNode | null = null;

  if (clockwise === signedArea(data, start, end, dim) > 0) {
    for (let i = start; i < end; i += dim) last = insertNode((i / dim) | 0, data[i], data[i + 1], last);
  } else {
    for (let i = end - dim; i >= start; i -= dim) last = insertNode((i / dim) | 0, data[i], data[i + 1], last);
  }

  if (last && equals(last, last.next!)) {
    removeNode(last);
    last = last.next;
  }
  return last;
}

function filterPoints(start: PolyNode | null, end?: PolyNode | null): PolyNode | null {
  if (!start) return start;
  if (!end) end = start;

  let p = start;
  let again: boolean;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next!) || area(p.prev!, p, p.next!) === 0)) {
      removeNode(p);
      p = end = p.prev!;
      if (p === p.next) break;
      again = true;
    } else {
      p = p.next!;
    }
  } while (again || p !== end);

  return end;
}

function earcutLinked(
  ear: PolyNode | null,
  triangles: number[],
  dim: number,
  minX: number,
  minY: number,
  invSize: number,
  pass: number,
): void {
  if (!ear) return;

  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);

  let stop: PolyNode | null = ear;

  while (ear!.prev !== ear!.next) {
    const prev: PolyNode = ear!.prev!;
    const next: PolyNode = ear!.next!;

    if (invSize ? isEarHashed(ear!, minX, minY, invSize) : isEar(ear!)) {
      triangles.push(prev.i, ear!.i, next.i);
      removeNode(ear!);
      ear = next.next;
      stop = next.next;
      continue;
    }

    ear = next;

    if (ear === stop) {
      // Kein Ohr mehr gefunden - mit Reparaturstrategien weitermachen.
      if (!pass) {
        earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
      } else if (pass === 1) {
        ear = cureLocalIntersections(filterPoints(ear)!, triangles);
        earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);
      } else if (pass === 2) {
        splitEarcut(ear!, triangles, dim, minX, minY, invSize);
      }
      break;
    }
  }
}

function isEar(ear: PolyNode): boolean {
  const a = ear.prev!;
  const b = ear;
  const c = ear.next!;

  if (area(a, b, c) >= 0) return false;

  const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
  const x0 = Math.min(ax, bx, cx);
  const y0 = Math.min(ay, by, cy);
  const x1 = Math.max(ax, bx, cx);
  const y1 = Math.max(ay, by, cy);

  let p = c.next!;
  while (p !== a) {
    if (
      p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
      pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev!, p, p.next!) >= 0
    ) {
      return false;
    }
    p = p.next!;
  }
  return true;
}

function isEarHashed(ear: PolyNode, minX: number, minY: number, invSize: number): boolean {
  const a = ear.prev!;
  const b = ear;
  const c = ear.next!;

  if (area(a, b, c) >= 0) return false;

  const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
  const x0 = Math.min(ax, bx, cx);
  const y0 = Math.min(ay, by, cy);
  const x1 = Math.max(ax, bx, cx);
  const y1 = Math.max(ay, by, cy);

  const minZ = zOrder(x0, y0, minX, minY, invSize);
  const maxZ = zOrder(x1, y1, minX, minY, invSize);

  let p = ear.prevZ;
  let n = ear.nextZ;

  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (
      p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
      p !== a && p !== c &&
      pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev!, p, p.next!) >= 0
    ) return false;
    p = p.prevZ;

    if (
      n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 &&
      n !== a && n !== c &&
      pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) &&
      area(n.prev!, n, n.next!) >= 0
    ) return false;
    n = n.nextZ;
  }

  while (p && p.z >= minZ) {
    if (
      p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
      p !== a && p !== c &&
      pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev!, p, p.next!) >= 0
    ) return false;
    p = p.prevZ;
  }

  while (n && n.z <= maxZ) {
    if (
      n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 &&
      n !== a && n !== c &&
      pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) &&
      area(n.prev!, n, n.next!) >= 0
    ) return false;
    n = n.nextZ;
  }

  return true;
}

function cureLocalIntersections(start: PolyNode, triangles: number[]): PolyNode {
  let p = start;
  do {
    const a = p.prev!;
    const b = p.next!.next!;

    if (!equals(a, b) && intersects(a, p, p.next!, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i, p.i, b.i);
      removeNode(p);
      removeNode(p.next!);
      p = start = b;
    }
    p = p.next!;
  } while (p !== start);

  return filterPoints(p)!;
}

function splitEarcut(
  start: PolyNode,
  triangles: number[],
  dim: number,
  minX: number,
  minY: number,
  invSize: number,
): void {
  let a: PolyNode = start;
  do {
    let b = a.next!.next!;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c: PolyNode | null = splitPolygon(a, b);
        a = filterPoints(a, a.next)!;
        c = filterPoints(c, c.next);
        earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
        earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
        return;
      }
      b = b.next!;
    }
    a = a.next!;
  } while (a !== start);
}

function eliminateHoles(
  data: number[],
  holeIndices: number[],
  outerNode: PolyNode,
  dim: number,
): PolyNode {
  const queue: PolyNode[] = [];

  for (let i = 0, len = holeIndices.length; i < len; i++) {
    const start = holeIndices[i] * dim;
    const end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
    const list = linkedList(data, start, end, dim, false);
    if (list) {
      if (list === list.next) list.steiner = true;
      queue.push(getLeftmost(list));
    }
  }

  queue.sort((a, b) => a.x - b.x);

  let node = outerNode;
  for (const hole of queue) {
    node = eliminateHole(hole, node);
  }
  return node;
}

function eliminateHole(hole: PolyNode, outerNode: PolyNode): PolyNode {
  const bridge = findHoleBridge(hole, outerNode);
  if (!bridge) return outerNode;

  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next)!;
}

function findHoleBridge(hole: PolyNode, outerNode: PolyNode): PolyNode | null {
  let p = outerNode;
  const hx = hole.x;
  const hy = hole.y;
  let qx = -Infinity;
  let m: PolyNode | null = null;

  // Strahl nach links: Schnittpunkt mit dem naechstliegenden Kantenzug suchen.
  do {
    if (hy <= p.y && hy >= p.next!.y && p.next!.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next!.x - p.x)) / (p.next!.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next!.x ? p : p.next!;
        if (x === hx) return m;
      }
    }
    p = p.next!;
  } while (p !== outerNode);

  if (!m) return null;

  const stop = m;
  const mx = m.x;
  const my = m.y;
  let tanMin = Infinity;

  p = m;
  do {
    if (
      hx >= p.x && p.x >= mx && hx !== p.x &&
      pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)
    ) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (
        locallyInside(p, hole) &&
        (tan < tanMin || (tan === tanMin && (p.x > m!.x || (p.x === m!.x && sectorContainsSector(m!, p)))))
      ) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next!;
  } while (p !== stop);

  return m;
}

function sectorContainsSector(m: PolyNode, p: PolyNode): boolean {
  return area(m.prev!, m, p.prev!) < 0 && area(p.next!, m, m.next!) < 0;
}

function indexCurve(start: PolyNode, minX: number, minY: number, invSize: number): void {
  let p = start;
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    p.prevZ = p.prev;
    p.nextZ = p.next;
    p = p.next!;
  } while (p !== start);

  p.prevZ!.nextZ = null;
  p.prevZ = null;

  sortLinked(p);
}

/** Merge-Sort einer verketteten Liste nach Z-Order-Wert. */
function sortLinked(list: PolyNode | null): PolyNode | null {
  let inSize = 1;
  let numMerges: number;

  do {
    let p = list;
    let tail: PolyNode | null = null;
    list = null;
    numMerges = 0;

    while (p) {
      numMerges++;
      let q: PolyNode | null = p;
      let pSize = 0;
      for (let i = 0; i < inSize; i++) {
        pSize++;
        q = q.nextZ;
        if (!q) break;
      }
      let qSize = inSize;

      while (pSize > 0 || (qSize > 0 && q)) {
        let e: PolyNode;
        if (pSize !== 0 && (qSize === 0 || !q || p!.z <= q.z)) {
          e = p!;
          p = p!.nextZ;
          pSize--;
        } else {
          e = q!;
          q = q!.nextZ;
          qSize--;
        }

        if (tail) tail.nextZ = e;
        else list = e;

        e.prevZ = tail;
        tail = e;
      }

      p = q;
    }

    tail!.nextZ = null;
    inSize *= 2;
  } while (numMerges > 1);

  return list;
}

function zOrder(x: number, y: number, minX: number, minY: number, invSize: number): number {
  let lx = ((x - minX) * invSize) | 0;
  let ly = ((y - minY) * invSize) | 0;

  lx = (lx | (lx << 8)) & 0x00ff00ff;
  lx = (lx | (lx << 4)) & 0x0f0f0f0f;
  lx = (lx | (lx << 2)) & 0x33333333;
  lx = (lx | (lx << 1)) & 0x55555555;

  ly = (ly | (ly << 8)) & 0x00ff00ff;
  ly = (ly | (ly << 4)) & 0x0f0f0f0f;
  ly = (ly | (ly << 2)) & 0x33333333;
  ly = (ly | (ly << 1)) & 0x55555555;

  return lx | (ly << 1);
}

function getLeftmost(start: PolyNode): PolyNode {
  let p = start;
  let leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
    p = p.next!;
  } while (p !== start);
  return leftmost;
}

function pointInTriangle(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number,
): boolean {
  return (
    (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
    (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
    (bx - px) * (cy - py) >= (cx - px) * (by - py)
  );
}

function isValidDiagonal(a: PolyNode, b: PolyNode): boolean {
  return (
    a.next!.i !== b.i &&
    a.prev!.i !== b.i &&
    !intersectsPolygon(a, b) &&
    ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
      (area(a.prev!, a, b.prev!) !== 0 || area(a, b.prev!, b) !== 0)) ||
      (equals(a, b) && area(a.prev!, a, a.next!) > 0 && area(b.prev!, b, b.next!) > 0))
  );
}

function area(p: PolyNode, q: PolyNode, r: PolyNode): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

function equals(p1: PolyNode, p2: PolyNode): boolean {
  return p1.x === p2.x && p1.y === p2.y;
}

function intersects(p1: PolyNode, q1: PolyNode, p2: PolyNode, q2: PolyNode): boolean {
  const o1 = sign(area(p1, q1, p2));
  const o2 = sign(area(p1, q1, q2));
  const o3 = sign(area(p2, q2, p1));
  const o4 = sign(area(p2, q2, q1));

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function onSegment(p: PolyNode, q: PolyNode, r: PolyNode): boolean {
  return (
    q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y)
  );
}

function sign(num: number): number {
  return num > 0 ? 1 : num < 0 ? -1 : 0;
}

function intersectsPolygon(a: PolyNode, b: PolyNode): boolean {
  let p = a;
  do {
    if (
      p.i !== a.i && p.next!.i !== a.i && p.i !== b.i && p.next!.i !== b.i &&
      intersects(p, p.next!, a, b)
    ) return true;
    p = p.next!;
  } while (p !== a);
  return false;
}

function locallyInside(a: PolyNode, b: PolyNode): boolean {
  return area(a.prev!, a, a.next!) < 0
    ? area(a, b, a.next!) >= 0 && area(a, a.prev!, b) >= 0
    : area(a, b, a.prev!) < 0 || area(a, a.next!, b) < 0;
}

function middleInside(a: PolyNode, b: PolyNode): boolean {
  let p = a;
  let inside = false;
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;
  do {
    if (p.y > py !== p.next!.y > py && p.next!.y !== p.y &&
      px < ((p.next!.x - p.x) * (py - p.y)) / (p.next!.y - p.y) + p.x) {
      inside = !inside;
    }
    p = p.next!;
  } while (p !== a);
  return inside;
}

function splitPolygon(a: PolyNode, b: PolyNode): PolyNode {
  const a2 = new PolyNode(a.i, a.x, a.y);
  const b2 = new PolyNode(b.i, b.x, b.y);
  const an = a.next!;
  const bp = b.prev!;

  a.next = b;
  b.prev = a;

  a2.next = an;
  an.prev = a2;

  b2.next = a2;
  a2.prev = b2;

  bp.next = b2;
  b2.prev = bp;

  return b2;
}

function insertNode(i: number, x: number, y: number, last: PolyNode | null): PolyNode {
  const p = new PolyNode(i, x, y);
  if (!last) {
    p.prev = p;
    p.next = p;
  } else {
    p.next = last.next;
    p.prev = last;
    last.next!.prev = p;
    last.next = p;
  }
  return p;
}

function removeNode(p: PolyNode): void {
  p.next!.prev = p.prev;
  p.prev!.next = p.next;
  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function signedArea(data: number[], start: number, end: number, dim: number): number {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; i += dim) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  return sum;
}

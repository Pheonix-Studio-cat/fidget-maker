/**
 * 3D-Vorschau.
 *
 * Die Modelle sind in Millimetern und Z-nach-oben aufgebaut, so wie sie
 * spaeter auf dem Druckbett stehen. Die Kamera wird entsprechend gedreht,
 * damit die Ansicht dem entspricht, was der Slicer zeigt.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PartPayload } from '../worker/builder.ts';

/** Druckbett eines Bambu Lab X1/P1 in mm. */
const BED = 256;

export interface ViewerPart {
  id: string;
  name: string;
  color: string;
  positions: Float32Array;
}

export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly group = new THREE.Group();
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly baseZ = new Map<string, number>();
  private explode = 0;
  private frameHandle = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 4000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(140, -190, 130);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 10);

    this.scene.add(new THREE.HemisphereLight(0xf4f6f8, 0x38404a, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(120, -160, 220);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdbe7f2, 0.7);
    fill.position.set(-160, 120, 80);
    this.scene.add(fill);

    this.scene.add(this.buildPlate());
    this.scene.add(this.group);

    this.resize();
    window.addEventListener('resize', this.resize);
    this.loop();
  }

  /** Druckbett mit Raster - gibt der Groesse einen Massstab. */
  private buildPlate(): THREE.Object3D {
    const plate = new THREE.Group();

    const grid = new THREE.GridHelper(BED, BED / 16, 0x4a5568, 0x2b323c);
    grid.rotation.x = Math.PI / 2;
    plate.add(grid);

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(BED, BED)),
      new THREE.LineBasicMaterial({ color: 0x5c7a99 }),
    );
    plate.add(border);
    return plate;
  }

  private resize = (): void => {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private loop = (): void => {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame(this.loop);
    if (this.canvas.clientWidth !== this.renderer.domElement.width / Math.min(devicePixelRatio, 2)) {
      this.resize();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  setParts(parts: PartPayload[]): void {
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.group.remove(mesh);
    }
    this.meshes.clear();
    this.baseZ.clear();

    for (const part of parts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(part.positions.slice(), 3));
      // Kanten unter 40 Grad werden weich schattiert, schaerfere bleiben
      // hart - so wirken Kugeln rund und Fasen trotzdem praezise.
      const shaded = toCreasedNormals(geometry, (40 * Math.PI) / 180);

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color),
        roughness: 0.62,
        metalness: 0.03,
      });
      const mesh = new THREE.Mesh(shaded, material);
      mesh.name = part.id;
      this.group.add(mesh);
      this.meshes.set(part.id, mesh);
      this.baseZ.set(part.id, mesh.geometry.boundingBox?.min.z ?? 0);
    }

    this.applyExplode();
    this.frameAll();
  }

  setPartVisible(id: string, visible: boolean): void {
    const mesh = this.meshes.get(id);
    if (mesh) mesh.visible = visible;
  }

  /** Zieht die Teile auseinander, damit der Aufbau sichtbar wird. */
  setExplode(amount: number): void {
    this.explode = amount;
    this.applyExplode();
  }

  private applyExplode(): void {
    const ordered = [...this.meshes.entries()].sort(
      (a, b) => (this.baseZ.get(a[0]) ?? 0) - (this.baseZ.get(b[0]) ?? 0),
    );
    ordered.forEach(([, mesh], i) => {
      mesh.position.z = this.explode * i;
    });
  }

  frameAll(): void {
    const box = new THREE.Box3();
    let has = false;
    for (const mesh of this.meshes.values()) {
      if (!mesh.visible) continue;
      mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox;
      if (!b) continue;
      box.union(b.clone().translate(mesh.position));
      has = true;
    }
    if (!has) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 12);
    const distance = radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.25;

    const dir = new THREE.Vector3(0.62, -0.86, 0.58).normalize();
    this.camera.position.copy(center).addScaledVector(dir, distance);
    this.controls.target.copy(center);
    this.controls.update();
  }

  /** Standbild fuer die Galerie. */
  snapshot(width = 480, height = 320): string {
    const before = { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/webp', 0.85);
    this.renderer.setSize(before.w || 1, before.h || 1, false);
    this.camera.aspect = (before.w || 1) / (before.h || 1);
    this.camera.updateProjectionMatrix();
    return url;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.resize);
    this.controls.dispose();
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.renderer.dispose();
  }
}

import * as THREE from "three";
import { CacheRenderInstancedModel, CacheRenderReferences, CollisionType, Entity, GROUND_OVERLAY_Y, LineOfSightMask, Settings } from "osrs-sdk";
import type { Location3, Model, Region, Renderable } from "osrs-sdk";
import type { ATile } from "./geometry";
import { key, toSdk } from "./geometry";

/** Anything drawn on the floor rather than standing on it. */
abstract class FloorEntity extends Entity {
  override get collisionType(): CollisionType {
    return CollisionType.NONE;
  }

  override get lineOfSight(): LineOfSightMask {
    return LineOfSightMask.NONE;
  }

  override get size(): number {
    return 1;
  }
}

export type SpotOptions = Readonly<{
  /** Client cycles (20 ms) before the effect starts. */
  delay?: number;
  /** OSRS orientation units, 2048 a turn. */
  rotation?: number;
  height?: number;
  /** Keep replaying until this many ticks have passed; otherwise play once. */
  loopTicks?: number;
  /** Remove after this many ticks even when the animation has not reported its end. */
  maxTicks?: number;
  size?: number;
}>;

class SpotModel implements Model {
  private playing: CacheRenderInstancedModel | null = null;
  private ended = false;

  constructor(private readonly renderable: GroundSpot) {}

  draw(scene: THREE.Scene, clockDelta: number, tickPercent: number, location: Location3, angleRadians: number, pitchRadians: number, visible: boolean, modelOffsets: Location3[]): void {
    if (this.playing !== null && this.ended && this.renderable.loops()) {
      this.playing.destroy(scene);
      this.playing = null;
    }
    if (this.playing === null && !this.renderable.finished()) {
      this.ended = false;
      const { id, options } = this.renderable;
      this.playing = CacheRenderInstancedModel.forRenderable(
        this.renderable,
        CacheRenderReferences.spotAnim([{ id, delay: this.renderable.restarts === 0 ? options.delay ?? 0 : 0, rotation: options.rotation ?? 0, height: options.height ?? 0 }]),
        {
          onSpotAnimComplete: () => {
            this.ended = true;
            this.renderable.restarts++;
            this.renderable.complete();
          },
        },
      );
    }
    this.playing?.draw(scene, clockDelta, tickPercent, location, 0, pitchRadians, visible && !this.renderable.finished(), modelOffsets);
  }

  destroy(scene: THREE.Scene): void {
    this.playing?.destroy(scene);
    this.playing = null;
  }

  getWorldPosition(): THREE.Vector3 {
    return this.playing?.getWorldPosition() ?? new THREE.Vector3();
  }

  async preload(): Promise<void> {}
}

/** A cache spotanim on a floor tile. */
export class GroundSpot extends FloorEntity {
  restarts = 0;
  private age = 0;
  private done = false;

  constructor(region: Region, tile: ATile, readonly id: number, readonly options: SpotOptions = {}) {
    super(region, toSdk(tile));
  }

  override get size(): number {
    return this.options.size ?? 1;
  }

  loops(): boolean {
    return this.options.loopTicks !== undefined && this.age < this.options.loopTicks;
  }

  finished(): boolean {
    return this.done;
  }

  complete(): void {
    if (!this.loops()) this.done = true;
  }

  stop(): void {
    this.done = true;
    this.dying = 0;
  }

  override tick(): void {
    this.age++;
    const limit = this.options.maxTicks ?? (this.options.loopTicks ?? 0) + 12;
    if (this.done || this.age > limit) {
      this.done = true;
      this.dying = 0;
    }
  }

  override draw(): void {}

  protected override create3dModel(): Model {
    return new SpotModel(this);
  }
}

export type TileMark = Readonly<{ tile: ATile; colour: number; opacity: number; inset?: number }>;

const MAX_MARKS = 1600;

class TileMarksModel implements Model {
  private readonly geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, vertexColors: false, side: THREE.DoubleSide, opacity: 1 });
  private readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly colour = new THREE.Color();
  private readonly opacities: Float32Array;

  constructor(private readonly marks: () => readonly TileMark[], height: number) {
    this.opacities = new Float32Array(MAX_MARKS);
    this.geometry.setAttribute("instanceOpacity", new THREE.InstancedBufferAttribute(this.opacities, 1));
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vInstanceOpacity;")
        .replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.a *= vInstanceOpacity;");
    };
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_MARKS);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MARKS * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.position.y = height;
  }

  draw(scene: THREE.Scene, clockDelta: number, tickPercent: number, location: Location3, angleRadians: number, pitchRadians: number, visible: boolean): void {
    if (this.mesh.parent !== scene) scene.add(this.mesh);
    const marks = this.marks();
    const count = Math.min(MAX_MARKS, marks.length);
    for (let i = 0; i < count; i++) {
      const { tile, colour, opacity, inset = 0 } = marks[i];
      const s = toSdk(tile);
      const scale = 1 - inset * 2;
      this.matrix.makeScale(scale, 1, scale).setPosition(s.x + 0.5, 0, s.y - 0.5);
      this.mesh.setMatrixAt(i, this.matrix);
      this.mesh.setColorAt(i, this.colour.setHex(colour));
      this.opacities[i] = opacity;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    const attribute = this.geometry.getAttribute("instanceOpacity");
    attribute.needsUpdate = true;
    this.mesh.visible = visible && count > 0;
  }

  destroy(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  getWorldPosition(): THREE.Vector3 {
    return new THREE.Vector3();
  }

  async preload(): Promise<void> {}
}

/** Translucent tiles, rebuilt every frame from a provider (hazard tells, safe tiles, zones). */
export class TileMarks extends FloorEntity {
  constructor(region: Region, private readonly marks: () => readonly TileMark[], private readonly overlayY = GROUND_OVERLAY_Y + 0.004) {
    super(region, { x: 0, y: 0 });
  }

  override draw(tickPercent: number, context: OffscreenCanvasRenderingContext2D): void {
    const scale = Settings.tileSize;
    for (const { tile, colour, opacity } of this.marks()) {
      const s = toSdk(tile);
      context.globalAlpha = opacity;
      context.fillStyle = `#${colour.toString(16).padStart(6, "0")}`;
      context.fillRect(s.x * scale, s.y * scale, scale, scale);
    }
    context.globalAlpha = 1;
  }

  protected override create3dModel(): Model {
    return new TileMarksModel(this.marks, this.overlayY);
  }
}

export type LabelledTile = Readonly<{ tile: ATile; colour: string; label: string }>;

const LABEL_PX = 64;
/** Clear texels around each atlas cell, so mipmaps never blend a neighbour's outline in. */
const LABEL_GUTTER = 4;
const LABEL_CELL = LABEL_PX + 2 * LABEL_GUTTER;

function labelAtlas(tiles: readonly LabelledTile[]): { texture: THREE.CanvasTexture; cells: ReadonlyMap<string, number>; columns: number; rows: number } {
  const cells = new Map<string, number>();
  for (const { colour, label } of tiles) if (!cells.has(`${colour} ${label}`)) cells.set(`${colour} ${label}`, cells.size);
  const columns = Math.max(1, Math.ceil(Math.sqrt(cells.size)));
  const rows = Math.max(1, Math.ceil(cells.size / columns));
  const canvas = new OffscreenCanvas(columns * LABEL_CELL, rows * LABEL_CELL);
  const context = canvas.getContext("2d");
  if (context) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 4;
    for (const { colour, label } of tiles) {
      const cell = cells.get(`${colour} ${label}`) ?? 0;
      const x = (cell % columns) * LABEL_CELL + LABEL_GUTTER;
      const y = Math.floor(cell / columns) * LABEL_CELL + LABEL_GUTTER;
      context.strokeStyle = colour;
      context.strokeRect(x + 2, y + 2, LABEL_PX - 4, LABEL_PX - 4);
      context.font = `bold ${label.length > 2 ? 22 : 34}px sans-serif`;
      context.fillStyle = "black";
      context.fillText(label, x + LABEL_PX / 2 + 2, y + LABEL_PX / 2 + 2);
      context.fillStyle = colour;
      context.fillText(label, x + LABEL_PX / 2, y + LABEL_PX / 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, cells, columns, rows };
}

class LabelledTilesModel implements Model {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;

  constructor(tiles: readonly LabelledTile[], height: number) {
    const { texture, cells, columns, rows } = labelAtlas(tiles);
    const width = columns * LABEL_CELL;
    const tall = rows * LABEL_CELL;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    tiles.forEach(({ tile, colour, label }, i) => {
      const cell = cells.get(`${colour} ${label}`) ?? 0;
      const u0 = ((cell % columns) * LABEL_CELL + LABEL_GUTTER) / width;
      const u1 = u0 + LABEL_PX / width;
      const top = 1 - (Math.floor(cell / columns) * LABEL_CELL + LABEL_GUTTER) / tall;
      const bottom = top - LABEL_PX / tall;
      const s = toSdk(tile);
      // The texture's top row on the tile's north edge (SDK y - 1).
      positions.push(s.x, height, s.y - 1, s.x + 1, height, s.y - 1, s.x, height, s.y, s.x + 1, height, s.y);
      uvs.push(u0, top, u1, top, u0, bottom, u1, bottom);
      const v = 4 * i;
      indices.push(v, v + 2, v + 1, v + 2, v + 3, v + 1);
    });
    this.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    this.geometry.setIndex(indices);
    this.material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 3;
  }

  draw(scene: THREE.Scene, clockDelta: number, tickPercent: number, location: Location3, angleRadians: number, pitchRadians: number, visible: boolean): void {
    if (this.mesh.parent !== scene) scene.add(this.mesh);
    this.mesh.visible = visible;
  }

  destroy(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }

  getWorldPosition(): THREE.Vector3 {
    return new THREE.Vector3();
  }

  async preload(): Promise<void> {}
}

/** Fixed tiles drawn with an outline and a label (phase 2's pattern tiles). */
export class LabelledTiles extends FloorEntity {
  constructor(region: Region, private readonly tiles: readonly LabelledTile[], private readonly overlayY = GROUND_OVERLAY_Y + 0.006) {
    super(region, { x: 0, y: 0 });
  }

  override draw(tickPercent: number, context: OffscreenCanvasRenderingContext2D): void {
    const scale = Settings.tileSize;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `bold ${Math.round(scale * 0.45)}px sans-serif`;
    for (const { tile, colour, label } of this.tiles) {
      const s = toSdk(tile);
      context.strokeStyle = colour;
      context.fillStyle = colour;
      context.strokeRect(s.x * scale, s.y * scale, scale, scale);
      context.fillText(label, (s.x + 0.5) * scale, (s.y + 0.5) * scale);
    }
  }

  protected override create3dModel(): Model {
    return new LabelledTilesModel(this.tiles, this.overlayY);
  }
}

/** A short text drawn over a point of the arena grid; a tile's centre is its whole coordinates. */
export type SceneLabel = Readonly<{ x: number; z: number; text: string; colour: number }>;

const LABEL = { width: 128, height: 64, font: "bold 44px sans-serif", scale: 1.6, lift: 0.6, pool: 64 } as const;

function cssColour(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

class SceneLabelsModel implements Model {
  private readonly sprites: THREE.Sprite[] = [];
  private readonly textures = new Map<string, THREE.CanvasTexture>();

  constructor(private readonly labels: () => readonly SceneLabel[]) {}

  draw(scene: THREE.Scene, clockDelta: number, tickPercent: number, location: Location3, angleRadians: number, pitchRadians: number, visible: boolean): void {
    const labels = this.labels();
    for (let i = 0; i < Math.min(labels.length, LABEL.pool); i++) {
      const { x, z, text, colour } = labels[i];
      const sprite = this.sprite(i, scene);
      const map = this.texture(text, colour);
      if (sprite.material.map !== map) {
        sprite.material.map = map;
        sprite.material.needsUpdate = true;
      }
      sprite.position.set(x + C_OFFSET + 0.5, GROUND_OVERLAY_Y + LABEL.lift, C_OFFSET - z - 0.5);
      sprite.visible = visible;
    }
    for (let i = labels.length; i < this.sprites.length; i++) this.sprites[i].visible = false;
  }

  destroy(scene: THREE.Scene): void {
    for (const sprite of this.sprites) {
      scene.remove(sprite);
      sprite.material.dispose();
    }
    this.textures.forEach((texture) => texture.dispose());
    this.textures.clear();
  }

  getWorldPosition(): THREE.Vector3 {
    return new THREE.Vector3();
  }

  async preload(): Promise<void> {}

  private sprite(index: number, scene: THREE.Scene): THREE.Sprite {
    const held = this.sprites[index];
    if (held) return held;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
    sprite.scale.set(LABEL.scale, LABEL.scale / 2, 1);
    sprite.renderOrder = 10;
    scene.add(sprite);
    this.sprites.push(sprite);
    return sprite;
  }

  private texture(text: string, colour: number): THREE.CanvasTexture {
    const key = `${text}|${colour}`;
    const held = this.textures.get(key);
    if (held) return held;
    const canvas = document.createElement("canvas");
    canvas.width = LABEL.width;
    canvas.height = LABEL.height;
    const context = canvas.getContext("2d");
    if (context) {
      context.font = LABEL.font;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineWidth = 6;
      context.strokeStyle = "#000000";
      context.strokeText(text, LABEL.width / 2, LABEL.height / 2);
      context.fillStyle = cssColour(colour);
      context.fillText(text, LABEL.width / 2, LABEL.height / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(key, texture);
    return texture;
  }
}

/** Arena x 0 is SDK x C; `toSdk` holds the same offset. */
const C_OFFSET = toSdk({ x: 0, z: 0 }).x;

/** Countdowns and other short texts over the floor, rebuilt every frame from a provider. */
export class SceneLabels extends FloorEntity {
  constructor(region: Region, private readonly labels: () => readonly SceneLabel[]) {
    super(region, { x: 0, y: 0 });
  }

  override draw(tickPercent: number, context: OffscreenCanvasRenderingContext2D): void {
    const scale = Settings.tileSize;
    context.font = `bold ${Math.round(scale * 0.6)}px sans-serif`;
    context.textAlign = "center";
    for (const { x, z, text, colour } of this.labels()) {
      context.fillStyle = cssColour(colour);
      context.fillText(text, (x + C_OFFSET + 0.5) * scale, (C_OFFSET - z + 0.5) * scale);
    }
  }

  protected override create3dModel(): Model {
    return new SceneLabelsModel(this.labels);
  }
}

const VOID_LOOK = { void: "#1e2529", stars: "#babcc2", rim: "#9f48bd" } as const;
const STAR_TILES = 4;
const STAR_PX = 32;
const RIM_DEPTH = 0.18;
const RIM_HEIGHT = 0.15;

function starfield(): THREE.Texture {
  const size = STAR_TILES * STAR_PX;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = VOID_LOOK.void;
    context.fillRect(0, 0, size, size);
    context.fillStyle = VOID_LOOK.stars;
    let state = 0x2545f491;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    for (let star = 0; star < 6 * STAR_TILES * STAR_TILES; star++) {
      context.globalAlpha = 0.35 + 0.65 * next();
      context.fillRect(Math.floor(next() * size), Math.floor(next() * size), next() < 0.2 ? 2 : 1, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type Side = "north" | "south" | "east" | "west";
const SIDES: readonly Side[] = ["north", "south", "east", "west"];
const SIDE_STEP: Readonly<Record<Side, Readonly<{ dx: number; dz: number }>>> = {
  north: { dx: 0, dz: 1 },
  south: { dx: 0, dz: -1 },
  east: { dx: 1, dz: 0 },
  west: { dx: -1, dz: 0 },
};

/** World-space edge of a tile's side, with the direction pointing into the tile. SDK y runs south, world z = sdk y. */
function edgeOf(tile: ATile, side: Side): Readonly<{ ax: number; az: number; bx: number; bz: number; ix: number; iz: number }> {
  const s = toSdk(tile);
  switch (side) {
    case "north":
      return { ax: s.x, az: s.y - 1, bx: s.x + 1, bz: s.y - 1, ix: 0, iz: 1 };
    case "south":
      return { ax: s.x, az: s.y, bx: s.x + 1, bz: s.y, ix: 0, iz: -1 };
    case "west":
      return { ax: s.x, az: s.y - 1, bx: s.x, bz: s.y, ix: 1, iz: 0 };
    case "east":
      return { ax: s.x + 1, az: s.y - 1, bx: s.x + 1, bz: s.y, ix: -1, iz: 0 };
    default: {
      const unhandled: never = side;
      return unhandled;
    }
  }
}

export function borderOf(tiles: readonly ATile[]): Readonly<{ tile: ATile; side: Side }>[] {
  const set = new Set(tiles.map(key));
  const out: { tile: ATile; side: Side }[] = [];
  for (const tile of tiles) {
    for (const side of SIDES) {
      const { dx, dz } = SIDE_STEP[side];
      if (!set.has(`${tile.x + dx},${tile.z + dz}`)) out.push({ tile, side });
    }
  }
  return out;
}

export { edgeOf };

class VoidModel implements Model {
  private readonly group = new THREE.Group();
  private built: string | null = null;
  private stars: THREE.Texture | null = null;
  private readonly owned: { dispose(): void }[] = [];

  constructor(private readonly tiles: () => Readonly<{ key: string; tiles: readonly ATile[] }>) {}

  draw(scene: THREE.Scene, clockDelta: number, tickPercent: number, location: Location3, angleRadians: number, pitchRadians: number, visible: boolean): void {
    if (this.group.parent !== scene) scene.add(this.group);
    const { key: wanted, tiles } = this.tiles();
    if (wanted !== this.built) this.rebuild(wanted, tiles);
    this.group.visible = visible && tiles.length > 0;
  }

  private rebuild(builtKey: string, tiles: readonly ATile[]): void {
    this.group.clear();
    this.owned.splice(0).forEach((resource) => resource.dispose());
    this.built = builtKey;
    if (tiles.length === 0) return;
    if (this.stars === null) this.stars = starfield();
    const positions: number[] = [];
    const uvs: number[] = [];
    for (const tile of tiles) {
      const s = toSdk(tile);
      const corners = [[s.x, s.y - 1], [s.x + 1, s.y], [s.x + 1, s.y - 1], [s.x, s.y - 1], [s.x, s.y], [s.x + 1, s.y]];
      for (const [cx, cz] of corners) {
        positions.push(cx, GROUND_OVERLAY_Y + 0.002, cz);
        uvs.push(cx / STAR_TILES, cz / STAR_TILES);
      }
    }
    const floor = new THREE.BufferGeometry();
    floor.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    floor.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    const floorMaterial = new THREE.MeshBasicMaterial({ map: this.stars, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

    const rim = new THREE.Color(VOID_LOOK.rim);
    const rimPositions: number[] = [];
    const rimColours: number[] = [];
    const y = GROUND_OVERLAY_Y + 0.003;
    const push = (x: number, h: number, z: number, lit: boolean) => {
      rimPositions.push(x, h, z);
      if (lit) rimColours.push(rim.r, rim.g, rim.b);
      else rimColours.push(0, 0, 0);
    };
    for (const { tile, side } of borderOf(tiles)) {
      const e = edgeOf(tile, side);
      const inside = { ax: e.ax + e.ix * RIM_DEPTH, az: e.az + e.iz * RIM_DEPTH, bx: e.bx + e.ix * RIM_DEPTH, bz: e.bz + e.iz * RIM_DEPTH };
      push(e.ax, y, e.az, true);
      push(e.bx, y, e.bz, true);
      push(inside.bx, y, inside.bz, false);
      push(e.ax, y, e.az, true);
      push(inside.bx, y, inside.bz, false);
      push(inside.ax, y, inside.az, false);
      push(e.ax, y, e.az, true);
      push(e.bx, y, e.bz, true);
      push(e.bx, y + RIM_HEIGHT, e.bz, false);
      push(e.ax, y, e.az, true);
      push(e.bx, y + RIM_HEIGHT, e.bz, false);
      push(e.ax, y + RIM_HEIGHT, e.az, false);
    }
    const rimGeometry = new THREE.BufferGeometry();
    rimGeometry.setAttribute("position", new THREE.Float32BufferAttribute(rimPositions, 3));
    rimGeometry.setAttribute("color", new THREE.Float32BufferAttribute(rimColours, 3));
    const rimMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.owned.push(floor, floorMaterial, rimGeometry, rimMaterial);
    this.group.add(new THREE.Mesh(floor, floorMaterial), new THREE.Mesh(rimGeometry, rimMaterial));
  }

  destroy(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.owned.forEach((resource) => resource.dispose());
    this.stars?.dispose();
  }

  getWorldPosition(): THREE.Vector3 {
    return this.group.getWorldPosition(new THREE.Vector3());
  }

  async preload(): Promise<void> {}
}

/** Starry void floor with a glowing purple rim over a set of tiles. */
export class VoidFloor extends FloorEntity {
  constructor(region: Region, private readonly tiles: () => Readonly<{ key: string; tiles: readonly ATile[] }>) {
    super(region, { x: 0, y: 0 });
  }

  override draw(tickPercent: number, context: OffscreenCanvasRenderingContext2D): void {
    const scale = Settings.tileSize;
    context.fillStyle = VOID_LOOK.void;
    for (const tile of this.tiles().tiles) {
      const s = toSdk(tile);
      context.fillRect(s.x * scale, s.y * scale, scale, scale);
    }
  }

  protected override create3dModel(): Model {
    return new VoidModel(this.tiles);
  }
}

/** Plays a cache spotanim on a unit for its own length (the SDK's actor spotanim channel). */
export function spotOn(unit: Readonly<{ addSpotAnim: (s: { id: number; channel?: string; height?: number; delay?: number }) => void }>, id: number, channel: string, height = 0, delay = 0): void {
  unit.addSpotAnim({ id, channel, height, delay });
}

export type { Renderable };

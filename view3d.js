/* ===========================================================================
 * view3d.js  --  Experimental 3D companion view for the Game Boy emulator.
 *
 * It reads the LIVE background tilemap, OAM sprites, and VRAM tile data straight
 * out of the emulator's MMU every frame, classifies each visible 8x8 tile by
 * matching its pixel pattern against a small library of reference "signatures",
 * and renders the recognised assets with Three.js -- keeping the original
 * pixel-art look.
 *
 * First milestone: detect + render TALL GRASS, FENCES, and HOUSES from Pokemon Red's
 * "overworld" tileset. Everything is content-based (no hard-coded tile IDs),
 * so it keeps working as the map scrolls and as tiles get reloaded.
 *
 * See CLAUDE.md for the architecture overview and how to add new assets.
 * ===========================================================================
 */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Tile signatures
  // ---------------------------------------------------------------------------
  // Each signature is one 8x8 Game Boy tile in raw 2bpp form (16 bytes, two
  // bytes per row: low bit-plane then high bit-plane). These were extracted
  // from gfx/tilesets/overworld.png -- see scripts referenced in CLAUDE.md.
  //
  // `category` is what the renderer keys off. Multiple signatures can map to
  // the same category (each fence/barrier motif contributes four tiles; houses
  // are grouped later into one building model per connected region).
  const RAW_SIGNATURES = [
    { key: "tallgrass", category: "tallgrass", label: "Tall grass", srcTile: 82,
      bytes: [1, 2, 0, 5, 6, 201, 5, 170, 32, 158, 18, 76, 208, 44, 100, 24] },
    { key: "grass_detail", category: "grass", label: "Grass ground", srcTile: 57,
      bytes: [0, 0, 80, 0, 85, 0, 5, 0, 0, 0, 40, 0, 40, 0, 0, 0] },
    { key: "flower_anim_1", category: "flower", label: "Flower", srcTile: null,
      bytes: [129, 0, 0, 24, 0, 36, 133, 90, 28, 66, 24, 165, 0, 126, 129, 24] },
    { key: "flower_anim_2", category: "flower", label: "Flower", srcTile: null,
      bytes: [129, 0, 0, 12, 0, 18, 130, 45, 14, 225, 12, 115, 0, 62, 129, 24] },
    { key: "flower_anim_3", category: "flower", label: "Flower", srcTile: null,
      bytes: [129, 24, 0, 36, 4, 90, 157, 66, 24, 36, 0, 219, 0, 126, 129, 24] },
    { key: "billboard_46", category: "billboard", label: "Billboard", srcTile: 70,
      bytes: [127, 127, 79, 127, 48, 48, 127, 127, 255, 128, 128, 160, 128, 181, 128, 128] },
    { key: "billboard_47", category: "billboard", label: "Billboard", srcTile: 71,
      bytes: [254, 254, 231, 255, 29, 27, 253, 255, 255, 3, 3, 51, 3, 183, 3, 3] },
    { key: "billboard_56", category: "billboard", label: "Billboard", srcTile: 86,
      bytes: [128, 176, 128, 181, 128, 128, 127, 127, 81, 0, 82, 0, 1, 0, 0, 0] },
    { key: "billboard_57", category: "billboard", label: "Billboard", srcTile: 87,
      bytes: [3, 43, 3, 171, 3, 3, 253, 255, 105, 27, 205, 59, 73, 63, 182, 15] },
    { key: "house_05", category: "house", label: "House", srcTile: 5,
      bytes: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 6, 6, 24, 30, 96, 118] },
    { key: "house_06", category: "house", label: "House", srcTile: 6,
      bytes: [1, 1, 6, 7, 24, 27, 96, 123, 128, 219, 0, 219, 0, 219, 0, 219] },
    { key: "house_07", category: "house", label: "House", srcTile: 7,
      bytes: [255, 255, 0, 0, 255, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 0] },
    { key: "house_08", category: "house", label: "House", srcTile: 8,
      bytes: [128, 128, 96, 224, 24, 216, 6, 222, 1, 219, 0, 219, 0, 219, 0, 219] },
    { key: "house_09", category: "house", label: "House", srcTile: 9,
      bytes: [0, 0, 0, 0, 0, 0, 0, 0, 128, 128, 96, 96, 24, 120, 6, 110] },
    { key: "house_0a", category: "house", label: "House", srcTile: 10,
      bytes: [255, 0, 126, 255, 133, 129, 137, 131, 147, 133, 165, 139, 201, 151, 126, 255] },
    { key: "house_0b", category: "house", label: "House", srcTile: 11,
      bytes: [95, 160, 127, 191, 96, 191, 103, 191, 40, 184, 40, 184, 41, 184, 42, 184] },
    { key: "house_0c", category: "house", label: "House", srcTile: 12,
      bytes: [250, 5, 254, 253, 6, 253, 230, 253, 84, 29, 180, 29, 116, 29, 244, 29] },
    { key: "house_15", category: "house", label: "House", srcTile: 21,
      bytes: [128, 182, 128, 182, 128, 182, 128, 182, 128, 182, 128, 182, 128, 182, 128, 182] },
    { key: "house_16", category: "house", label: "House", srcTile: 22,
      bytes: [0, 219, 0, 219, 0, 219, 0, 219, 0, 219, 1, 219, 6, 223, 25, 223] },
    { key: "house_17", category: "house", label: "House", srcTile: 23,
      bytes: [0, 255, 255, 0, 255, 0, 255, 0, 255, 0, 255, 255, 0, 255, 255, 255] },
    { key: "house_18", category: "house", label: "House", srcTile: 24,
      bytes: [0, 219, 0, 219, 0, 219, 0, 219, 0, 219, 128, 219, 96, 251, 152, 251] },
    { key: "house_19", category: "house", label: "House", srcTile: 25,
      bytes: [1, 109, 1, 109, 1, 109, 1, 109, 1, 109, 1, 109, 1, 109, 1, 109] },
    { key: "house_1a", category: "house", label: "House", srcTile: 26,
      bytes: [255, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 255, 255, 255, 255, 0] },
    { key: "house_1b", category: "house", label: "House", srcTile: 27,
      bytes: [39, 191, 32, 191, 40, 176, 39, 176, 39, 176, 32, 191, 63, 191, 255, 192] },
    { key: "house_1c", category: "house", label: "House", srcTile: 28,
      bytes: [236, 253, 20, 245, 28, 13, 244, 13, 244, 13, 4, 253, 252, 253, 255, 3] },
    { key: "house_1f", category: "house", label: "House", srcTile: 31,
      bytes: [62, 32, 62, 32, 62, 32, 62, 32, 62, 32, 62, 32, 62, 32, 62, 32] },
    { key: "house_25", category: "house", label: "House", srcTile: 37,
      bytes: [128, 182, 129, 183, 134, 183, 153, 191, 231, 254, 159, 248, 127, 120, 14, 8] },
    { key: "house_26", category: "house", label: "House", srcTile: 38,
      bytes: [103, 254, 159, 248, 127, 224, 255, 128, 248, 0, 224, 0, 128, 0, 0, 0] },
    { key: "house_28", category: "house", label: "House", srcTile: 40,
      bytes: [230, 127, 249, 31, 254, 7, 255, 1, 31, 0, 7, 0, 1, 0, 0, 0] },
    { key: "house_29", category: "house", label: "House", srcTile: 41,
      bytes: [1, 109, 129, 237, 97, 237, 153, 253, 231, 127, 249, 31, 254, 30, 112, 16] },
    { key: "house_4b", category: "house", label: "House", srcTile: 75,
      bytes: [0, 0, 252, 2, 252, 2, 0, 0, 207, 32, 207, 32, 0, 0, 124, 2] },
    { key: "house_4e", category: "house", label: "House", srcTile: 78,
      bytes: [127, 4, 124, 4, 124, 4, 127, 4, 126, 5, 126, 5, 127, 3, 127, 0] },
    { key: "house_4f", category: "house", label: "House", srcTile: 79,
      bytes: [254, 32, 62, 32, 62, 32, 254, 32, 126, 160, 126, 160, 254, 192, 254, 0] },
    { key: "fence_round_tl", category: "fence", label: "Fence", srcTile: 42,
      bytes: [3, 3, 13, 14, 20, 24, 32, 48, 48, 32, 44, 48, 43, 52, 104, 54] },
    { key: "fence_round_tr", category: "fence", label: "Fence", srcTile: 43,
      bytes: [224, 224, 216, 56, 20, 12, 2, 6, 6, 2, 26, 6, 234, 22, 10, 54] },
    { key: "fence_round_bl", category: "fence", label: "Fence", srcTile: 58,
      bytes: [248, 38, 190, 96, 174, 112, 168, 118, 24, 118, 76, 62, 35, 31, 28, 3] },
    { key: "fence_round_br", category: "fence", label: "Fence", srcTile: 59,
      bytes: [14, 50, 62, 2, 58, 6, 10, 54, 12, 54, 24, 60, 224, 248, 0, 224] },
    { key: "fence_tl", category: "fence", label: "Fence", srcTile: 64,
      bytes: [175, 7, 76, 56, 184, 16, 81, 48, 186, 96, 74, 116, 245, 106, 126, 49] },
    { key: "fence_tr", category: "fence", label: "Fence", srcTile: 65,
      bytes: [149, 192, 106, 112, 186, 52, 20, 90, 41, 44, 150, 124, 173, 252, 122, 220] },
    { key: "fence_bl", category: "fence", label: "Fence", srcTile: 80,
      bytes: [245, 90, 171, 245, 245, 222, 107, 255, 191, 127, 94, 191, 165, 94, 91, 7] },
    { key: "fence_br", category: "fence", label: "Fence", srcTile: 81,
      bytes: [173, 254, 215, 126, 238, 254, 125, 254, 250, 252, 116, 250, 169, 116, 219, 224] },
    { key: "post_fence_top", category: "postfence", label: "Post fence", srcTile: 14,
      bytes: [0, 0, 0, 0, 60, 60, 126, 126, 126, 126, 122, 94, 114, 78, 114, 78] },
    { key: "post_fence_bottom", category: "postfence", label: "Post fence", srcTile: 85,
      bytes: [114, 78, 114, 78, 86, 74, 78, 66, 106, 70, 52, 110, 24, 60, 0, 0] },
  ];

  // A visible tile is accepted as a match when at least this many of its 64
  // pixels equal the signature. VRAM holds the exact tileset graphics, so an
  // exact match is normal; the small tolerance covers ROM-region variants and
  // the tall-grass two-frame shuffle.
  const MATCH_THRESHOLD = 60;

  // Visible window: the GB screen is exactly 20x18 tiles.
  const COLS = 20;
  const ROWS = 18;
  const TILE = 8; // px per GB tile
  // Pokemon overworld characters are 2x2 OAM metasprites. Keep composites
  // within that footprint so adjacent actors do not become one tall billboard.
  const SPRITE_COMPONENT_MAX_PX = TILE * 2;
  const SPRITE_COMPONENT_MAX_OAM_SPAN = 3;
  const HOUSE_MIN_TILES = 10;
  const HOUSE_MIN_WIDTH = 4;
  const HOUSE_MIN_DEPTH = 3;
  const BILLBOARD_MIN_TILES = 4;

  // Game Boy "green" palette -- kept in sync with pixelprocessingunit.js.
  const GB_PALETTE = [
    [224, 248, 208],
    [136, 192, 112],
    [52, 104, 86],
    [8, 24, 32],
  ];

  // ---------------------------------------------------------------------------
  // 2bpp helpers
  // ---------------------------------------------------------------------------
  // Decode 16 bytes of Game Boy 2bpp tile data into 64 colour indices (0..3),
  // row-major. `out` is reused to avoid per-tile allocation.
  function decode2bpp(bytes, offset, out) {
    for (let y = 0; y < 8; y++) {
      const b1 = bytes[offset + y * 2];
      const b2 = bytes[offset + y * 2 + 1];
      for (let x = 0; x < 8; x++) {
        const bit = 7 - x;
        out[y * 8 + x] = (((b2 >> bit) & 1) << 1) | ((b1 >> bit) & 1);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Minimal orbit camera controller (so we don't depend on a CDN OrbitControls)
  // ---------------------------------------------------------------------------
  class OrbitController {
    constructor(camera, domElement, target) {
      this.camera = camera;
      this.dom = domElement;
      this.target = target.clone();
      // Spherical coordinates around the target.
      this.radius = 26;
      this.minRadius = 6;
      this.maxRadius = 90;
      this.theta = -0.7;          // azimuth
      this.phi = 0.95;            // polar (0 = straight down)
      this.minPhi = 0.15;
      this.maxPhi = Math.PI / 2 - 0.05;

      this._dragging = null;      // 'rotate' | 'pan' | null
      this._lastX = 0;
      this._lastY = 0;
      this._pinchDist = 0;

      this._bind();
      this.update();
    }

    _bind() {
      const dom = this.dom;
      dom.style.touchAction = "none";

      dom.addEventListener("contextmenu", (e) => e.preventDefault());

      dom.addEventListener("pointerdown", (e) => {
        dom.setPointerCapture(e.pointerId);
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        this._dragging =
          e.button === 2 || e.shiftKey ? "pan" : "rotate";
      });

      dom.addEventListener("pointermove", (e) => {
        if (!this._dragging) return;
        const dx = e.clientX - this._lastX;
        const dy = e.clientY - this._lastY;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        if (this._dragging === "rotate") {
          this.theta -= dx * 0.008;
          this.phi -= dy * 0.008;
          this.phi = Math.max(this.minPhi, Math.min(this.maxPhi, this.phi));
        } else {
          this._pan(dx, dy);
        }
        this.update();
      });

      const endDrag = (e) => {
        this._dragging = null;
        if (dom.hasPointerCapture && dom.hasPointerCapture(e.pointerId)) {
          dom.releasePointerCapture(e.pointerId);
        }
      };
      dom.addEventListener("pointerup", endDrag);
      dom.addEventListener("pointercancel", endDrag);

      dom.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          const scale = Math.exp(e.deltaY * 0.0012);
          this.radius = Math.max(
            this.minRadius,
            Math.min(this.maxRadius, this.radius * scale)
          );
          this.update();
        },
        { passive: false }
      );

      // Basic touch: one finger rotates, two fingers pinch-zoom.
      dom.addEventListener(
        "touchstart",
        (e) => {
          if (e.touches.length === 2) {
            this._pinchDist = this._touchDist(e);
          }
        },
        { passive: true }
      );
      dom.addEventListener(
        "touchmove",
        (e) => {
          if (e.touches.length === 2) {
            const d = this._touchDist(e);
            if (this._pinchDist > 0) {
              const scale = this._pinchDist / d;
              this.radius = Math.max(
                this.minRadius,
                Math.min(this.maxRadius, this.radius * scale)
              );
              this.update();
            }
            this._pinchDist = d;
          }
        },
        { passive: true }
      );
    }

    _touchDist(e) {
      const a = e.touches[0];
      const b = e.touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }

    _pan(dx, dy) {
      // Pan in the camera's local screen plane, projected onto the ground.
      const panSpeed = this.radius * 0.0016;
      const cam = this.camera;
      const right = new global.THREE.Vector3();
      const up = new global.THREE.Vector3(0, 1, 0);
      right.setFromMatrixColumn(cam.matrix, 0); // camera X axis
      const forward = new global.THREE.Vector3();
      forward.crossVectors(up, right).normalize();
      this.target.addScaledVector(right, -dx * panSpeed);
      this.target.addScaledVector(forward, -dy * panSpeed);
    }

    setTarget(v) {
      this.target.copy(v);
      this.update();
    }

    update() {
      const sinPhi = Math.sin(this.phi);
      const x = this.target.x + this.radius * sinPhi * Math.sin(this.theta);
      const y = this.target.y + this.radius * Math.cos(this.phi);
      const z = this.target.z + this.radius * sinPhi * Math.cos(this.theta);
      this.camera.position.set(x, y, z);
      this.camera.lookAt(this.target);
    }
  }

  // ---------------------------------------------------------------------------
  // View3D
  // ---------------------------------------------------------------------------
  class View3D {
    /**
     * @param {HTMLCanvasElement} canvas  canvas to render the 3D scene into
     * @param {MemoryManagementUnit} mmu  the running emulator's MMU
     * @param {object} [options]
     * @param {HTMLElement} [options.hudElement]  optional element for the
     *        detection-count readout
     */
    constructor(canvas, mmu, options) {
      options = options || {};
      this.canvas = canvas;
      this.mmu = mmu;
      this.hud = options.hudElement || null;
      this.THREE = global.THREE;
      this.available = !!this.THREE;

      this.counts = {
        tallgrass: 0,
        fence: 0,
        postfence: 0,
        flower: 0,
        grass: 0,
        house: 0,
        billboard: 0,
      };

      if (!this.available) {
        this._showUnavailable();
        return;
      }

      // Decode signatures once into flat colour-index arrays for fast matching.
      this.signatures = RAW_SIGNATURES.map((s) => ({
        key: s.key,
        category: s.category,
        label: s.label,
        srcTile: s.srcTile,
        pixels: decode2bpp(s.bytes, 0, new Uint8Array(64)),
      }));

      // Scratch buffers reused every frame (no per-tile allocation).
      this._tileBytes = new Uint8Array(16);
      this._tilePixels = new Uint8Array(64);

      // Cache of GPU textures/materials keyed by raw tile content, so animated
      // or repeated tiles don't rebuild textures. Tile variety is tiny.
      this._matCache = new Map();
      this._spriteMatCache = new Map();

      this._initThree();
      this._lastSig = null;
      this._lastW = 0;
      this._lastH = 0;
    }

    // -- public API -----------------------------------------------------------

    /** Call once per emulator frame, after the PPU has stepped. */
    update() {
      if (!this.available) return;
      this._resizeIfNeeded();

      const mem = this.mmu && this.mmu.memory;
      if (!mem) {
        this._renderer.render(this._scene, this._camera);
        return;
      }

      const lcdc = mem[0xff40];
      const lcdOn = (lcdc & 0x80) !== 0 && (lcdc & 0x01) !== 0;
      this._emptyState.visible = !lcdOn;
      this._floorMesh.visible = lcdOn;
      if (!lcdOn) {
        this._clearWorld();
        this._disposeGroupChildren(this._spriteGroup);
        this._updateHud();
        this._controls.update();
        this._renderer.render(this._scene, this._camera);
        return;
      }

      const scx = mem[0xff43];
      const scy = mem[0xff42];
      const bgMapBase = (lcdc & 0x08) !== 0 ? 0x9c00 : 0x9800;
      const bgDataArea = (lcdc & 0x10) !== 0;
      const bgp = mem[0xff47];
      const startCol = scx >> 3;
      const startRow = scy >> 3;

      // Cheap change-detection: hash the inputs that affect tile-level content.
      const sig = this._sceneHash(
        mem, bgMapBase, bgDataArea, bgp, startCol, startRow
      );
      if (sig !== this._lastSig) {
        this._lastSig = sig;
        this._rebuild(mem, bgMapBase, bgDataArea, bgp, startCol, startRow);
        this._updateHud();
      }

      // Smooth sub-tile scroll: shift the whole world group by the fractional
      // part of the scroll registers. Tile-level rebuilds only happen on a
      // genuine content change.
      this._world.position.set(-(scx & 7) / 8, 0, -(scy & 7) / 8);

      this._rebuildSprites(mem, lcdc);
      this._controls.update();
      this._faceSpritesToCamera();
      this._renderer.render(this._scene, this._camera);
    }

    /** Re-frame the camera on the centre of the visible grid. */
    resetCamera() {
      if (!this.available) return;
      this._controls.theta = -0.7;
      this._controls.phi = 0.95;
      this._controls.radius = 26;
      this._controls.setTarget(
        new this.THREE.Vector3(COLS / 2, 0.5, ROWS / 2)
      );
    }

    getCounts() {
      return Object.assign({}, this.counts);
    }

    // -- Three.js setup -------------------------------------------------------

    _initThree() {
      const THREE = this.THREE;

      this._renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
      });
      this._renderer.setPixelRatio(global.devicePixelRatio || 1);

      this._scene = new THREE.Scene();
      this._scene.background = new THREE.Color(0xa8c8e0); // soft sky

      this._camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);

      // Lights: flat ambient + one angled directional for gentle box shading.
      this._scene.add(new THREE.AmbientLight(0xffffff, 0.78));
      const sun = new THREE.DirectionalLight(0xffffff, 0.55);
      sun.position.set(-8, 18, 6);
      this._scene.add(sun);

      // The "world" group holds everything map-related and gets nudged around
      // for smooth sub-tile scrolling.
      this._world = new THREE.Group();
      this._scene.add(this._world);

      // Shared geometries (created once, reused by every mesh).
      this._floorGeo = new THREE.PlaneGeometry(COLS, ROWS);
      this._floorGeo.rotateX(-Math.PI / 2);
      this._floorGeo.translate(COLS / 2, 0, ROWS / 2);

      this._grassGeoA = new THREE.PlaneGeometry(0.95, 0.85);
      this._grassGeoB = new THREE.PlaneGeometry(0.95, 0.85);
      this._grassGeoB.rotateY(Math.PI / 2);
      this._grassGeoA.translate(0, 0.42, 0);
      this._grassGeoB.translate(0, 0.42, 0);

      this._flowerGeoA = new THREE.PlaneGeometry(0.62, 0.5);
      this._flowerGeoB = new THREE.PlaneGeometry(0.62, 0.5);
      this._flowerGeoB.rotateY(Math.PI / 2);
      this._flowerGeoA.translate(0, 0.25, 0);
      this._flowerGeoB.translate(0, 0.25, 0);

      this._boxGeo = new THREE.BoxGeometry(1, 1, 1);
      this._spriteGeo8 = new THREE.PlaneGeometry(1, 1);
      this._spriteGeo8.translate(0, 0.5, 0);
      this._spriteGeo16 = new THREE.PlaneGeometry(1, 2);
      this._spriteGeo16.translate(0, 1, 0);
      this._tileTopGeo = new THREE.PlaneGeometry(1, 1);
      this._tileTopGeo.rotateX(-Math.PI / 2);
      this._billboardFaceGeo = new THREE.PlaneGeometry(1, 0.72);
      this._houseWallMat = new THREE.MeshLambertMaterial({ color: 0xe0f8d0 });
      this._houseRoofMat = new THREE.MeshLambertMaterial({ color: 0x88c070 });
      this._houseDarkMat = new THREE.MeshLambertMaterial({ color: 0x081820 });
      this._fenceBodyMat = new THREE.MeshLambertMaterial({ color: 0x88c070 });
      this._billboardPostMat = new THREE.MeshLambertMaterial({ color: 0x346856 });
      this._postFenceMat = new THREE.MeshLambertMaterial({ color: 0x346856 });
      this._fenceSideFallbackMat = new THREE.MeshBasicMaterial({ color: 0x88c070 });

      // Floor: a single mesh with a CanvasTexture redrawn on each rebuild.
      this._floorCanvas = document.createElement("canvas");
      this._floorCanvas.width = COLS * TILE;
      this._floorCanvas.height = ROWS * TILE;
      this._floorCtx = this._floorCanvas.getContext("2d");
      this._floorTex = new THREE.CanvasTexture(this._floorCanvas);
      this._floorTex.magFilter = THREE.NearestFilter;
      this._floorTex.minFilter = THREE.NearestFilter;
      this._floorTex.generateMipmaps = false;
      this._floorMesh = new THREE.Mesh(
        this._floorGeo,
        new THREE.MeshBasicMaterial({ map: this._floorTex })
      );
      this._world.add(this._floorMesh);

      // Containers for the detected props.
      this._grassGroup = new THREE.Group();
      this._fenceGroup = new THREE.Group();
      this._postFenceGroup = new THREE.Group();
      this._flowerGroup = new THREE.Group();
      this._houseGroup = new THREE.Group();
      this._billboardGroup = new THREE.Group();
      this._world.add(this._grassGroup);
      this._world.add(this._fenceGroup);
      this._world.add(this._postFenceGroup);
      this._world.add(this._flowerGroup);
      this._world.add(this._houseGroup);
      this._world.add(this._billboardGroup);

      this._spriteGroup = new THREE.Group();
      this._scene.add(this._spriteGroup);

      // "No signal" placeholder shown when the LCD is off / no ROM.
      const emptyGeo = new THREE.PlaneGeometry(COLS, ROWS);
      emptyGeo.rotateX(-Math.PI / 2);
      emptyGeo.translate(COLS / 2, 0, ROWS / 2);
      this._emptyState = new THREE.Mesh(
        emptyGeo,
        new THREE.MeshBasicMaterial({ color: 0x2b3a2b })
      );
      this._emptyState.visible = false;
      this._scene.add(this._emptyState);

      this._controls = new OrbitController(
        this._camera,
        this.canvas,
        new THREE.Vector3(COLS / 2, 0.5, ROWS / 2)
      );

      this._resizeIfNeeded(true);
    }

    _resizeIfNeeded(force) {
      const w = this.canvas.clientWidth || 480;
      const h = this.canvas.clientHeight || 432;
      if (!force && w === this._lastW && h === this._lastH) return;
      this._lastW = w;
      this._lastH = h;
      this._renderer.setSize(w, h, false);
      this._camera.aspect = w / Math.max(1, h);
      this._camera.updateProjectionMatrix();
    }

    // -- tile reading / classification ---------------------------------------

    // Resolve the VRAM address of a tile's 16-byte graphic from a tilemap entry.
    _tileDataAddress(tileIndex, bgDataArea) {
      if (bgDataArea) {
        return 0x8000 + tileIndex * 16;
      }
      const signed = (tileIndex << 24) >> 24; // sign-extend 8-bit
      return 0x9000 + signed * 16;
    }

    // Compare a decoded tile against every signature; return the matching
    // signature object or null. Strict-ish: needs MATCH_THRESHOLD/64 pixels.
    _classify(pixels) {
      let best = null;
      let bestScore = MATCH_THRESHOLD - 1;
      for (let i = 0; i < this.signatures.length; i++) {
        const sig = this.signatures[i];
        const sp = sig.pixels;
        let score = 0;
        for (let p = 0; p < 64; p++) {
          if (pixels[p] === sp[p]) score++;
        }
        if (score > bestScore) {
          bestScore = score;
          best = sig;
        }
      }
      return best;
    }

    // FNV-1a over the inputs that change tile-level content. Sub-tile scroll is
    // deliberately excluded (handled by moving the world group instead).
    _sceneHash(mem, bgMapBase, bgDataArea, bgp, startCol, startRow) {
      let h = 0x811c9dc5;
      h = (h ^ bgp) >>> 0; h = Math.imul(h, 0x01000193);
      h = (h ^ (bgDataArea ? 1 : 0)) >>> 0; h = Math.imul(h, 0x01000193);
      h = (h ^ startCol) >>> 0; h = Math.imul(h, 0x01000193);
      h = (h ^ startRow) >>> 0; h = Math.imul(h, 0x01000193);
      for (let r = 0; r < ROWS; r++) {
        const mapRow = (startRow + r) & 31;
        for (let c = 0; c < COLS; c++) {
          const mapCol = (startCol + c) & 31;
          const entry = mem[bgMapBase + mapRow * 32 + mapCol];
          h = (h ^ entry) >>> 0;
          h = Math.imul(h, 0x01000193);
          // Fold in a couple of content bytes so animated tiles still trigger
          // a rebuild even when the tilemap index is unchanged.
          const addr = this._tileDataAddress(entry, bgDataArea);
          h = (h ^ mem[addr]) >>> 0; h = Math.imul(h, 0x01000193);
          h = (h ^ mem[addr + 7]) >>> 0; h = Math.imul(h, 0x01000193);
          h = (h ^ mem[addr + 15]) >>> 0; h = Math.imul(h, 0x01000193);
        }
      }
      return h >>> 0;
    }

    // -- scene rebuild --------------------------------------------------------

    _clearWorld() {
      this._disposeGroupChildren(this._grassGroup);
      this._disposeGroupChildren(this._fenceGroup);
      this._disposeGroupChildren(this._postFenceGroup);
      this._disposeGroupChildren(this._flowerGroup);
      this._disposeGroupChildren(this._houseGroup);
      this._disposeGroupChildren(this._billboardGroup);
      this.counts.tallgrass = 0;
      this.counts.fence = 0;
      this.counts.postfence = 0;
      this.counts.flower = 0;
      this.counts.grass = 0;
      this.counts.house = 0;
      this.counts.billboard = 0;
    }

    _disposeGroupChildren(group) {
      for (let i = group.children.length - 1; i >= 0; i--) {
        group.remove(group.children[i]);
      }
    }

    _rebuild(mem, bgMapBase, bgDataArea, bgp, startCol, startRow) {
      const THREE = this.THREE;
      this._clearWorld();

      const floorImg = this._floorCtx.createImageData(COLS * TILE, ROWS * TILE);
      const fd = floorImg.data;
      const fenceCells = [];
      const houseCells = [];
      const billboardCells = [];
      const postFenceCells = [];

      for (let r = 0; r < ROWS; r++) {
        const mapRow = (startRow + r) & 31;
        for (let c = 0; c < COLS; c++) {
          const mapCol = (startCol + c) & 31;
          const entry = mem[bgMapBase + mapRow * 32 + mapCol];
          const addr = this._tileDataAddress(entry, bgDataArea);

          // Copy 16 bytes of tile graphics out of VRAM.
          for (let b = 0; b < 16; b++) this._tileBytes[b] = mem[addr + b];
          const pixels = decode2bpp(this._tileBytes, 0, this._tilePixels);

          // 1) Paint this tile onto the shared floor texture (BGP applied,
          //    so the floor matches the 2D screen exactly).
          this._blitTileToFloor(fd, pixels, bgp, c, r);

          // 2) Classify and, when recognised, drop a 3D prop on top.
          const match = this._classify(pixels);
          if (!match) continue;

          if (match.category === "tallgrass") {
            this.counts.tallgrass++;
            this._addGrassTuft(pixels, bgp, c, r);
          } else if (match.category === "fence") {
            fenceCells.push({
              col: c,
              row: r,
              srcTile: match.srcTile,
              pixels: new Uint8Array(pixels),
            });
          } else if (match.category === "postfence") {
            postFenceCells.push({
              col: c,
              row: r,
              srcTile: match.srcTile,
              pixels: new Uint8Array(pixels),
            });
          } else if (match.category === "house") {
            houseCells.push({
              col: c,
              row: r,
              srcTile: match.srcTile,
              pixels: new Uint8Array(pixels),
            });
          } else if (match.category === "billboard") {
            billboardCells.push({
              col: c,
              row: r,
              srcTile: match.srcTile,
              pixels: new Uint8Array(pixels),
            });
          } else if (match.category === "flower") {
            this.counts.flower++;
            this._addFlower(pixels, bgp, c, r);
          } else if (match.category === "grass") {
            this.counts.grass++;
            // Ground grass is conveyed by the floor texture itself; no prop.
          }
        }
      }

      this._addFenceModels(fenceCells, bgp);
      this._addPostFenceModels(postFenceCells, bgp);
      this._addHouseModels(houseCells, bgp);
      this._addBillboardModels(billboardCells, bgp);
      this._floorCtx.putImageData(floorImg, 0, 0);
      this._floorTex.needsUpdate = true;
    }

    // Write one decoded tile into the big floor ImageData buffer.
    _blitTileToFloor(fd, pixels, bgp, col, row) {
      const baseX = col * TILE;
      const baseY = row * TILE;
      const stride = COLS * TILE * 4;
      for (let y = 0; y < 8; y++) {
        let o = (baseY + y) * stride + baseX * 4;
        for (let x = 0; x < 8; x++) {
          const ci = pixels[y * 8 + x];
          const shade = (bgp >> (ci * 2)) & 0x03;
          const rgb = GB_PALETTE[shade];
          fd[o++] = rgb[0];
          fd[o++] = rgb[1];
          fd[o++] = rgb[2];
          fd[o++] = 255;
        }
      }
    }

    // Build (or fetch from cache) a NearestFilter texture for one tile.
    // `transparentLightest` makes colour-index-0 pixels transparent, which
    // gives grass tufts a ragged, clumpy silhouette instead of a solid square.
    _tileMaterial(pixels, bgp, transparentLightest) {
      const THREE = this.THREE;
      // Cache key: the raw pixels + bgp + transparency flag.
      let key = (transparentLightest ? "t" : "o") + bgp + ":";
      for (let p = 0; p < 64; p++) key += pixels[p];
      const cached = this._matCache.get(key);
      if (cached) return cached;

      const cv = document.createElement("canvas");
      cv.width = 8;
      cv.height = 8;
      const cx = cv.getContext("2d");
      const img = cx.createImageData(8, 8);
      for (let i = 0; i < 64; i++) {
        const ci = pixels[i];
        const shade = (bgp >> (ci * 2)) & 0x03;
        const rgb = GB_PALETTE[shade];
        img.data[i * 4] = rgb[0];
        img.data[i * 4 + 1] = rgb[1];
        img.data[i * 4 + 2] = rgb[2];
        img.data[i * 4 + 3] = transparentLightest && ci === 0 ? 0 : 255;
      }
      cx.putImageData(img, 0, 0);

      const tex = new THREE.CanvasTexture(cv);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;

      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: !!transparentLightest,
        alphaTest: transparentLightest ? 0.5 : 0,
        side: THREE.DoubleSide,
      });
      const record = { material: mat, texture: tex };
      this._matCache.set(key, record);
      return record;
    }

    // Tall grass -> two crossed billboards, textured with the live grass tile.
    _addGrassTuft(pixels, bgp, col, row) {
      const rec = this._tileMaterial(pixels, bgp, true);
      const a = new this.THREE.Mesh(this._grassGeoA, rec.material);
      const b = new this.THREE.Mesh(this._grassGeoB, rec.material);
      a.position.set(col + 0.5, 0, row + 0.5);
      b.position.set(col + 0.5, 0, row + 0.5);
      this._grassGroup.add(a);
      this._grassGroup.add(b);
    }

    _addFenceModels(fenceCells, bgp) {
      if (!fenceCells.length) return;

      const byKey = new Map();
      for (let i = 0; i < fenceCells.length; i++) {
        const cell = fenceCells[i];
        byKey.set(cell.col + "," + cell.row, cell);
      }

      const used = new Set();
      const motifs = [];
      for (let i = 0; i < fenceCells.length; i++) {
        const cell = fenceCells[i];
        const key = cell.col + "," + cell.row;
        if (used.has(key)) continue;

        const motif = this._fenceMotifAt(byKey, cell.col, cell.row);
        if (!motif) continue;

        let blocked = false;
        for (let m = 0; m < motif.cells.length; m++) {
          const mKey = motif.cells[m].col + "," + motif.cells[m].row;
          if (used.has(mKey)) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        for (let m = 0; m < motif.cells.length; m++) {
          used.add(motif.cells[m].col + "," + motif.cells[m].row);
        }
        motifs.push(motif);
      }

      const motifKeys = new Set();
      for (let i = 0; i < motifs.length; i++) {
        const motif = motifs[i];
        motifKeys.add(motif.col + "," + motif.row);
        this.counts.fence++;
        this._addFenceModel(motif, bgp);
      }

      for (let i = 0; i < motifs.length; i++) {
        const motif = motifs[i];
        if (motifKeys.has((motif.col + 2) + "," + motif.row)) {
          this._addFenceRail(motif.col + 2, motif.row + 1, "x");
        }
        if (motifKeys.has(motif.col + "," + (motif.row + 2))) {
          this._addFenceRail(motif.col + 1, motif.row + 2, "z");
        }
      }
    }

    _fenceMotifAt(byKey, col, row) {
      const candidates = [
        { type: "round", tiles: [42, 43, 58, 59] },
        { type: "post", tiles: [64, 65, 80, 81] },
      ];

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const tl = byKey.get(col + "," + row);
        const tr = byKey.get((col + 1) + "," + row);
        const bl = byKey.get(col + "," + (row + 1));
        const br = byKey.get((col + 1) + "," + (row + 1));
        if (
          tl && tr && bl && br &&
          tl.srcTile === c.tiles[0] &&
          tr.srcTile === c.tiles[1] &&
          bl.srcTile === c.tiles[2] &&
          br.srcTile === c.tiles[3]
        ) {
          return {
            type: c.type,
            col,
            row,
            cells: [tl, tr, bl, br],
          };
        }
      }
      return null;
    }

    _addFenceModel(motif, bgp) {
      const x = motif.col + 1;
      const z = motif.row + 1;
      const round = motif.type === "round";
      const width = round ? 1.38 : 1.24;
      const depth = round ? 1.38 : 1.18;
      const height = round ? 0.82 : 0.72;

      const faceMats = this._fenceBoxMaterials(motif, bgp);
      const body = new this.THREE.Mesh(this._boxGeo, faceMats);
      body.position.set(x, height / 2, z);
      body.scale.set(width, height, depth);
      this._fenceGroup.add(body);
      this._addBox(
        this._fenceGroup, this._houseDarkMat,
        x, height + 0.04, z,
        width * 0.82, 0.08, depth * 0.82
      );

      const rec = this._tilePatchMaterial(motif.cells, motif.col, motif.row, 2, 2, bgp);
      const top = new this.THREE.Mesh(this._tileTopGeo, rec.material);
      top.position.set(x, height + 0.086, z);
      top.scale.set(width, depth, 1);
      this._fenceGroup.add(top);
    }

    _fenceBoxMaterials(motif, bgp) {
      const topPatch = this._tilePatchMaterial(motif.cells, motif.col, motif.row, 2, 2, bgp);
      const leftCells = this._fencePatchCells(motif, [0, 2]);
      const rightCells = this._fencePatchCells(motif, [1, 3]);
      const frontCells = this._fencePatchCells(motif, [2, 3]);
      const backCells = this._fencePatchCells(motif, [0, 1]);
      return [
        this._tilePatchMaterial(rightCells, motif.col + 1, motif.row, 1, 2, bgp).material,
        this._tilePatchMaterial(leftCells, motif.col, motif.row, 1, 2, bgp).material,
        topPatch.material,
        this._fenceSideFallbackMat,
        this._tilePatchMaterial(frontCells, motif.col, motif.row + 1, 2, 1, bgp).material,
        this._tilePatchMaterial(backCells, motif.col, motif.row, 2, 1, bgp).material,
      ];
    }

    _fencePatchCells(motif, indexes) {
      const out = [];
      for (let i = 0; i < indexes.length; i++) {
        out.push(motif.cells[indexes[i]]);
      }
      return out;
    }

    _addFenceRail(x, z, axis) {
      const sx = axis === "x" ? 1.1 : 0.16;
      const sz = axis === "x" ? 0.16 : 1.1;
      this._addBox(
        this._fenceGroup, this._fenceBodyMat,
        x, 0.42, z,
        sx, 0.22, sz
      );
      this._addBox(
        this._fenceGroup, this._houseDarkMat,
        x, 0.56, z,
        sx, 0.08, sz
      );
    }

    _tilePatchMaterial(cells, minCol, minRow, width, depth, bgp) {
      let key = "p" + bgp + ":" + width + "x" + depth + ":";
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        key += (cell.col - minCol) + "," + (cell.row - minRow) + ":";
        for (let p = 0; p < 64; p++) key += cell.pixels[p];
        key += ";";
      }

      const cached = this._matCache.get(key);
      if (cached) return cached;

      const cv = document.createElement("canvas");
      cv.width = width * TILE;
      cv.height = depth * TILE;
      const cx = cv.getContext("2d");
      const img = cx.createImageData(cv.width, cv.height);
      const stride = cv.width * 4;

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const baseX = (cell.col - minCol) * TILE;
        const baseY = (cell.row - minRow) * TILE;
        for (let y = 0; y < TILE; y++) {
          let o = (baseY + y) * stride + baseX * 4;
          for (let x = 0; x < TILE; x++) {
            const ci = cell.pixels[y * TILE + x];
            const shade = (bgp >> (ci * 2)) & 0x03;
            const rgb = GB_PALETTE[shade];
            img.data[o++] = rgb[0];
            img.data[o++] = rgb[1];
            img.data[o++] = rgb[2];
            img.data[o++] = 255;
          }
        }
      }
      cx.putImageData(img, 0, 0);

      const tex = new this.THREE.CanvasTexture(cv);
      tex.magFilter = this.THREE.NearestFilter;
      tex.minFilter = this.THREE.NearestFilter;
      tex.generateMipmaps = false;
      const mat = new this.THREE.MeshBasicMaterial({
        map: tex,
        side: this.THREE.DoubleSide,
      });
      const rec = { material: mat, texture: tex };
      this._matCache.set(key, rec);
      return rec;
    }

    _addFlower(pixels, bgp, col, row) {
      const rec = this._tileMaterial(pixels, bgp, true);
      const a = new this.THREE.Mesh(this._flowerGeoA, rec.material);
      const b = new this.THREE.Mesh(this._flowerGeoB, rec.material);
      a.position.set(col + 0.5, 0.02, row + 0.5);
      b.position.set(col + 0.5, 0.02, row + 0.5);
      this._flowerGroup.add(a);
      this._flowerGroup.add(b);
    }

    _addPostFenceModels(postFenceCells, bgp) {
      if (!postFenceCells.length) return;

      const byKey = new Map();
      for (let i = 0; i < postFenceCells.length; i++) {
        const cell = postFenceCells[i];
        byKey.set(cell.col + "," + cell.row, cell);
      }

      const used = new Set();
      for (let i = 0; i < postFenceCells.length; i++) {
        const top = postFenceCells[i];
        if (top.srcTile !== 14) continue;
        const topKey = top.col + "," + top.row;
        if (used.has(topKey)) continue;

        const bottomKey = top.col + "," + (top.row + 1);
        const bottom = byKey.get(bottomKey);
        if (!bottom || bottom.srcTile !== 85 || used.has(bottomKey)) continue;

        used.add(topKey);
        used.add(bottomKey);
        this.counts.postfence++;
        this._addPostFenceModel(top, bottom, bgp);
      }
    }

    _addPostFenceModel(topCell, bottomCell, bgp) {
      const col = topCell.col;
      const row = topCell.row;
      const x = col + 0.5;
      const z = row + 1.0;

      this._addBox(
        this._postFenceGroup, this._postFenceMat,
        x, 0.62, z,
        0.32, 1.24, 0.28
      );
      this._addBox(
        this._postFenceGroup, this._houseDarkMat,
        x, 1.27, z,
        0.38, 0.14, 0.34
      );

      const topRec = this._tileMaterial(topCell.pixels, bgp, true);
      const bottomRec = this._tileMaterial(bottomCell.pixels, bgp, true);
      this._addPostFenceFace(topRec.material, x, 0.96, z + 0.155);
      this._addPostFenceFace(bottomRec.material, x, 0.36, z + 0.155);
    }

    _addPostFenceFace(material, x, y, z) {
      const face = new this.THREE.Mesh(this._billboardFaceGeo, material);
      face.position.set(x, y, z);
      face.scale.set(0.72, 0.84, 1);
      this._postFenceGroup.add(face);
    }

    _addBillboardModels(billboardCells, bgp) {
      if (!billboardCells.length) return;

      const byKey = new Map();
      for (let i = 0; i < billboardCells.length; i++) {
        const cell = billboardCells[i];
        byKey.set(cell.col + "," + cell.row, cell);
      }

      const visited = new Set();
      for (let i = 0; i < billboardCells.length; i++) {
        const start = billboardCells[i];
        const startKey = start.col + "," + start.row;
        if (visited.has(startKey)) continue;

        const queue = [start];
        const component = [];
        visited.add(startKey);
        let minCol = start.col;
        let maxCol = start.col;
        let minRow = start.row;
        let maxRow = start.row;

        for (let q = 0; q < queue.length; q++) {
          const cell = queue[q];
          component.push(cell);
          minCol = Math.min(minCol, cell.col);
          maxCol = Math.max(maxCol, cell.col);
          minRow = Math.min(minRow, cell.row);
          maxRow = Math.max(maxRow, cell.row);

          const neighbours = [
            [cell.col + 1, cell.row],
            [cell.col - 1, cell.row],
            [cell.col, cell.row + 1],
            [cell.col, cell.row - 1],
          ];
          for (let n = 0; n < neighbours.length; n++) {
            const key = neighbours[n][0] + "," + neighbours[n][1];
            if (visited.has(key) || !byKey.has(key)) continue;
            visited.add(key);
            queue.push(byKey.get(key));
          }
        }

        const width = maxCol - minCol + 1;
        const depth = maxRow - minRow + 1;
        if (component.length < BILLBOARD_MIN_TILES || width < 2 || depth < 2) {
          continue;
        }

        this.counts.billboard++;
        this._addBillboardModel(minCol, maxCol, minRow, maxRow, component, bgp);
      }
    }

    _addBillboardModel(minCol, maxCol, minRow, maxRow, cells, bgp) {
      const width = maxCol - minCol + 1;
      const depth = maxRow - minRow + 1;
      const faceH = 0.72;
      const baseY = 0.52;
      const boardH = depth * faceH;
      const centerX = minCol + width / 2;
      const faceZ = minRow + depth * 0.55;
      const boardCenterY = baseY + boardH / 2;

      this._addBox(
        this._billboardGroup, this._houseDarkMat,
        centerX, boardCenterY, faceZ - 0.055,
        width + 0.12, boardH + 0.08, 0.12
      );

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const rec = this._tileMaterial(cell.pixels, bgp, false);
        const face = new this.THREE.Mesh(this._billboardFaceGeo, rec.material);
        face.position.set(
          cell.col + 0.5,
          baseY + (maxRow - cell.row + 0.5) * faceH,
          faceZ + 0.012
        );
        this._billboardGroup.add(face);
      }

      const postY = baseY / 2;
      const postH = baseY;
      const leftX = minCol + 0.28;
      const rightX = maxCol + 0.72;
      this._addBox(
        this._billboardGroup, this._billboardPostMat,
        leftX, postY, faceZ - 0.08,
        0.16, postH, 0.16
      );
      this._addBox(
        this._billboardGroup, this._billboardPostMat,
        rightX, postY, faceZ - 0.08,
        0.16, postH, 0.16
      );
      this._addBox(
        this._billboardGroup, this._billboardPostMat,
        centerX, baseY + boardH + 0.06, faceZ - 0.06,
        width + 0.12, 0.12, 0.14
      );
    }

    _addHouseModels(houseCells, bgp) {
      if (!houseCells.length) return;

      const byKey = new Map();
      for (let i = 0; i < houseCells.length; i++) {
        const cell = houseCells[i];
        byKey.set(cell.col + "," + cell.row, cell);
      }

      const visited = new Set();
      for (let i = 0; i < houseCells.length; i++) {
        const start = houseCells[i];
        const startKey = start.col + "," + start.row;
        if (visited.has(startKey)) continue;

        const queue = [start];
        visited.add(startKey);
        let minCol = start.col;
        let maxCol = start.col;
        let minRow = start.row;
        let maxRow = start.row;
        let count = 0;
        const component = [];

        for (let q = 0; q < queue.length; q++) {
          const cell = queue[q];
          component.push(cell);
          count++;
          minCol = Math.min(minCol, cell.col);
          maxCol = Math.max(maxCol, cell.col);
          minRow = Math.min(minRow, cell.row);
          maxRow = Math.max(maxRow, cell.row);

          const neighbours = [
            [cell.col + 1, cell.row],
            [cell.col - 1, cell.row],
            [cell.col, cell.row + 1],
            [cell.col, cell.row - 1],
          ];
          for (let n = 0; n < neighbours.length; n++) {
            const key = neighbours[n][0] + "," + neighbours[n][1];
            if (visited.has(key) || !byKey.has(key)) continue;
            visited.add(key);
            queue.push(byKey.get(key));
          }
        }

        const width = maxCol - minCol + 1;
        const depth = maxRow - minRow + 1;
        if (
          count < HOUSE_MIN_TILES ||
          width < HOUSE_MIN_WIDTH ||
          depth < HOUSE_MIN_DEPTH
        ) {
          continue;
        }

        this.counts.house++;
        this._addHouseModel(minCol, minRow, width, depth, component, bgp);
      }
    }

    _addHouseModel(minCol, minRow, width, depth, cells, bgp) {
      const group = this._houseGroup;
      const centerX = minCol + width / 2;
      const centerZ = minRow + depth / 2;

      this._addBox(
        group, this._houseDarkMat,
        centerX, 0.06, centerZ,
        width + 0.18, 0.12, depth + 0.18
      );
      this._addBox(
        group, this._houseWallMat,
        centerX, 0.17, minRow + depth * 0.66,
        Math.max(1, width - 0.45), 0.2, Math.max(1, depth * 0.48)
      );

      for (let i = 0; i < cells.length; i++) {
        this._addHouseTile(cells[i], bgp, minRow, depth);
      }
    }

    _addHouseTile(cell, bgp, minRow, depth) {
      const rec = this._tileMaterial(cell.pixels, bgp, false);
      const roof = this._isHouseRoofTile(cell.srcTile) ||
        cell.row < minRow + depth * 0.55;
      const h = roof ? 0.78 : 0.52;
      const inset = roof ? 0.02 : 0.06;
      const mesh = new this.THREE.Mesh(
        this._boxGeo,
        roof ? this._houseRoofMat : this._houseWallMat
      );
      mesh.position.set(cell.col + 0.5, 0.12 + h / 2, cell.row + 0.5);
      mesh.scale.set(1 - inset, h, 1 - inset);
      this._houseGroup.add(mesh);

      const top = new this.THREE.Mesh(this._tileTopGeo, rec.material);
      top.position.set(cell.col + 0.5, 0.12 + h + 0.004, cell.row + 0.5);
      top.scale.set(1 - inset, 1 - inset, 1);
      this._houseGroup.add(top);
    }

    _isHouseRoofTile(srcTile) {
      return (
        (srcTile >= 5 && srcTile <= 9) ||
        (srcTile >= 21 && srcTile <= 25) ||
        srcTile === 37 ||
        srcTile === 38 ||
        srcTile === 40 ||
        srcTile === 41 ||
        srcTile === 75
      );
    }

    _rebuildSprites(mem, lcdc) {
      this._disposeGroupChildren(this._spriteGroup);
      if ((lcdc & 0x02) === 0) return;

      const sprites = this._readVisibleSprites(mem, lcdc);
      const components = this._groupSpriteComponents(sprites);
      for (let i = 0; i < components.length; i++) {
        const component = components[i];
        const rec = this._compositeSpriteMaterial(mem, component);
        const mesh = new this.THREE.Mesh(this._spriteGeo8, rec.material);
        mesh.position.set(
          (component.minX + component.width / 2) / TILE,
          0.03,
          (component.minY + component.height) / TILE
        );
        mesh.scale.set(component.width / TILE, component.height / TILE, 1);
        mesh.renderOrder = 100 + component.minIndex;
        this._spriteGroup.add(mesh);
      }
    }

    _readVisibleSprites(mem, lcdc) {
      const spriteHeight = (lcdc & 0x04) !== 0 ? 16 : 8;
      const sprites = [];
      for (let i = 0; i < 40; i++) {
        const base = 0xfe00 + i * 4;
        const y = mem[base] - 16;
        const x = mem[base + 1] - 8;
        let tileIndex = mem[base + 2];
        const attr = mem[base + 3];

        if (x <= -8 || x >= 160 || y <= -spriteHeight || y >= 144) continue;
        if (spriteHeight === 16) tileIndex &= 0xfe;

        sprites.push({
          index: i,
          x,
          y,
          width: TILE,
          height: spriteHeight,
          tileIndex,
          attr,
          palette: mem[(attr & 0x10) ? 0xff49 : 0xff48],
          xFlip: (attr & 0x20) !== 0,
          yFlip: (attr & 0x40) !== 0,
        });
      }
      return sprites;
    }

    _groupSpriteComponents(sprites) {
      const components = [];
      const used = new Array(sprites.length).fill(false);

      for (let i = 0; i < sprites.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        const items = [sprites[i]];
        const queue = [sprites[i]];

        for (let q = 0; q < queue.length; q++) {
          const sprite = queue[q];

          for (let j = 0; j < sprites.length; j++) {
            if (used[j]) continue;
            const candidate = sprites[j];
            if (!this._spriteRectsTouch(sprite, candidate)) continue;
            if (!this._spriteComponentCanAccept(items, candidate)) continue;
            used[j] = true;
            items.push(candidate);
            queue.push(candidate);
          }
        }

        components.push(this._spriteComponentFromItems(items));
      }

      return components;
    }

    _spriteComponentCanAccept(items, candidate) {
      let minX = candidate.x;
      let minY = candidate.y;
      let maxX = candidate.x + candidate.width;
      let maxY = candidate.y + candidate.height;
      let minIndex = candidate.index;
      let maxIndex = candidate.index;
      let maxSpriteHeight = candidate.height;
      for (let i = 0; i < items.length; i++) {
        const s = items[i];
        minX = Math.min(minX, s.x);
        minY = Math.min(minY, s.y);
        maxX = Math.max(maxX, s.x + s.width);
        maxY = Math.max(maxY, s.y + s.height);
        minIndex = Math.min(minIndex, s.index);
        maxIndex = Math.max(maxIndex, s.index);
        maxSpriteHeight = Math.max(maxSpriteHeight, s.height);
      }

      const width = maxX - minX;
      const height = maxY - minY;
      const maxHeight = Math.max(SPRITE_COMPONENT_MAX_PX, maxSpriteHeight);
      return (
        width <= SPRITE_COMPONENT_MAX_PX &&
        height <= maxHeight &&
        maxIndex - minIndex <= SPRITE_COMPONENT_MAX_OAM_SPAN
      );
    }

    _spriteComponentFromItems(items) {
      let minX = items[0].x;
      let minY = items[0].y;
      let maxX = items[0].x + items[0].width;
      let maxY = items[0].y + items[0].height;
      let minIndex = items[0].index;
      for (let k = 1; k < items.length; k++) {
        const s = items[k];
        minX = Math.min(minX, s.x);
        minY = Math.min(minY, s.y);
        maxX = Math.max(maxX, s.x + s.width);
        maxY = Math.max(maxY, s.y + s.height);
        minIndex = Math.min(minIndex, s.index);
      }

      return {
        sprites: items,
        minX,
        minY,
        width: maxX - minX,
        height: maxY - minY,
        minIndex,
      };
    }

    _spriteRectsTouch(a, b) {
      return (
        a.x <= b.x + b.width &&
        a.x + a.width >= b.x &&
        a.y <= b.y + b.height &&
        a.y + a.height >= b.y
      );
    }

    _compositeSpriteMaterial(mem, component) {
      let key = "sc:" + component.width + "x" + component.height + ":";
      const ordered = component.sprites.slice().sort((a, b) => a.index - b.index);
      for (let i = 0; i < ordered.length; i++) {
        const s = ordered[i];
        key +=
          s.index + "," + (s.x - component.minX) + "," +
          (s.y - component.minY) + "," + s.tileIndex + "," + s.height + "," +
          s.palette + "," + (s.xFlip ? 1 : 0) + "," + (s.yFlip ? 1 : 0) + ":";
        for (let y = 0; y < s.height; y++) {
          const tile = s.tileIndex + (y >> 3);
          const addr = 0x8000 + tile * 16 + (y & 7) * 2;
          key += mem[addr] + "," + mem[addr + 1] + ";";
        }
      }

      const cached = this._spriteMatCache.get(key);
      if (cached) return cached;

      const cv = document.createElement("canvas");
      cv.width = component.width;
      cv.height = component.height;
      const cx = cv.getContext("2d");
      const img = cx.createImageData(component.width, component.height);

      for (let i = 0; i < ordered.length; i++) {
        this._blitSpriteToImage(mem, ordered[i], component, img.data);
      }
      cx.putImageData(img, 0, 0);

      const tex = new this.THREE.CanvasTexture(cv);
      tex.magFilter = this.THREE.NearestFilter;
      tex.minFilter = this.THREE.NearestFilter;
      tex.generateMipmaps = false;
      const mat = new this.THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.5,
        side: this.THREE.DoubleSide,
      });
      const rec = { material: mat, texture: tex };
      this._spriteMatCache.set(key, rec);
      return rec;
    }

    _blitSpriteToImage(mem, sprite, component, data) {
      const stride = component.width * 4;
      const dstBaseX = sprite.x - component.minX;
      const dstBaseY = sprite.y - component.minY;

      for (let y = 0; y < sprite.height; y++) {
        const srcY = sprite.yFlip ? sprite.height - 1 - y : y;
        const tile = sprite.tileIndex + (srcY >> 3);
        const addr = 0x8000 + tile * 16 + (srcY & 7) * 2;
        const lo = mem[addr];
        const hi = mem[addr + 1];

        for (let x = 0; x < TILE; x++) {
          const srcX = sprite.xFlip ? TILE - 1 - x : x;
          const bit = 7 - srcX;
          const ci = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
          if (ci === 0) continue;

          const dstX = dstBaseX + x;
          const dstY = dstBaseY + y;
          if (
            dstX < 0 ||
            dstX >= component.width ||
            dstY < 0 ||
            dstY >= component.height
          ) {
            continue;
          }

          const o = dstY * stride + dstX * 4;
          // Preserve OAM priority inside the composite: lower OAM index wins.
          if (data[o + 3] !== 0) continue;

          const shade = (sprite.palette >> (ci * 2)) & 0x03;
          const rgb = GB_PALETTE[shade];
          data[o] = rgb[0];
          data[o + 1] = rgb[1];
          data[o + 2] = rgb[2];
          data[o + 3] = 255;
        }
      }
    }

    _spriteMaterial(mem, tileIndex, spriteHeight, palette, xFlip, yFlip) {
      let key =
        "s:" + tileIndex + ":" + spriteHeight + ":" + palette + ":" +
        (xFlip ? 1 : 0) + ":" + (yFlip ? 1 : 0) + ":";
      for (let y = 0; y < spriteHeight; y++) {
        const tile = tileIndex + (y >> 3);
        const addr = 0x8000 + tile * 16 + (y & 7) * 2;
        key += mem[addr] + "," + mem[addr + 1] + ";";
      }

      const cached = this._spriteMatCache.get(key);
      if (cached) return cached;

      const cv = document.createElement("canvas");
      cv.width = TILE;
      cv.height = spriteHeight;
      const cx = cv.getContext("2d");
      const img = cx.createImageData(TILE, spriteHeight);

      for (let y = 0; y < spriteHeight; y++) {
        const srcY = yFlip ? spriteHeight - 1 - y : y;
        const tile = tileIndex + (srcY >> 3);
        const addr = 0x8000 + tile * 16 + (srcY & 7) * 2;
        const lo = mem[addr];
        const hi = mem[addr + 1];
        for (let x = 0; x < TILE; x++) {
          const srcX = xFlip ? TILE - 1 - x : x;
          const bit = 7 - srcX;
          const ci = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
          const o = (y * TILE + x) * 4;
          if (ci === 0) {
            img.data[o + 3] = 0;
            continue;
          }
          const shade = (palette >> (ci * 2)) & 0x03;
          const rgb = GB_PALETTE[shade];
          img.data[o] = rgb[0];
          img.data[o + 1] = rgb[1];
          img.data[o + 2] = rgb[2];
          img.data[o + 3] = 255;
        }
      }
      cx.putImageData(img, 0, 0);

      const tex = new this.THREE.CanvasTexture(cv);
      tex.magFilter = this.THREE.NearestFilter;
      tex.minFilter = this.THREE.NearestFilter;
      tex.generateMipmaps = false;
      const mat = new this.THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.5,
        side: this.THREE.DoubleSide,
      });
      const rec = { material: mat, texture: tex };
      this._spriteMatCache.set(key, rec);
      return rec;
    }

    _faceSpritesToCamera() {
      for (let i = 0; i < this._spriteGroup.children.length; i++) {
        const sprite = this._spriteGroup.children[i];
        sprite.lookAt(this._camera.position.x, sprite.position.y, this._camera.position.z);
      }
    }

    _addBox(group, material, x, y, z, sx, sy, sz) {
      const mesh = new this.THREE.Mesh(this._boxGeo, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      group.add(mesh);
      return mesh;
    }

    // -- misc -----------------------------------------------------------------

    _updateHud() {
      if (!this.hud) return;
      const c = this.counts;
      this.hud.textContent =
        "Detected -- tall grass: " +
        c.tallgrass +
        "  |  fence: " +
        c.fence +
        "  |  post fence: " +
        c.postfence +
        "  |  flower: " +
        c.flower +
        "  |  house: " +
        c.house +
        "  |  billboard: " +
        c.billboard +
        "  |  grass ground: " +
        c.grass;
    }

    _showUnavailable() {
      const ctx = this.canvas.getContext && this.canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#222";
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = "#ddd";
        ctx.font = "14px sans-serif";
        ctx.fillText("Three.js failed to load -- 3D view unavailable.", 16, 28);
      }
      if (this.hud) this.hud.textContent = "3D view unavailable (Three.js not loaded).";
    }
  }

  global.View3D = View3D;
})(window);

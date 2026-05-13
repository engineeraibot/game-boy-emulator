// Three.js "voxel landscape" view of the Game Boy framebuffer.
//
// Each pixel is rendered as a 3D cube. Color is per-pixel (so the on-screen
// detail is preserved), and height is chosen per pixel — but with a small
// amount of structural awareness so a single "object" (a building, fence,
// dialog box, character) reads as one solid block instead of an outline
// hovering over a sunken interior.
//
// Classification (computed each frame from the BG-only buffer):
//   wall    — pixel darker than `wallThreshold` (outline / fill of an object)
//   outside — light pixel reachable by 4-connected flood fill from the
//             screen border (i.e. open ground)
//   inside  — light pixel not reachable from the border (it's enclosed by
//             walls — interior of a building, fenced patch, etc.)
//
// Heights:
//   wall    -> objectHeight (uniform "object top")
//   inside  -> objectHeight (lifts interior to match outline)
//   outside -> per-pixel darkness (so grass / paths have gentle variation)
//
// Sprite pixels (where the full framebuffer differs from the BG-only buffer)
// are forced to objectHeight + spriteBump so characters clearly stand above
// the world.
class View3D {
    constructor(canvas, memoryManagementUnit, pixelProcessingUnit) {
        if (typeof THREE === "undefined") {
            console.warn("THREE.js not loaded; 3D view disabled.");
            return;
        }
        this.canvas = canvas;
        this.mmu = memoryManagementUnit;
        this.ppu = pixelProcessingUnit;

        this.width = 160;
        this.height = 144;
        this.instances = this.width * this.height;

        // Tile-based logic (20x18 tiles of 8x8 pixels)
        this.tileW = 20;
        this.tileH = 18;
        this.numTiles = this.tileW * this.tileH;

        // Vertical look — tune freely.
        this.heightScale = 5;       // variation for Floor tiles
        this.minHeight = 0.5;       // base height
        this.objectHeight = 18;     // height of Solid/Interior blocks
        this.spriteHeight = 12;     // Height of sprite billboards
        this.wallThreshold = 0.5;   // luminance below this => wall pixel

        // Working buffers, allocated once.
        this._isWall = new Uint8Array(this.instances);
        this._tileType = new Uint8Array(this.numTiles); // 0: Floor, 1: Solid, 2: Water, 3: Grass
        this._tileSolid = new Uint8Array(this.numTiles);
        this._tileVisited = new Uint8Array(this.numTiles);
        this._tileQueue = new Int32Array(this.numTiles);
        this._pixelQueue = new Int32Array(this.instances);

        // Spherical camera coordinates.
        this.cameraDistance = 250;
        this.cameraTheta = Math.PI / 2;
        this.cameraPhi = Math.PI / 3.5;

        // Current heights for lerping
        this.currentHeights = new Float32Array(this.instances);

        // CCL & Object pooling
        this.maxObjects = 40;
        this._labels = new Int32Array(this.instances);
        this._isSprite = new Uint8Array(this.instances);
        this.objectPool = [];
        this.detectedObjects = [];

        this._lastW = 0;
        this._lastH = 0;

        this.init();
        this.setupControls();
        this.handleResize();
        window.addEventListener("resize", () => this.handleResize());
        this.animate();
    }

    init() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
        });
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        const bgColor = new THREE.Color(0x1a1a1a); // Darker background for "toy box" feel
        this.scene.background = bgColor;
        this.scene.fog = new THREE.Fog(bgColor, 300, 800);

        this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
        this.updateCameraPosition();

        // Lighting
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

        const key = new THREE.DirectionalLight(0xffffff, 0.8);
        key.position.set(60, 150, 60);
        key.castShadow = true;

        // Optimize shadow camera
        key.shadow.camera.left = -100;
        key.shadow.camera.right = 100;
        key.shadow.camera.top = 100;
        key.shadow.camera.bottom = -100;
        key.shadow.mapSize.width = 1024;
        key.shadow.mapSize.height = 1024;

        this.scene.add(key);

        const fill = new THREE.DirectionalLight(0x9be3b5, 0.2);
        fill.position.set(-100, 80, -80);
        this.scene.add(fill);

        // 1x1x1 box, pivot moved to its bottom face so only matrix[5]
        // (Y scale) needs to change per voxel per frame.
        const geo = new THREE.BoxGeometry(1, 1, 1);
        geo.translate(0, 0.5, 0);

        // Use MeshStandardMaterial for better lighting/shadows
        const material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.7,
            metalness: 0.2
        });

        this.mesh = new THREE.InstancedMesh(geo, material, this.instances);
        this.mesh.frustumCulled = false;
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        const colorArr = new Float32Array(this.instances * 3);
        for (let i = 0; i < colorArr.length; i += 3) {
            colorArr[i] = 0.55;
            colorArr[i + 1] = 0.75;
            colorArr[i + 2] = 0.55;
        }
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colorArr, 3);

        // Pre-fill instance matrices: fixed X/Z, only Y-scale animates.
        const matArr = this.mesh.instanceMatrix.array;
        const halfW = this.width / 2;
        const halfH = this.height / 2;
        const scale = 0.98; // Small gap between voxels
        for (let yy = 0; yy < this.height; yy++) {
            for (let xx = 0; xx < this.width; xx++) {
                const idx = yy * this.width + xx;
                const off = idx * 16;
                matArr[off + 0] = scale;
                matArr[off + 5] = 1;
                matArr[off + 10] = scale;
                matArr[off + 12] = xx - halfW;
                matArr[off + 13] = 0;
                matArr[off + 14] = yy - halfH;
                matArr[off + 15] = 1;
            }
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(this.mesh);

        // Floor under the voxels.
        const floorGeo = new THREE.PlaneGeometry(this.width + 100, this.height + 100);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x123124,
            roughness: 0.9,
            metalness: 0.1
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.01;
        floor.receiveShadow = true;
        this.scene.add(floor);

        this.initObjectPool();
    }

    initObjectPool() {
        // We use a plane for billboarding sprites.
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.translate(0, 0.5, 0); // Pivot at bottom

        for (let i = 0; i < this.maxObjects; i++) {
            // Each object gets its own texture/material so we can update it per frame.
            const canvas = document.createElement("canvas");
            canvas.width = 32; // Over-allocated for most sprites
            canvas.height = 32;
            const tex = new THREE.CanvasTexture(canvas);
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;

            const mat = new THREE.MeshStandardMaterial({
                map: tex,
                transparent: true,
                side: THREE.DoubleSide,
                alphaTest: 0.5
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            mesh.castShadow = true;
            this.scene.add(mesh);

            this.objectPool.push({
                mesh,
                canvas,
                ctx: canvas.getContext("2d"),
                tex
            });
        }
    }

    setupControls() {
        let isDragging = false;
        let prevX = 0;
        let prevY = 0;

        this.canvas.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            isDragging = true;
            prevX = e.clientX;
            prevY = e.clientY;
            try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
            this.canvas.style.cursor = "grabbing";
        });
        const onMove = (e) => {
            if (!isDragging) return;
            const dx = e.clientX - prevX;
            const dy = e.clientY - prevY;
            prevX = e.clientX;
            prevY = e.clientY;
            this.cameraTheta -= dx * 0.008;
            this.cameraPhi = Math.max(
                0.15,
                Math.min(Math.PI / 2 - 0.05, this.cameraPhi - dy * 0.008)
            );
            this.updateCameraPosition();
        };
        const onUp = (e) => {
            isDragging = false;
            try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
            this.canvas.style.cursor = "grab";
        };
        this.canvas.addEventListener("pointermove", onMove);
        this.canvas.addEventListener("pointerup", onUp);
        this.canvas.addEventListener("pointercancel", onUp);

        this.canvas.addEventListener(
            "wheel",
            (e) => {
                e.preventDefault();
                this.cameraDistance = Math.max(
                    80,
                    Math.min(700, this.cameraDistance + e.deltaY * 0.4)
                );
                this.updateCameraPosition();
            },
            { passive: false }
        );
    }

    updateCameraPosition() {
        const r = this.cameraDistance;
        const x = r * Math.sin(this.cameraPhi) * Math.cos(this.cameraTheta);
        const z = r * Math.sin(this.cameraPhi) * Math.sin(this.cameraTheta);
        const y = r * Math.cos(this.cameraPhi);
        this.camera.position.set(x, y, z);
        this.camera.lookAt(0, 6, 0);
    }

    handleResize() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (!w || !h) return;
        if (w === this._lastW && h === this._lastH) return;
        this._lastW = w;
        this._lastH = h;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    // Connected Component Labeling to group sprite pixels.
    performCCL(frameData, bgData) {
        const W = this.width;
        const H = this.height;
        const N = this.instances;
        const labels = this._labels;
        const isSprite = this._isSprite;
        const queue = this._pixelQueue;

        labels.fill(-1);
        isSprite.fill(0);

        for (let i = 0; i < N; i++) {
            const pi = i * 4;
            if (frameData[pi] !== bgData[pi] ||
                frameData[pi + 1] !== bgData[pi + 1] ||
                frameData[pi + 2] !== bgData[pi + 2]) {
                isSprite[i] = 1;
            }
        }

        let nextLabel = 0;
        const objects = [];

        for (let i = 0; i < N; i++) {
            if (isSprite[i] && labels[i] === -1) {
                const label = nextLabel++;
                if (label >= this.maxObjects) break;

                let qHead = 0, qTail = 0;
                queue[qTail++] = i;
                labels[i] = label;

                let minX = i % W, maxX = i % W;
                let minY = Math.floor(i / W), maxY = Math.floor(i / W);

                while (qHead < qTail) {
                    const idx = queue[qHead++];
                    const x = idx % W;
                    const y = Math.floor(idx / W);
                    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y); maxY = Math.max(maxY, y);

                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx, ny = y + dy;
                            if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                                const ni = ny * W + nx;
                                if (isSprite[ni] && labels[ni] === -1) {
                                    labels[ni] = label;
                                    queue[qTail++] = ni;
                                }
                            }
                        }
                    }
                }
                objects.push({ label, minX, maxX, minY, maxY, count: qTail });
            }
        }
        this.detectedObjects = objects;
    }

    // BFS flood-fill on TILE grid.
    classifyPixels(frameData, bgData) {
        this.performCCL(frameData, bgData);
        const W = this.width;
        const H = this.height;
        const TW = this.tileW;
        const TH = this.tileH;
        const isWall = this._isWall;
        const tileSolid = this._tileSolid;
        const visited = this._tileVisited;
        const queue = this._tileQueue;
        const wallThresh = this.wallThreshold * 255;

        // 1. Identify individual wall pixels.
        for (let i = 0; i < this.instances; i++) {
            const pi = i * 4;
            const lum = 0.2126 * bgData[pi] + 0.7152 * bgData[pi + 1] + 0.0722 * bgData[pi + 2];
            isWall[i] = lum < wallThresh ? 1 : 0;
        }

        // 2. Quantize: Tile is "Solid" if it has significant wall density.
        tileSolid.fill(0);
        this._tileType.fill(0);
        for (let ty = 0; ty < TH; ty++) {
            for (let tx = 0; tx < TW; tx++) {
                let wallCount = 0;
                let sumR = 0, sumG = 0, sumB = 0;
                for (let py = 0; py < 8; py++) {
                    for (let px = 0; px < 8; px++) {
                        const idx = (ty * 8 + py) * W + (tx * 8 + px);
                        if (isWall[idx]) wallCount++;
                        const pi = idx * 4;
                        sumR += bgData[pi];
                        sumG += bgData[pi + 1];
                        sumB += bgData[pi + 2];
                    }
                }

                const tidx = ty * TW + tx;
                // If more than 20% of tile is dark, consider it a Solid block.
                if (wallCount > 12) {
                    tileSolid[tidx] = 1;
                    this._tileType[tidx] = 1; // Solid
                } else {
                    // Heuristic for Water (mostly dark greenish/blueish)
                    // and Grass (checkerboard-like).
                    const avgR = sumR / 64;
                    const avgG = sumG / 64;
                    const avgB = sumB / 64;

                    if (avgG > avgR && avgG > avgB && avgG < 150) {
                         // Likely grass or water in Pokemon Red palette
                         this._tileType[tidx] = 3; // Grass
                    }
                }
            }
        }

        // 3. Tile-based BFS from borders to find Floor vs Interior.
        visited.fill(0);
        let qTail = 0;
        for (let x = 0; x < TW; x++) {
            if (!tileSolid[x]) { visited[x] = 1; queue[qTail++] = x; }
            const b = (TH - 1) * TW + x;
            if (!tileSolid[b]) { visited[b] = 1; queue[qTail++] = b; }
        }
        for (let y = 1; y < TH - 1; y++) {
            const l = y * TW;
            if (!tileSolid[l]) { visited[l] = 1; queue[qTail++] = l; }
            const r = y * TW + TW - 1;
            if (!tileSolid[r]) { visited[r] = 1; queue[qTail++] = r; }
        }

        let qHead = 0;
        while (qHead < qTail) {
            const idx = queue[qHead++];
            const tx = idx % TW;
            const ty = Math.floor(idx / TW);

            const neighbors = [];
            if (ty > 0) neighbors.push(idx - TW);
            if (ty < TH - 1) neighbors.push(idx + TW);
            if (tx > 0) neighbors.push(idx - 1);
            if (tx < TW - 1) neighbors.push(idx + 1);

            for (const ni of neighbors) {
                if (!visited[ni] && !tileSolid[ni]) {
                    visited[ni] = 1;
                    queue[qTail++] = ni;
                }
            }
        }
    }

    updateFromFrame() {
        const frameData = this.ppu && this.ppu.frameData && this.ppu.frameData.data;
        if (!frameData) return;
        const bgData = (this.ppu.bgFrameData && this.ppu.bgFrameData.data) || frameData;

        this.classifyPixels(frameData, bgData);

        const matArr = this.mesh.instanceMatrix.array;
        const colArr = this.mesh.instanceColor.array;
        const inv255 = 1 / 255;
        const heightScale = this.heightScale;
        const minH = this.minHeight;
        const objectH = this.objectHeight;
        const tileSolid = this._tileSolid;
        const tileVisited = this._tileVisited;
        const tileType = this._tileType;
        const currentHeights = this.currentHeights;
        const labels = this._labels;
        const TW = this.tileW;
        const W = this.width;
        const H = this.height;

        // Voxel lerp speed.
        const lerpFactor = 0.2;
        const now = Date.now();

        // Reset billboards
        for (let i = 0; i < this.maxObjects; i++) {
            this.objectPool[i].mesh.visible = false;
        }

        // Update billboards from detected objects
        for (let i = 0; i < this.detectedObjects.length; i++) {
            const obj = this.detectedObjects[i];
            const pool = this.objectPool[i];
            const mesh = pool.mesh;
            const ctx = pool.ctx;

            const objW = Math.max(1, Math.floor(obj.maxX - obj.minX + 1));
            const objH = Math.max(1, Math.floor(obj.maxY - obj.minY + 1));

            pool.canvas.width = objW;
            pool.canvas.height = objH;
            ctx.clearRect(0, 0, objW, objH);
            const imgData = ctx.createImageData(objW, objH);

            for (let py = 0; py < objH; py++) {
                for (let px = 0; px < objW; px++) {
                    const gx = obj.minX + px;
                    const gy = obj.minY + py;
                    const gidx = gy * W + gx;
                    const targetIdx = (py * objW + px) * 4;
                    if (labels[gidx] === obj.label) {
                        const sIdx = gidx * 4;
                        imgData.data[targetIdx] = frameData[sIdx];
                        imgData.data[targetIdx + 1] = frameData[sIdx + 1];
                        imgData.data[targetIdx + 2] = frameData[sIdx + 2];
                        imgData.data[targetIdx + 3] = 255;
                    } else {
                        imgData.data[targetIdx + 3] = 0;
                    }
                }
            }
            ctx.putImageData(imgData, 0, 0);
            pool.tex.needsUpdate = true;

            mesh.visible = true;
            mesh.scale.set(objW, this.spriteHeight, 1);
            mesh.position.x = (obj.minX + obj.maxX) / 2 - W / 2;
            mesh.position.z = (obj.minY + obj.maxY) / 2 - H / 2;
            mesh.position.y = 0.1;

            // Billboard behavior: always face camera but stay vertical
            mesh.quaternion.copy(this.camera.quaternion);
            mesh.rotation.x = 0;
            mesh.rotation.z = 0;
        }

        for (let idx = 0; idx < this.instances; idx++) {
            const x = idx % W;
            const y = Math.floor(idx / W);
            const tx = Math.floor(x / 8);
            const ty = Math.floor(y / 8);
            const tidx = ty * TW + tx;

            const pi = idx * 4;
            const r = frameData[pi] * inv255;
            const g = frameData[pi + 1] * inv255;
            const b = frameData[pi + 2] * inv255;

            let targetH;
            if (labels[idx] !== -1) {
                // Pixel is part of a billboarded object, hide its voxel.
                targetH = 0;
            } else if (tileSolid[tidx] || !tileVisited[tidx]) {
                targetH = objectH;
            } else {
                const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                targetH = minH + (1 - lum) * heightScale;

                // Pokemon Red heuristics
                if (tileType[tidx] === 3) { // Grass/Water-like
                     // If it's very green-leaning, maybe it's water?
                     if (g > r * 1.1) {
                         targetH = minH + Math.sin(now * 0.002 + tx + ty) * 0.5;
                     } else {
                         // Grass: slightly higher and "fuzzier"
                         targetH += 1.5;
                     }
                }
            }

            currentHeights[idx] += (targetH - currentHeights[idx]) * lerpFactor;
            matArr[idx * 16 + 5] = currentHeights[idx];

            const ci = idx * 3;
            colArr[ci] = r;
            colArr[ci + 1] = g;
            colArr[ci + 2] = b;
        }

        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.instanceColor.needsUpdate = true;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.handleResize();
        this.updateFromFrame();
        this.renderer.render(this.scene, this.camera);
    }
}

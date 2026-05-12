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

        // Vertical look — tune freely.
        this.heightScale = 8;       // per-pixel range for OPEN ground
        this.minHeight = 0.4;       // base height for any voxel
        this.objectHeight = 22;     // uniform height of walls / interiors
        this.spriteBump = 6;        // sprites sit this much above objectHeight
        this.wallThreshold = 0.5;   // luminance below this => wall pixel

        // Working buffers, allocated once.
        this._isWall = new Uint8Array(this.instances);
        this._visited = new Uint8Array(this.instances);
        this._queue = new Int32Array(this.instances);

        // Spherical camera coordinates.
        this.cameraDistance = 230;
        this.cameraTheta = Math.PI / 2;
        this.cameraPhi = Math.PI / 3.2;

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

        this.scene = new THREE.Scene();
        const bgColor = new THREE.Color(0x0e2e1f);
        this.scene.background = bgColor;
        this.scene.fog = new THREE.Fog(bgColor, 260, 720);

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
        this.updateCameraPosition();

        // Lighting
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
        const key = new THREE.DirectionalLight(0xffffff, 0.85);
        key.position.set(120, 220, 120);
        this.scene.add(key);
        const fill = new THREE.DirectionalLight(0x9be3b5, 0.3);
        fill.position.set(-150, 120, -100);
        this.scene.add(fill);

        // 1x1x1 box, pivot moved to its bottom face so only matrix[5]
        // (Y scale) needs to change per voxel per frame.
        // NOTE: do not enable vertexColors here — it'd switch on USE_COLOR
        // which expects a per-vertex color attribute the BoxGeometry doesn't
        // have, and the resulting (0,0,0) would multiply the per-instance
        // color to black.
        const geo = new THREE.BoxGeometry(1, 1, 1);
        geo.translate(0, 0.5, 0);
        const material = new THREE.MeshLambertMaterial({ color: 0xffffff });

        this.mesh = new THREE.InstancedMesh(geo, material, this.instances);
        this.mesh.frustumCulled = false;

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
        for (let yy = 0; yy < this.height; yy++) {
            for (let xx = 0; xx < this.width; xx++) {
                const idx = yy * this.width + xx;
                const off = idx * 16;
                matArr[off + 0] = 1;
                matArr[off + 5] = 1;
                matArr[off + 10] = 1;
                matArr[off + 12] = xx - halfW;
                matArr[off + 13] = 0;
                matArr[off + 14] = yy - halfH;
                matArr[off + 15] = 1;
            }
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(this.mesh);

        // Floor under the voxels.
        const floorGeo = new THREE.PlaneGeometry(this.width + 8, this.height + 8);
        const floorMat = new THREE.MeshLambertMaterial({ color: 0x123124 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.5;
        this.scene.add(floor);
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

    // BFS flood-fill from screen-border light pixels marks every light pixel
    // reachable from "outside" as visited. Unvisited light pixels are
    // therefore enclosed by walls — they form the inside of an object.
    classifyPixels(bgData) {
        const W = this.width;
        const H = this.height;
        const N = this.instances;
        const isWall = this._isWall;
        const visited = this._visited;
        const queue = this._queue;
        const wallThresh = this.wallThreshold * 255;

        // 1. Wall mask: luminance test.
        for (let i = 0; i < N; i++) {
            const pi = i * 4;
            const lum =
                0.2126 * bgData[pi] +
                0.7152 * bgData[pi + 1] +
                0.0722 * bgData[pi + 2];
            isWall[i] = lum < wallThresh ? 1 : 0;
        }

        // 2. Seed BFS with every OPEN pixel on the screen border.
        visited.fill(0);
        let qTail = 0;

        for (let x = 0; x < W; x++) {
            if (!isWall[x]) {
                visited[x] = 1;
                queue[qTail++] = x;
            }
            const b = (H - 1) * W + x;
            if (!isWall[b]) {
                visited[b] = 1;
                queue[qTail++] = b;
            }
        }
        for (let y = 1; y < H - 1; y++) {
            const l = y * W;
            if (!isWall[l]) {
                visited[l] = 1;
                queue[qTail++] = l;
            }
            const r = y * W + W - 1;
            if (!isWall[r]) {
                visited[r] = 1;
                queue[qTail++] = r;
            }
        }

        // 3. 4-connected BFS through OPEN pixels.
        let qHead = 0;
        while (qHead < qTail) {
            const idx = queue[qHead++];
            const x = idx % W;
            // up
            if (idx >= W) {
                const ni = idx - W;
                if (!visited[ni] && !isWall[ni]) {
                    visited[ni] = 1;
                    queue[qTail++] = ni;
                }
            }
            // down
            if (idx < N - W) {
                const ni = idx + W;
                if (!visited[ni] && !isWall[ni]) {
                    visited[ni] = 1;
                    queue[qTail++] = ni;
                }
            }
            // left
            if (x > 0) {
                const ni = idx - 1;
                if (!visited[ni] && !isWall[ni]) {
                    visited[ni] = 1;
                    queue[qTail++] = ni;
                }
            }
            // right
            if (x < W - 1) {
                const ni = idx + 1;
                if (!visited[ni] && !isWall[ni]) {
                    visited[ni] = 1;
                    queue[qTail++] = ni;
                }
            }
        }
    }

    updateFromFrame() {
        const frameData = this.ppu && this.ppu.frameData && this.ppu.frameData.data;
        if (!frameData) return;
        const bgData =
            (this.ppu.bgFrameData && this.ppu.bgFrameData.data) || frameData;

        this.classifyPixels(bgData);

        const matArr = this.mesh.instanceMatrix.array;
        const colArr = this.mesh.instanceColor.array;
        const inv255 = 1 / 255;
        const heightScale = this.heightScale;
        const minH = this.minHeight;
        const objectH = this.objectHeight;
        const bump = this.spriteBump;
        const isWall = this._isWall;
        const visited = this._visited;
        const N = this.instances;

        for (let idx = 0; idx < N; idx++) {
            const pi = idx * 4;

            const r = frameData[pi] * inv255;
            const g = frameData[pi + 1] * inv255;
            const b = frameData[pi + 2] * inv255;

            // Sprite pixels differ from the BG-only buffer.
            const isSprite =
                frameData[pi] !== bgData[pi] ||
                frameData[pi + 1] !== bgData[pi + 1] ||
                frameData[pi + 2] !== bgData[pi + 2];

            let h;
            if (isSprite) {
                // Sprites are forced to objectH + bump so they always stand
                // clearly above the world, no matter what's under them.
                h = objectH + bump;
            } else if (isWall[idx] || !visited[idx]) {
                // Wall OR enclosed interior -> uniform object top.
                h = objectH;
            } else {
                // Open ground: gentle variation from per-pixel darkness.
                const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                h = minH + (1 - lum) * heightScale;
            }

            matArr[idx * 16 + 5] = h;

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

// Three.js 2.5D relief view of the Game Boy framebuffer.
//
// This intentionally works from the visible background/window layer instead of
// trying to draw the full Pokemon map. The exact current screen is used as a
// texture, then a continuous heightfield lifts walls, roofs, trees, rocks, and
// enclosed object interiors. Sprite pixels are drawn as separate billboards.
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
        this.worldScale = 0.58;

        this.wallThreshold = 0.5;
        this.objectHeight = 6.4;
        this.wallRimHeight = 6.7;
        this.groundRelief = 0.16;
        this.minObjectRelief = 0.18;
        this.spriteRefreshInterval = 2;

        // Interior detection erodes the open region by this radius to find the
        // "cores" of enclosed areas (e.g. building interiors), then seals the
        // necks that leak them out to the screen border. It reliably handles
        // leaks — doorways, light roof seams — up to ~2*(radius-1) px wide, so
        // 5 covers a full 8px-tile doorway. Larger risks missing small
        // interiors and puffing up shallow alcoves; smaller risks interiors
        // still sinking. Tune here if a particular game needs it.
        this.enclosureGateRadius = 5;

        this._isWall = new Uint8Array(this.instances);
        this._visited = new Uint8Array(this.instances);
        this._solid = new Uint8Array(this.instances);
        this._solidEdge = new Uint8Array(this.instances);
        this._componentIds = new Int32Array(this.instances);
        this._queue = new Int32Array(this.instances);
        this._heights = new Float32Array(this.instances);
        this._smoothedHeights = new Float32Array(this.instances);
        this._spriteVisited = new Uint8Array(this.instances);
        this._spriteQueue = new Int32Array(this.instances);
        this._open = new Uint8Array(this.instances);
        this._nonSolid = new Uint8Array(this.instances);
        this._interiorCore = new Uint8Array(this.instances);
        this._erodedOpen = new Uint8Array(this.instances);
        this._dtToWall = new Float32Array(this.instances);
        this._dtScratch = new Float32Array(this.instances);
        this._dtSolid = new Float32Array(this.instances);

        this.cameraDistance = 132;
        this.cameraTheta = Math.PI / 2;
        this.cameraPhi = Math.PI / 3.25;
        this._lastW = 0;
        this._lastH = 0;
        this._frameCounter = 0;

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
        const bgColor = new THREE.Color(0x0d2319);
        this.scene.background = bgColor;
        this.scene.fog = new THREE.Fog(bgColor, 130, 330);

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
        this.updateCameraPosition();

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.72));

        const key = new THREE.DirectionalLight(0xffffff, 0.62);
        key.position.set(70, 130, 80);
        this.scene.add(key);

        const fill = new THREE.DirectionalLight(0xb6e7b8, 0.24);
        fill.position.set(-90, 70, -70);
        this.scene.add(fill);

        this.reliefGroup = new THREE.Group();
        this.scene.add(this.reliefGroup);

        this.textureCanvas = document.createElement("canvas");
        this.textureCanvas.width = this.width;
        this.textureCanvas.height = this.height;
        this.textureCtx = this.textureCanvas.getContext("2d");
        this.textureImage = this.textureCtx.createImageData(this.width, this.height);

        this.screenTexture = new THREE.CanvasTexture(this.textureCanvas);
        this.screenTexture.magFilter = THREE.NearestFilter;
        this.screenTexture.minFilter = THREE.NearestFilter;
        this.screenTexture.generateMipmaps = false;

        const worldW = this.width * this.worldScale;
        const worldH = this.height * this.worldScale;

        this.terrainGeometry = new THREE.PlaneGeometry(
            worldW,
            worldH,
            this.width - 1,
            this.height - 1
        );
        this.terrainMaterial = new THREE.MeshLambertMaterial({
            map: this.screenTexture,
            color: 0xffffff,
            side: THREE.DoubleSide,
        });

        this.terrain = new THREE.Mesh(this.terrainGeometry, this.terrainMaterial);
        this.terrain.rotation.x = -Math.PI / 2;
        this.terrain.frustumCulled = false;
        this.reliefGroup.add(this.terrain);

        const underlay = new THREE.Mesh(
            new THREE.PlaneGeometry(worldW + 8, worldH + 8),
            new THREE.MeshLambertMaterial({ color: 0x132b20 })
        );
        underlay.rotation.x = -Math.PI / 2;
        underlay.position.y = -0.45;
        this.reliefGroup.add(underlay);

        this.spriteGroup = new THREE.Group();
        this.reliefGroup.add(this.spriteGroup);
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
                0.18,
                Math.min(Math.PI / 2 - 0.06, this.cameraPhi - dy * 0.008)
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
                    62,
                    Math.min(360, this.cameraDistance + e.deltaY * 0.28)
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
        this.camera.lookAt(0, 4.5, 0);
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

    // Two-pass chamfer distance transform. Writes into `out` the approximate
    // Euclidean distance from every pixel to the nearest pixel where `isZero`
    // is truthy. Two linear sweeps — cheap, and accurate enough for relief.
    _distanceTransform(isZero, out) {
        const W = this.width;
        const H = this.height;
        const N = this.instances;
        const D2 = Math.SQRT2;
        const INF = 1e9;

        for (let i = 0; i < N; i++) out[i] = isZero[i] ? 0 : INF;

        // Forward sweep: top-left -> bottom-right.
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                if (out[i] === 0) continue;
                let v = out[i];
                if (y > 0) {
                    v = Math.min(v, out[i - W] + 1);
                    if (x > 0) v = Math.min(v, out[i - W - 1] + D2);
                    if (x < W - 1) v = Math.min(v, out[i - W + 1] + D2);
                }
                if (x > 0) v = Math.min(v, out[i - 1] + 1);
                out[i] = v;
            }
        }

        // Backward sweep: bottom-right -> top-left.
        for (let y = H - 1; y >= 0; y--) {
            for (let x = W - 1; x >= 0; x--) {
                const i = y * W + x;
                if (out[i] === 0) continue;
                let v = out[i];
                if (y < H - 1) {
                    v = Math.min(v, out[i + W] + 1);
                    if (x > 0) v = Math.min(v, out[i + W - 1] + D2);
                    if (x < W - 1) v = Math.min(v, out[i + W + 1] + D2);
                }
                if (x < W - 1) v = Math.min(v, out[i + 1] + 1);
                out[i] = v;
            }
        }
    }

    // 4-connected flood fill from the screen border. Marks `visited[idx] = 1`
    // for every pixel reachable from the edge through cells where `passable`
    // returns true. Used twice by classifyPixels with different rules.
    _floodFromBorder(passable) {
        const W = this.width;
        const H = this.height;
        const N = this.instances;
        const visited = this._visited;
        const queue = this._queue;

        visited.fill(0);
        let tail = 0;
        const push = (idx) => {
            if (idx < 0 || idx >= N || visited[idx] || !passable(idx)) return;
            visited[idx] = 1;
            queue[tail++] = idx;
        };

        for (let x = 0; x < W; x++) {
            push(x);
            push((H - 1) * W + x);
        }
        for (let y = 1; y < H - 1; y++) {
            push(y * W);
            push(y * W + W - 1);
        }

        let head = 0;
        while (head < tail) {
            const idx = queue[head++];
            const x = idx % W;
            if (idx >= W) push(idx - W);
            if (idx < N - W) push(idx + W);
            if (x > 0) push(idx - 1);
            if (x < W - 1) push(idx + 1);
        }
    }

    classifyPixels(bgData) {
        const N = this.instances;
        const isWall = this._isWall;
        const open = this._open;
        const visited = this._visited;
        const solid = this._solid;
        const nonSolid = this._nonSolid;
        const erodedOpen = this._erodedOpen;
        const interiorCore = this._interiorCore;
        const dtToWall = this._dtToWall;
        const dtToInterior = this._dtScratch;
        const wallThresh = this.wallThreshold * 255;
        const gate = this.enclosureGateRadius;

        for (let i = 0; i < N; i++) {
            const pi = i * 4;
            const lum =
                0.2126 * bgData[pi] +
                0.7152 * bgData[pi + 1] +
                0.0722 * bgData[pi + 2];
            const wall = lum < wallThresh ? 1 : 0;
            isWall[i] = wall;
            open[i] = wall ? 0 : 1;
        }

        // --- Step 1: erode the open region. --------------------------------
        // Distance from every open pixel to the nearest wall, then keep only
        // open pixels at least `gate` away from any wall. This snaps the open
        // space apart at every narrow neck — doorways, light roof seams, and
        // the gaps between objects all get cut.
        this._distanceTransform(isWall, dtToWall);
        for (let i = 0; i < N; i++) {
            erodedOpen[i] = open[i] && dtToWall[i] >= gate ? 1 : 0;
        }

        // --- Step 2: find interior cores. ----------------------------------
        // Flood the eroded region from the border. Any eroded blob the flood
        // can't reach is the core of an enclosed area: a wide open region
        // walled off from the outdoors except through narrow necks. (The old
        // code's single border flood leaked through any 1px gap, which is why
        // whole building interiors dropped to ground level.)
        this._floodFromBorder((idx) => erodedOpen[idx] === 1);
        for (let i = 0; i < N; i++) {
            interiorCore[i] = erodedOpen[i] && !visited[i] ? 1 : 0;
        }

        // --- Step 3: flood the real outdoors, sealing interior necks. ------
        // The leak that connects an interior to the outdoors is by definition a
        // narrow neck. Forbidding everything within `gate` of an interior core
        // seals that neck from both sides — without having to guess its width —
        // so the outdoor flood can never trickle in. Narrow OUTDOOR corridors
        // have no interior core nearby, so they are still traversed freely;
        // that's what keeps this from burying thin strips of open ground.
        this._distanceTransform(interiorCore, dtToInterior);
        this._floodFromBorder(
            (idx) => open[idx] === 1 && dtToInterior[idx] > gate
        );

        // Solid = walls, plus every open pixel the outdoor flood couldn't reach
        // — i.e. genuine enclosed interiors. Interiors now share a connected
        // component with their walls and get lifted right along with them.
        for (let i = 0; i < N; i++) {
            const s = isWall[i] || !visited[i] ? 1 : 0;
            solid[i] = s;
            nonSolid[i] = s ? 0 : 1;
        }
    }

    updateTexture(bgData) {
        this.textureImage.data.set(bgData);
        this.textureCtx.putImageData(this.textureImage, 0, 0);
        this.screenTexture.needsUpdate = true;
    }

    updateSolidEdges() {
        const W = this.width;
        const H = this.height;
        const solid = this._solid;
        const edges = this._solidEdge;
        edges.fill(0);

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const idx = y * W + x;
                if (!solid[idx]) continue;

                const edge =
                    x === 0 ||
                    y === 0 ||
                    x === W - 1 ||
                    y === H - 1 ||
                    !solid[idx - 1] ||
                    !solid[idx + 1] ||
                    !solid[idx - W] ||
                    !solid[idx + W];

                edges[idx] = edge ? 1 : 0;
            }
        }
    }

    collectSolidComponents() {
        const W = this.width;
        const H = this.height;
        const ids = this._componentIds;
        const queue = this._queue;
        const solid = this._solid;
        const isWall = this._isWall;
        const dtSolid = this._dtSolid;
        const components = [];

        // Local thickness of the solid mass at every pixel — how deep into the
        // mass you can get before hitting a non-solid pixel. This is the basis
        // for object height: it does NOT grow when distinct objects merely
        // touch and fuse into one connected component.
        this._distanceTransform(this._nonSolid, dtSolid);

        ids.fill(-1);

        for (let start = 0; start < this.instances; start++) {
            if (!solid[start] || ids[start] !== -1) continue;

            const id = components.length;
            const component = {
                id,
                minX: W,
                minY: H,
                maxX: 0,
                maxY: 0,
                area: 0,
                wallArea: 0,
                peakThickness: 0,
            };

            let qHead = 0;
            let qTail = 0;
            ids[start] = id;
            queue[qTail++] = start;

            while (qHead < qTail) {
                const idx = queue[qHead++];
                const x = idx % W;
                const y = Math.floor(idx / W);

                component.minX = Math.min(component.minX, x);
                component.minY = Math.min(component.minY, y);
                component.maxX = Math.max(component.maxX, x);
                component.maxY = Math.max(component.maxY, y);
                component.area++;
                if (isWall[idx]) component.wallArea++;
                if (dtSolid[idx] > component.peakThickness) {
                    component.peakThickness = dtSolid[idx];
                }

                const push = (ni) => {
                    if (ni < 0 || ni >= this.instances || !solid[ni] || ids[ni] !== -1) return;
                    ids[ni] = id;
                    queue[qTail++] = ni;
                };

                if (idx >= W) push(idx - W);
                if (idx < this.instances - W) push(idx + W);
                if (x > 0) push(idx - 1);
                if (x < W - 1) push(idx + 1);
            }

            component.width = component.maxX - component.minX + 1;
            component.height = component.maxY - component.minY + 1;
            component.density = component.area / (component.width * component.height);
            components.push(component);
        }

        return components;
    }

    // Smoothstep ease between two edges: clamps to [0,1] with a gentle slope at
    // both ends so the size -> height mapping never changes abruptly.
    _smoothstep(edge0, edge1, x) {
        const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    chooseComponentHeight(component) {
        // Height is driven by `peakThickness` — the largest local thickness
        // found anywhere in the component (see collectSolidComponents).
        //
        // Why this is the right measure: the old code keyed off `area` (and
        // later, bounding-box size). Both of those balloon when separate
        // objects touch — a lone tree and a whole row of touching trees fuse
        // into one connected component, so the row got `area`'d up into a much
        // taller height bucket. Local thickness does NOT grow that way: a row
        // of touching trees is still only one tree "thick", so every tree —
        // merged or not — now resolves to the same height.
        //
        // It also fixes sunken interiors: a building's enclosed interior is now
        // solid, so its deep middle has a large thickness and the whole
        // roof+interior component reads as one tall, flat-topped mass.
        const peak = component.peakThickness;

        // Single-pixel strokes and texture specks: not scenery.
        if (peak <= 1.5) return 0;

        // Smooth, monotonic thickness -> height ramp. There are no buckets to
        // fall across, so a few pixels of difference can never produce a
        // visible height jump between two near-identical objects.
        //   peak ~3    -> low relief (grass tufts, thin detail)
        //   peak ~7-8  -> a single object (tree, rock, sign)
        //   peak ~13+  -> a massive structure (building roof + interior)
        const t = this._smoothstep(1.5, 13, peak);
        return this.minObjectRelief + t * (this.objectHeight - this.minObjectRelief);
    }

    componentPixelRelief(component, x, y, isWallPixel) {
        const maxHeight = this.chooseComponentHeight(component);
        if (maxHeight <= 0) return 0;

        const idx = y * this.width + x;
        const isEdge = !!this._solidEdge[idx];
        if (maxHeight < 3) {
            if (component.area >= 58) return maxHeight;
            if (isEdge) return maxHeight;
            return Math.max(this.minObjectRelief, maxHeight * 0.34);
        }

        // For large enclosed/object regions, the dark outline defines the
        // footprint. Keep the whole region as one flat plateau so the interior
        // never sinks below its border.
        let relief = maxHeight;
        if (isWallPixel && isEdge) {
            relief = Math.min(this.wallRimHeight, maxHeight + 0.24);
        }

        return Math.max(this.minObjectRelief, relief);
    }

    updateHeights(bgData) {
        const W = this.width;
        const H = this.height;
        const heights = this._heights;
        const smoothed = this._smoothedHeights;
        const isWall = this._isWall;
        const solid = this._solid;
        const ids = this._componentIds;

        for (let i = 0; i < this.instances; i++) {
            const pi = i * 4;
            const lum =
                0.2126 * bgData[pi] +
                0.7152 * bgData[pi + 1] +
                0.0722 * bgData[pi + 2];

            heights[i] = (1 - lum / 255) * this.groundRelief;
        }

        this.updateSolidEdges();
        const components = this.collectSolidComponents();
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const idx = y * W + x;
                if (!solid[idx]) continue;

                const component = components[ids[idx]];
                if (!component) continue;

                const relief = this.componentPixelRelief(component, x, y, !!isWall[idx]);
                heights[idx] = Math.max(heights[idx], relief);
            }
        }

        smoothed.set(heights);

        const pos = this.terrainGeometry.attributes.position;
        const arr = pos.array;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const idx = y * W + x;
                arr[idx * 3 + 2] = smoothed[idx];
            }
        }

        pos.needsUpdate = true;
        this.terrainGeometry.computeVertexNormals();
    }

    clearSprites() {
        const geometries = new Set();
        const materials = new Set();
        const textures = new Set();

        this.spriteGroup.traverse((obj) => {
            if (obj.geometry) geometries.add(obj.geometry);
            const materialList = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const material of materialList) {
                if (!material) continue;
                materials.add(material);
                if (material.map) textures.add(material.map);
            }
        });

        while (this.spriteGroup.children.length) {
            this.spriteGroup.remove(this.spriteGroup.children[0]);
        }

        textures.forEach((texture) => texture.dispose());
        materials.forEach((material) => material.dispose());
        geometries.forEach((geometry) => geometry.dispose());
    }

    updateSpriteBillboards() {
        const frameData = this.ppu?.frameData?.data;
        const bgData = this.ppu?.bgFrameData?.data;
        if (!frameData || !bgData) return;

        this.clearSprites();

        const W = this.width;
        const H = this.height;
        const visited = this._spriteVisited;
        const queue = this._spriteQueue;
        visited.fill(0);

        const isSpritePixel = (idx) => {
            const pi = idx * 4;
            return (
                frameData[pi] !== bgData[pi] ||
                frameData[pi + 1] !== bgData[pi + 1] ||
                frameData[pi + 2] !== bgData[pi + 2]
            );
        };

        for (let i = 0; i < this.instances; i++) {
            if (visited[i] || !isSpritePixel(i)) continue;

            let qHead = 0;
            let qTail = 0;
            let minX = W;
            let minY = H;
            let maxX = 0;
            let maxY = 0;
            let count = 0;

            visited[i] = 1;
            queue[qTail++] = i;

            while (qHead < qTail) {
                const idx = queue[qHead++];
                const x = idx % W;
                const y = Math.floor(idx / W);
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
                count++;

                const tryPush = (ni) => {
                    if (ni < 0 || ni >= this.instances || visited[ni] || !isSpritePixel(ni)) return;
                    visited[ni] = 1;
                    queue[qTail++] = ni;
                };

                if (idx >= W) tryPush(idx - W);
                if (idx < this.instances - W) tryPush(idx + W);
                if (x > 0) tryPush(idx - 1);
                if (x < W - 1) tryPush(idx + 1);
            }

            const sw = maxX - minX + 1;
            const sh = maxY - minY + 1;
            if (count < 6 || sw > 48 || sh > 48) continue;

            this.addSpriteComponent(frameData, bgData, minX, minY, sw, sh);
        }
    }

    addSpriteComponent(frameData, bgData, minX, minY, sw, sh) {
        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        const image = ctx.createImageData(sw, sh);

        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const src = ((minY + y) * this.width + minX + x) * 4;
                const dst = (y * sw + x) * 4;
                const isSprite =
                    frameData[src] !== bgData[src] ||
                    frameData[src + 1] !== bgData[src + 1] ||
                    frameData[src + 2] !== bgData[src + 2];

                if (!isSprite) continue;

                image.data[dst] = frameData[src];
                image.data[dst + 1] = frameData[src + 1];
                image.data[dst + 2] = frameData[src + 2];
                image.data[dst + 3] = 255;
            }
        }

        ctx.putImageData(image, 0, 0);

        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.1,
            depthWrite: false,
        });

        const sprite = new THREE.Sprite(material);
        const worldW = sw * this.worldScale;
        const worldH = sh * this.worldScale;
        const centerX = minX + sw / 2;
        const footY = minY + sh;
        const groundIdx = Math.min(this.instances - 1, Math.max(0, Math.floor(footY) * this.width + Math.floor(centerX)));
        const yLift = (this._smoothedHeights[groundIdx] || 0) + worldH / 2 + 0.8;

        sprite.position.set(
            (centerX - this.width / 2) * this.worldScale,
            yLift,
            (footY - this.height / 2) * this.worldScale
        );
        sprite.scale.set(worldW, worldH, 1);
        this.spriteGroup.add(sprite);
    }

    updateFromFrame() {
        const frameData = this.ppu?.frameData?.data;
        if (!frameData) return;

        const bgData = this.ppu?.bgFrameData?.data || frameData;

        this.classifyPixels(bgData);
        this.updateTexture(bgData);
        this.updateHeights(bgData);

        this._frameCounter++;
        if ((this._frameCounter % this.spriteRefreshInterval) === 0) {
            this.updateSpriteBillboards();
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.handleResize();
        this.updateFromFrame();
        this.renderer.render(this.scene, this.camera);
    }
}

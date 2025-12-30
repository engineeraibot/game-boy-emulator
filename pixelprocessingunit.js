class PixelProcessingUnit {

    constructor(canvas, memoryManagementUnit) {
        this.canvas = canvas;
        this.context = canvas.getContext("2d");
        this.mmu = memoryManagementUnit;
        this.ppuClock = 0;
        this.mode = 2; // Start in OAM search
        this.scxPerLine = new Uint8Array(154);
        this.scyPerLine = new Uint8Array(154);
        
        // Create an ImageData object to manipulate pixels directly
        this.frameData = this.context.createImageData(160, 144);
        
        // Game Boy "Green" palette
        this.colors = [
            [224, 248, 208], // Lightest
            [136, 192, 112],
            [52, 104, 86],
            [8, 24, 32]      // Darkest
        ];
    }

    reset() {
        this.ppuClock = 0;
        this.mode = 2;
        this.scxPerLine.fill(0);
        this.scyPerLine.fill(0);
        this.mmu.write8bits(0xFF44, 0);
        this.updateStatMode(2, true, 0);
    }

    getState() {
        return {
            ppuClock: this.ppuClock,
            mode: this.mode,
            scxPerLine: Array.from(this.scxPerLine),
            scyPerLine: Array.from(this.scyPerLine),
        };
    }

    setState(state) {
        if (!state) return;
        this.ppuClock = state.ppuClock ?? 0;
        this.mode = state.mode ?? 2;
        if (state.scxPerLine) this.scxPerLine = new Uint8Array(state.scxPerLine);
        if (state.scyPerLine) this.scyPerLine = new Uint8Array(state.scyPerLine);
        // LY/stat registers reside in MMU memory; they should be restored via MMU state.
    }

    step(cycles) {
        const lcdc = this.mmu.read8bits(0xFF40);
        const lcdEnabled = (lcdc & 0x80) !== 0;

        if (!lcdEnabled) {
            this.ppuClock = 0;
            this.mode = 0;
            this.mmu.write8bits(0xFF44, 0); // LY
            this.updateStatMode(0, true);
            return;
        }

        // Capture scroll registers for the current line when in mode 2
        if (this.mode === 2) {
            const ly = this.mmu.read8bits(0xFF44);
            if (ly < 144) {
                this.sampleLineRegisters(ly);
            }
        }

        this.ppuClock += cycles;

        // Mode lengths (approximate)
        const mode2Length = 80;
        const mode3Length = 172;
        const mode0Length = 204; // 456 - 80 - 172
        const lineLength = 456;

        while (this.ppuClock >= 0) {
            const ly = this.mmu.read8bits(0xFF44);

            switch (this.mode) {
                case 2: // OAM search
                    if (this.ppuClock >= mode2Length) {
                        this.ppuClock -= mode2Length;
                        this.mode = 3;
                        this.updateStatMode(3, false, ly);
                    } else {
                        return;
                    }
                    break;
                case 3: // Drawing
                    if (this.ppuClock >= mode3Length) {
                        this.ppuClock -= mode3Length;
                        this.mode = 0;
                        this.updateStatMode(0, false, ly);
                    } else {
                        return;
                    }
                    break;
                case 0: // HBlank
                    if (this.ppuClock >= mode0Length) {
                        this.ppuClock -= mode0Length;
                        const newLy = ly + 1;
                        this.mmu.write8bits(0xFF44, newLy);
                        this.checkLyc(newLy);

                        if (newLy === 144) {
                            // Enter VBlank
                            this.mode = 1;
                            this.updateStatMode(1, false, newLy);
                            this.mmu.requestInterrupt(0); // VBlank interrupt
                            this.renderFrame(); // draw finished frame
                        } else {
                            // Next line starts in mode 2
                            this.mode = 2;
                            this.updateStatMode(2, false, newLy);
                        }
                    } else {
                        return;
                    }
                    break;
                case 1: // VBlank
                    if (this.ppuClock >= lineLength) {
                        this.ppuClock -= lineLength;
                        const newLyV = ly + 1;
                        if (newLyV > 153) {
                            // Restart frame
                            this.mmu.write8bits(0xFF44, 0);
                            this.checkLyc(0);
                            this.mode = 2;
                            this.updateStatMode(2, false, 0);
                        } else {
                            this.mmu.write8bits(0xFF44, newLyV);
                            this.checkLyc(newLyV);
                        }
                    } else {
                        return;
                    }
                    break;
            }
        }
    }

    updateStatMode(mode, clearCoincidence = false, lyOverride = null) {
        let stat = this.mmu.read8bits(0xFF41);
        stat = (stat & ~0x03) | (mode & 0x03);
        if (clearCoincidence) {
            stat &= ~0x04;
        }
        this.mmu.write8bits(0xFF41, stat);

        if (mode === 2) {
            const ly = lyOverride !== null ? lyOverride : this.mmu.read8bits(0xFF44);
            if (ly < 144) {
                this.sampleLineRegisters(ly);
            }
        }

        // STAT interrupts for modes
        if (mode === 2 && (stat & 0x20)) { // OAM
            this.mmu.requestInterrupt(1);
        } else if (mode === 0 && (stat & 0x08)) { // HBlank
            this.mmu.requestInterrupt(1);
        } else if (mode === 1 && (stat & 0x10)) { // VBlank STAT
            this.mmu.requestInterrupt(1);
        }
    }

    checkLyc(ly) {
        const lyc = this.mmu.read8bits(0xFF45);
        let stat = this.mmu.read8bits(0xFF41);
        const coincidence = ly === lyc;
        stat = (stat & ~0x04) | (coincidence ? 0x04 : 0);
        this.mmu.write8bits(0xFF41, stat);
        if (coincidence && (stat & 0x40)) {
            this.mmu.requestInterrupt(1);
        }
    }

    sampleLineRegisters(ly) {
        if (ly < 154) {
            this.scxPerLine[ly] = this.mmu.read8bits(0xFF43);
            this.scyPerLine[ly] = this.mmu.read8bits(0xFF42);
        }
    }

    renderFrame() {
        const lcdc = this.mmu.read8bits(0xFF40);
        const lcdEnabled = (lcdc & 0x80) !== 0;
        if (!lcdEnabled) {
            // Fill white when LCD off
            this.frameData.data.fill(255);
            this.context.putImageData(this.frameData, 0, 0);
            return;
        }

        const wy = this.mmu.read8bits(0xFF4A);
        const wx = this.mmu.read8bits(0xFF4B);
        const windowEnabled = (lcdc & 0x20) !== 0;

        // Loop through every pixel on the 160x144 screen
        const spritesEnabled = (lcdc & 0x02) !== 0;
        const spriteHeight = (lcdc & 0x04) !== 0 ? 16 : 8;
        for (let y = 0; y < 144; y++) {
            const scx = this.scxPerLine[y];
            const scy = this.scyPerLine[y];
            for (let x = 0; x < 160; x++) {
                
                // Decide whether to use window or background
                const useWindow = windowEnabled && y >= wy && x >= (wx - 7);
                const worldX = useWindow ? (x - (wx - 7)) & 0xFF : (x + scx) & 0xFF;
                const worldY = useWindow ? (y - wy) & 0xFF : (y + scy) & 0xFF;

                // Find which 8x8 tile that pixel belongs to
                const bgTileMapArea = useWindow
                    ? (lcdc & 0x40) !== 0 // Window tile map select (bit 6)
                    : (lcdc & 0x08) !== 0; // BG tile map select (bit 3)
                const tileMapBaseAddress = bgTileMapArea ? 0x9C00 : 0x9800;

                const tileCol = Math.floor(worldX / 8);
                const tileRow = Math.floor(worldY / 8);
                const tileMapAddress = tileMapBaseAddress + (tileRow * 32) + tileCol;
                const tileIndex = this.mmu.read8bits(tileMapAddress);

                // Find the pixel data within that tile
                const bgTileDataArea = (lcdc & 0x10) !== 0; // Bit 4
                let tileDataAddress;

                if (bgTileDataArea) {
                    // Unsigned addressing mode from 0x8000.
                    tileDataAddress = 0x8000 + (tileIndex * 16);
                } else {
                    // Signed addressing mode from 0x9000.
                    const signedIndex = (tileIndex << 24) >> 24; // sign-extend 8-bit
                    tileDataAddress = 0x9000 + (signedIndex * 16);
                }
                const innerY = worldY % 8;
                const innerX = worldX % 8;

                // Game Boy uses 2 bits per pixel stored in two separate bytes
                const byte1 = this.mmu.read8bits(tileDataAddress + (innerY * 2));
                const byte2 = this.mmu.read8bits(tileDataAddress + (innerY * 2) + 1);

                // Extract the specific bit for this pixel (bit 7 is leftmost)
                const bitIndex = 7 - innerX;
                const bgColorIndex = (((byte2 >> bitIndex) & 1) << 1) | ((byte1 >> bitIndex) & 1);

                let finalPaletteIndex;
                let finalColorIndex = bgColorIndex;

                // Sprite (OBJ) rendering
                if (spritesEnabled) {
                    // Sprite priority is determined by OAM order (first hit wins)
                    for (let sprite = 0; sprite < 40; sprite++) {
                        const base = 0xFE00 + sprite * 4;
                        const spriteY = this.mmu.read8bits(base) - 16;
                        const spriteX = this.mmu.read8bits(base + 1) - 8;
                        let tileIndex = this.mmu.read8bits(base + 2);
                        const attr = this.mmu.read8bits(base + 3);

                        if (y < spriteY || y >= spriteY + spriteHeight) continue;
                        if (x < spriteX || x >= spriteX + 8) continue;

                        // Handle 8x16 mode: tileIndex must be even, second tile is +1
                        if (spriteHeight === 16) {
                            tileIndex &= 0xFE;
                        }

                        let innerYSprite = y - spriteY;
                        let innerXSprite = x - spriteX;
                        if (attr & 0x40) { // Y flip
                            innerYSprite = spriteHeight - 1 - innerYSprite;
                        }
                        if (attr & 0x20) { // X flip
                            innerXSprite = 7 - innerXSprite;
                        }

                        // Select correct tile for 8x16
                        const tileRow = innerYSprite % 8;
                        const spriteTile = tileIndex + Math.floor(innerYSprite / 8);
                        const spriteTileAddress = 0x8000 + spriteTile * 16;
                        const sByte1 = this.mmu.read8bits(spriteTileAddress + tileRow * 2);
                        const sByte2 = this.mmu.read8bits(spriteTileAddress + tileRow * 2 + 1);
                        const sBitIndex = 7 - innerXSprite;
                        const spriteColorIndex = (((sByte2 >> sBitIndex) & 1) << 1) | ((sByte1 >> sBitIndex) & 1);

                        // Color index 0 is transparent
                        if (spriteColorIndex === 0) {
                            continue;
                        }

                        // Priority: if OBJ-to-BG flag set, sprite is behind non-zero BG
                        const bgPriority = (attr & 0x80) !== 0;
                        if (bgPriority && bgColorIndex !== 0) {
                            break; // BG wins, stop checking further sprites
                        }

                        const paletteReg = (attr & 0x10) ? 0xFF49 : 0xFF48;
                        const palette = this.mmu.read8bits(paletteReg);
                        finalPaletteIndex = (palette >> (spriteColorIndex * 2)) & 0x03;
                        finalColorIndex = null; // using palette index directly
                        break;
                    }
                }

                // Write to the canvas buffer
                if (finalPaletteIndex === undefined) {
                    const bgp = this.mmu.read8bits(0xFF47);
                    finalPaletteIndex = (bgp >> (finalColorIndex * 2)) & 0x03;
                }
                const color = this.colors[finalPaletteIndex];
                const canvasIndex = (y * 160 + x) * 4;
                
                this.frameData.data[canvasIndex] = color[0];     // R
                this.frameData.data[canvasIndex + 1] = color[1]; // G
                this.frameData.data[canvasIndex + 2] = color[2]; // B
                this.frameData.data[canvasIndex + 3] = 255;      // Alpha
            }
        }

        // Push the pixel data to the canvas
        this.context.putImageData(this.frameData, 0, 0);
    }
    
}

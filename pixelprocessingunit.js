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
        this.lcdPreviouslyEnabled = true;

        // Preallocated per-scanline sprite buffers (avoids rescanning OAM per pixel)
        this.lineSpriteX = new Int16Array(40);
        this.lineSpriteAttr = new Uint8Array(40);
        this.lineSpriteB1 = new Uint8Array(40);
        this.lineSpriteB2 = new Uint8Array(40);
        
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
        // Direct memory access: 0xFF40/0xFF44 fall through to plain memory in the MMU,
        // so this is behaviorally identical but avoids per-instruction call overhead.
        const mem = this.mmu.memory;
        const lcdc = mem[0xFF40];
        const lcdEnabled = (lcdc & 0x80) !== 0;

        if (!lcdEnabled) {
            if (this.lcdPreviouslyEnabled) {
                // Blank the screen once when LCD turns off
                this.frameData.data.fill(255);
                this.context.putImageData(this.frameData, 0, 0);
                this.ppuClock = 0;
                this.mode = 0;
                this.mmu.write8bits(0xFF44, 0); // LY
                // Set STAT mode bits directly WITHOUT requesting interrupts:
                // a disabled LCD produces no STAT interrupts on real hardware.
                // Going through updateStatMode here fired the mode-0 STAT
                // interrupt on every step, flooding the CPU with interrupts
                // (this froze Pokemon Yellow's intro, which turns the LCD off
                // while the hblank STAT interrupt is enabled).
                let stat = this.mmu.read8bits(0xFF41);
                stat = stat & ~0x07; // mode 0, clear coincidence flag
                this.mmu.write8bits(0xFF41, stat);
            }
            this.lcdPreviouslyEnabled = false;
            return;
        }
        this.lcdPreviouslyEnabled = true;

        // Capture scroll registers for the current line when in mode 2
        if (this.mode === 2) {
            const ly = mem[0xFF44];
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
            const ly = mem[0xFF44];

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
                        this.renderScanline(ly);
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
                            this.flushFrame(); // present finished frame
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
            this.scxPerLine[ly] = this.mmu.memory[0xFF43];
            this.scyPerLine[ly] = this.mmu.memory[0xFF42];
        }
    }

    renderScanline(y) {
        // The whole scanline is rendered at a single instant, so reading VRAM/OAM/
        // registers directly from MMU memory (where these addresses fall through to
        // anyway) is behaviorally identical to the previous per-pixel read8bits calls.
        const mem = this.mmu.memory;
        const lcdc = mem[0xFF40];
        const lcdEnabled = (lcdc & 0x80) !== 0;
        if (!lcdEnabled) {
            return;
        }

        const wy = mem[0xFF4A];
        const wx = mem[0xFF4B];
        const wxAdj = wx - 7;
        const windowEnabled = (lcdc & 0x20) !== 0;
        const windowOnLine = windowEnabled && y >= wy;

        const spritesEnabled = (lcdc & 0x02) !== 0;
        const spriteHeight = (lcdc & 0x04) !== 0 ? 16 : 8;
        const scx = this.scxPerLine[y];
        const scy = this.scyPerLine[y];

        const bgTileDataArea = (lcdc & 0x10) !== 0; // Bit 4
        const windowMapBase = (lcdc & 0x40) !== 0 ? 0x9C00 : 0x9800; // Bit 6
        const bgMapBase = (lcdc & 0x08) !== 0 ? 0x9C00 : 0x9800; // Bit 3
        const bgp = mem[0xFF47];
        const obp0 = mem[0xFF48];
        const obp1 = mem[0xFF49];

        // OAM scan once per line instead of once per pixel.
        // OAM order is preserved, so per-pixel priority (first hit wins) is unchanged.
        const sX = this.lineSpriteX;
        const sAttr = this.lineSpriteAttr;
        const sB1 = this.lineSpriteB1;
        const sB2 = this.lineSpriteB2;
        let spriteCount = 0;
        if (spritesEnabled) {
            for (let sprite = 0; sprite < 40; sprite++) {
                const base = 0xFE00 + sprite * 4;
                const spriteY = mem[base] - 16;
                if (y < spriteY || y >= spriteY + spriteHeight) continue;
                const spriteX = mem[base + 1] - 8;
                if (spriteX <= -8 || spriteX >= 160) continue; // can never cover a pixel

                let tileIndexSprite = mem[base + 2];
                const attr = mem[base + 3];

                // Handle 8x16 mode: tileIndex must be even, second tile is +1
                if (spriteHeight === 16) {
                    tileIndexSprite &= 0xFE;
                }

                let innerYSprite = y - spriteY;
                if (attr & 0x40) { // Y flip
                    innerYSprite = spriteHeight - 1 - innerYSprite;
                }

                // The sprite's tile row for this line is fixed; fetch it once.
                const spriteTile = tileIndexSprite + (innerYSprite >> 3);
                const rowAddress = 0x8000 + spriteTile * 16 + (innerYSprite & 7) * 2;
                sX[spriteCount] = spriteX;
                sAttr[spriteCount] = attr;
                sB1[spriteCount] = mem[rowAddress];
                sB2[spriteCount] = mem[rowAddress + 1];
                spriteCount++;
            }
        }

        const data = this.frameData.data;
        let canvasIndex = y * 160 * 4;

        // Cache the current BG/window tile row; consecutive pixels usually share it.
        let cachedRowAddress = -1;
        let rowByte1 = 0;
        let rowByte2 = 0;

        for (let x = 0; x < 160; x++) {
            // Decide whether to use window or background
            const useWindow = windowOnLine && x >= wxAdj;
            let worldX, worldY, tileMapBaseAddress;
            if (useWindow) {
                worldX = (x - wxAdj) & 0xFF;
                worldY = (y - wy) & 0xFF;
                tileMapBaseAddress = windowMapBase;
            } else {
                worldX = (x + scx) & 0xFF;
                worldY = (y + scy) & 0xFF;
                tileMapBaseAddress = bgMapBase;
            }

            // Find which 8x8 tile that pixel belongs to
            const tileMapAddress = tileMapBaseAddress + ((worldY >> 3) << 5) + (worldX >> 3);
            const tileIndex = mem[tileMapAddress];

            // Find the pixel data within that tile
            let tileDataAddress;
            if (bgTileDataArea) {
                // Unsigned addressing mode from 0x8000.
                tileDataAddress = 0x8000 + (tileIndex * 16);
            } else {
                // Signed addressing mode from 0x9000.
                tileDataAddress = 0x9000 + (((tileIndex << 24) >> 24) * 16);
            }

            // Game Boy uses 2 bits per pixel stored in two separate bytes
            const rowAddress = tileDataAddress + ((worldY & 7) << 1);
            if (rowAddress !== cachedRowAddress) {
                cachedRowAddress = rowAddress;
                rowByte1 = mem[rowAddress];
                rowByte2 = mem[rowAddress + 1];
            }

            // Extract the specific bit for this pixel (bit 7 is leftmost)
            const bitIndex = 7 - (worldX & 7);
            const bgColorIndex = (((rowByte2 >> bitIndex) & 1) << 1) | ((rowByte1 >> bitIndex) & 1);

            let finalPaletteIndex = -1;

            // Sprite (OBJ) rendering; priority is OAM order (first hit wins)
            for (let s = 0; s < spriteCount; s++) {
                const spriteX = sX[s];
                if (x < spriteX || x >= spriteX + 8) continue;

                const attr = sAttr[s];
                let innerXSprite = x - spriteX;
                if (attr & 0x20) { // X flip
                    innerXSprite = 7 - innerXSprite;
                }
                const sBitIndex = 7 - innerXSprite;
                const spriteColorIndex = (((sB2[s] >> sBitIndex) & 1) << 1) | ((sB1[s] >> sBitIndex) & 1);

                // Color index 0 is transparent
                if (spriteColorIndex === 0) {
                    continue;
                }

                // Priority: if OBJ-to-BG flag set, sprite is behind non-zero BG
                if ((attr & 0x80) && bgColorIndex !== 0) {
                    break; // BG wins, stop checking further sprites
                }

                const palette = (attr & 0x10) ? obp1 : obp0;
                finalPaletteIndex = (palette >> (spriteColorIndex << 1)) & 0x03;
                break;
            }

            // Write to the canvas buffer
            if (finalPaletteIndex < 0) {
                finalPaletteIndex = (bgp >> (bgColorIndex << 1)) & 0x03;
            }
            const color = this.colors[finalPaletteIndex];

            data[canvasIndex] = color[0];     // R
            data[canvasIndex + 1] = color[1]; // G
            data[canvasIndex + 2] = color[2]; // B
            data[canvasIndex + 3] = 255;      // Alpha
            canvasIndex += 4;
        }
    }

    flushFrame() {
        const lcdc = this.mmu.read8bits(0xFF40);
        const lcdEnabled = (lcdc & 0x80) !== 0;
        if (!lcdEnabled) {
            this.frameData.data.fill(255);
        }
        this.context.putImageData(this.frameData, 0, 0);
    }
    
}

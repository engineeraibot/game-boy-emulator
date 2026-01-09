function encodeBytes(u8) {
    if (!u8) return null;
    let binary = "";
    const chunk = 0x4000;
    for (let i = 0; i < u8.length; i += chunk) {
        const slice = u8.subarray(i, i + chunk);
        binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary);
}

function decodeBytes(str) {
    if (!str) return null;
    const binary = atob(str);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

function toUint8(source, fallbackLength = 0) {
    if (!source && source !== 0) {
        return fallbackLength ? new Uint8Array(fallbackLength) : null;
    }
    if (typeof source === "string") return decodeBytes(source);
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    if (Array.isArray(source)) return new Uint8Array(source);
    return fallbackLength ? new Uint8Array(fallbackLength) : null;
}

class MemoryManagementUnit {

    constructor () {
        this.memory = new Uint8Array(0x10000);
        this.joypad = new Joypad(this);
        this.apu = null;

        // Cartridge state
        this.rom = null;
        this.cartridgeType = 0x00;
        this.mbcType = "ROM_ONLY";
        this.romBankNumber = 1; // switchable bank (behavior varies by MBC)
        this.ramBankNumber = 0; // also used for upper ROM bits on some MBCs
        this.mbc1Mode = 0; // 0 = 16Mbit ROM/8KByte RAM, 1 = 4Mbit ROM/32KByte RAM
        this.mbc3RtcRegister = null;
        this.externalRamEnabled = false;
        this.ramBanks = new Uint8Array(0x8000); // up to 4 * 8KB RAM banks

        // Timers
        this.divCounter = 0;
        this.timerCounter = 0;
    }

    async loadROM(romSource) {
        console.log("ROM load start");
        let romData;

        if (typeof romSource === "string") {
            const response = await fetch(romSource);
            if (!response.ok) {
                throw new Error(`Failed to load ROM: ${romSource}`);
            }
            const buffer = await response.arrayBuffer();
            romData = new Uint8Array(buffer);
        } else if (romSource instanceof ArrayBuffer) {
            romData = new Uint8Array(romSource);
        } else if (romSource instanceof Uint8Array) {
            romData = romSource;
        } else {
            throw new Error("Unsupported ROM source");
        }

        this.initializeRomBanks(romData);
        console.log("ROM load end");
    }

    initializeRomBanks(romData) {
        // Save ROM for banked reads
        this.rom = romData;
        this.cartridgeType = romData[0x0147] ?? 0x00;
        this.mbcType = this.detectMbcType(this.cartridgeType);
        this.romBankNumber = 1;
        this.ramBankNumber = 0;
        this.mbc1Mode = 0;
        this.mbc3RtcRegister = null;
        this.externalRamEnabled = false;
        this.ramBanks = new Uint8Array(this.getRamSizeBytes(romData[0x0149] ?? 0) || 0x8000);

        // Clear memory (VRAM/RAM/OAM/IO) to a known state
        this.memory.fill(0);

        // Seed fixed + default switchable bank so code can run before any bank switches
        const seedSize = Math.min(romData.length, 0x8000);
        this.memory.set(romData.slice(0, seedSize), 0x0000);

        // Hardware register defaults (DMG, post-boot ROM)
        this.memory[0xFF05] = 0x00; // TIMA
        this.memory[0xFF06] = 0x00; // TMA
        this.memory[0xFF07] = 0x00; // TAC
        this.memory[0xFF04] = 0x00; // DIV
        this.memory[0xFF10] = 0x80;
        this.memory[0xFF11] = 0xBF;
        this.memory[0xFF12] = 0xF3;
        this.memory[0xFF14] = 0xBF;
        this.memory[0xFF16] = 0x3F;
        this.memory[0xFF17] = 0x00;
        this.memory[0xFF19] = 0xBF;
        this.memory[0xFF1A] = 0x7F;
        this.memory[0xFF1B] = 0xFF;
        this.memory[0xFF1C] = 0x9F;
        this.memory[0xFF1E] = 0xBF;
        this.memory[0xFF20] = 0xFF;
        this.memory[0xFF21] = 0x00;
        this.memory[0xFF22] = 0x00;
        this.memory[0xFF23] = 0xBF;
        this.memory[0xFF24] = 0x77;
        this.memory[0xFF25] = 0xF3;
        this.memory[0xFF26] = 0xF1;
        this.memory[0xFF40] = 0x91; // LCDC on, BG on
        this.memory[0xFF41] = 0x85; // STAT
        this.memory[0xFF42] = 0x00; // SCY
        this.memory[0xFF43] = 0x00; // SCX
        this.memory[0xFF45] = 0x00; // LYC
        this.memory[0xFF47] = 0xFC; // BGP
        this.memory[0xFF48] = 0xFF; // OBP0
        this.memory[0xFF49] = 0xFF; // OBP1
        this.memory[0xFF4A] = 0x00; // WY
        this.memory[0xFF4B] = 0x00; // WX
        this.memory[0xFF50] = 0x01; // Boot ROM disabled
        this.memory[0xFF00] = 0xCF; // Joypad default (no buttons pressed)
        this.memory[0xFFFF] = 0x00; // IE
    }

    getState() {
        return {
            memoryB64: encodeBytes(this.memory),
            romB64: this.rom ? encodeBytes(this.rom) : null,
            cartridgeType: this.cartridgeType,
            mbcType: this.mbcType,
            romBankNumber: this.romBankNumber,
            ramBankNumber: this.ramBankNumber,
            mbc1Mode: this.mbc1Mode,
            mbc3RtcRegister: this.mbc3RtcRegister,
            externalRamEnabled: this.externalRamEnabled,
            ramBanksB64: encodeBytes(this.ramBanks),
            divCounter: this.divCounter,
            timerCounter: this.timerCounter,
            joypad: {
                buttons: { ...this.joypad.buttons },
                memoryValue: this.joypad.memoryValue
            }
        };
    }

    setState(state) {
        if (!state) return;
        this.memory = toUint8(state.memoryB64 ?? state.memory, 0x10000);
        this.rom = toUint8(state.romB64 ?? state.rom, 0);
        this.cartridgeType = state.cartridgeType ?? this.cartridgeType ?? 0x00;
        this.mbcType = state.mbcType ?? this.detectMbcType(this.cartridgeType);
        this.romBankNumber = state.romBankNumber ?? 1;
        this.ramBankNumber = state.ramBankNumber ?? 0;
        this.mbc1Mode = state.mbc1Mode ?? 0;
        this.mbc3RtcRegister = state.mbc3RtcRegister ?? null;
        this.externalRamEnabled = !!state.externalRamEnabled;
        const ramLength = this.getRamSizeBytes(state.ramSizeCode ?? null) || this.ramBanks?.length || 0x8000;
        this.ramBanks = toUint8(state.ramBanksB64 ?? state.ramBanks, ramLength);
        this.divCounter = state.divCounter ?? 0;
        this.timerCounter = state.timerCounter ?? 0;
        if (state.joypad?.buttons) {
          this.joypad.buttons = { ...state.joypad.buttons };
        }
        if (typeof state.joypad?.memoryValue === "number") {
          this.joypad.memoryValue = state.joypad.memoryValue;
        }
    }

    read8bits(
        address
    ) {
        address &= 0xFFFF;

        if (address >= 0xE000 && address < 0xFE00) {
            address -= 0x2000;
        }

        if (address >= 0xFEA0 && address < 0xFEFF) {
            return 0xFF;
        }

        // Joypad register
        if (address === 0xFF00) { // Joypad register
            return this.joypad.read();
        }

        if (address >= 0xFF10 && address <= 0xFF3F) {
            return this.apu?.readRegister(address) ?? 0xFF;
        }

        // ROM
        if (address < 0x4000) {
            return this.rom ? this.rom[address] : this.memory[address];
        }

        if (address < 0x8000) { // switchable bank
            if (!this.rom) {
                return this.memory[address];
            }
            const bank = this.getCurrentRomBankNumber();
            const bankOffset = bank * 0x4000;
            const index = bankOffset + (address - 0x4000);
            return this.rom[index] ?? 0xFF;
        }

        if (address >= 0xA000 && address < 0xC000) { // External RAM / RTC
            if (!this.externalRamEnabled) {
                return 0xFF;
            }
            if (this.mbcType === "MBC3" && this.mbc3RtcRegister !== null) {
                // Simple stub RTC registers
                switch (this.mbc3RtcRegister) {
                    case 0x08: return 0; // seconds
                    case 0x09: return 0; // minutes
                    case 0x0A: return 0; // hours
                    case 0x0B: return 0; // lower day
                    case 0x0C: return 0; // upper day + control
                    default: return 0;
                }
            }
            const ramBank = this.getCurrentRamBankNumber();
            const offset = ramBank * 0x2000 + (address - 0xA000);
            if (offset < this.ramBanks.length) {
                return this.ramBanks[offset];
            }
            return 0xFF;
        }

        return this.memory[address];
    }

    step(cycles) {
        // DIV: 16384 Hz -> increment every 256 CPU cycles
        this.divCounter = (this.divCounter + cycles) & 0xFFFF;
        while (this.divCounter >= 256) {
            this.divCounter -= 256;
            this.memory[0xFF04] = (this.memory[0xFF04] + 1) & 0xFF;
        }

        // TIMA
        const tac = this.memory[0xFF07];
        if ((tac & 0x04) !== 0) {
            const periods = [1024, 16, 64, 256]; // cycles per increment for TAC input select 00,01,10,11
            const period = periods[tac & 0x03];
            this.timerCounter += cycles;
            while (this.timerCounter >= period) {
                this.timerCounter -= period;
                if (this.memory[0xFF05] === 0xFF) {
                    this.memory[0xFF05] = this.memory[0xFF06]; // reload
                    this.requestInterrupt(2); // Timer interrupt
                } else {
                    this.memory[0xFF05] = (this.memory[0xFF05] + 1) & 0xFF;
                }
            }
        } else {
            this.timerCounter = 0;
        }
    }
    
    write8bits(
        address,
        value
    ) {
        address &= 0xFFFF;
        value &= 0xFF;

        if (address >= 0xE000 && address < 0xFE00) {
            address -= 0x2000;
        }

        if (address >= 0xFEA0 && address < 0xFEFF) {
            return;
        }

        if (address >= 0xFF10 && address <= 0xFF3F) {
            this.apu?.writeRegister(address, value);
            return;
        }

        if (this.mbcType === "MBC3") {
            // RAM/RTC enable
            if (address < 0x2000) {
                this.externalRamEnabled = (value & 0x0F) === 0x0A;
                return;
            }
            // ROM bank select (7 bits, 0 -> 1)
            if (address >= 0x2000 && address < 0x4000) {
                const bank = value & 0x7F;
                this.romBankNumber = bank === 0 ? 1 : bank;
                return;
            }
            // RAM bank select or RTC register select
            if (address >= 0x4000 && address < 0x6000) {
                if (value <= 0x03) {
                    this.ramBankNumber = value & 0x03;
                    this.mbc3RtcRegister = null;
                } else if (value >= 0x08 && value <= 0x0C) {
                    this.mbc3RtcRegister = value;
                }
                return;
            }
            // Latch clock (ignored for now)
            if (address >= 0x6000 && address < 0x8000) {
                return;
            }
        } else if (this.mbcType === "MBC5") {
            // RAM enable
            if (address < 0x2000) {
                this.externalRamEnabled = (value & 0x0F) === 0x0A;
                return;
            }
            // ROM bank lower 8 bits
            if (address >= 0x2000 && address < 0x3000) {
                this.romBankNumber = (this.romBankNumber & 0x100) | value;
                return;
            }
            // ROM bank upper bit
            if (address >= 0x3000 && address < 0x4000) {
                this.romBankNumber = (this.romBankNumber & 0xFF) | ((value & 0x01) << 8);
                return;
            }
            // RAM bank number (4 bits)
            if (address >= 0x4000 && address < 0x6000) {
                this.ramBankNumber = value & 0x0F;
                return;
            }
            // 0x6000-0x7FFF unused for MBC5
            if (address >= 0x6000 && address < 0x8000) {
                return;
            }
        } else {
            // MBC1 control (default)
            if (address < 0x2000) { // RAM enable
                this.externalRamEnabled = (value & 0x0F) === 0x0A;
                return;
            }
            if (address >= 0x2000 && address < 0x4000) { // ROM bank number (lower 5 bits)
                const bank = value & 0x1F;
                this.romBankNumber = bank === 0 ? 1 : bank;
                return;
            }
            if (address >= 0x4000 && address < 0x6000) { // RAM bank number or upper ROM bits
                this.ramBankNumber = value & 0x03;
                return;
            }
            if (address >= 0x6000 && address < 0x8000) { // Banking mode select
                this.mbc1Mode = value & 0x01;
                return;
            }
        }

        if (address >= 0xA000 && address < 0xC000) { // External RAM
            if (!this.externalRamEnabled) {
                return;
            }
            if (this.mbcType === "MBC3" && this.mbc3RtcRegister !== null) {
                // Stub RTC write ignored
                return;
            }
            const ramBank = this.getCurrentRamBankNumber();
            const offset = ramBank * 0x2000 + (address - 0xA000);
            if (offset < this.ramBanks.length) {
                this.ramBanks[offset] = value;
            }
            return;
        }

        if (address === 0xFF04) { // DIV reset
            this.memory[0xFF04] = 0;
            this.divCounter = 0;
            return;
        }
        if (address === 0xFF05 || address === 0xFF06 || address === 0xFF07) { // TIMA, TMA, TAC
            this.memory[address] = value;
            if (address === 0xFF07) {
                this.timerCounter = 0;
            }
            return;
        }
        if (address === 0xFF46) { // DMA
            const sourceBase = value << 8;
            for (let i = 0; i < 160; i++) {
                const data = this.read8bits((sourceBase + i) & 0xFFFF);
                this.memory[0xFE00 + i] = data;
            }
            return;
        }

        this.memory[address] = value;
    }
    
    read16bits(
        address
    ) {
        return this.read8bits(address) | (this.read8bits(address + 1) << 8);
    }

    write16bits(
        address,
        value
    ) {
        this.write8bits(address, value & 0xFF);
        this.write8bits(address + 1, value >> 8);
    }

    getCurrentRomBankNumber() {
        if (this.mbcType === "MBC3") {
            const bank = this.romBankNumber & 0x7F;
            return bank === 0 ? 1 : bank;
        }
        if (this.mbcType === "MBC5") {
            return this.romBankNumber & 0x1FF; // 9 bits
        }
        // Default to MBC1
        const upper = (this.mbc1Mode === 0 ? this.ramBankNumber : (this.ramBankNumber & 0x03)) << 5;
        const bank = (upper | this.romBankNumber) & 0x7F;
        return bank === 0 ? 1 : bank;
    }

    getCurrentRamBankNumber() {
        if (this.mbcType === "MBC3") {
            return this.ramBankNumber & 0x03;
        }
        if (this.mbcType === "MBC5") {
            return this.ramBankNumber & 0x0F;
        }
        return this.mbc1Mode === 0 ? 0 : (this.ramBankNumber & 0x03);
    }

    requestInterrupt(bit) {
        this.memory[0xFF0F] |= (1 << bit);
    }

    detectMbcType(cartridgeType) {
        if (cartridgeType === 0x00) return "ROM_ONLY";
        if ([0x01, 0x02, 0x03].includes(cartridgeType)) return "MBC1";
        if ([0x0F, 0x10, 0x11, 0x12, 0x13].includes(cartridgeType)) return "MBC3";
        if ([0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E].includes(cartridgeType)) return "MBC5";
        return "MBC1"; // default fallback
    }

    getRamSizeBytes(code) {
        switch (code) {
            case 0x00: return 0;
            case 0x01: return 0x800; // 2KB
            case 0x02: return 0x2000; // 8KB
            case 0x03: return 0x8000; // 32KB (4 banks)
            case 0x04: return 0x20000; // 128KB (16 banks)
            case 0x05: return 0x10000; // 64KB (8 banks)
            default: return 0x8000;
        }
    }

}

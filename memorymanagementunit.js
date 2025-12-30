class MemoryManagementUnit {

    constructor () {
        this.memory = new Uint8Array(0x10000);
        this.joypad = new Joypad(this);

        // Cartridge/MBC1 state
        this.rom = null;
        this.romBankNumber = 1; // MBC1 lower 5 bits, bank 0 maps to 1
        this.ramBankNumber = 0;
        this.mbc1Mode = 0; // 0 = 16Mbit ROM/8KByte RAM, 1 = 4Mbit ROM/32KByte RAM
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
        this.romBankNumber = 1;
        this.ramBankNumber = 0;
        this.mbc1Mode = 0;
        this.externalRamEnabled = false;

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
        this.memory[0xFFFF] = 0x00; // IE
    }

    read8bits(
        address
    ) {
        address &= 0xFFFF;

        // Joypad register
        if (address === 0xFF00) { // Joypad register
            return this.joypad.read();
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

        if (address >= 0xA000 && address < 0xC000) { // External RAM
            if (!this.externalRamEnabled) {
                return 0xFF;
            }
            const ramBank = this.getCurrentRamBankNumber();
            const offset = ramBank * 0x2000 + (address - 0xA000);
            return this.ramBanks[offset];
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

        // MBC1 control
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

        if (address >= 0xA000 && address < 0xC000) { // External RAM
            if (!this.externalRamEnabled) {
                return;
            }
            const ramBank = this.getCurrentRamBankNumber();
            const offset = ramBank * 0x2000 + (address - 0xA000);
            this.ramBanks[offset] = value;
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
        const upper = (this.mbc1Mode === 0 ? this.ramBankNumber : (this.ramBankNumber & 0x03)) << 5;
        const bank = (upper | this.romBankNumber) & 0x7F;
        return bank === 0 ? 1 : bank;
    }

    getCurrentRamBankNumber() {
        return this.mbc1Mode === 0 ? 0 : (this.ramBankNumber & 0x03);
    }

    requestInterrupt(bit) {
        this.memory[0xFF0F] |= (1 << bit);
    }

}

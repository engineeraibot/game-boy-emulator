class Cpu {

    constructor(memoryManagementUnit) {
        this.memoryManagementUnit = memoryManagementUnit;
        this.reset();
    }

    reset() {
        // 8-bit registers
        this.A = 0x01;
        this.F = 0xB0;
        this.B = 0x00;
        this.C = 0x13;
        this.D = 0x00;
        this.E = 0xD8;
        this.H = 0x01;
        this.L = 0x4D;

        // 16-bit registers
        this.SP = 0xFFFE;
        this.PC = 0x0100;

        // CPU state
        this.halted = false;
        this.interruptMasterEnable = false; // ime
    }

    getState() {
        return {
            A: this.A,
            F: this.F,
            B: this.B,
            C: this.C,
            D: this.D,
            E: this.E,
            H: this.H,
            L: this.L,
            SP: this.SP,
            PC: this.PC,
            halted: this.halted,
            interruptMasterEnable: this.interruptMasterEnable
        };
    }

    setState(state) {
        if (!state) return;
        this.A = state.A ?? this.A;
        this.F = state.F ?? this.F;
        this.B = state.B ?? this.B;
        this.C = state.C ?? this.C;
        this.D = state.D ?? this.D;
        this.E = state.E ?? this.E;
        this.H = state.H ?? this.H;
        this.L = state.L ?? this.L;
        this.SP = state.SP ?? this.SP;
        this.PC = state.PC ?? this.PC;
        this.halted = !!state.halted;
        this.interruptMasterEnable = !!state.interruptMasterEnable;
    }

    get AF() {
        return (this.A << 8) | this.F;
    }

    set AF(
        value
    ) {
        this.A = (value >> 8) & 0xFF;
        this.F = value & 0xF0;
    }

    get BC() {
        return (this.B << 8) | this.C;
    }

    set BC(
        value
    ) {
        this.B = (value >> 8) & 0xFF;
        this.C = value & 0xFF;
    }

    get DE() {
        return (this.D << 8) | this.E;
    }
    
    set DE(
        value
    ) {
        this.D = (value >> 8) & 0xFF;
        this.E = value & 0xFF;
    }

    get HL() {
        return (this.H << 8) | this.L;
    }
    
    set HL(
        value
    ) {
        this.H = (value >> 8) & 0xFF;
        this.L = value & 0xFF;
    }

    /* =======================
       Flags
    ======================= */

    get Z() {
        return (this.F & 0x80) !== 0;
    }

    set Z(
        value
    ) {
        this.F = value ? this.F | 0x80 : this.F & ~0x80;
    }

    get N() {
        return (this.F & 0x40) !== 0;
    }

    set N(
        value
    ) {
        this.F = value ? this.F | 0x40 : this.F & ~0x40;
    }

    get Hf() {
        return (this.F & 0x20) !== 0;
    }

    set Hf(value) {
        this.F = value ? this.F | 0x20 : this.F & ~0x20;
    }
    


    get Cc() {
        return (this.F & 0x10) !== 0;
    }

    set Cc(value) {
        this.F = value ? this.F | 0x10 : this.F & ~0x10;
    }

    clearFlags() {
        this.F = 0;
    }

    add(a, b) {
        const result = a + b;
        this.Z = (result & 0xFF) === 0;
        this.N = false;
        this.Hf = (a & 0xF) + (b & 0xF) > 0xF;
        this.Cc = result > 0xFF;
        return result & 0xFF;
    }

    adc(a, b) {
        const carry = this.Cc ? 1 : 0;
        const result = a + b + carry;
        this.Z = (result & 0xFF) === 0;
        this.N = false;
        this.Hf = (a & 0xF) + (b & 0xF) + carry > 0xF;
        this.Cc = result > 0xFF;
        return result & 0xFF;
    }

    sub(a, b) {
        const result = a - b;
        this.Z = (result & 0xFF) === 0;
        this.N = true;
        this.Hf = (a & 0xF) < (b & 0xF);
        this.Cc = a < b;
        return result & 0xFF;
    }

    sbc(a, b) {
        const carry = this.Cc ? 1 : 0;
        const result = a - b - carry;
        this.Z = (result & 0xFF) === 0;
        this.N = true;
        this.Hf = (a & 0xF) < (b & 0xF) + carry;
        this.Cc = a < b + carry;
        return result & 0xFF;
    }

    and(a, b) {
        const result = a & b;
        this.Z = result === 0;
        this.N = false;
        this.Hf = true;
        this.Cc = false;
        return result;
    }

    or(a, b) {
        const result = a | b;
        this.Z = result === 0;
        this.N = false;
        this.Hf = false;
        this.Cc = false;
        return result;
    }

    xor(a, b) {
        const result = a ^ b;
        this.Z = result === 0;
        this.N = false;
        this.Hf = false;
        this.Cc = false;
        return result;
    }

    cp(a, b) {
        const result = a - b;
        this.Z = (result & 0xFF) === 0;
        this.N = true;
        this.Hf = (a & 0xF) < (b & 0xF);
        this.Cc = a < b;
    }

    bit(operation) {
        const bit = (operation >> 3) & 0b111;
        const register = operation & 0b111;
        let value;

        switch (register) {
            case 0: value = this.B; break;
            case 1: value = this.C; break;
            case 2: value = this.D; break;
            case 3: value = this.E; break;
            case 4: value = this.H; break;
            case 5: value = this.L; break;
            case 6: value = this.memoryManagementUnit.read8bits(this.HL); break;
            case 7: value = this.A; break;
        }

        this.Z = (value & (1 << bit)) === 0;
        this.N = false;
        this.Hf = true;
    }

    res(operation) {
        const bit = (operation >> 3) & 0b111;
        const register = operation & 0b111;
        const mask = 1 << bit;

        switch (register) {
            case 0: this.B &= ~mask; break;
            case 1: this.C &= ~mask; break;
            case 2: this.D &= ~mask; break;
            case 3: this.E &= ~mask; break;
            case 4: this.H &= ~mask; break;
            case 5: this.L &= ~mask; break;
            case 6: this.memoryManagementUnit.write8bits(this.HL, this.memoryManagementUnit.read8bits(this.HL) & ~mask); break;
            case 7: this.A &= ~mask; break;
        }
    }

    set(operation) {
        const bit = (operation >> 3) & 0b111;
        const register = operation & 0b111;
        const mask = 1 << bit;

        switch (register) {
            case 0: this.B |= mask; break;
            case 1: this.C |= mask; break;
            case 2: this.D |= mask; break;
            case 3: this.E |= mask; break;
            case 4: this.H |= mask; break;
            case 5: this.L |= mask; break;
            case 6: this.memoryManagementUnit.write8bits(this.HL, this.memoryManagementUnit.read8bits(this.HL) | mask); break;
            case 7: this.A |= mask; break;
        }
    }

    add16(a, b) {
        const result = a + b;
        this.N = false;
        this.Hf = (a & 0xFFF) + (b & 0xFFF) > 0xFFF;
        this.Cc = result > 0xFFFF;
        return result & 0xFFFF;
    }

    inc(value) {
        const result = (value + 1) & 0xFF;
        this.Z = result === 0;
        this.N = false;
        this.Hf = (value & 0xF) + 1 > 0xF;
        return result;
    }

    dec(value) {
        const result = (value - 1) & 0xFF;
        this.Z = result === 0;
        this.N = true;
        this.Hf = (value & 0xF) === 0;
        return result;
    }

    push16bits(value) {
        this.SP = (this.SP - 1) & 0xFFFF;
        this.memoryManagementUnit.write8bits(this.SP, (value >> 8) & 0xFF);
        this.SP = (this.SP - 1) & 0xFFFF;
        this.memoryManagementUnit.write8bits(this.SP, value & 0xFF);
    }

    pop16bits() {
        const lo = this.memoryManagementUnit.read8bits(this.SP);
        this.SP = (this.SP + 1) & 0xFFFF;
        const hi = this.memoryManagementUnit.read8bits(this.SP);
        this.SP = (this.SP + 1) & 0xFFFF;
        return (hi << 8) | lo;
    }

    fetchImmediate8() {
        const value = this.memoryManagementUnit.read8bits(this.PC);
        this.increaseProgramCounter();
        return value;
    }

    fetchImmediate16() {
        const lo = this.fetchImmediate8();
        const hi = this.fetchImmediate8();
        return lo | (hi << 8);
    }

    increaseProgramCounter() {
        this.PC = (this.PC + 1) & 0xFFFF;
    }

    executeStep() {
        // Handle interrupts before executing the next opcode
        const interruptCycles = this.handleInterrupts();
        if (interruptCycles >= 0) {
            return interruptCycles;
        }

        // If halted and no interrupt serviced, burn a small number of cycles
        if (this.halted) {
            return 4;
        }

        const operation = this.memoryManagementUnit.read8bits(this.PC);
        this.increaseProgramCounter();
        return this.executeOperation(operation);
    }

    handleInterrupts() {
        const ie = this.memoryManagementUnit.read8bits(0xFFFF);
        const _if = this.memoryManagementUnit.read8bits(0xFF0F);
        const pending = ie & _if;

        if (pending === 0) {
            return -1;
        }

        // Exit HALT if any interrupt is pending
        if (this.halted) {
            this.halted = false;
        }

        if (!this.interruptMasterEnable) {
            return -1;
        }

        // Service the highest-priority pending interrupt
        this.interruptMasterEnable = false;
        const vectors = [0x40, 0x48, 0x50, 0x58, 0x60]; // VBlank, LCD STAT, Timer, Serial, Joypad
        for (let i = 0; i < 5; i++) {
            if (pending & (1 << i)) {
                // Clear request flag
                const newIf = _if & ~(1 << i);
                this.memoryManagementUnit.write8bits(0xFF0F, newIf);

                // Push PC and jump to vector
                this.push16bits(this.PC);
                this.PC = vectors[i];
                return 20; // Interrupt service time
            }
        }

        return -1;
    }
    
    executeOperation(
        operation
    ) {
        switch(operation) {
            case 0x00: // NOP
                return 4;
            case 0x40: // LD B,B
                this.B = this.B;
                return 4;
            case 0x41: // LD B,C
                this.B = this.C;
                return 4;
            case 0x42: // LD B,D
                this.B = this.D;
                return 4;
            case 0x43: // LD B,E
                this.B = this.E;
                return 4;
            case 0x44: // LD B,H
                this.B = this.H;
                return 4;
            case 0x45: // LD B,L
                this.B = this.L;
                return 4;
            case 0x46: // LD B,(HL)
                this.B = this.memoryManagementUnit.read8bits(this.HL);
                return 8;
            case 0x47: // LD B,A
                this.B = this.A;
                return 4;
            case 0x48: // LD C,B
                this.C = this.B;
                return 4;
            case 0x49: // LD C,C
                this.C = this.C;
                return 4;
            case 0x4A: // LD C,D
                this.C = this.D;
                return 4;
            case 0x4B: // LD C,E
                this.C = this.E;
                return 4;
            case 0x4C: // LD C,H
                this.C = this.H;
                return 4;
            case 0x4D: // LD C,L
                this.C = this.L;
                return 4;
            case 0x4E: // LD C,(HL)
                this.C = this.memoryManagementUnit.read8bits(this.HL);
                return 8;
            case 0x4F: // LD C,A
                this.C = this.A;
                return 4;
            case 0x50: // LD D,B
                this.D = this.B;
                return 4;
            case 0x51: // LD D,C
                this.D = this.C;
                return 4;
            case 0x52: // LD D,D
                this.D = this.D;
                return 4;
            case 0x53: // LD D,E
                this.D = this.E;
                return 4;
            case 0x54: // LD D,H
                this.D = this.H;
                return 4;
            case 0x55: // LD D,L
                this.D = this.L;
                return 4;
            case 0x56: // LD D,(HL)
                this.D = this.memoryManagementUnit.read8bits(this.HL);
                return 8;
            case 0x57: // LD D,A
                this.D = this.A;
                return 4;
            case 0x58: // LD E,B
                this.E = this.B;
                return 4;
            case 0x59: // LD E,C
                this.E = this.C;
                return 4;
            case 0x5A: // LD E,D
                this.E = this.D;
                return 4;
            case 0x5B: // LD E,E
                this.E = this.E;
                return 4;
            case 0x5C: // LD E,H
                this.E = this.H;
                return 4;
            case 0x5D: // LD E,L
                this.E = this.L;
                return 4;
            case 0x5E: // LD E,(HL)
                this.E = this.memoryManagementUnit.read8bits(this.HL);
                return 8;
            case 0x5F: // LD E,A
                this.E = this.A;
                return 4;
            case 0x60: // LD H,B
                this.H = this.B;
                return 4;
            case 0x61: // LD H,C
                this.H = this.C;
                return 4;
            case 0x62: // LD H,D
                this.H = this.D;
                return 4;
            case 0x63: // LD H,E
                this.H = this.E;
                return 4;
            case 0x64: // LD H,H
                this.H = this.H;
                return 4;
            case 0x65: // LD H,L
                this.H = this.L;
                return 4;
            case 0x66: // LD H,(HL)
                this.H = this.memoryManagementUnit.read8bits(this.HL);
                return 8;
            case 0x67: // LD H,A
                this.H = this.A;
                return 4;
            case 0x68: // LD L,B
                this.L = this.B;
                return 4;
            case 0x69: // LD L,C
                this.L = this.C;
                return 4;
            case 0x6A: // LD L,D
                this.L = this.D;
                return 4;
            case 0x6B: // LD L,E
                this.L = this.E;
                return 4;
            case 0x6C: // LD L,H
                this.L = this.H;
                return 4;
            case 0x6D: // LD L,L
                this.L = this.L;
                return 4;
            case 0x6E: // LD L,(HL)
                this.L = this.memoryManagementUnit.read8bits(this.HL);
                return 8;
            case 0x6F: // LD L,A
                this.L = this.A;
                return 4;
            case 0x70: // LD (HL),B
                this.memoryManagementUnit.write8bits(this.HL, this.B);
                return 8;
            case 0x71: // LD (HL),C
                this.memoryManagementUnit.write8bits(this.HL, this.C);
                return 8;
            case 0x72: // LD (HL),D
                this.memoryManagementUnit.write8bits(this.HL, this.D);
                return 8;
            case 0x73: // LD (HL),E
                this.memoryManagementUnit.write8bits(this.HL, this.E);
                return 8;
            case 0x74: // LD (HL),H
                this.memoryManagementUnit.write8bits(this.HL, this.H);
                return 8;
            case 0x75: // LD (HL),L
                this.memoryManagementUnit.write8bits(this.HL, this.L);
                return 8;
            case 0x77: // LD (HL),A
                this.memoryManagementUnit.write8bits(this.HL, this.A);
                return 8;
            case 0x78: // LD A,B
                this.A = this.B;
                return 4;
            case 0x79: // LD A,C
                this.A = this.C;
                return 4;
            case 0x7A: // LD A,D
                this.A = this.D;
                return 4;
            case 0x7B: // LD A,E
                this.A = this.E;
                return 4;
            case 0x7C: // LD A,H
                this.A = this.H;
                return 4;
            case 0x7D: // LD A,L
                this.A = this.L;
                return 4;
            case 0x7E: // LD A,(HL)
                this.A = this.memoryManagementUnit.read8bits(this.HL);
                return 8;
            case 0x7F: // LD A,A
                this.A = this.A;
                return 4;
            case 0x06: // LD B,d8
                this.B = this.fetchImmediate8();
                return 8;
            case 0x0E: // LD C,d8
                this.C = this.fetchImmediate8();
                return 8;
            case 0x16: // LD D,d8
                this.D = this.fetchImmediate8();
                return 8;
            case 0x1E: // LD E,d8
                this.E = this.fetchImmediate8();
                return 8;
            case 0x26: // LD H,d8
                this.H = this.fetchImmediate8();
                return 8;
            case 0x2E: // LD L,d8
                this.L = this.fetchImmediate8();
                return 8;
            case 0x36: // LD (HL),d8
                this.memoryManagementUnit.write8bits(this.HL, this.fetchImmediate8());
                return 12;
            case 0x0A: // LD A,(BC)
                this.A = this.memoryManagementUnit.read8bits(this.BC);
                return 8;
            case 0x1A: // LD A,(DE)
                this.A = this.memoryManagementUnit.read8bits(this.DE);
                return 8;
            case 0xFA: // LD A,(a16)
                const address = this.fetchImmediate16();
                this.A = this.memoryManagementUnit.read8bits(address);
                return 16;
            case 0x08: // LD (a16),SP
                {
                    const addr = this.fetchImmediate16();
                    this.memoryManagementUnit.write8bits(addr, this.SP & 0xFF);
                    this.memoryManagementUnit.write8bits((addr + 1) & 0xFFFF, this.SP >> 8);
                    return 20;
                }
            case 0x02: // LD (BC),A
                this.memoryManagementUnit.write8bits(this.BC, this.A);
                return 8;
            case 0x12: // LD (DE),A
                this.memoryManagementUnit.write8bits(this.DE, this.A);
                return 8;
            case 0xEA: // LD (a16),A
                const destAddress = this.fetchImmediate16();
                this.memoryManagementUnit.write8bits(destAddress, this.A);
                return 16;
            case 0x01: // LD BC,d16
                this.BC = this.fetchImmediate16();
                return 12;
            case 0x10: // STOP
                this.halted = true;
                this.increaseProgramCounter(); // STOP is a 2-byte instruction, 0x10 0x00
                return 4;
            case 0x11: // LD DE,d16
                this.DE = this.fetchImmediate16();
                return 12;
            case 0x21: // LD HL,d16
                this.HL = this.fetchImmediate16();
                return 12;
            case 0x22: // LD (HL+),A
                this.memoryManagementUnit.write8bits(this.HL, this.A);
                this.HL = (this.HL + 1) & 0xFFFF;
                return 8;
            case 0x2A: // LD A,(HL+)
                this.A = this.memoryManagementUnit.read8bits(this.HL);
                this.HL = (this.HL + 1) & 0xFFFF;
                return 8;
            case 0x31: // LD SP,d16
                this.SP = this.fetchImmediate16();
                return 12;
            case 0xF9: // LD SP,HL
                this.SP = this.HL;
                return 8;
            case 0xC5: // PUSH BC
                this.push16bits(this.BC);
                return 16;
            case 0xD5: // PUSH DE
                this.push16bits(this.DE);
                return 16;
            case 0xE5: // PUSH HL
                this.push16bits(this.HL);
                return 16;
            case 0xF5: // PUSH AF
                this.push16bits(this.AF);
                return 16;
            case 0xC1: // POP BC
                this.BC = this.pop16bits();
                return 12;
            case 0xD1: // POP DE
                this.DE = this.pop16bits();
                return 12;
            case 0xE1: // POP HL
                this.HL = this.pop16bits();
                return 12;
            case 0xF1: // POP AF
                this.AF = this.pop16bits();
                return 12;
            case 0x80: // ADD A,B
                this.A = this.add(this.A, this.B);
                return 4;
            case 0x81: // ADD A,C
                this.A = this.add(this.A, this.C);
                return 4;
            case 0x82: // ADD A,D
                this.A = this.add(this.A, this.D);
                return 4;
            case 0x83: // ADD A,E
                this.A = this.add(this.A, this.E);
                return 4;
            case 0x84: // ADD A,H
                this.A = this.add(this.A, this.H);
                return 4;
            case 0x85: // ADD A,L
                this.A = this.add(this.A, this.L);
                return 4;
            case 0x86: // ADD A,(HL)
                this.A = this.add(this.A, this.memoryManagementUnit.read8bits(this.HL));
                return 8;
            case 0x87: // ADD A,A
                this.A = this.add(this.A, this.A);
                return 4;
            case 0x88: // ADC A,B
                this.A = this.adc(this.A, this.B);
                return 4;
            case 0x89: // ADC A,C
                this.A = this.adc(this.A, this.C);
                return 4;
            case 0x8A: // ADC A,D
                this.A = this.adc(this.A, this.D);
                return 4;
            case 0x8B: // ADC A,E
                this.A = this.adc(this.A, this.E);
                return 4;
            case 0x8C: // ADC A,H
                this.A = this.adc(this.A, this.H);
                return 4;
            case 0x8D: // ADC A,L
                this.A = this.adc(this.A, this.L);
                return 4;
            case 0x8E: // ADC A,(HL)
                this.A = this.adc(this.A, this.memoryManagementUnit.read8bits(this.HL));
                return 8;
            case 0x8F: // ADC A,A
                this.A = this.adc(this.A, this.A);
                return 4;
            case 0x90: // SUB A,B
                this.A = this.sub(this.A, this.B);
                return 4;
            case 0x91: // SUB A,C
                this.A = this.sub(this.A, this.C);
                return 4;
            case 0x92: // SUB A,D
                this.A = this.sub(this.A, this.D);
                return 4;
            case 0x93: // SUB A,E
                this.A = this.sub(this.A, this.E);
                return 4;
            case 0x94: // SUB A,H
                this.A = this.sub(this.A, this.H);
                return 4;
            case 0x95: // SUB A,L
                this.A = this.sub(this.A, this.L);
                return 4;
            case 0x96: // SUB A,(HL)
                this.A = this.sub(this.A, this.memoryManagementUnit.read8bits(this.HL));
                return 8;
            case 0x97: // SUB A,A
                this.A = this.sub(this.A, this.A);
                return 4;
            case 0x98: // SBC A,B
                this.A = this.sbc(this.A, this.B);
                return 4;
            case 0x99: // SBC A,C
                this.A = this.sbc(this.A, this.C);
                return 4;
            case 0x9A: // SBC A,D
                this.A = this.sbc(this.A, this.D);
                return 4;
            case 0x9B: // SBC A,E
                this.A = this.sbc(this.A, this.E);
                return 4;
            case 0x9C: // SBC A,H
                this.A = this.sbc(this.A, this.H);
                return 4;
            case 0x9D: // SBC A,L
                this.A = this.sbc(this.A, this.L);
                return 4;
            case 0x9E: // SBC A,(HL)
                this.A = this.sbc(this.A, this.memoryManagementUnit.read8bits(this.HL));
                return 8;
            case 0x9F: // SBC A,A
                this.A = this.sbc(this.A, this.A);
                return 4;
            case 0xA0: // AND A,B
                this.A = this.and(this.A, this.B);
                return 4;
            case 0xA1: // AND A,C
                this.A = this.and(this.A, this.C);
                return 4;
            case 0xA2: // AND A,D
                this.A = this.and(this.A, this.D);
                return 4;
            case 0xA3: // AND A,E
                this.A = this.and(this.A, this.E);
                return 4;
            case 0xA4: // AND A,H
                this.A = this.and(this.A, this.H);
                return 4;
            case 0xA5: // AND A,L
                this.A = this.and(this.A, this.L);
                return 4;
            case 0xA6: // AND A,(HL)
                this.A = this.and(this.A, this.memoryManagementUnit.read8bits(this.HL));
                return 8;
            case 0xA7: // AND A,A
                this.A = this.and(this.A, this.A);
                return 4;
            case 0xA8: // XOR A,B
                this.A = this.xor(this.A, this.B);
                return 4;
            case 0xA9: // XOR A,C
                this.A = this.xor(this.A, this.C);
                return 4;
            case 0xAA: // XOR A,D
                this.A = this.xor(this.A, this.D);
                return 4;
            case 0xAB: // XOR A,E
                this.A = this.xor(this.A, this.E);
                return 4;
            case 0xAC: // XOR A,H
                this.A = this.xor(this.A, this.H);
                return 4;
            case 0xAD: // XOR A,L
                this.A = this.xor(this.A, this.L);
                return 4;
            case 0xAE: // XOR A,(HL)
                this.A = this.xor(this.A, this.memoryManagementUnit.read8bits(this.HL));
                return 8;
            case 0xAF: // XOR A,A
                this.A = this.xor(this.A, this.A);
                return 4;
            case 0xB0: // OR A,B
                this.A = this.or(this.A, this.B);
                return 4;
            case 0xB1: // OR A,C
                this.A = this.or(this.A, this.C);
                return 4;
            case 0xB2: // OR A,D
                this.A = this.or(this.A, this.D);
                return 4;
            case 0xB3: // OR A,E
                this.A = this.or(this.A, this.E);
                return 4;
            case 0xB4: // OR A,H
                this.A = this.or(this.A, this.H);
                return 4;
            case 0xB5: // OR A,L
                this.A = this.or(this.A, this.L);
                return 4;
            case 0xB6: // OR A,(HL)
                this.A = this.or(this.A, this.memoryManagementUnit.read8bits(this.HL));
                return 8;
            case 0xB7: // OR A,A
                this.A = this.or(this.A, this.A);
                return 4;
            case 0xB8: // CP A,B
                this.cp(this.A, this.B);
                return 4;
            case 0xB9: // CP A,C
                this.cp(this.A, this.C);
                return 4;
            case 0xBA: // CP A,D
                this.cp(this.A, this.D);
                return 4;
            case 0xBB: // CP A,E
                this.cp(this.A, this.E);
                return 4;
            case 0xBC: // CP A,H
                this.cp(this.A, this.H);
                return 4;
            case 0xBD: // CP A,L
                this.cp(this.A, this.L);
                return 4;
            case 0xBE: // CP A,(HL)
                this.cp(this.A, this.memoryManagementUnit.read8bits(this.HL));
                return 8;
            case 0xBF: // CP A,A
                this.cp(this.A, this.A);
                return 4;
            case 0xC6: // ADD A,d8
                this.A = this.add(this.A, this.fetchImmediate8());
                return 8;
            case 0xCE: // ADC A,d8
                this.A = this.adc(this.A, this.fetchImmediate8());
                return 8;
            case 0xD6: // SUB d8
                this.A = this.sub(this.A, this.fetchImmediate8());
                return 8;
            case 0xDE: // SBC d8
                this.A = this.sbc(this.A, this.fetchImmediate8());
                return 8;
            case 0xE6: // AND d8
                this.A = this.and(this.A, this.fetchImmediate8());
                return 8;
            case 0xEE: // XOR d8
                this.A = this.xor(this.A, this.fetchImmediate8());
                return 8;
            case 0xF6: // OR d8
                this.A = this.or(this.A, this.fetchImmediate8());
                return 8;
            case 0xFE: // CP d8
                this.cp(this.A, this.fetchImmediate8());
                return 8;
            case 0x04: // INC B
                this.B = this.inc(this.B);
                return 4;
            case 0x0C: // INC C
                this.C = this.inc(this.C);
                return 4;
            case 0x14: // INC D
                this.D = this.inc(this.D);
                return 4;
            case 0x1C: // INC E
                this.E = this.inc(this.E);
                return 4;
            case 0x24: // INC H
                this.H = this.inc(this.H);
                return 4;
            case 0x2C: // INC L
                this.L = this.inc(this.L);
                return 4;
            case 0x34: // INC (HL)
                const value = this.memoryManagementUnit.read8bits(this.HL);
                this.memoryManagementUnit.write8bits(this.HL, this.inc(value));
                return 12;
            case 0x3C: // INC A
                this.A = this.inc(this.A);
                return 4;
            case 0x05: // DEC B
                this.B = this.dec(this.B);
                return 4;
            case 0x0D: // DEC C
                this.C = this.dec(this.C);
                return 4;
            case 0x15: // DEC D
                this.D = this.dec(this.D);
                return 4;
            case 0x1D: // DEC E
                this.E = this.dec(this.E);
                return 4;
            case 0x25: // DEC H
                this.H = this.dec(this.H);
                return 4;
            case 0x2D: // DEC L
                this.L = this.dec(this.L);
                return 4;
            case 0x35: // DEC (HL)
                const value2 = this.memoryManagementUnit.read8bits(this.HL);
                this.memoryManagementUnit.write8bits(this.HL, this.dec(value2));
                return 12;
            case 0x3D: // DEC A
                this.A = this.dec(this.A);
                return 4;
            case 0x3E: // LD A,d8
                this.A = this.fetchImmediate8();
                return 8;
            case 0x32: // LD (HL-),A
                this.memoryManagementUnit.write8bits(this.HL, this.A);
                this.HL = (this.HL - 1) & 0xFFFF;
                return 8;
            case 0x3A: // LD A,(HL-)
                this.A = this.memoryManagementUnit.read8bits(this.HL);
                this.HL = (this.HL - 1) & 0xFFFF;
                return 8;
            case 0x09: // ADD HL,BC
                this.HL = this.add16(this.HL, this.BC);
                return 8;
            case 0x19: // ADD HL,DE
                this.HL = this.add16(this.HL, this.DE);
                return 8;
            case 0x29: // ADD HL,HL
                this.HL = this.add16(this.HL, this.HL);
                return 8;
            case 0x39: // ADD HL,SP
                this.HL = this.add16(this.HL, this.SP);
                return 8;
            case 0xE8: // ADD SP,r8
                {
                    const offsetE8 = (this.fetchImmediate8() << 24) >> 24; // sign-extend
                    const resultE8 = (this.SP + offsetE8) & 0xFFFF;
                    this.Z = false;
                    this.N = false;
                    this.Hf = ((this.SP & 0x0F) + (offsetE8 & 0x0F)) > 0x0F;
                    this.Cc = ((this.SP & 0xFF) + (offsetE8 & 0xFF)) > 0xFF;
                    this.SP = resultE8;
                    return 16;
                }
            case 0x03: // INC BC
                this.BC = (this.BC + 1) & 0xFFFF;
                return 8;
            case 0x13: // INC DE
                this.DE = (this.DE + 1) & 0xFFFF;
                return 8;
            case 0x23: // INC HL
                this.HL = (this.HL + 1) & 0xFFFF;
                return 8;
            case 0x33: // INC SP
                this.SP = (this.SP + 1) & 0xFFFF;
                return 8;
            case 0x0B: // DEC BC
                this.BC = (this.BC - 1) & 0xFFFF;
                return 8;
            case 0x1B: // DEC DE
                this.DE = (this.DE - 1) & 0xFFFF;
                return 8;
            case 0x2B: // DEC HL
                this.HL = (this.HL - 1) & 0xFFFF;
                return 8;
            case 0x3B: // DEC SP
                this.SP = (this.SP - 1) & 0xFFFF;
                return 8;
            case 0x07: // RLCA
                this.Cc = (this.A & 0x80) !== 0;
                this.A = ((this.A << 1) | (this.A >> 7)) & 0xFF;
                this.Z = false;
                this.N = false;
                this.Hf = false;
                return 4;
            case 0x17: // RLA
                const carry = this.Cc ? 1 : 0;
                this.Cc = (this.A & 0x80) !== 0;
                this.A = ((this.A << 1) | carry) & 0xFF;
                this.Z = false;
                this.N = false;
                this.Hf = false;
                return 4;
            case 0x0F: // RRCA
                this.Cc = (this.A & 0x01) !== 0;
                this.A = ((this.A >> 1) | (this.A << 7)) & 0xFF;
                this.Z = false;
                this.N = false;
                this.Hf = false;
                return 4;
            case 0x1F: // RRA
                const carry2 = this.Cc ? 0x80 : 0;
                this.Cc = (this.A & 0x01) !== 0;
                this.A = ((this.A >> 1) | carry2) & 0xFF;
                this.Z = false;
                this.N = false;
                this.Hf = false;
                return 4;
            case 0xCB:
                const cbOperation = this.fetchImmediate8();
                return this.executeCbOperation(cbOperation);
            case 0xC3: // JP a16
                this.PC = this.fetchImmediate16();
                return 16;
            case 0xE9: // JP (HL)
                this.PC = this.HL;
                return 4;
            case 0x18: // JR r8
                const relative = this.fetchImmediate8();
                this.PC = (this.PC + (relative << 24 >> 24)) & 0xFFFF;
                return 12;
            case 0xC2: // JP NZ,a16
                const nzAddress = this.fetchImmediate16();
                if (!this.Z) {
                    this.PC = nzAddress;
                    return 16;
                }
                return 12;
            case 0xCA: // JP Z,a16
                const zAddress = this.fetchImmediate16();
                if (this.Z) {
                    this.PC = zAddress;
                    return 16;
                }
                return 12;
            case 0xD2: // JP NC,a16
                const ncAddress = this.fetchImmediate16();
                if (!this.Cc) {
                    this.PC = ncAddress;
                    return 16;
                }
                return 12;
            case 0xDA: // JP C,a16
                const cAddress = this.fetchImmediate16();
                if (this.Cc) {
                    this.PC = cAddress;
                    return 16;
                }
                return 12;
            case 0x20: // JR NZ,r8
                const relativeNZ = this.fetchImmediate8();
                if (!this.Z) {
                    this.PC = (this.PC + (relativeNZ << 24 >> 24)) & 0xFFFF;
                    return 12;
                }
                return 8;
            case 0x28: // JR Z,r8
                const relativeZ = this.fetchImmediate8();
                if (this.Z) {
                    this.PC = (this.PC + (relativeZ << 24 >> 24)) & 0xFFFF;
                    return 12;
                }
                return 8;
            case 0x30: // JR NC,r8
                const relativeNC = this.fetchImmediate8();
                if (!this.Cc) {
                    this.PC = (this.PC + (relativeNC << 24 >> 24)) & 0xFFFF;
                    return 12;
                }
                return 8;
            case 0x38: // JR C,r8
                const relativeC = this.fetchImmediate8();
                if (this.Cc) {
                    this.PC = (this.PC + (relativeC << 24 >> 24)) & 0xFFFF;
                    return 12;
                }
                return 8;
            case 0xCD: // CALL a16
                const callAddress = this.fetchImmediate16();
                this.push16bits(this.PC);
                this.PC = callAddress;
                return 24;
            case 0xC4: // CALL NZ,a16
                const callNzAddress = this.fetchImmediate16();
                if (!this.Z) {
                    this.push16bits(this.PC);
                    this.PC = callNzAddress;
                    return 24;
                }
                return 12;
            case 0xCC: // CALL Z,a16
                const callZAddress = this.fetchImmediate16();
                if (this.Z) {
                    this.push16bits(this.PC);
                    this.PC = callZAddress;
                    return 24;
                }
                return 12;
            case 0xD4: // CALL NC,a16
                const callNcAddress = this.fetchImmediate16();
                if (!this.Cc) {
                    this.push16bits(this.PC);
                    this.PC = callNcAddress;
                    return 24;
                }
                return 12;
            case 0xDC: // CALL C,a16
                const callCAddress = this.fetchImmediate16();
                if (this.Cc) {
                    this.push16bits(this.PC);
                    this.PC = callCAddress;
                    return 24;
                }
                return 12;
            case 0xC9: // RET
                this.PC = this.pop16bits();
                return 16;
            case 0xC0: // RET NZ
                if (!this.Z) {
                    this.PC = this.pop16bits();
                    return 20;
                }
                return 8;
            case 0xC8: // RET Z
                if (this.Z) {
                    this.PC = this.pop16bits();
                    return 20;
                }
                return 8;
            case 0xD0: // RET NC
                if (!this.Cc) {
                    this.PC = this.pop16bits();
                    return 20;
                }
                return 8;
            case 0xD8: // RET C
                if (this.Cc) {
                    this.PC = this.pop16bits();
                    return 20;
                }
                return 8;
            case 0xD9: // RETI
                this.PC = this.pop16bits();
                this.interruptMasterEnable = true;
                return 16;
            case 0xC7: // RST 00H
                this.push16bits(this.PC);
                this.PC = 0x00;
                return 16;
            case 0xCF: // RST 08H
                this.push16bits(this.PC);
                this.PC = 0x08;
                return 16;
            case 0xD7: // RST 10H
                this.push16bits(this.PC);
                this.PC = 0x10;
                return 16;
            case 0xDF: // RST 18H
                this.push16bits(this.PC);
                this.PC = 0x18;
                return 16;
            case 0xE7: // RST 20H
                this.push16bits(this.PC);
                this.PC = 0x20;
                return 16;
            case 0xEF: // RST 28H
                this.push16bits(this.PC);
                this.PC = 0x28;
                return 16;
            case 0xF7: // RST 30H
                this.push16bits(this.PC);
                this.PC = 0x30;
                return 16;
            case 0xFF: // RST 38H
                this.push16bits(this.PC);
                this.PC = 0x38;
                return 16;
            case 0x27: // DAA
                let a = this.A;
                if (this.N) {
                    if (this.Hf) {
                        a = (a - 6) & 0xFF;
                    }
                    if (this.Cc) {
                        a -= 0x60;
                    }
                } else {
                    if (this.Hf || (a & 0xF) > 9) {
                        a += 6;
                    }
                    if (this.Cc || a > 0x9F) {
                        a += 0x60;
                    }
                }
                this.Hf = false;
                if (a > 0xFF) {
                    this.Cc = true;
                }
                a &= 0xFF;
                this.Z = a === 0;
                this.A = a;
                return 4;
            case 0x2F: // CPL
                this.A = ~this.A & 0xFF;
                this.N = true;
                this.Hf = true;
                return 4;
            case 0x37: // SCF
                this.N = false;
                this.Hf = false;
                this.Cc = true;
                return 4;
            case 0x3F: // CCF
                this.N = false;
                this.Hf = false;
                this.Cc = !this.Cc;
                return 4;
            case 0x76: // HALT
                this.halted = true;
                return 4;
            case 0xF3: // DI
                this.interruptMasterEnable = false;
                return 4;
            case 0xFB: // EI
                this.interruptMasterEnable = true;
                return 4;
            case 0xE0: // LDH (a8),A
                const offset = this.fetchImmediate8();
                this.memoryManagementUnit.write8bits(0xFF00 + offset, this.A);
                return 12;
            case 0xE2: // LD (C),A
                this.memoryManagementUnit.write8bits(0xFF00 + this.C, this.A);
                return 8;
            case 0xEE: // XOR A,n8
                this.A = this.xor(this.A, this.fetchImmediate8());
                return 8;
            case 0xF0: // LDH A,(a8)
                const offsetF0 = this.fetchImmediate8();
                this.A = this.memoryManagementUnit.read8bits(0xFF00 + offsetF0);
                return 12;
            case 0xF2: // LD A,(C)
                this.A = this.memoryManagementUnit.read8bits(0xFF00 + this.C);
                return 8;
            case 0xFE: // CP n8
                const valueFE = this.fetchImmediate8();
                this.cp(this.A, valueFE);
                return 8;
            case 0xF8: // LD HL,SP+r8
                {
                    const offsetF8 = (this.fetchImmediate8() << 24) >> 24; // sign-extend
                    const sumF8 = this.SP + offsetF8;
                    this.Z = false;
                    this.N = false;
                    this.Hf = ((this.SP & 0x0F) + (offsetF8 & 0x0F)) > 0x0F;
                    this.Cc = ((this.SP & 0xFF) + (offsetF8 & 0xFF)) > 0xFF;
                    this.HL = sumF8 & 0xFFFF;
                    return 12;
                }
            default:
                throw new Error(`Unimplemented opcode 0x${operation.toString(16)}`);
        }
    }

    executeCbOperation(operation) {
        let value;
        let carry;
        let carryC;
        let carryD;
        let carryE;
        let carryH;
        let carryL;
        let carryHL;
        let carryA;
        let carryA2;

        switch (operation) {
            case 0x00: // RLC B
                this.Cc = (this.B & 0x80) !== 0;
                this.B = ((this.B << 1) | (this.B >> 7)) & 0xFF;
                this.Z = this.B === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x01: // RLC C
                this.Cc = (this.C & 0x80) !== 0;
                this.C = ((this.C << 1) | (this.C >> 7)) & 0xFF;
                this.Z = this.C === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x02: // RLC D
                this.Cc = (this.D & 0x80) !== 0;
                this.D = ((this.D << 1) | (this.D >> 7)) & 0xFF;
                this.Z = this.D === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x03: // RLC E
                this.Cc = (this.E & 0x80) !== 0;
                this.E = ((this.E << 1) | (this.E >> 7)) & 0xFF;
                this.Z = this.E === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x04: // RLC H
                this.Cc = (this.H & 0x80) !== 0;
                this.H = ((this.H << 1) | (this.H >> 7)) & 0xFF;
                this.Z = this.H === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x05: // RLC L
                this.Cc = (this.L & 0x80) !== 0;
                this.L = ((this.L << 1) | (this.L >> 7)) & 0xFF;
                this.Z = this.L === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x06: // RLC (HL)
                value = this.memoryManagementUnit.read8bits(this.HL);
                this.Cc = (value & 0x80) !== 0;
                value = ((value << 1) | (value >> 7)) & 0xFF;
                this.memoryManagementUnit.write8bits(this.HL, value);
                this.Z = value === 0;
                this.N = false;
                this.Hf = false;
                return 16;
            case 0x07: // RLC A
                this.Cc = (this.A & 0x80) !== 0;
                this.A = ((this.A << 1) | (this.A >> 7)) & 0xFF;
                this.Z = this.A === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x08: // RRC B
                this.Cc = (this.B & 0x01) !== 0;
                this.B = ((this.B >> 1) | (this.B << 7)) & 0xFF;
                this.Z = this.B === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x09: // RRC C
                this.Cc = (this.C & 0x01) !== 0;
                this.C = ((this.C >> 1) | (this.C << 7)) & 0xFF;
                this.Z = this.C === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x0A: // RRC D
                this.Cc = (this.D & 0x01) !== 0;
                this.D = ((this.D >> 1) | (this.D << 7)) & 0xFF;
                this.Z = this.D === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x0B: // RRC E
                this.Cc = (this.E & 0x01) !== 0;
                this.E = ((this.E >> 1) | (this.E << 7)) & 0xFF;
                this.Z = this.E === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x0C: // RRC H
                this.Cc = (this.H & 0x01) !== 0;
                this.H = ((this.H >> 1) | (this.H << 7)) & 0xFF;
                this.Z = this.H === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x0D: // RRC L
                this.Cc = (this.L & 0x01) !== 0;
                this.L = ((this.L >> 1) | (this.L << 7)) & 0xFF;
                this.Z = this.L === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x0E: // RRC (HL)
                value = this.memoryManagementUnit.read8bits(this.HL);
                this.Cc = (value & 0x01) !== 0;
                value = ((value >> 1) | (value << 7)) & 0xFF;
                this.memoryManagementUnit.write8bits(this.HL, value);
                this.Z = value === 0;
                this.N = false;
                this.Hf = false;
                return 16;
            case 0x0F: // RRC A
                this.Cc = (this.A & 0x01) !== 0;
                this.A = ((this.A >> 1) | (this.A << 7)) & 0xFF;
                this.Z = this.A === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x10: // RL B
                carry = this.Cc ? 1 : 0;
                this.Cc = (this.B & 0x80) !== 0;
                this.B = ((this.B << 1) | carry) & 0xFF;
                this.Z = this.B === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x11: // RL C
                carryC = this.Cc ? 1 : 0;
                this.Cc = (this.C & 0x80) !== 0;
                this.C = ((this.C << 1) | carryC) & 0xFF;
                this.Z = this.C === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x12: // RL D
                carryD = this.Cc ? 1 : 0;
                this.Cc = (this.D & 0x80) !== 0;
                this.D = ((this.D << 1) | carryD) & 0xFF;
                this.Z = this.D === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x13: // RL E
                carryE = this.Cc ? 1 : 0;
                this.Cc = (this.E & 0x80) !== 0;
                this.E = ((this.E << 1) | carryE) & 0xFF;
                this.Z = this.E === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x14: // RL H
                carryH = this.Cc ? 1 : 0;
                this.Cc = (this.H & 0x80) !== 0;
                this.H = ((this.H << 1) | carryH) & 0xFF;
                this.Z = this.H === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x15: // RL L
                carryL = this.Cc ? 1 : 0;
                this.Cc = (this.L & 0x80) !== 0;
                this.L = ((this.L << 1) | carryL) & 0xFF;
                this.Z = this.L === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x16: // RL (HL)
                carryHL = this.Cc ? 1 : 0;
                value = this.memoryManagementUnit.read8bits(this.HL);
                this.Cc = (value & 0x80) !== 0;
                value = ((value << 1) | carryHL) & 0xFF;
                this.memoryManagementUnit.write8bits(this.HL, value);
                this.Z = value === 0;
                this.N = false;
                this.Hf = false;
                return 16;
            case 0x17: // RL A
                carryA = this.Cc ? 1 : 0;
                this.Cc = (this.A & 0x80) !== 0;
                this.A = ((this.A << 1) | carryA) & 0xFF;
                this.Z = this.A === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x18: // RR B
                carry = this.Cc ? 0x80 : 0;
                this.Cc = (this.B & 0x01) !== 0;
                this.B = ((this.B >> 1) | carry) & 0xFF;
                this.Z = this.B === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x19: // RR C
                carryC = this.Cc ? 0x80 : 0;
                this.Cc = (this.C & 0x01) !== 0;
                this.C = ((this.C >> 1) | carryC) & 0xFF;
                this.Z = this.C === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x1A: // RR D
                carryD = this.Cc ? 0x80 : 0;
                this.Cc = (this.D & 0x01) !== 0;
                this.D = ((this.D >> 1) | carryD) & 0xFF;
                this.Z = this.D === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x1B: // RR E
                carryE = this.Cc ? 0x80 : 0;
                this.Cc = (this.E & 0x01) !== 0;
                this.E = ((this.E >> 1) | carryE) & 0xFF;
                this.Z = this.E === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x1C: // RR H
                carryH = this.Cc ? 0x80 : 0;
                this.Cc = (this.H & 0x01) !== 0;
                this.H = ((this.H >> 1) | carryH) & 0xFF;
                this.Z = this.H === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x1D: // RR L
                carryL = this.Cc ? 0x80 : 0;
                this.Cc = (this.L & 0x01) !== 0;
                this.L = ((this.L >> 1) | carryL) & 0xFF;
                this.Z = this.L === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x1E: // RR (HL)
                carryHL = this.Cc ? 0x80 : 0;
                value = this.memoryManagementUnit.read8bits(this.HL);
                this.Cc = (value & 0x01) !== 0;
                value = ((value >> 1) | carryHL) & 0xFF;
                this.memoryManagementUnit.write8bits(this.HL, value);
                this.Z = value === 0;
                this.N = false;
                this.Hf = false;
                return 16;
            case 0x1F: // RR A
                carryA2 = this.Cc ? 0x80 : 0;
                this.Cc = (this.A & 0x01) !== 0;
                this.A = ((this.A >> 1) | carryA2) & 0xFF;
                this.Z = this.A === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x20: // SLA B
                this.Cc = (this.B & 0x80) !== 0;
                this.B = (this.B << 1) & 0xFF;
                this.Z = this.B === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x21: // SLA C
                this.Cc = (this.C & 0x80) !== 0;
                this.C = (this.C << 1) & 0xFF;
                this.Z = this.C === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x22: // SLA D
                this.Cc = (this.D & 0x80) !== 0;
                this.D = (this.D << 1) & 0xFF;
                this.Z = this.D === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x23: // SLA E
                this.Cc = (this.E & 0x80) !== 0;
                this.E = (this.E << 1) & 0xFF;
                this.Z = this.E === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x24: // SLA H
                this.Cc = (this.H & 0x80) !== 0;
                this.H = (this.H << 1) & 0xFF;
                this.Z = this.H === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x25: // SLA L
                this.Cc = (this.L & 0x80) !== 0;
                this.L = (this.L << 1) & 0xFF;
                this.Z = this.L === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x26: // SLA (HL)
                value = this.memoryManagementUnit.read8bits(this.HL);
                this.Cc = (value & 0x80) !== 0;
                value = (value << 1) & 0xFF;
                this.memoryManagementUnit.write8bits(this.HL, value);
                this.Z = value === 0;
                this.N = false;
                this.Hf = false;
                return 16;
            case 0x27: // SLA A
                this.Cc = (this.A & 0x80) !== 0;
                this.A = (this.A << 1) & 0xFF;
                this.Z = this.A === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x28: // SRA B
                this.Cc = (this.B & 0x01) !== 0;
                this.B = (this.B >> 1) | (this.B & 0x80);
                this.Z = this.B === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x29: // SRA C
                this.Cc = (this.C & 0x01) !== 0;
                this.C = (this.C >> 1) | (this.C & 0x80);
                this.Z = this.C === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x2A: // SRA D
                this.Cc = (this.D & 0x01) !== 0;
                this.D = (this.D >> 1) | (this.D & 0x80);
                this.Z = this.D === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x2B: // SRA E
                this.Cc = (this.E & 0x01) !== 0;
                this.E = (this.E >> 1) | (this.E & 0x80);
                this.Z = this.E === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x2C: // SRA H
                this.Cc = (this.H & 0x01) !== 0;
                this.H = (this.H >> 1) | (this.H & 0x80);
                this.Z = this.H === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x2D: // SRA L
                this.Cc = (this.L & 0x01) !== 0;
                this.L = (this.L >> 1) | (this.L & 0x80);
                this.Z = this.L === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x2E: // SRA (HL)
                value = this.memoryManagementUnit.read8bits(this.HL);
                this.Cc = (value & 0x01) !== 0;
                value = (value >> 1) | (value & 0x80);
                this.memoryManagementUnit.write8bits(this.HL, value);
                this.Z = value === 0;
                this.N = false;
                this.Hf = false;
                return 16;
            case 0x2F: // SRA A
                this.Cc = (this.A & 0x01) !== 0;
                this.A = (this.A >> 1) | (this.A & 0x80);
                this.Z = this.A === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x30: // SWAP B
                this.B = ((this.B & 0xF) << 4) | ((this.B & 0xF0) >> 4);
                this.Z = this.B === 0;
                this.N = false;
                this.Hf = false;
                this.Cc = false;
                return 8;
            case 0x31: // SWAP C
                this.C = ((this.C & 0xF) << 4) | ((this.C & 0xF0) >> 4);
                this.Z = this.C === 0;
                this.N = false;
                this.Hf = false;
                this.Cc = false;
                return 8;
            case 0x32: // SWAP D
                this.D = ((this.D & 0xF) << 4) | ((this.D & 0xF0) >> 4);
                this.Z = this.D === 0;
                this.N = false;
                this.Hf = false;
                this.Cc = false;
                return 8;
            case 0x33: // SWAP E
                this.E = ((this.E & 0xF) << 4) | ((this.E & 0xF0) >> 4);
                this.Z = this.E === 0;
                this.N = false;
                this.Hf = false;
                this.Cc = false;
                return 8;
            case 0x34: // SWAP H
                this.H = ((this.H & 0xF) << 4) | ((this.H & 0xF0) >> 4);
                this.Z = this.H === 0;
                this.N = false;
                this.Hf = false;
                this.Cc = false;
                return 8;
            case 0x35: // SWAP L
                this.L = ((this.L & 0xF) << 4) | ((this.L & 0xF0) >> 4);
                this.Z = this.L === 0;
                this.N = false;
                this.Hf = false;
                this.Cc = false;
                return 8;
            case 0x36: // SWAP (HL)
                value = this.memoryManagementUnit.read8bits(this.HL);
                value = ((value & 0xF) << 4) | ((value & 0xF0) >> 4);
                this.memoryManagementUnit.write8bits(this.HL, value);
                this.Z = value === 0;
                this.N = false;
                this.Hf = false;
                this.Cc = false;
                return 16;
            case 0x37: // SWAP A
                this.A = ((this.A & 0xF) << 4) | ((this.A & 0xF0) >> 4);
                this.Z = this.A === 0;
                this.N = false;
                this.Hf = false;
                this.Cc = false;
                return 8;
            case 0x38: // SRL B
                this.Cc = (this.B & 0x01) !== 0;
                this.B >>= 1;
                this.Z = this.B === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x39: // SRL C
                this.Cc = (this.C & 0x01) !== 0;
                this.C >>= 1;
                this.Z = this.C === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x3A: // SRL D
                this.Cc = (this.D & 0x01) !== 0;
                this.D >>= 1;
                this.Z = this.D === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x3B: // SRL E
                this.Cc = (this.E & 0x01) !== 0;
                this.E >>= 1;
                this.Z = this.E === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x3C: // SRL H
                this.Cc = (this.H & 0x01) !== 0;
                this.H >>= 1;
                this.Z = this.H === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x3D: // SRL L
                this.Cc = (this.L & 0x01) !== 0;
                this.L >>= 1;
                this.Z = this.L === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            case 0x3E: // SRL (HL)
                value = this.memoryManagementUnit.read8bits(this.HL);
                this.Cc = (value & 0x01) !== 0;
                value >>= 1;
                this.memoryManagementUnit.write8bits(this.HL, value);
                this.Z = value === 0;
                this.N = false;
                this.Hf = false;
                return 16;
            case 0x3F: // SRL A
                this.Cc = (this.A & 0x01) !== 0;
                this.A >>= 1;
                this.Z = this.A === 0;
                this.N = false;
                this.Hf = false;
                return 8;
            // BIT
            case 0x40: case 0x41: case 0x42: case 0x43: case 0x44: case 0x45: case 0x47:
            case 0x48: case 0x49: case 0x4A: case 0x4B: case 0x4C: case 0x4D: case 0x4F:
            case 0x50: case 0x51: case 0x52: case 0x53: case 0x54: case 0x55: case 0x57:
            case 0x58: case 0x59: case 0x5A: case 0x5B: case 0x5C: case 0x5D: case 0x5F:
            case 0x60: case 0x61: case 0x62: case 0x63: case 0x64: case 0x65: case 0x67:
            case 0x68: case 0x69: case 0x6A: case 0x6B: case 0x6C: case 0x6D: case 0x6F:
            case 0x70: case 0x71: case 0x72: case 0x73: case 0x74: case 0x75: case 0x77:
            case 0x78: case 0x79: case 0x7A: case 0x7B: case 0x7C: case 0x7D: case 0x7F:
                this.bit(operation);
                return 8;
            case 0x46: case 0x4E: case 0x56: case 0x5E:
            case 0x66: case 0x6E: case 0x76: case 0x7E:
                this.bit(operation);
                return 16;
            // RES
            case 0x80: case 0x81: case 0x82: case 0x83: case 0x84: case 0x85: case 0x87:
            case 0x88: case 0x89: case 0x8A: case 0x8B: case 0x8C: case 0x8D: case 0x8F:
            case 0x90: case 0x91: case 0x92: case 0x93: case 0x94: case 0x95: case 0x97:
            case 0x98: case 0x99: case 0x9A: case 0x9B: case 0x9C: case 0x9D: case 0x9F:
            case 0xA0: case 0xA1: case 0xA2: case 0xA3: case 0xA4: case 0xA5: case 0xA7:
            case 0xA8: case 0xA9: case 0xAA: case 0xAB: case 0xAC: case 0xAD: case 0xAF:
            case 0xB0: case 0xB1: case 0xB2: case 0xB3: case 0xB4: case 0xB5: case 0xB7:
            case 0xB8: case 0xB9: case 0xBA: case 0xBB: case 0xBC: case 0xBD: case 0xBF:
                this.res(operation);
                return 8;
            case 0x86: case 0x8E: case 0x96: case 0x9E:
            case 0xA6: case 0xAE: case 0xB6: case 0xBE:
                this.res(operation);
                return 16;
            // SET
            case 0xC0: case 0xC1: case 0xC2: case 0xC3: case 0xC4: case 0xC5: case 0xC7:
            case 0xC8: case 0xC9: case 0xCA: case 0xCB: case 0xCC: case 0xCD: case 0xCF:
            case 0xD0: case 0xD1: case 0xD2: case 0xD3: case 0xD4: case 0xD5: case 0xD7:
            case 0xD8: case 0xD9: case 0xDA: case 0xDB: case 0xDC: case 0xDD: case 0xDF:
            case 0xE0: case 0xE1: case 0xE2: case 0xE3: case 0xE4: case 0xE5: case 0xE7:
            case 0xE8: case 0xE9: case 0xEA: case 0xEB: case 0xEC: case 0xED: case 0xEF:
            case 0xF0: case 0xF1: case 0xF2: case 0xF3: case 0xF4: case 0xF5: case 0xF7:
            case 0xF8: case 0xF9: case 0xFA: case 0xFB: case 0xFC: case 0xFD: case 0xFF:
                this.set(operation);
                return 8;
            case 0xC6: case 0xCE: case 0xD6: case 0xDE:
            case 0xE6: case 0xEE: case 0xF6: case 0xFE:
                this.set(operation);
                return 16;
            default:
                throw new Error(`Unimplemented CB opcode 0x${operation.toString(16)}`);
        }
    }

}

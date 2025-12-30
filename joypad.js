class Joypad {
    constructor(mmu) {
        this.mmu = mmu;
        this.buttons = {
            A: false,
            B: false,
            Select: false,
            Start: false,
            Up: false,
            Down: false,
            Left: false,
            Right: false
        };
        this.memoryValue = 0xFF;
    }

    update() {
        // Bit 5: Action buttons (A, B, Select, Start)
        // Bit 4: Direction buttons (Up, Down, Left, Right)
        let value = this.mmu.memory[0xFF00];

        if ((value & 0x20) === 0) { // Action buttons selected
            let joypad = 0xCF;
            if (this.buttons.A) joypad &= ~0x01;
            if (this.buttons.B) joypad &= ~0x02;
            if (this.buttons.Select) joypad &= ~0x04;
            if (this.buttons.Start) joypad &= ~0x08;
            this.memoryValue = joypad;
        } else if ((value & 0x10) === 0) { // Direction buttons selected
            let joypad = 0xCF;
            if (this.buttons.Right) joypad &= ~0x01;
            if (this.buttons.Left) joypad &= ~0x02;
            if (this.buttons.Up) joypad &= ~0x04;
            if (this.buttons.Down) joypad &= ~0x08;
            this.memoryValue = joypad;
        } else {
            this.memoryValue = 0xFF;
        }
    }

    read() {
        return this.memoryValue;
    }
}
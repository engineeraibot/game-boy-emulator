class WaveChannel {
    constructor() {
        this.enabled = false;
        this.dacEnabled = false;

        // NR31: Sound Length
        this.lengthLoad = 0;
        this.lengthCounter = 0;

        // NR32: Output Level
        this.volumeCode = 0;

        // NR33, NR34: Frequency
        this.frequency = 0;
        this.timer = 0;

        // NR34: Control
        this.lengthEnabled = false;

        this.position = 0;
        this.waveTable = new Uint8Array(16);
    }

    trigger() {
        if (!this.dacEnabled) return;

        this.enabled = true;
        if (this.lengthCounter === 0) {
            this.lengthCounter = 256;
        }

        this.timer = (2048 - this.frequency) * 2;
        this.position = 0;
    }

    clockLength() {
        if (this.lengthEnabled && this.lengthCounter > 0) {
            this.lengthCounter--;
            if (this.lengthCounter === 0) {
                this.enabled = false;
            }
        }
    }

    clockTimer(cycles) {
        if (this.timer > 0) {
            this.timer -= cycles;
            if (this.timer <= 0) {
                this.position = (this.position + 1) % 32;
                this.timer += (2048 - this.frequency) * 2;
            }
        }
    }

    getSample() {
        if (!this.enabled || !this.dacEnabled) {
            return 0;
        }

        const byteIndex = Math.floor(this.position / 2);
        const isUpperNibble = (this.position % 2) === 0;
        const byte = this.waveTable[byteIndex];
        let sample = isUpperNibble ? (byte >> 4) : (byte & 0x0F);

        if (this.volumeCode > 0) {
            sample >>= (this.volumeCode - 1);
        } else {
            sample = 0;
        }

        return sample;
    }

    writeRegister(address, value) {
        switch (address) {
            case 0xFF1A: // NR30
                this.dacEnabled = (value & 0x80) !== 0;
                if (!this.dacEnabled) {
                    this.enabled = false;
                }
                break;
            case 0xFF1B: // NR31
                this.lengthLoad = value;
                this.lengthCounter = 256 - this.lengthLoad;
                break;
            case 0xFF1C: // NR32
                this.volumeCode = (value >> 5) & 0x03;
                break;
            case 0xFF1D: // NR33
                this.frequency = (this.frequency & 0xFF00) | value;
                break;
            case 0xFF1E: // NR34
                this.frequency = (this.frequency & 0x00FF) | ((value & 0x07) << 8);
                this.lengthEnabled = (value & 0x40) !== 0;
                if (value & 0x80) {
                    this.trigger();
                }
                break;
        }
    }

    writeWaveTable(offset, value) {
        this.waveTable[offset] = value;
    }

    getState() {
        return {
            enabled: this.enabled,
            dacEnabled: this.dacEnabled,
            lengthLoad: this.lengthLoad,
            lengthCounter: this.lengthCounter,
            volumeCode: this.volumeCode,
            frequency: this.frequency,
            timer: this.timer,
            lengthEnabled: this.lengthEnabled,
            position: this.position,
            waveTable: Array.from(this.waveTable),
        };
    }

    setState(state) {
        this.enabled = state.enabled;
        this.dacEnabled = state.dacEnabled;
        this.lengthLoad = state.lengthLoad;
        this.lengthCounter = state.lengthCounter;
        this.volumeCode = state.volumeCode;
        this.frequency = state.frequency;
        this.timer = state.timer;
        this.lengthEnabled = state.lengthEnabled;
        this.position = state.position;
        this.waveTable = new Uint8Array(state.waveTable);
    }
}

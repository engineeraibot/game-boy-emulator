class NoiseChannel {
    constructor() {
        this.enabled = false;

        // NR41: Sound Length
        this.lengthLoad = 0;
        this.lengthCounter = 0;

        // NR42: Volume Envelope
        this.initialVolume = 0;
        this.envelopeDirection = 0;
        this.envelopePeriod = 0;
        this.volume = 0;
        this.envelopeTimer = 0;

        // NR43: Polynomial Counter
        this.shiftClockFrequency = 0;
        this.counterStep = 0;
        this.dividingRatio = 0;
        this.timer = 0;

        // NR44: Counter/consecutive; Initial
        this.lengthEnabled = false;

        // LFSR
        this.lfsr = 0x7FFF;
    }

    trigger() {
        this.enabled = true;
        if (this.lengthCounter === 0) {
            this.lengthCounter = 64 - this.lengthLoad;
        }

        this.volume = this.initialVolume;
        this.envelopeTimer = this.envelopePeriod;

        this.lfsr = 0x7FFF;

        const divisorCode = this.dividingRatio;
        const divisor = divisorCode > 0 ? (divisorCode << 4) : 8;
        this.timer = divisor << this.shiftClockFrequency;
    }

    clockLength() {
        if (this.lengthEnabled && this.lengthCounter > 0) {
            this.lengthCounter--;
            if (this.lengthCounter === 0) {
                this.enabled = false;
            }
        }
    }

    clockEnvelope() {
        if (this.envelopePeriod === 0) {
            return;
        }

        this.envelopeTimer--;
        if (this.envelopeTimer === 0) {
            this.envelopeTimer = this.envelopePeriod;
            if (this.envelopeDirection === 1 && this.volume < 15) {
                this.volume++;
            } else if (this.envelopeDirection === 0 && this.volume > 0) {
                this.volume--;
            }
        }
    }

    clockTimer(cycles) {
        if (!this.enabled) return;

        this.timer -= cycles;
        if (this.timer <= 0) {
            const divisorCode = this.dividingRatio;
            const divisor = divisorCode > 0 ? (divisorCode << 4) : 8;
            const period = divisor << this.shiftClockFrequency;
            this.timer += period;

            const xorBit = (this.lfsr & 1) ^ ((this.lfsr >> 1) & 1);
            this.lfsr = (this.lfsr >> 1) | (xorBit << 14);

            if (this.counterStep === 1) { // 7-bit mode
                this.lfsr = (this.lfsr & ~(1 << 6)) | (xorBit << 6);
            }
        }
    }

    getSample() {
        if (!this.enabled || (this.lfsr & 1) !== 0) {
            return 0;
        }
        return this.volume;
    }

    readRegister(address) {
        switch (address) {
            case 0xFF20: // NR41
                return 0xC0 | (this.lengthLoad & 0x3F);
            case 0xFF21: // NR42
                return (this.initialVolume << 4) | (this.envelopeDirection ? 0x08 : 0) | (this.envelopePeriod & 0x07);
            case 0xFF22: // NR43
                return (this.shiftClockFrequency << 4) | (this.counterStep ? 0x08 : 0) | (this.dividingRatio & 0x07);
            case 0xFF23: // NR44
                return 0xBF | (this.lengthEnabled ? 0x40 : 0);
            default:
                return 0xFF;
        }
    }

    writeRegister(address, value) {
        switch (address) {
            case 0xFF20: // NR41
                this.lengthLoad = value & 0x3F;
                this.lengthCounter = 64 - this.lengthLoad;
                break;
            case 0xFF21: // NR42
                this.initialVolume = value >> 4;
                this.envelopeDirection = (value & 0x08) ? 1 : 0;
                this.envelopePeriod = value & 0x07;
                if ((value & 0xF8) === 0) {
                    this.enabled = false;
                }
                break;
            case 0xFF22: // NR43
                this.shiftClockFrequency = value >> 4;
                this.counterStep = (value & 0x08) ? 1 : 0;
                this.dividingRatio = value & 0x07;
                break;
            case 0xFF23: // NR44
                if (value & 0x80) {
                    this.trigger();
                }
                this.lengthEnabled = (value & 0x40) !== 0;
                break;
        }
    }

    getState() {
        return {
            enabled: this.enabled,
            lengthLoad: this.lengthLoad,
            lengthCounter: this.lengthCounter,
            initialVolume: this.initialVolume,
            envelopeDirection: this.envelopeDirection,
            envelopePeriod: this.envelopePeriod,
            volume: this.volume,
            envelopeTimer: this.envelopeTimer,
            shiftClockFrequency: this.shiftClockFrequency,
            counterStep: this.counterStep,
            dividingRatio: this.dividingRatio,
            timer: this.timer,
            lengthEnabled: this.lengthEnabled,
            lfsr: this.lfsr,
        };
    }

    setState(state) {
        this.enabled = state.enabled;
        this.lengthLoad = state.lengthLoad;
        this.lengthCounter = state.lengthCounter;
        this.initialVolume = state.initialVolume;
        this.envelopeDirection = state.envelopeDirection;
        this.envelopePeriod = state.envelopePeriod;
        this.volume = state.volume;
        this.envelopeTimer = state.envelopeTimer;
        this.shiftClockFrequency = state.shiftClockFrequency;
        this.counterStep = state.counterStep;
        this.dividingRatio = state.dividingRatio;
        this.timer = state.timer;
        this.lengthEnabled = state.lengthEnabled;
        this.lfsr = state.lfsr;
    }
}

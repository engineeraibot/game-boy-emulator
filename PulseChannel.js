const DUTY_PATTERNS = [
    [0, 0, 0, 0, 0, 0, 0, 1], // 12.5%
    [1, 0, 0, 0, 0, 0, 0, 1], // 25%
    [1, 0, 0, 0, 0, 1, 1, 1], // 50%
    [0, 1, 1, 1, 1, 1, 1, 0], // 75%
];

class PulseChannel {
    constructor(hasSweep) {
        this.hasSweep = hasSweep;
        this.enabled = false;

        // NR10 / NR20: Sweep (channel 1 only)
        this.sweepPeriod = 0;
        this.sweepDirection = 0;
        this.sweepShift = 0;
        this.sweepTimer = 0;
        this.shadowFrequency = 0;
        this.sweepEnabled = false;

        // NR11 / NR21: Sound Length / Wave Pattern Duty
        this.duty = 0;
        this.lengthLoad = 0;
        this.lengthCounter = 0;

        // NR12 / NR22: Volume Envelope
        this.initialVolume = 0;
        this.envelopeDirection = 0;
        this.envelopePeriod = 0;
        this.volume = 0;
        this.envelopeTimer = 0;

        // NR13 / NR23: Frequency lo
        // NR14 / NR24: Frequency hi
        this.frequency = 0;
        this.timer = 0;
        this.lengthEnabled = false;

        this.waveStep = 0;
    }

    trigger() {
        this.enabled = true;
        if (this.lengthCounter === 0) {
            this.lengthCounter = 64 - this.lengthLoad;
        }

        this.timer = (2048 - this.frequency) * 4;
        this.volume = this.initialVolume;
        this.envelopeTimer = this.envelopePeriod;

        if (this.hasSweep) {
            this.shadowFrequency = this.frequency;
            this.sweepTimer = this.sweepPeriod || 8;
            this.sweepEnabled = this.sweepPeriod > 0 || this.sweepShift > 0;
            if (this.sweepShift > 0) {
                this.calculateSweep(true);
            }
        }

        if ((this.initialVolume === 0 && this.envelopeDirection === 0)) {
            this.enabled = false;
        }
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
        if (this.envelopeTimer <= 0) {
            this.envelopeTimer = this.envelopePeriod;
            if (this.envelopeDirection === 1 && this.volume < 15) {
                this.volume++;
            } else if (this.envelopeDirection === 0 && this.volume > 0) {
                this.volume--;
            }
        }
    }

    clockSweep() {
        if (!this.hasSweep || !this.sweepEnabled) {
            return;
        }

        this.sweepTimer--;
        if (this.sweepTimer <= 0) {
            this.sweepTimer = this.sweepPeriod || 8;
            if (this.sweepPeriod > 0) {
                const newFreq = this.calculateSweep(false);
                if (newFreq <= 2047 && this.sweepShift > 0) {
                    this.frequency = newFreq;
                    this.shadowFrequency = newFreq;
                    // Run overflow check again with the new frequency
                    this.calculateSweep(true);
                }
            }
        }
    }

    calculateSweep(update) {
        let newFreq = this.shadowFrequency >> this.sweepShift;
        if (this.sweepDirection === 1) { // subtraction
            newFreq = this.shadowFrequency - newFreq;
        } else { // addition
            newFreq = this.shadowFrequency + newFreq;
        }

        if (newFreq > 2047) {
            this.enabled = false;
        }

        return newFreq;
    }

    clockTimer(cycles) {
        if (this.timer > 0) {
            this.timer -= cycles;
            if (this.timer <= 0) {
                this.waveStep = (this.waveStep + 1) % 8;
                this.timer += (2048 - this.frequency) * 4;
            }
        }
    }

    getSample() {
        if (!this.enabled || (this.initialVolume === 0 && this.envelopeDirection === 0)) {
            return 0;
        }
        const dutyPattern = DUTY_PATTERNS[this.duty];
        return dutyPattern[this.waveStep] * this.volume;
    }

    writeRegister(address, value) {
        // NRx0
        if (this.hasSweep && (address === 0xFF10)) {
            this.sweepPeriod = (value >> 4) & 0x07;
            this.sweepDirection = (value & 0x08) ? 1 : 0;
            this.sweepShift = value & 0x07;
        }
        // NRx1
        else if (address === 0xFF11 || address === 0xFF16) {
            this.duty = value >> 6;
            this.lengthLoad = value & 0x3F;
            this.lengthCounter = 64 - this.lengthLoad;
        }
        // NRx2
        else if (address === 0xFF12 || address === 0xFF17) {
            this.initialVolume = value >> 4;
            this.envelopeDirection = (value & 0x08) ? 1 : 0;
            this.envelopePeriod = value & 0x07;
            if ((value & 0xF8) === 0) {
                this.enabled = false;
            }
        }
        // NRx3
        else if (address === 0xFF13 || address === 0xFF18) {
            this.frequency = (this.frequency & 0xFF00) | value;
        }
        // NRx4
        else if (address === 0xFF14 || address === 0xFF19) {
            this.frequency = (this.frequency & 0x00FF) | ((value & 0x07) << 8);
            this.lengthEnabled = (value & 0x40) !== 0;
            if (value & 0x80) {
                this.trigger();
            }
        }
    }

    getState() {
        return {
            enabled: this.enabled,
            sweepPeriod: this.sweepPeriod,
            sweepDirection: this.sweepDirection,
            sweepShift: this.sweepShift,
            sweepTimer: this.sweepTimer,
            shadowFrequency: this.shadowFrequency,
            sweepEnabled: this.sweepEnabled,
            duty: this.duty,
            lengthLoad: this.lengthLoad,
            lengthCounter: this.lengthCounter,
            initialVolume: this.initialVolume,
            envelopeDirection: this.envelopeDirection,
            envelopePeriod: this.envelopePeriod,
            volume: this.volume,
            envelopeTimer: this.envelopeTimer,
            frequency: this.frequency,
            timer: this.timer,
            lengthEnabled: this.lengthEnabled,
            waveStep: this.waveStep,
        };
    }

    setState(state) {
        this.enabled = state.enabled;
        this.sweepPeriod = state.sweepPeriod;
        this.sweepDirection = state.sweepDirection;
        this.sweepShift = state.sweepShift;
        this.sweepTimer = state.sweepTimer;
        this.shadowFrequency = state.shadowFrequency;
        this.sweepEnabled = state.sweepEnabled;
        this.duty = state.duty;
        this.lengthLoad = state.lengthLoad;
        this.lengthCounter = state.lengthCounter;
        this.initialVolume = state.initialVolume;
        this.envelopeDirection = state.envelopeDirection;
        this.envelopePeriod = state.envelopePeriod;
        this.volume = state.volume;
        this.envelopeTimer = state.envelopeTimer;
        this.frequency = state.frequency;
        this.timer = state.timer;
        this.lengthEnabled = state.lengthEnabled;
        this.waveStep = state.waveStep;
    }
}

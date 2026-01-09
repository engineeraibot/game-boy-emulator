// Constants
const SAMPLE_RATE = 44100;
const APU_CHUNK_SIZE = 2048;
const FRAME_SEQUENCER_RATE = 512;
const CYCLES_PER_SECOND = 4194304;
const CYCLES_PER_SAMPLE = CYCLES_PER_SECOND / SAMPLE_RATE;

class AudioProcessingUnit {
    constructor(memoryManagementUnit) {
        this.mmu = memoryManagementUnit;
        this.audioContext = null;
        this.workletNode = null;
        this.soundEnabled = false;

        this.channel1 = new PulseChannel(true);
        this.channel2 = new PulseChannel(false);
        this.channel3 = new WaveChannel();
        this.channel4 = new NoiseChannel();

        this.masterVolume = 0.5;
        this.vinLeft = false;
        this.vinRight = false;
        this.leftVolume = 7;
        this.rightVolume = 7;

        this.apuClock = 0;
        this.frameSequencerClock = 0;
        this.frameSequencerStep = 0;

        this.sampleClock = 0;
        this.buffer = new Float32Array(APU_CHUNK_SIZE);
        this.bufferPtr = 0;
    }

    step(cycles) {
        if (!this.soundEnabled || !this.workletNode) {
            return;
        }

        this.apuClock += cycles;
        this.frameSequencerClock += cycles;

        if (this.frameSequencerClock >= 8192) {
            this.frameSequencerClock -= 8192;
            this.clockFrameSequencer();
        }

        this.channel1.clockTimer(cycles);
        this.channel2.clockTimer(cycles);
        this.channel3.clockTimer(cycles);
        this.channel4.clockTimer(cycles);

        this.sampleClock += cycles;
        if (this.sampleClock >= CYCLES_PER_SAMPLE) {
            this.sampleClock -= CYCLES_PER_SAMPLE;
            this.mixAndBufferSample();
        }
    }

    clockFrameSequencer() {
        // Length counters (256 Hz)
        if (this.frameSequencerStep % 2 === 0) {
            this.channel1.clockLength();
            this.channel2.clockLength();
            this.channel3.clockLength();
            this.channel4.clockLength();
        }

        // Sweep (128 Hz)
        if (this.frameSequencerStep === 2 || this.frameSequencerStep === 6) {
            this.channel1.clockSweep();
        }

        // Volume envelopes (64 Hz)
        if (this.frameSequencerStep === 7) {
            this.channel1.clockEnvelope();
            this.channel2.clockEnvelope();
            this.channel4.clockEnvelope();
        }

        this.frameSequencerStep = (this.frameSequencerStep + 1) % 8;
    }

    mixAndBufferSample() {
        if (this.bufferPtr >= APU_CHUNK_SIZE) {
            this.flushBuffer();
        }

        const s1 = this.channel1.getSample() / 15;
        const s2 = this.channel2.getSample() / 15;
        const s3 = this.channel3.getSample() / 15;
        const s4 = this.channel4.getSample() / 15;

        let left = 0;
        let right = 0;
        const nr51 = this.mmu.read8bits(0xFF25);

        if (nr51 & 0x01) right += s1;
        if (nr51 & 0x02) right += s2;
        if (nr51 & 0x04) right += s3;
        if (nr51 & 0x08) right += s4;
        if (nr51 & 0x10) left += s1;
        if (nr51 & 0x20) left += s2;
        if (nr51 & 0x40) left += s3;
        if (nr51 & 0x80) left += s4;

        left /= 4.0;
        right /= 4.0;

        left *= (this.leftVolume / 7.0) * this.masterVolume;
        right *= (this.rightVolume / 7.0) * this.masterVolume;

        this.buffer[this.bufferPtr++] = left;
        this.buffer[this.bufferPtr++] = right;
    }

    flushBuffer() {
        if (this.bufferPtr > 0) {
            this.workletNode.port.postMessage(this.buffer.subarray(0, this.bufferPtr));
            this.bufferPtr = 0;
        }
    }

    async initAudio() {
        if (this.audioContext) {
            this.audioContext.resume();
            return;
        };
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: SAMPLE_RATE,
        });
        await this.audioContext.audioWorklet.addModule('audio-processor.js');
        this.workletNode = new AudioWorkletNode(this.audioContext, 'gameboy-audio-processor', {
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });
        this.workletNode.connect(this.audioContext.destination);
    }

    readRegister(address) {
        if (address >= 0xFF10 && address <= 0xFF14) return this.channel1.readRegister(address);
        if (address >= 0xFF16 && address <= 0xFF19) return this.channel2.readRegister(address);
        if (address >= 0xFF1A && address <= 0xFF1E) return this.channel3.readRegister(address);
        if (address >= 0xFF20 && address <= 0xFF23) return this.channel4.readRegister(address);

        switch (address) {
            case 0xFF24: // NR50
                return (this.vinLeft ? 0x80 : 0) | (this.leftVolume << 4) | (this.vinRight ? 0x08 : 0) | this.rightVolume;
            case 0xFF25: // NR51
                // This is write-only in hardware but often readable in emulators
                return this.mmu.memory[0xFF25];
            case 0xFF26: { // NR52
                let status = (this.soundEnabled ? 0x80 : 0) | 0x70;
                if (this.channel1.enabled) status |= 0x01;
                if (this.channel2.enabled) status |= 0x02;
                if (this.channel3.enabled) status |= 0x04;
                if (this.channel4.enabled) status |= 0x08;
                return status;
            }
            case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33:
            case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37:
            case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B:
            case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
                return this.channel3.waveTable[address - 0xFF30];
        }
        return 0xFF;
    }

    writeRegister(address, value) {
        if (!this.soundEnabled && address !== 0xFF26) {
            return;
        }

        if (address >= 0xFF10 && address <= 0xFF14) this.channel1.writeRegister(address, value);
        else if (address >= 0xFF16 && address <= 0xFF19) this.channel2.writeRegister(address, value);
        else if (address >= 0xFF1A && address <= 0xFF1E) this.channel3.writeRegister(address, value);
        else if (address >= 0xFF20 && address <= 0xFF23) this.channel4.writeRegister(address, value);
        else if (address >= 0xFF30 && address <= 0xFF3F) this.channel3.writeWaveTable(address - 0xFF30, value);
        else {
            switch (address) {
                case 0xFF24: // NR50
                    this.vinLeft = (value & 0x80) !== 0;
                    this.leftVolume = (value >> 4) & 0x07;
                    this.vinRight = (value & 0x08) !== 0;
                    this.rightVolume = value & 0x07;
                    break;
                case 0xFF25: // NR51
                    this.mmu.memory[0xFF25] = value;
                    break;
                case 0xFF26: // NR52
                    const wasEnabled = this.soundEnabled;
                    this.soundEnabled = (value & 0x80) !== 0;
                    if (this.soundEnabled && !wasEnabled) {
                        this.initAudio().catch(console.error);
                        this.reset();
                    } else if (!this.soundEnabled && wasEnabled) {
                        this.flushBuffer();
                        if (this.audioContext) this.audioContext.suspend();
                        for (let i = 0xFF10; i <= 0xFF25; i++) {
                            if (i !== 0xFF26) this.writeRegister(i, 0);
                        }
                    }
                    break;
            }
        }
    }

    reset() {
        this.apuClock = 0;
        this.frameSequencerClock = 0;
        this.frameSequencerStep = 0;
        this.channel1 = new PulseChannel(true);
        this.channel2 = new PulseChannel(false);
        this.channel3 = new WaveChannel();
        this.channel4 = new NoiseChannel();
    }

    getState() {
        return {
            soundEnabled: this.soundEnabled,
            masterVolume: this.masterVolume,
            vinLeft: this.vinLeft,
            vinRight: this.vinRight,
            leftVolume: this.leftVolume,
            rightVolume: this.rightVolume,
            apuClock: this.apuClock,
            frameSequencerClock: this.frameSequencerClock,
            frameSequencerStep: this.frameSequencerStep,
            channel1: this.channel1.getState(),
            channel2: this.channel2.getState(),
            channel3: this.channel3.getState(),
            channel4: this.channel4.getState(),
        };
    }

    setState(state) {
        if (!state) return;
        this.soundEnabled = state.soundEnabled;
        this.masterVolume = state.masterVolume;
        this.vinLeft = state.vinLeft;
        this.vinRight = state.vinRight;
        this.leftVolume = state.leftVolume;
        this.rightVolume = state.rightVolume;
        this.apuClock = state.apuClock;
        this.frameSequencerClock = state.frameSequencerClock;
        this.frameSequencerStep = state.frameSequencerStep;
        this.channel1.setState(state.channel1);
        this.channel2.setState(state.channel2);
        this.channel3.setState(state.channel3);
        this.channel4.setState(state.channel4);
    }
}

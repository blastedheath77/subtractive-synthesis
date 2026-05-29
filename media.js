/* ==========================================================================
   SynthDeck Audio & Synthesis Engine (media.js)
   Web Audio API Polyphonic Synth and Sound Generators
   ========================================================================== */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.analyser = null;
    this.isInitialized = false;
    
    // Active voice tracking (frequency -> Voice object)
    this.activeVoices = new Map();
    
    // Global parameters
    this.s4Harmonics = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]; // Fundamental + 7 harmonics
    this.modRouting = {
      lfo: { pitch: false, filter: false, volume: false },
      env: { pitch: false, filter: false, volume: false },
      depth: 0.5
    };
    this.s5PulseWidth = 0.50; // default 50%
    this.s5WaveType = "pulse"; // default
    this.noiseCrossfade = 0.5; // 0 = white, 1 = pink
    this.s8EnvTarget = "vca"; // "vca" or "vcf"
    
    // Envelope (ADSR) state
    this.adsr = {
      attack: 0.10,
      decay: 0.30,
      sustain: 0.70,
      release: 0.50
    };
    
    // VCF state
    this.vcf = {
      cutoff: 1000,
      q: 1.0
    };

    // Slide 9 VCF state
    this.s9FilterType = "lowpass";
    this.s9FilterSlope = "2-pole";
    this.s9FilterCutoff = 1000;

    // LFO state
    this.lfoParams = {
      rate: 2.0,
      depth: 0.5,
      wave: "sine",
      destination: "none"
    };

    // Slide 6 continuous noise source nodes
    this.noiseSource = null;
    this.noiseGainNode = null;
    this.whiteNoiseBuffer = null;
    this.pinkNoiseBuffer = null;
  }

  /**
   * Initializes the AudioContext after user interaction (browser policy)
   */
  async init() {
    if (this.isInitialized) return;
    
    // Create AudioContext
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass();
    
    // Master Analyser Node (Exposed to visualizer)
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    
    // Master Gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.4, this.ctx.currentTime); // Safe volume
    
    // Routing: Voices -> MasterGain -> Analyser -> Destination
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    
    // Pre-generate noise buffers
    this.generateNoiseBuffers();
    
    this.isInitialized = true;
    
    // Resume context if suspended
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  /**
   * Pre-calculates White and Pink noise buffers to save CPU cycles during synthesis.
   */
  generateNoiseBuffers() {
    const bufferSize = 2 * this.ctx.sampleRate; // 2 seconds of noise
    
    // 1. White Noise Buffer
    this.whiteNoiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const whiteData = this.whiteNoiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      whiteData[i] = Math.random() * 2 - 1;
    }
    
    // 2. Pink Noise Buffer (Paul Kellet refined method)
    this.pinkNoiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const pinkData = this.pinkNoiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      
      pinkData[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      pinkData[i] *= 0.11; // Normalization to prevent clipping
      b6 = white * 0.115926;
    }
  }

  /**
   * Generates a static comparator curve for pulse width modulation (PWM)
   */
  makeStaticComparatorCurve() {
    const curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) {
      curve[i] = i < 1024 ? -1 : 1;
    }
    return curve;
  }

  /**
   * Generates a WaveShaper curve for pulse width modulation (PWM)
   */
  makePulseCurve(width) {
    const curve = new Float32Array(2048);
    // Threshold ranges from -0.9 (95% PW) to 0.9 (5% PW)
    // To match width 10% - 50%, map width input [0.1, 0.5]
    // 50% = threshold 0
    // 10% = threshold 0.8
    const threshold = 1.0 - (width * 2); 
    
    for (let i = 0; i < 2048; i++) {
      const x = (i / 2047) * 2 - 1; // Map index to [-1, 1]
      curve[i] = x < threshold ? -1 : 1;
    }
    return curve;
  }

  /**
   * Triggers a specific audio demonstration for Slide 1
   */
  triggerSlide1Demo(method) {
    if (!this.isInitialized) return;
    
    const now = this.ctx.currentTime;
    
    if (method === "subtractive") {
      // Subtractive sweep: Bright sawtooth sweeping down through a resonant lowpass
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(110, now); // A2
      
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1500, now);
      filter.frequency.exponentialRampToValueAtTime(100, now + 1.5);
      filter.Q.setValueAtTime(8, now);
      
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.3, now + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.analyser);
      
      osc.start(now);
      osc.stop(now + 1.8);
      
    } else if (method === "fm") {
      // FM Bell chime: Carrier modulated by high index modulator
      const carrier = this.ctx.createOscillator();
      const modulator = this.ctx.createOscillator();
      const modGain = this.ctx.createGain();
      const gain = this.ctx.createGain();
      
      carrier.frequency.setValueAtTime(440, now); // A4
      modulator.frequency.setValueAtTime(440 * 3.5, now); // 3.5 ratio (metallic)
      
      modGain.gain.setValueAtTime(1500, now);
      modGain.gain.exponentialRampToValueAtTime(1, now + 1.2);
      
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
      
      modulator.connect(modGain);
      modGain.connect(carrier.frequency); // FM modulation routing
      
      carrier.connect(gain);
      gain.connect(this.analyser);
      
      modulator.start(now);
      carrier.start(now);
      
      modulator.stop(now + 1.5);
      carrier.stop(now + 1.5);
      
    } else if (method === "physical") {
      // Physical Modeling (Plucked String via Karplus-Strong approximation)
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      
      // We will simulate a acoustic woodblock/marimba ping
      osc.type = "sine";
      osc.frequency.setValueAtTime(330, now); // E4
      
      // Rapid decay low-pass filter sweeps
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(4000, now);
      filter.frequency.exponentialRampToValueAtTime(120, now + 0.5);
      filter.Q.setValueAtTime(2, now);
      
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.analyser);
      
      osc.start(now);
      osc.stop(now + 0.7);
      
    } else if (method === "wavetable") {
      // Wavetable Sweep: Brighter octave stack sweeping triangles to sawtooths
      // with a sweeping filter to simulate scanning a wavetable containing increasing harmonics
      const osc1a = this.ctx.createOscillator();
      const osc1b = this.ctx.createOscillator();
      const osc2a = this.ctx.createOscillator();
      const osc2b = this.ctx.createOscillator();
      
      const gain1 = this.ctx.createGain();
      const gain2 = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      const master = this.ctx.createGain();
      
      const pitch = 220.00; // A3 (highly audible)
      
      // Part 1: Triangle morph base (smooth, low-harmonics)
      osc1a.type = "triangle";
      osc1a.frequency.setValueAtTime(pitch, now);
      osc1b.type = "triangle";
      osc1b.frequency.setValueAtTime(pitch * 2, now); // Octave up
      
      // Part 2: Sawtooth morph target (bright, high-harmonics)
      osc2a.type = "sawtooth";
      osc2a.frequency.setValueAtTime(pitch, now);
      osc2b.type = "sawtooth";
      osc2b.frequency.setValueAtTime(pitch * 2, now); // Octave up
      
      // Crossfade envelopes (Morphing from Tri to Saw)
      gain1.gain.setValueAtTime(0.2, now);
      gain1.gain.linearRampToValueAtTime(0.0, now + 1.4);
      
      gain2.gain.setValueAtTime(0.0, now);
      gain2.gain.linearRampToValueAtTime(0.2, now + 1.4);
      
      // Filter sweep to highlight the morphing timbre
      filter.type = "lowpass";
      filter.Q.setValueAtTime(4, now);
      filter.frequency.setValueAtTime(300, now);
      filter.frequency.exponentialRampToValueAtTime(3000, now + 0.8);
      filter.frequency.exponentialRampToValueAtTime(150, now + 1.5);
      
      // Master volume envelope
      master.gain.setValueAtTime(0.001, now);
      master.gain.linearRampToValueAtTime(0.35, now + 0.1);
      master.gain.exponentialRampToValueAtTime(0.001, now + 1.7);
      
      // Connections
      osc1a.connect(gain1);
      osc1b.connect(gain1);
      
      osc2a.connect(gain2);
      osc2b.connect(gain2);
      
      gain1.connect(filter);
      gain2.connect(filter);
      filter.connect(master);
      master.connect(this.analyser);
      
      osc1a.start(now);
      osc1b.start(now);
      osc2a.start(now);
      osc2b.start(now);
      
      osc1a.stop(now + 1.8);
      osc1b.stop(now + 1.8);
      osc2a.stop(now + 1.8);
      osc2b.stop(now + 1.8);
    }
  }

  /**
   * Starts a looping repeating sequence for Slide 2 diagram highlighting
   */
  startSlide2Loop(focusedModule) {
    if (!this.isInitialized) return;
    this.stopAllVoices();
    
    // Define the note playback logic
    const playNote = () => {
      const time = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      
      // Default configurations
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(130.81, time); // C3
      
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2000, time);
      filter.Q.setValueAtTime(1, time);
      
      gain.gain.setValueAtTime(0.001, time);
      
      let noteLength = 1.8;
      let oscStopOffset = 2.0;
      
      // Apply isolations based on what block the user is hovering on
      if (focusedModule === "vco") {
        // Raw oscillator, bypass filter shape
        filter.frequency.setValueAtTime(18000, time); // Wide open
        gain.gain.linearRampToValueAtTime(0.2, time + 0.05);
        gain.gain.setValueAtTime(0.2, time + noteLength);
        gain.gain.exponentialRampToValueAtTime(0.001, time + oscStopOffset);
      } else if (focusedModule === "vcf") {
        // Exaggerated filter sweep
        filter.frequency.setValueAtTime(300, time);
        filter.frequency.exponentialRampToValueAtTime(3000, time + 0.5);
        filter.frequency.exponentialRampToValueAtTime(150, time + noteLength);
        filter.Q.setValueAtTime(10, time); // Highly resonant
        
        gain.gain.linearRampToValueAtTime(0.2, time + 0.05);
        gain.gain.setValueAtTime(0.2, time + noteLength);
        gain.gain.exponentialRampToValueAtTime(0.001, time + oscStopOffset);
      } else if (focusedModule === "vca") {
        // Soft volume swell envelope
        gain.gain.linearRampToValueAtTime(0.3, time + 0.8);
        gain.gain.setValueAtTime(0.3, time + noteLength);
        gain.gain.exponentialRampToValueAtTime(0.001, time + oscStopOffset);
      } else if (focusedModule === "lfo") {
        // Evident pitch LFO modulation
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.frequency.setValueAtTime(4.0, time); // 4Hz LFO
        lfoGain.gain.setValueAtTime(40, time); // sweep range
        
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfo.start(time);
        lfo.stop(time + noteLength);
        
        gain.gain.linearRampToValueAtTime(0.2, time + 0.05);
        gain.gain.setValueAtTime(0.2, time + noteLength);
        gain.gain.exponentialRampToValueAtTime(0.001, time + oscStopOffset);
      } else if (focusedModule === "env") {
        // ADSR filter cutoff sweep
        filter.frequency.setValueAtTime(150, time);
        filter.frequency.linearRampToValueAtTime(2500, time + 0.4); // Attack: 0.4s
        filter.frequency.exponentialRampToValueAtTime(600, time + 0.8);   // Decay: 0.4s
        filter.frequency.setValueAtTime(600, time + 1.8);
        filter.frequency.exponentialRampToValueAtTime(150, time + 2.2);   // Release: 0.4s
        
        gain.gain.linearRampToValueAtTime(0.3, time + 0.4); // Attack: 0.4s
        gain.gain.exponentialRampToValueAtTime(0.12, time + 0.8); // Decay: 0.4s to sustain
        gain.gain.setValueAtTime(0.12, time + 1.8);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 2.2); // Release: 0.4s
        
        noteLength = 2.2;
        oscStopOffset = 2.3;
      } else {
        // Default clean synth note
        gain.gain.linearRampToValueAtTime(0.25, time + 0.05);
        gain.gain.setValueAtTime(0.25, time + noteLength);
        gain.gain.exponentialRampToValueAtTime(0.001, time + oscStopOffset);
      }
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.analyser);
      
      osc.start(time);
      osc.stop(time + oscStopOffset);
    };

    // Play once immediately, then schedule repeat interval
    playNote();
    this.s2LoopInterval = setInterval(playNote, 2500);
  }

  stopSlide2Loop() {
    if (this.s2LoopInterval) {
      clearInterval(this.s2LoopInterval);
      this.s2LoopInterval = null;
    }
  }

  /**
   * Continuous Noise Engine for Slide 6
   */
  playNoise() {
    if (!this.isInitialized) return;
    this.stopNoise();
    
    const now = this.ctx.currentTime;
    
    // Create two buffer sources
    this.whiteSource = this.ctx.createBufferSource();
    this.whiteSource.buffer = this.whiteNoiseBuffer;
    this.whiteSource.loop = true;
    
    this.pinkSource = this.ctx.createBufferSource();
    this.pinkSource.buffer = this.pinkNoiseBuffer;
    this.pinkSource.loop = true;
    
    // Gain nodes for mixing
    this.whiteGain = this.ctx.createGain();
    this.pinkGain = this.ctx.createGain();
    
    // Master noise volume control
    this.noiseGainNode = this.ctx.createGain();
    this.noiseGainNode.gain.setValueAtTime(0.001, now);
    this.noiseGainNode.gain.linearRampToValueAtTime(0.3, now + 0.1); // fade in
    
    // Route sources
    this.whiteSource.connect(this.whiteGain);
    this.pinkSource.connect(this.pinkGain);
    
    this.whiteGain.connect(this.noiseGainNode);
    this.pinkGain.connect(this.noiseGainNode);
    
    this.noiseGainNode.connect(this.analyser);
    
    // Set initial balance
    this.updateNoiseFade(this.noiseCrossfade);
    
    // Start sources
    this.whiteSource.start(now);
    this.pinkSource.start(now);
  }

  updateNoiseFade(value) {
    this.noiseCrossfade = value;
    if (!this.isInitialized || !this.whiteGain || !this.pinkGain) return;
    
    const now = this.ctx.currentTime;
    // Equal-power crossfade curve
    const whiteVol = Math.cos(value * Math.PI * 0.5);
    const pinkVol = Math.sin(value * Math.PI * 0.5);
    
    this.whiteGain.gain.setValueAtTime(whiteVol, now);
    this.pinkGain.gain.setValueAtTime(pinkVol, now);
  }

  updateModulationDepth(value) {
    this.modRouting.depth = value;
    if (!this.isInitialized) return;
    
    const now = this.ctx.currentTime;
    this.activeVoices.forEach((voice, frequency) => {
      if (voice.lfo) {
        if (voice.lfoPitchGain) {
          const lfoPitchDepth = value * 2400; // max 2400 cents detune (2 octaves)
          voice.lfoPitchGain.gain.cancelScheduledValues(now);
          voice.lfoPitchGain.gain.setValueAtTime(lfoPitchDepth, now);
        }
        if (voice.lfoFilterGain) {
          const lfoFilterDepth = value * 800;
          voice.lfoFilterGain.gain.cancelScheduledValues(now);
          voice.lfoFilterGain.gain.setValueAtTime(lfoFilterDepth, now);
        }
        if (voice.lfoVolGain) {
          const lfoVolDepth = value * 0.18;
          voice.lfoVolGain.gain.cancelScheduledValues(now);
          voice.lfoVolGain.gain.setValueAtTime(lfoVolDepth, now);
        }
      }
    });
  }

  updateS9FilterConfig(type, slope, cutoff) {
    const oldType = this.s9FilterType;
    const oldSlope = this.s9FilterSlope;
    
    this.s9FilterType = type;
    this.s9FilterSlope = slope;
    this.s9FilterCutoff = cutoff;
    
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    
    this.activeVoices.forEach((voice) => {
      if (voice.slideNum === 9) {
        // If type or slope changed, recreate filter chain
        if (type !== oldType || slope !== oldSlope) {
          // Disconnect old filters
          if (voice.filters) {
            voice.filters.forEach(f => {
              try { f.disconnect(); } catch (e) {}
            });
          }
          if (voice.oscillators && voice.oscillators[0]) {
            try { voice.oscillators[0].disconnect(); } catch (e) {}
          }
          
          // Recreate filters
          const filters = [];
          if (type === "lowpass") {
            if (slope === "1-pole") {
              const f = this.ctx.createBiquadFilter();
              f.type = "lowpass";
              f.frequency.setValueAtTime(cutoff, now);
              f.Q.setValueAtTime(0.35, now);
              filters.push(f);
            } else if (slope === "2-pole") {
              const f = this.ctx.createBiquadFilter();
              f.type = "lowpass";
              f.frequency.setValueAtTime(cutoff, now);
              f.Q.setValueAtTime(0.707, now);
              filters.push(f);
            } else if (slope === "4-pole") {
              const f1 = this.ctx.createBiquadFilter();
              f1.type = "lowpass";
              f1.frequency.setValueAtTime(cutoff, now);
              f1.Q.setValueAtTime(0.54, now);
              const f2 = this.ctx.createBiquadFilter();
              f2.type = "lowpass";
              f2.frequency.setValueAtTime(cutoff, now);
              f2.Q.setValueAtTime(0.54, now);
              filters.push(f1, f2);
            }
          } else if (type === "highpass") {
            const f = this.ctx.createBiquadFilter();
            f.type = "highpass";
            f.frequency.setValueAtTime(cutoff, now);
            f.Q.setValueAtTime(0.707, now);
            filters.push(f);
          } else if (type === "bandpass") {
            const f = this.ctx.createBiquadFilter();
            f.type = "bandpass";
            f.frequency.setValueAtTime(cutoff, now);
            f.Q.setValueAtTime(1.0, now);
            filters.push(f);
          }
          
          // Reconnect
          if (filters.length > 0) {
            if (voice.oscillators && voice.oscillators[0]) {
              voice.oscillators[0].connect(filters[0]);
            }
            for (let i = 0; i < filters.length - 1; i++) {
              filters[i].connect(filters[i+1]);
            }
            filters[filters.length - 1].connect(voice.gain);
            voice.filters = filters;
          } else {
            if (voice.oscillators && voice.oscillators[0]) {
              voice.oscillators[0].connect(voice.gain);
            }
            voice.filters = [];
          }
        } else {
          // Only cutoff frequency changed, update existing filters
          if (voice.filters) {
            voice.filters.forEach(f => {
              f.frequency.setValueAtTime(cutoff, now);
            });
          }
        }
      }
    });
  }

  updateLfoParams(rate, depth, wave, destination) {
    this.lfoParams.rate = rate;
    this.lfoParams.depth = depth;
    this.lfoParams.wave = wave;
    this.lfoParams.destination = destination;
    
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    
    this.activeVoices.forEach((voice, frequency) => {
      if (voice.slideNum === 11) {
        if (voice.lfo) {
          voice.lfo.frequency.setValueAtTime(rate, now);
          voice.lfo.type = wave;
        }
        
        const pitchTarget = (destination === "pitch") ? depth * 2400 : 0; // max 2400 cents detune (2 octaves)
        const filterTarget = (destination === "filter") ? depth * 800 : 0;
        const volumeTarget = (destination === "volume") ? depth * 0.18 : 0;
        
        if (voice.lfoPitchGain) {
          voice.lfoPitchGain.gain.cancelScheduledValues(now);
          voice.lfoPitchGain.gain.setValueAtTime(pitchTarget, now);
        }
        if (voice.lfoFilterGain) {
          voice.lfoFilterGain.gain.cancelScheduledValues(now);
          voice.lfoFilterGain.gain.setValueAtTime(filterTarget, now);
        }
        if (voice.lfoVolGain) {
          voice.lfoVolGain.gain.cancelScheduledValues(now);
          voice.lfoVolGain.gain.setValueAtTime(volumeTarget, now);
        }
        
        if (!voice.released) {
          const baseVol = (destination === "volume") ? 0.2 : 0.3;
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
          voice.gain.gain.linearRampToValueAtTime(baseVol, now + 0.02);
        }
      }
    });
  }

  updateADSREnvelope() {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    const S = this.adsr.sustain;
    
    this.activeVoices.forEach((voice, frequency) => {
      if (voice.released) return;
      
      if (voice.slideNum === 8) {
        if (this.s8EnvTarget === "vcf") {
          if (voice.filter) {
            voice.filter.frequency.cancelScheduledValues(now);
            voice.filter.frequency.setValueAtTime(voice.filter.frequency.value, now);
            voice.filter.frequency.linearRampToValueAtTime(300 + S * 4000, now + 0.05);
          }
        } else {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
          voice.gain.gain.linearRampToValueAtTime(S * 0.35 + 0.001, now + 0.05);
        }
      } else if (voice.slideNum === 12) {
        const vcaS = parseFloat(document.getElementById("slider-pg-vca-s").value);
        const vcfS = parseFloat(document.getElementById("slider-pg-vcf-s").value);
        const filterCutoff = parseFloat(document.getElementById("dial-pg-cutoff").dataset.value || 2000);
        const vcfEnvDepth = parseFloat(document.getElementById("dial-pg-vcf-env-depth").dataset.value || 0.5);
        
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
        voice.gain.gain.linearRampToValueAtTime(vcaS * 0.35 + 0.001, now + 0.05);
        
        if (voice.filter) {
          voice.filter.frequency.cancelScheduledValues(now);
          voice.filter.frequency.setValueAtTime(voice.filter.frequency.value, now);
          const targetSustain = Math.max(20, Math.min(18000, filterCutoff + vcfS * vcfEnvDepth * 10000));
          voice.filter.frequency.linearRampToValueAtTime(targetSustain, now + 0.05);
        }
      } else {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
        voice.gain.gain.linearRampToValueAtTime(S * 0.35 + 0.001, now + 0.05);
      }
    });
  }

  updatePgFilter(cutoff, resonance) {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    this.activeVoices.forEach((voice) => {
      if (voice.slideNum === 12 && voice.filter) {
        const vcfS = parseFloat(document.getElementById("slider-pg-vcf-s").value);
        const vcfEnvDepth = parseFloat(document.getElementById("dial-pg-vcf-env-depth").dataset.value || 0.5);
        voice.filter.Q.cancelScheduledValues(now);
        voice.filter.Q.setValueAtTime(resonance, now);
        
        voice.filter.frequency.cancelScheduledValues(now);
        voice.filter.frequency.setValueAtTime(voice.filter.frequency.value, now);
        
        const targetCutoff = voice.released ? cutoff : Math.max(20, Math.min(18000, cutoff + vcfS * vcfEnvDepth * 10000));
        voice.filter.frequency.linearRampToValueAtTime(targetCutoff, now + 0.05);
      }
    });
  }

  updatePgEnvDepth(envDepth) {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    this.activeVoices.forEach((voice) => {
      if (voice.slideNum === 12 && voice.filter && !voice.released) {
        const filterCutoff = parseFloat(document.getElementById("dial-pg-cutoff").dataset.value || 2000);
        const vcfS = parseFloat(document.getElementById("slider-pg-vcf-s").value);
        
        voice.filter.frequency.cancelScheduledValues(now);
        voice.filter.frequency.setValueAtTime(voice.filter.frequency.value, now);
        
        const targetSustain = Math.max(20, Math.min(18000, filterCutoff + vcfS * envDepth * 10000));
        voice.filter.frequency.linearRampToValueAtTime(targetSustain, now + 0.05);
      }
    });
  }

  updatePgLfo(rate, depth, wave, destination) {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    this.activeVoices.forEach((voice, frequency) => {
      if (voice.slideNum === 12) {
        if (voice.lfo) {
          voice.lfo.frequency.setValueAtTime(rate, now);
          voice.lfo.type = wave;
        }
        
        const filterCutoff = parseFloat(document.getElementById("dial-pg-cutoff").dataset.value || 2000);
        const pitchTarget = (destination === "pitch") ? depth * 2400 : 0;
        const filterTarget = (destination === "filter") ? depth * (filterCutoff * 0.85) : 0;
        const volumeTarget = (destination === "volume") ? depth * 0.3 : 0;
        
        if (voice.lfoPitchGain) {
          voice.lfoPitchGain.gain.cancelScheduledValues(now);
          voice.lfoPitchGain.gain.setValueAtTime(pitchTarget, now);
        }
        if (voice.lfoFilterGain) {
          voice.lfoFilterGain.gain.cancelScheduledValues(now);
          voice.lfoFilterGain.gain.setValueAtTime(filterTarget, now);
        }
        if (voice.lfoVolGain) {
          voice.lfoVolGain.gain.cancelScheduledValues(now);
          voice.lfoVolGain.gain.setValueAtTime(volumeTarget, now);
        }
      }
    });
  }

  updatePgPw(pw) {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    this.activeVoices.forEach((voice) => {
      if (voice.slideNum === 12 && voice.pwOffset) {
        voice.pwOffset.offset.setTargetAtTime(2 * pw - 1.0, now, 0.015);
      }
    });
  }

  updatePgNoiseMix(mix) {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    this.activeVoices.forEach((voice) => {
      if (voice.slideNum === 12 && voice.oscGain && voice.noiseGain) {
        const oscVol = Math.cos(mix * Math.PI * 0.5) * 0.35;
        const noiseVol = Math.sin(mix * Math.PI * 0.5) * 0.25;
        voice.oscGain.gain.cancelScheduledValues(now);
        voice.oscGain.gain.setValueAtTime(oscVol, now);
        voice.noiseGain.gain.cancelScheduledValues(now);
        voice.noiseGain.gain.setValueAtTime(noiseVol, now);
      }
    });
  }

  stopNoise() {
    const now = this.ctx.currentTime;
    if (this.noiseGainNode) {
      try {
        this.noiseGainNode.gain.setValueAtTime(this.noiseGainNode.gain.value, now);
        this.noiseGainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15); // click-free fade
        
        const wSrc = this.whiteSource;
        const pSrc = this.pinkSource;
        setTimeout(() => {
          try { wSrc.stop(); } catch(e) {}
          try { pSrc.stop(); } catch(e) {}
        }, 160);
      } catch(e) {}
      
      this.whiteSource = null;
      this.pinkSource = null;
      this.whiteGain = null;
      this.pinkGain = null;
      this.noiseGainNode = null;
    }
  }

  /**
   * Triggers a transient percussive hi-hat envelope using the active noise mix settings.
   */
  triggerNoiseEnvelope() {
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    
    // Create transient sources
    const whiteSrc = this.ctx.createBufferSource();
    whiteSrc.buffer = this.whiteNoiseBuffer;
    
    const pinkSrc = this.ctx.createBufferSource();
    pinkSrc.buffer = this.pinkNoiseBuffer;
    
    const whiteGain = this.ctx.createGain();
    const pinkGain = this.ctx.createGain();
    
    // Equal-power crossfade volumes based on current state
    const whiteVol = Math.cos(this.noiseCrossfade * Math.PI * 0.5);
    const pinkVol = Math.sin(this.noiseCrossfade * Math.PI * 0.5);
    whiteGain.gain.setValueAtTime(whiteVol, now);
    pinkGain.gain.setValueAtTime(pinkVol, now);
    
    // Transient envelope shaper
    const envGainNode = this.ctx.createGain();
    envGainNode.gain.setValueAtTime(0.001, now);
    envGainNode.gain.exponentialRampToValueAtTime(0.3, now + 0.005); // 5ms attack
    envGainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15); // 150ms decay to zero (hi-hat)
    
    // Route
    whiteSrc.connect(whiteGain);
    pinkSrc.connect(pinkGain);
    whiteGain.connect(envGainNode);
    pinkGain.connect(envGainNode);
    envGainNode.connect(this.analyser);
    
    // Start and auto-schedule stop
    whiteSrc.start(now);
    pinkSrc.start(now);
    whiteSrc.stop(now + 0.2);
    pinkSrc.stop(now + 0.2);
  }

  /**
   * Evaluates the student ADSR envelope settings against a percussive pluck target.
   */
  evaluateEnvelopeChallenge() {
    const targetA = 0.02; // Target percussive pluck attack velocity
    const targetD = 0.25; // Brief decay profile
    const targetS = 0.10; // Low sustain level
    const targetR = 0.20; // Short release
    
    const devA = Math.abs(this.adsr.attack - targetA);
    const devD = Math.abs(this.adsr.decay - targetD);
    const devS = Math.abs(this.adsr.sustain - targetS);
    const devR = Math.abs(this.adsr.release - targetR);
    
    const totalDeviation = devA + devD + devS + devR;
    
    // Pass threshold: total cumulative deviation < 0.35
    if (totalDeviation < 0.35) {
      return { 
        passed: true, 
        feedback: `Excellent ear! Total deviation is only ${(totalDeviation * 100).toFixed(0)}%. You successfully shaped a sharp transient pluck envelope!` 
      };
    } else {
      let advice = "Listen closely: ";
      if (this.adsr.attack > 0.15) {
        advice += "The pluck starts instantly—your Attack should be near the minimum. ";
      } else if (this.adsr.sustain > 0.3) {
        advice += "The sound decays to a very quiet level while held—your Sustain is too high. ";
      } else if (this.adsr.decay > 0.5) {
        advice += "The initial pluck volume drops down quickly—reduce your Decay time. ";
      } else {
        advice += "Try shortening your release time to match the quick tail.";
      }
      return { 
        passed: false, 
        feedback: advice + ` (Deviation: ${(totalDeviation * 100).toFixed(0)}%)`
      };
    }
  }

  /**
   * Plays the target envelope sound loop for the ADSR Listening Challenge
   */
  playTargetSound() {
    if (!this.isInitialized) return;
    
    const now = this.ctx.currentTime;
    
    // Pluck characteristics: sharp attack, fast decay, quiet sustain
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, now); // A3
    
    filter.type = "lowpass";
    // Modulate cutoff to make it pluckier
    filter.frequency.setValueAtTime(4000, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + 0.25);
    filter.Q.setValueAtTime(4, now);
    
    // Target volume ADSR: A=0.02s, D=0.25s, S=0.10, R=0.20s
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.02); // Sharp Attack
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.27); // Decay to Sustain (10% of peak = 0.04)
    
    // Hold sustain for a brief period, then release
    const holdTime = 0.5;
    gain.gain.setValueAtTime(0.04, now + holdTime);
    gain.gain.exponentialRampToValueAtTime(0.001, now + holdTime + 0.20); // Release
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.analyser);
    
    osc.start(now);
    osc.stop(now + holdTime + 0.3);
  }

  /**
   * Play Note (Keyboard Trigger)
   * Spawns a voice node structure based on the active slide number configuration
   */
  playNote(frequency, slideNum) {
    if (!this.isInitialized) return;
    
    // Stop note if it's already active to avoid overlap glitches
    if (this.activeVoices.has(frequency)) {
      this.releaseNote(frequency);
    }
    
    const now = this.ctx.currentTime;
    const voice = {
      frequency: frequency,
      oscillators: [],
      filter: null,
      gain: null,
      lfo: null,
      lfoGain: null,
      slideNum: slideNum
    };

    // VCA Gain envelope (standard volume control)
    voice.gain = this.ctx.createGain();
    voice.gain.gain.setValueAtTime(0.001, now); // starts silent

    // Route based on slide context
    if (slideNum === 3) {
      // Slide 3: Pure Sine Wave (VCO)
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, now);
      
      osc.connect(voice.gain);
      voice.oscillators.push(osc);
      
      // Simple gate envelope (instant trigger)
      voice.gain.gain.setValueAtTime(0.3, now);
      
    } else if (slideNum === 4) {
      // Slide 4: Additive synthesis mixing H1 to H8
      voice.harmGains = [];
      for (let i = 0; i < 8; i++) {
        const harmGain = this.s4Harmonics[i];
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        
        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency * (i + 1), now);
        oscGain.gain.setValueAtTime(harmGain * 0.25, now); // scale to prevent clipping
        
        osc.connect(oscGain);
        oscGain.connect(voice.gain);
        
        osc.start(now);
        voice.oscillators.push(osc);
        voice.harmGains.push(oscGain);
      }
      voice.gain.gain.setValueAtTime(0.3, now);
      
    } else if (slideNum === 5) {
      // Slide 5: Standard Waveform shapes (Pulse wave with WaveShaper)
      const osc = this.ctx.createOscillator();
      
      if (this.s5WaveType === "pulse") {
        // Variable pulse width requires WaveShaper loaded with a sawtooth input and DC offset
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(frequency, now);
        
        const shaper = this.ctx.createWaveShaper();
        if (!this.staticComparatorCurve) {
          this.staticComparatorCurve = this.makeStaticComparatorCurve();
        }
        shaper.curve = this.staticComparatorCurve;
        
        const pwOffset = this.ctx.createConstantSource();
        pwOffset.offset.setValueAtTime(2 * this.s5PulseWidth - 1.0, now);
        pwOffset.start(now);
        
        osc.connect(shaper);
        pwOffset.connect(shaper);
        shaper.connect(voice.gain);
        
        voice.shaper = shaper; // Store shaper node
        voice.pwOffset = pwOffset; // Store reference for dynamic updates!
      } else {
        // Standard saw/tri shapes
        osc.type = this.s5WaveType;
        osc.frequency.setValueAtTime(frequency, now);
        osc.connect(voice.gain);
      }
      
      osc.start(now);
      voice.oscillators.push(osc);
      voice.gain.gain.setValueAtTime(0.25, now);
      
    } else if (slideNum === 7) {
      // Slide 7: Patch Bay modulation note trigger
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(frequency, now);
      
      voice.filter = this.ctx.createBiquadFilter();
      voice.filter.type = "lowpass";
      voice.filter.frequency.setValueAtTime(1000, now);
      voice.filter.Q.setValueAtTime(4, now);
      
      osc.connect(voice.filter);
      voice.filter.connect(voice.gain);
      osc.start(now);
      voice.oscillators.push(osc);
      
      // ADSR configuration
      const A = this.adsr.attack;
      const D = this.adsr.decay;
      const S = this.adsr.sustain;
      const depth = this.modRouting.depth;
      
      // Volume modulation route
      const envModulatesVolume = this.modRouting.env.volume;
      const lfoModulatesVolume = this.modRouting.lfo.volume;

      if (envModulatesVolume) {
        voice.gain.gain.setValueAtTime(0.001, now);
        voice.gain.gain.linearRampToValueAtTime(0.35, now + A);
        voice.gain.gain.exponentialRampToValueAtTime(S * 0.35 + 0.001, now + A + D);
      } else if (lfoModulatesVolume) {
        voice.gain.gain.setValueAtTime(0.2, now); // flat base for LFO to modulate
      } else {
        // Flat standard volume gate
        voice.gain.gain.setValueAtTime(0.001, now);
        voice.gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
      }
      
      // LFO modulation connections
      const hasLfoMod = this.modRouting.lfo.pitch || this.modRouting.lfo.filter || this.modRouting.lfo.volume;
      if (hasLfoMod && depth > 0.001) {
        voice.lfo = this.ctx.createOscillator();
        voice.lfo.type = "sine";
        voice.lfo.frequency.setValueAtTime(3.0, now); // LFO rate 3Hz
        
        if (this.modRouting.lfo.pitch) {
          voice.lfoPitchGain = this.ctx.createGain();
          const lfoPitchDepth = depth * 2400; // max 2400 cents detune (2 octaves)
          voice.lfoPitchGain.gain.setValueAtTime(lfoPitchDepth, now);
          voice.lfo.connect(voice.lfoPitchGain);
          voice.lfoPitchGain.connect(osc.detune);
        }
        if (this.modRouting.lfo.filter) {
          voice.lfoFilterGain = this.ctx.createGain();
          const lfoFilterDepth = depth * 800; // max 800Hz filter sweep
          voice.lfoFilterGain.gain.setValueAtTime(lfoFilterDepth, now);
          voice.lfo.connect(voice.lfoFilterGain);
          voice.lfoFilterGain.connect(voice.filter.frequency);
        }
        if (this.modRouting.lfo.volume) {
          voice.lfoVolGain = this.ctx.createGain();
          const lfoVolDepth = depth * 0.18;
          voice.lfoVolGain.gain.setValueAtTime(lfoVolDepth, now);
          voice.lfo.connect(voice.lfoVolGain);
          voice.lfoVolGain.connect(voice.gain.gain);
        }
        voice.lfo.start(now);
      }
      
      // Envelope modulation connections
      if (depth > 0.001) {
        if (this.modRouting.env.pitch) {
          osc.frequency.setValueAtTime(frequency, now);
          osc.frequency.linearRampToValueAtTime(frequency + depth * 400, now + A);
          osc.frequency.exponentialRampToValueAtTime(frequency + (S * depth * 400) + 0.01, now + A + D);
        }
        if (this.modRouting.env.filter) {
          voice.filter.frequency.setValueAtTime(300, now);
          voice.filter.frequency.linearRampToValueAtTime(300 + depth * 4000, now + A);
          voice.filter.frequency.exponentialRampToValueAtTime(300 + (S * depth * 4000) + 0.01, now + A + D);
        }
      }
      
    } else if (slideNum === 8) {
      // Slide 8: Custom ADSR envelope (controlled by visual vector nodes)
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(frequency, now);
      
      const A = this.adsr.attack;
      const D = this.adsr.decay;
      const S = this.adsr.sustain;
      
      if (this.s8EnvTarget === "vcf") {
        voice.filter = this.ctx.createBiquadFilter();
        voice.filter.type = "lowpass";
        voice.filter.Q.setValueAtTime(4.0, now);
        
        osc.connect(voice.filter);
        voice.filter.connect(voice.gain);
        
        // Modulate Filter cutoff (VCF)
        voice.filter.frequency.setValueAtTime(300, now);
        voice.filter.frequency.linearRampToValueAtTime(300 + 4000, now + A);
        voice.filter.frequency.exponentialRampToValueAtTime(300 + (S * 4000) + 0.01, now + A + D);
        
        // VCA uses standard gate
        voice.gain.gain.setValueAtTime(0.001, now);
        voice.gain.gain.linearRampToValueAtTime(0.35, now + 0.01);
      } else {
        osc.connect(voice.gain);
        
        // Modulate Volume (VCA)
        voice.gain.gain.setValueAtTime(0.001, now);
        voice.gain.gain.linearRampToValueAtTime(0.35, now + A);
        voice.gain.gain.exponentialRampToValueAtTime(S * 0.35 + 0.001, now + A + D);
      }
      
      osc.start(now);
      voice.oscillators.push(osc);
      
    } else if (slideNum === 9) {
      // Slide 9: Filter Types & Slopes (No resonance)
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(frequency, now);
      
      const filters = [];
      const type = this.s9FilterType || "lowpass";
      const slope = this.s9FilterSlope || "2-pole";
      const cutoff = this.s9FilterCutoff || 1000;
      
      if (type === "lowpass") {
        if (slope === "1-pole") {
          const f = this.ctx.createBiquadFilter();
          f.type = "lowpass";
          f.frequency.setValueAtTime(cutoff, now);
          f.Q.setValueAtTime(0.35, now);
          filters.push(f);
        } else if (slope === "2-pole") {
          const f = this.ctx.createBiquadFilter();
          f.type = "lowpass";
          f.frequency.setValueAtTime(cutoff, now);
          f.Q.setValueAtTime(0.707, now);
          filters.push(f);
        } else if (slope === "4-pole") {
          const f1 = this.ctx.createBiquadFilter();
          f1.type = "lowpass";
          f1.frequency.setValueAtTime(cutoff, now);
          f1.Q.setValueAtTime(0.54, now);
          
          const f2 = this.ctx.createBiquadFilter();
          f2.type = "lowpass";
          f2.frequency.setValueAtTime(cutoff, now);
          f2.Q.setValueAtTime(0.54, now);
          
          filters.push(f1, f2);
        }
      } else if (type === "highpass") {
        const f = this.ctx.createBiquadFilter();
        f.type = "highpass";
        f.frequency.setValueAtTime(cutoff, now);
        f.Q.setValueAtTime(0.707, now);
        filters.push(f);
      } else if (type === "bandpass") {
        const f = this.ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.setValueAtTime(cutoff, now);
        f.Q.setValueAtTime(1.0, now);
        filters.push(f);
      }
      
      if (filters.length > 0) {
        osc.connect(filters[0]);
        for (let i = 0; i < filters.length - 1; i++) {
          filters[i].connect(filters[i+1]);
        }
        filters[filters.length - 1].connect(voice.gain);
        voice.filters = filters;
      } else {
        osc.connect(voice.gain);
      }
      
      osc.start(now);
      voice.oscillators.push(osc);
      voice.gain.gain.setValueAtTime(0.3, now);

    } else if (slideNum === 10) {
      // Slide 10: Filter Resonance XY Pad controls (Cutoff and Resonance)
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(frequency, now);
      
      voice.filter = this.ctx.createBiquadFilter();
      voice.filter.type = "lowpass";
      voice.filter.frequency.setValueAtTime(this.vcf.cutoff, now);
      voice.filter.Q.setValueAtTime(this.vcf.q, now);
      
      osc.connect(voice.filter);
      voice.filter.connect(voice.gain);
      
      osc.start(now);
      voice.oscillators.push(osc);
      voice.gain.gain.setValueAtTime(0.3, now);

    } else if (slideNum === 11) {
      // Slide 11: LFO speed/depth/destination showcase (was slide 10)
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(frequency, now);
      
      // Filter creation (Lowpass baseline)
      voice.filter = this.ctx.createBiquadFilter();
      voice.filter.type = "lowpass";
      voice.filter.Q.setValueAtTime(4.0, now);
      voice.filter.frequency.setValueAtTime(1200, now); // Baseline cutoff
      
      osc.connect(voice.filter);
      voice.filter.connect(voice.gain);
      
      // Modulate oscillator pitch, filter, and volume with LFO
      voice.lfo = this.ctx.createOscillator();
      voice.lfo.type = this.lfoParams.wave;
      voice.lfo.frequency.setValueAtTime(this.lfoParams.rate, now);
      
      // 1. Pitch modulation node
      voice.lfoPitchGain = this.ctx.createGain();
      const pitchTarget = (this.lfoParams.destination === "pitch") ? this.lfoParams.depth * 2400 : 0;
      voice.lfoPitchGain.gain.setValueAtTime(pitchTarget, now);
      voice.lfo.connect(voice.lfoPitchGain);
      voice.lfoPitchGain.connect(osc.detune);
      
      // 2. Filter modulation node
      voice.lfoFilterGain = this.ctx.createGain();
      const filterTarget = (this.lfoParams.destination === "filter") ? this.lfoParams.depth * 800 : 0;
      voice.lfoFilterGain.gain.setValueAtTime(filterTarget, now);
      voice.lfo.connect(voice.lfoFilterGain);
      voice.lfoFilterGain.connect(voice.filter.frequency);
      
      // 3. Volume modulation node
      voice.lfoVolGain = this.ctx.createGain();
      const volumeTarget = (this.lfoParams.destination === "volume") ? this.lfoParams.depth * 0.18 : 0;
      voice.lfoVolGain.gain.setValueAtTime(volumeTarget, now);
      voice.lfo.connect(voice.lfoVolGain);
      voice.lfoVolGain.connect(voice.gain.gain);
      
      const baseVol = (this.lfoParams.destination === "volume") ? 0.2 : 0.3;
      voice.gain.gain.setValueAtTime(baseVol, now);
      
      voice.lfo.start(now);
      osc.start(now);
      
      voice.oscillators.push(osc);

    } else if (slideNum === 12) {
      // Slide 11: Master Playground Mixer Console
      
      // Get parameter controls from overhauled buttons and dials
      const pgWave = document.querySelector("#btn-group-pg-wave .btn-wave-select.active").dataset.wave;
      const pgPW = parseFloat(document.getElementById("dial-pg-pw").dataset.value || 0.50);
      const noiseMixVal = parseFloat(document.getElementById("dial-pg-noise-mix").dataset.value || 0.0);
      const noiseColor = document.querySelector("#btn-group-pg-noise-color .btn-wave-select.active").dataset.noisecolor;
      
      const filterCutoff = parseFloat(document.getElementById("dial-pg-cutoff").dataset.value || 2000);
      const filterRes = parseFloat(document.getElementById("dial-pg-res").dataset.value || 1.0);
      const vcfEnvDepth = parseFloat(document.getElementById("dial-pg-vcf-env-depth").dataset.value || 0.5);
      
      const lfoWave = document.querySelector("#btn-group-pg-lfo-wave .btn-wave-select.active").dataset.lfowave;
      const lfoRate = parseFloat(document.getElementById("dial-pg-lfo-rate").dataset.value || 2.0);
      const lfoDepth = parseFloat(document.getElementById("dial-pg-lfo-depth").dataset.value || 0.0);
      const lfoDest = document.querySelector("#btn-group-pg-lfo-dest .btn-wave-select.active").dataset.lfodest;
      
      const rawVcaA = parseFloat(document.getElementById("slider-pg-vca-a").value);
      const rawVcaD = parseFloat(document.getElementById("slider-pg-vca-d").value);
      const vcaS = parseFloat(document.getElementById("slider-pg-vca-s").value);
      const vcaA = 0.005 + 1.995 * Math.pow(rawVcaA, 2);
      const vcaD = 0.005 + 1.995 * Math.pow(rawVcaD, 2);

      const rawVcfA = parseFloat(document.getElementById("slider-pg-vcf-a").value);
      const rawVcfD = parseFloat(document.getElementById("slider-pg-vcf-d").value);
      const vcfS = parseFloat(document.getElementById("slider-pg-vcf-s").value);
      const vcfA = 0.005 + 1.995 * Math.pow(rawVcfA, 2);
      const vcfD = 0.005 + 1.995 * Math.pow(rawVcfD, 2);

      // 1. Oscillator Core
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      
      if (pgWave === "pulse") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(frequency, now);
        
        const shaper = this.ctx.createWaveShaper();
        if (!this.staticComparatorCurve) {
          this.staticComparatorCurve = this.makeStaticComparatorCurve();
        }
        shaper.curve = this.staticComparatorCurve;
        
        const pwOffset = this.ctx.createConstantSource();
        pwOffset.offset.setValueAtTime(2 * pgPW - 1.0, now);
        pwOffset.start(now);
        
        osc.connect(shaper);
        pwOffset.connect(shaper);
        shaper.connect(oscGain);
        
        voice.shaper = shaper; // Store shaper reference
        voice.pwOffset = pwOffset; // Store reference
      } else {
        osc.type = pgWave;
        osc.frequency.setValueAtTime(frequency, now);
        osc.connect(oscGain);
      }
      
      // Store references on voice
      voice.oscGain = oscGain;
      
      // 2. Noise Source Mixing
      const noiseSrcNode = this.ctx.createBufferSource();
      noiseSrcNode.buffer = (noiseColor === "pink") ? this.pinkNoiseBuffer : this.whiteNoiseBuffer;
      noiseSrcNode.loop = true;
      
      const noiseGainNode = this.ctx.createGain();
      noiseSrcNode.connect(noiseGainNode);
      
      voice.noiseGain = noiseGainNode;
      
      // Set volumes based on noise mix dial
      const oscVol = Math.cos(noiseMixVal * Math.PI * 0.5) * 0.35;
      const noiseVol = Math.sin(noiseMixVal * Math.PI * 0.5) * 0.25;
      
      oscGain.gain.setValueAtTime(oscVol, now);
      noiseGainNode.gain.setValueAtTime(noiseVol, now);
      
      // Combine generator outputs
      const generatorSum = this.ctx.createGain();
      oscGain.connect(generatorSum);
      noiseGainNode.connect(generatorSum);
      
      osc.start(now);
      noiseSrcNode.start(now);
      
      voice.oscillators.push(osc);
      voice.oscillators.push(noiseSrcNode);
      
      // 3. VCF Lowpass Filter with ADSR modulation
      voice.filter = this.ctx.createBiquadFilter();
      voice.filter.type = "lowpass";
      voice.filter.Q.setValueAtTime(filterRes, now);
      
      // Apply VCF Cutoff ADSR
      voice.filter.frequency.setValueAtTime(filterCutoff, now);
      const targetPeak = Math.max(20, Math.min(18000, filterCutoff + vcfEnvDepth * 10000));
      const targetSustain = Math.max(20, Math.min(18000, filterCutoff + vcfS * vcfEnvDepth * 10000));
      voice.filter.frequency.linearRampToValueAtTime(targetPeak, now + vcfA);
      voice.filter.frequency.exponentialRampToValueAtTime(targetSustain + 0.01, now + vcfA + vcfD);
      
      generatorSum.connect(voice.filter);
      voice.filter.connect(voice.gain);
      
      // 4. LFO Modulation routing (3-gain node architecture)
      voice.lfo = this.ctx.createOscillator();
      voice.lfo.type = lfoWave;
      voice.lfo.frequency.setValueAtTime(lfoRate, now);

      // Pitch modulation path
      voice.lfoPitchGain = this.ctx.createGain();
      const pitchTarget = (lfoDest === "pitch") ? lfoDepth * 2400 : 0; // max 2400 cents detune (2 octaves)
      voice.lfoPitchGain.gain.setValueAtTime(pitchTarget, now);
      voice.lfo.connect(voice.lfoPitchGain);
      voice.lfoPitchGain.connect(osc.detune);
      
      // Filter modulation path
      voice.lfoFilterGain = this.ctx.createGain();
      const filterTarget = (lfoDest === "filter") ? lfoDepth * (filterCutoff * 0.85) : 0;
      voice.lfoFilterGain.gain.setValueAtTime(filterTarget, now);
      voice.lfo.connect(voice.lfoFilterGain);
      voice.lfoFilterGain.connect(voice.filter.frequency);
      
      // Volume modulation path
      voice.lfoVolGain = this.ctx.createGain();
      const volumeTarget = (lfoDest === "volume") ? lfoDepth * 0.3 : 0;
      voice.lfoVolGain.gain.setValueAtTime(volumeTarget, now);
      voice.lfo.connect(voice.lfoVolGain);
      voice.lfoVolGain.connect(voice.gain.gain);
      
      voice.lfo.start(now);
      
      // 5. Volume ADSR Envelope Trigger
      voice.gain.gain.setValueAtTime(0.001, now);
      voice.gain.gain.linearRampToValueAtTime(0.35, now + vcaA);
      voice.gain.gain.exponentialRampToValueAtTime(vcaS * 0.35 + 0.001, now + vcaA + vcaD);
    }
    
    // Routing final output
    voice.gain.connect(this.analyser);
    
    // Start active primary oscillator (if not started above)
    if (slideNum !== 4 && slideNum !== 11) {
      voice.oscillators.forEach(osc => {
        try { osc.start(now); } catch(e) {}
      });
    }
    
    this.activeVoices.set(frequency, voice);
  }

  /**
   * Release Note (Keyboard Release)
   * Applies the release envelope stage before stopping and destroying the oscillators
   */
  releaseNote(frequency) {
    if (!this.isInitialized) return;
    
    const voice = this.activeVoices.get(frequency);
    if (!voice) return;
    
    voice.released = true;
    const now = this.ctx.currentTime;
    
    // Get release duration based on active panel sliders
    let R = this.adsr.release;
    
    if (voice.slideNum === 12) {
      const rawVcaR = parseFloat(document.getElementById("slider-pg-vca-r").value);
      const vcaR = 0.005 + 2.995 * Math.pow(rawVcaR, 2);
      R = vcaR; // Use VCA release for voice duration timeout
      
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.exponentialRampToValueAtTime(0.001, now + vcaR);
      
      if (voice.filter) {
        const rawVcfR = parseFloat(document.getElementById("slider-pg-vcf-r").value);
        const vcfR = 0.005 + 2.995 * Math.pow(rawVcfR, 2);
        const filterCutoff = parseFloat(document.getElementById("dial-pg-cutoff").dataset.value || 2000);
        
        voice.filter.frequency.cancelScheduledValues(now);
        voice.filter.frequency.setValueAtTime(voice.filter.frequency.value, now);
        voice.filter.frequency.exponentialRampToValueAtTime(filterCutoff, now + vcfR);
      }
    } else {
      // Linear / Exponential release to zero
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.exponentialRampToValueAtTime(0.001, now + R);
      
      // Slide 7 / Slide 8: Sweep parameters back to baseline on release
      if (voice.filter) {
        if (voice.slideNum === 8 && this.s8EnvTarget === "vcf") {
          voice.filter.frequency.cancelScheduledValues(now);
          voice.filter.frequency.setValueAtTime(voice.filter.frequency.value, now);
          voice.filter.frequency.exponentialRampToValueAtTime(300, now + R);
        } else if (this.modRouting.env.filter) {
          voice.filter.frequency.cancelScheduledValues(now);
          voice.filter.frequency.setValueAtTime(voice.filter.frequency.value, now);
          voice.filter.frequency.exponentialRampToValueAtTime(1000, now + R);
        }
      }
    }
    
    if (this.modRouting.env.pitch) {
      voice.oscillators.forEach(osc => {
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(osc.frequency.value, now);
        osc.frequency.exponentialRampToValueAtTime(frequency, now + R);
      });
    }
    
    // Clean up nodes after release completes
    const oscList = voice.oscillators;
    const lfoNode = voice.lfo;
    const voiceGain = voice.gain;
    const harmGains = voice.harmGains;
    
    setTimeout(() => {
      oscList.forEach(osc => {
        try { osc.stop(); } catch(e) {}
        try { osc.disconnect(); } catch(e) {}
      });
      if (harmGains) {
        harmGains.forEach(g => {
          try { g.disconnect(); } catch(e) {}
        });
      }
      if (lfoNode) {
        try { lfoNode.stop(); } catch(e) {}
        try { lfoNode.disconnect(); } catch(e) {}
      }
      if (voice.lfoGain) {
        try { voice.lfoGain.disconnect(); } catch(e) {}
      }
      if (voice.lfoPitchGain) {
        try { voice.lfoPitchGain.disconnect(); } catch(e) {}
      }
      if (voice.lfoFilterGain) {
        try { voice.lfoFilterGain.disconnect(); } catch(e) {}
      }
      if (voice.lfoVolGain) {
        try { voice.lfoVolGain.disconnect(); } catch(e) {}
      }
      if (voice.filter) {
        try { voice.filter.disconnect(); } catch(e) {}
      }
      if (voice.filters) {
        voice.filters.forEach(f => {
          try { f.disconnect(); } catch(e) {}
        });
      }
      if (voice.pwOffset) {
        try { voice.pwOffset.stop(); } catch(e) {}
        try { voice.pwOffset.disconnect(); } catch(e) {}
      }
      if (voice.shaper) {
        try { voice.shaper.disconnect(); } catch(e) {}
      }
      try { voiceGain.disconnect(); } catch(e) {}
    }, (R * 1000) + 100);
    
    this.activeVoices.delete(frequency);
  }

  /**
   * Immediately stops all running voices and sound sources (used for slide transitions)
   */
  stopAllVoices() {
    this.stopSlide2Loop();
    this.stopNoise();
    
    if (!this.isInitialized) return;
    
    const now = this.ctx.currentTime;
    
    this.activeVoices.forEach((voice, freq) => {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(0.001, now);
      
      voice.oscillators.forEach(osc => {
        try { osc.stop(); } catch(e) {}
        try { osc.disconnect(); } catch(e) {}
      });
      
      if (voice.lfo) {
        try { voice.lfo.stop(); } catch(e) {}
        try { voice.lfo.disconnect(); } catch(e) {}
      }
      if (voice.pwOffset) {
        try { voice.pwOffset.stop(); } catch(e) {}
        try { voice.pwOffset.disconnect(); } catch(e) {}
      }
      if (voice.shaper) {
        try { voice.shaper.disconnect(); } catch(e) {}
      }
      if (voice.filter) {
        try { voice.filter.disconnect(); } catch(e) {}
      }
      if (voice.filters) {
        voice.filters.forEach(f => {
          try { f.disconnect(); } catch(e) {}
        });
      }
      try { voice.gain.disconnect(); } catch(e) {}
    });
    
    this.activeVoices.clear();
  }

  /**
   * Updates the volume of a specific harmonic in real-time for all active additive voices.
   */
  setHarmonicGain(index, value) {
    this.s4Harmonics[index] = value;
    if (!this.isInitialized) return;
    
    const now = this.ctx.currentTime;
    this.activeVoices.forEach(voice => {
      if (voice.harmGains && voice.harmGains[index]) {
        voice.harmGains[index].gain.setTargetAtTime(value * 0.25, now, 0.02);
      }
    });
  }

  /**
   * Updates all harmonics in real-time for active voices (preset selection)
   */
  updateAllHarmonics(gains) {
    for (let i = 0; i < 8; i++) {
      if (gains[i] !== undefined) {
        this.s4Harmonics[i] = gains[i];
      }
    }
    if (!this.isInitialized) return;
    
    const now = this.ctx.currentTime;
    this.activeVoices.forEach(voice => {
      if (voice.harmGains) {
        for (let i = 0; i < 8; i++) {
          if (voice.harmGains[i] && gains[i] !== undefined) {
            voice.harmGains[i].gain.setTargetAtTime(gains[i] * 0.25, now, 0.02);
          }
        }
      }
    });
  }

  /**
   * Updates the pulse width value in real-time for all active pulse-wave oscillators.
   */
  setPulseWidth(width) {
    this.s5PulseWidth = width;
    if (!this.isInitialized) return;
    
    const now = this.ctx.currentTime;
    this.activeVoices.forEach(voice => {
      if (voice.pwOffset) {
        voice.pwOffset.offset.setTargetAtTime(2 * width - 1.0, now, 0.015);
      }
    });
  }
}

/* ==========================================================================
   SynthDeck Visualizer Engine (visualizer.js)
   Hardware-accelerated, High-DPI Canvas Rendering
   ========================================================================== */

class Visualizer {
  constructor(canvas) {
    if (!canvas) throw new Error("Visualizer requires a valid canvas element.");
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.animationId = null;
    this.isPlaying = false;
    
    // Bind resize handler
    this.resize = this.resize.bind(this);
    window.addEventListener("resize", this.resize);
    
    // Initial size setup
    this.resize();
  }

  /**
   * Recalculates canvas dimensions to match CSS layout, scaled by devicePixelRatio
   * to ensure crisp, razor-sharp vector graphics on Retina and high-DPI displays.
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Only resize if display size actually changed (prevents loops)
    const displayWidth = Math.floor(rect.width) || 300;
    const displayHeight = Math.floor(rect.height) || 150;
    
    if (this.canvas.width !== displayWidth * dpr || this.canvas.height !== displayHeight * dpr) {
      this.canvas.width = displayWidth * dpr;
      this.canvas.height = displayHeight * dpr;
      
      // Scale context to draw in CSS pixels
      this.ctx.resetTransform();
      this.ctx.scale(dpr, dpr);
    }
    
    this.width = displayWidth;
    this.height = displayHeight;
  }

  /**
   * Clears the canvas with a sleek deep space background and grid lines.
   */
  clear() {
    const ctx = this.ctx;
    const style = getComputedStyle(this.canvas);
    const bg = style.getPropertyValue("--canvas-bg").trim() || "#08090d";
    const grid = style.getPropertyValue("--canvas-grid").trim() || "rgba(102, 252, 241, 0.04)";
    
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, this.height);
    
    // Draw subtle grid lines
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    
    // Vertical grid lines
    const gridSpacing = 40;
    for (let x = 0; x < this.width; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    
    // Horizontal grid lines
    for (let y = 0; y < this.height; y += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
  }

  /**
   * Stops the active rendering loop and cancels the animation frame request.
   */
  stop() {
    this.isPlaying = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.clear();
  }

  /**
   * Starts a real-time Time-Domain Oscilloscope visualizer loop.
   * Uses a zero-crossing trigger algorithm to stabilize the waveform.
   * @param {AnalyserNode} analyser - Web Audio API AnalyserNode
   */
  startOscilloscope(analyser) {
    this.stop();
    this.isPlaying = true;
    
    // Set typical analyser properties for oscilloscope
    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
      if (!this.isPlaying) return;
      this.animationId = requestAnimationFrame(draw);
      
      analyser.getByteTimeDomainData(dataArray);
      this.clear();
      
      const ctx = this.ctx;
      const style = getComputedStyle(this.canvas);
      const traceColor = style.getPropertyValue("--canvas-trace").trim() || "#66fcf1";
      const glowColor = style.getPropertyValue("--canvas-trace-glow").trim() || "rgba(102, 252, 241, 0.8)";
      
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = traceColor;
      
      if (glowColor !== "none" && glowColor !== "") {
        ctx.shadowBlur = 8;
        ctx.shadowColor = glowColor;
      } else {
        ctx.shadowBlur = 0;
      }
      
      ctx.beginPath();
      
      // Zero-Crossing Trigger: Find the point in the buffer where the wave crosses
      // the zero point (value 128) in an upward direction, stabilizing the waveform.
      let triggerIndex = 0;
      const threshold = 128;
      for (let i = 0; i < bufferLength / 2; i++) {
        if (dataArray[i] < threshold && dataArray[i + 1] >= threshold) {
          triggerIndex = i;
          break;
        }
      }
      
      // If no trigger point is found, default to index 0
      const sliceWidth = this.width / (bufferLength / 2);
      let x = 0;
      
      for (let i = triggerIndex; i < triggerIndex + (bufferLength / 2); i++) {
        const v = dataArray[i] / 128.0; // 0.0 to 2.0
        const y = (v * this.height) / 2;
        
        if (i === triggerIndex) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        
        x += sliceWidth;
      }
      
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow blur
    };
    
    draw();
  }

  /**
   * Starts a real-time Frequency-Domain FFT Spectrum Analyzer loop.
   * @param {AnalyserNode} analyser - Web Audio API AnalyserNode
   */
  startFFT(analyser) {
    this.stop();
    this.isPlaying = true;
    
    analyser.fftSize = 1024; // Higher resolution for crisp low-end bins
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const sampleRate = analyser.context.sampleRate;
    
    // Logarithmic bounds of interest (covers the full synth range)
    const fMin = 40;
    const fMax = 12000;
    const labels = [100, 200, 500, 1000, 2000, 5000, 10000];
    
    const draw = () => {
      if (!this.isPlaying) return;
      this.animationId = requestAnimationFrame(draw);
      
      analyser.getByteFrequencyData(dataArray);
      
      const ctx = this.ctx;
      const style = getComputedStyle(this.canvas);
      const bg = style.getPropertyValue("--canvas-bg").trim() || "#08090d";
      const grid = style.getPropertyValue("--canvas-grid").trim() || "rgba(69, 243, 255, 0.08)";
      const textColor = style.getPropertyValue("--canvas-text").trim() || "#64748b";
      const trace1 = style.getPropertyValue("--canvas-trace").trim() || "#66fcf1";
      const trace2 = style.getPropertyValue("--canvas-trace-2").trim() || "#d946ef";
      
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, this.width, this.height);
      
      // 1. Draw Logarithmic Grid Lines & Labels first
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.fillStyle = textColor;
      ctx.font = "9px 'Share Tech Mono', monospace";
      ctx.textAlign = "center";
      
      labels.forEach(freq => {
        // Calculate X coordinate on logarithmic scale
        const ratioX = (Math.log10(freq) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin));
        const x = ratioX * this.width;
        
        // Dotted grid line
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.height - 18);
        ctx.stroke();
        
        // Text label
        ctx.setLineDash([]);
        const text = freq >= 1000 ? (freq / 1000) + "kHz" : freq + "Hz";
        ctx.fillText(text, x, this.height - 4);
      });
      
      // Subtle baseline border
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(0, this.height - 18);
      ctx.lineTo(this.width, this.height - 18);
      ctx.stroke();
      
      // 2. Draw Spectrum Bars
      const numBars = 100; // Number of logarithmic frequency steps
      const barWidth = this.width / numBars;
      
      // Gradient for bars
      const gradient = ctx.createLinearGradient(0, this.height - 18, 0, 0);
      gradient.addColorStop(0, trace1);
      gradient.addColorStop(1, trace2);
      
      ctx.fillStyle = gradient;
      
      for (let i = 0; i < numBars; i++) {
        // Calculate frequency at this bar step
        const ratio = i / (numBars - 1);
        const freq = fMin * Math.pow(fMax / fMin, ratio);
        
        // Map frequency to FFT array bin index
        const binIndex = Math.min(bufferLength - 1, Math.round((freq * analyser.fftSize) / sampleRate));
        const value = dataArray[binIndex];
        
        // Calculate height (clamped, leaving room for labels at bottom)
        const maxBarH = this.height - 18;
        const barHeight = (value / 255) * maxBarH;
        
        if (barHeight > 0.5) {
          const x = i * barWidth;
          const y = maxBarH - barHeight;
          
          // Draw logarithmic spectrum bar
          ctx.fillRect(x, y, barWidth - 1, barHeight);
        }
      }
    };
    
    draw();
  }

  /**
   * Destroys event listeners and cancels active animations to prevent memory leaks.
   */
  destroy() {
    this.stop();
    window.removeEventListener("resize", this.resize);
  }
}

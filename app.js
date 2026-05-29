/* ==========================================================================
   SynthDeck Application Controller (app.js)
   SPA Router, Interactive Widgets, and Interface Bindings
   ========================================================================== */

// Instantiate global engines
const synth = new AudioEngine();
let activeVisualizer = null;
let activeVisualizer2 = null;

// Global App State
const state = {
  currentSlide: 0,
  totalSlides: 12,
  
  octaveOffset: 0, // Octave offset: -2 to +2
  
  // Note mapping tracking
  pressedKeys: new Map(), // tracks key code/source -> active playing frequency
  
  // Slide 1 Canvas
  s1AnimationId: null,
  s1ActiveMethod: "subtractive",
  
  // Slide 7 Patch Bay
  draggingCable: null, // { sourceId, svgPath }
  activeConnections: new Map(), // destinationJackId -> sourceJackId
  
  // Slide 8 ADSR Canvas Editor
  adsrNodes: [
    { id: "attack", x: 60, y: 15, label: "A" }, // Peak (Attack time)
    { id: "sustain", x: 160, y: 80, label: "D/S" }, // Sustain start (Decay time + Sustain level)
    { id: "release", x: 260, y: 135, label: "R" }  // Release end (Release time)
  ],
  draggingAdsrNode: null,
  
  // Slide 10 Filter Pad (previously Slide 9)
  filterPadDragging: false,
  s10CanvasId: null,
  
  // Slide 11 LFO (previously Slide 10)
  s11AnimationId: null,

  // Arpeggiator (Slide 12)
  arpEnabled: false,
  arpPattern: [],
  arpMode: "up",
  arpTempo: 120,
  arpTimer: null,
  arpStepIndex: 0
};

// Musical note frequencies mapping
const NOTE_MAP = {
  // White keys
  "KeyA": { note: "C4", freq: 261.63 }, // Middle C
  "KeyS": { note: "D4", freq: 293.66 },
  "KeyD": { note: "E4", freq: 329.63 },
  "KeyF": { note: "F4", freq: 349.23 },
  "KeyG": { note: "G4", freq: 392.00 },
  "KeyH": { note: "A4", freq: 440.00 },
  "KeyJ": { note: "B4", freq: 493.88 },
  "KeyK": { note: "C5", freq: 523.25 }, // High C
  
  // Black keys
  "KeyW": { note: "C#4", freq: 277.18 },
  "KeyE": { note: "D#4", freq: 311.13 },
  "KeyT": { note: "F#4", freq: 369.99 },
  "KeyY": { note: "G#4", freq: 415.30 },
  "KeyU": { note: "A#4", freq: 466.16 }
};

// Initialize App on DOM Content Loaded
document.addEventListener("DOMContentLoaded", () => {
  generateSpiralSpine();
  renderAllKeybeds();
  setupNavigation();
  setupAudioActivation();
  setupInteractiveDials(); // Set up interactive dial knobs
  
  // Initialize the first slide view
  updateActiveSlideDOM(0);
  initializeSlide(0);
});

/* ==========================================================================
   1. Shell Setup & Spiral Spine Generator
   ========================================================================== */

function generateSpiralSpine() {
  const spine = document.getElementById("spiral-spine");
  spine.innerHTML = "";
  
  // Dynamically generate notebook binding rings based on screen height
  const ringCount = 20;
  for (let i = 0; i < ringCount; i++) {
    const ring = document.createElement("div");
    ring.className = "spiral-ring";
    spine.appendChild(ring);
  }
}

function setupAudioActivation() {
  const overlay = document.getElementById("audio-activator-overlay");
  const btn = document.getElementById("btn-activate-audio");
  
  btn.addEventListener("click", async () => {
    // Unlock Audio Context
    await synth.init();
    
    // Hide overlay
    overlay.classList.add("hidden");
    
    // Auto-trigger the first synthesis example on load
    synth.triggerSlide1Demo("subtractive");
  });
}

/* ==========================================================================
   2. Keyboard Note-Mapping & Keybed Layer
   ========================================================================== */

function renderAllKeybeds() {
  const keybedIds = ["keybed-s3", "keybed-s4", "keybed-s5", "keybed-s8", "keybed-s9", "keybed-s10", "keybed-s11", "keybed-s12"];
  keybedIds.forEach(id => {
    const container = document.getElementById(id);
    if (container) {
      renderKeybed(container);
    }
  });
  updateOctaveDisplays();
  updatePianoKeyLabels();
}

function renderOctaveControls(container) {
  const parent = container.parentNode;
  let controls = parent.querySelector(".octave-controls-bar");
  if (!controls) {
    controls = document.createElement("div");
    controls.className = "octave-controls-bar";
    parent.insertBefore(controls, container);
    
    controls.innerHTML = `
      <button class="btn-octave btn-oct-down" title="Shift Octave Down (Z)">◀ Octave Down (Z)</button>
      <span class="lbl-octave-display">OCTAVE: 4 (C4 - C5)</span>
      <button class="btn-octave btn-oct-up" title="Shift Octave Up (X)">Octave Up (X) ▶</button>
    `;
    
    const btnDown = controls.querySelector(".btn-oct-down");
    const btnUp = controls.querySelector(".btn-oct-up");
    
    btnDown.addEventListener("click", () => {
      setOctave(state.octaveOffset - 1);
    });
    btnUp.addEventListener("click", () => {
      setOctave(state.octaveOffset + 1);
    });
  }
}

function setOctave(newOffset) {
  state.octaveOffset = Math.max(-2, Math.min(2, newOffset));
  updateOctaveDisplays();
  updatePianoKeyLabels();
}

function updateOctaveDisplays() {
  const currentOctaveNum = 4 + state.octaveOffset;
  const readouts = document.querySelectorAll(".lbl-octave-display");
  readouts.forEach(lbl => {
    lbl.textContent = `OCTAVE: ${currentOctaveNum} (C${currentOctaveNum} - C${currentOctaveNum + 1})`;
  });
}

function updatePianoKeyLabels() {
  const currentOctaveNum = 4 + state.octaveOffset;
  const keybeds = ["keybed-s3", "keybed-s4", "keybed-s5", "keybed-s8", "keybed-s9", "keybed-s10", "keybed-s11", "keybed-s12"];
  
  keybeds.forEach(id => {
    const container = document.getElementById(id);
    if (!container) return;
    
    const whiteKeys = container.querySelectorAll(".key-white");
    const whiteNotes = ["C", "D", "E", "F", "G", "A", "B", "C"];
    whiteKeys.forEach((key, idx) => {
      const noteLetter = whiteNotes[idx];
      const octave = (noteLetter === "C" && idx === 7) ? currentOctaveNum + 1 : currentOctaveNum;
      
      const keyNoteSpan = key.querySelector(".key-note");
      if (keyNoteSpan) {
        keyNoteSpan.textContent = `${noteLetter}${octave}`;
      }
      
      const basePitch = parseFloat(key.dataset.basePitch);
      if (basePitch) {
        key.dataset.pitch = basePitch * Math.pow(2, state.octaveOffset);
        key.dataset.note = `${noteLetter}${octave}`;
      }
    });
    
    const blackKeys = container.querySelectorAll(".key-black");
    const blackNotes = ["C#", "D#", "F#", "G#", "A#"];
    blackKeys.forEach((key, idx) => {
      const noteLetter = blackNotes[idx];
      const octave = currentOctaveNum;
      
      const basePitch = parseFloat(key.dataset.basePitch);
      if (basePitch) {
        key.dataset.pitch = basePitch * Math.pow(2, state.octaveOffset);
        key.dataset.note = `${noteLetter}${octave}`;
      }
    });
  });
}

function renderKeybed(container) {
  renderOctaveControls(container);
  container.innerHTML = "";
  
  // White keys notes
  const whiteKeys = [
    { note: "C4", pitch: 261.63, key: "A" },
    { note: "D4", pitch: 293.66, key: "S" },
    { note: "E4", pitch: 329.63, key: "D" },
    { note: "F4", pitch: 349.23, key: "F" },
    { note: "G4", pitch: 392.00, key: "G" },
    { note: "A4", pitch: 440.00, key: "H" },
    { note: "B4", pitch: 493.88, key: "J" },
    { note: "C5", pitch: 523.25, key: "K" }
  ];
  
  // Black keys mapping to relative offsets
  const blackKeys = [
    { note: "C#4", pitch: 277.18, left: 7.8, key: "W" },
    { note: "D#4", pitch: 311.13, left: 20.3, key: "E" },
    { note: "F#4", pitch: 369.99, left: 45.3, key: "T" },
    { note: "G#4", pitch: 415.30, left: 57.8, key: "Y" },
    { note: "A#4", pitch: 466.16, left: 70.3, key: "U" }
  ];
  
  // Render White Keys
  whiteKeys.forEach((keyData, idx) => {
    const key = document.createElement("div");
    key.className = "key-white";
    key.dataset.index = idx;
    key.dataset.note = keyData.note;
    key.dataset.basePitch = keyData.pitch;
    key.dataset.pitch = keyData.pitch * Math.pow(2, state.octaveOffset);
    
    key.innerHTML = `
      <div class="key-label">
        <span class="key-char">${keyData.key}</span>
        <span class="key-note">${keyData.note}</span>
      </div>
    `;
    
    bindKeyTouchEvents(key, keyData.pitch);
    container.appendChild(key);
  });
  
  // Render Black Keys
  blackKeys.forEach(keyData => {
    const key = document.createElement("div");
    key.className = "key-black";
    key.style.left = `${keyData.left}%`;
    key.dataset.note = keyData.note;
    key.dataset.basePitch = keyData.pitch;
    key.dataset.pitch = keyData.pitch * Math.pow(2, state.octaveOffset);
    
    key.innerHTML = `
      <div class="key-label" style="color: #fff; margin-top: auto; font-size: 0.65rem;">
        <span class="key-char">${keyData.key}</span>
      </div>
    `;
    
    bindKeyTouchEvents(key, keyData.pitch);
    container.appendChild(key);
  });
}

function bindKeyTouchEvents(keyElement, basePitch) {
  // Mouse down trigger
  keyElement.addEventListener("mousedown", (e) => {
    e.preventDefault();
    triggerNoteOn(basePitch, keyElement);
  });
  
  // Mouse up trigger
  keyElement.addEventListener("mouseup", () => {
    triggerNoteOff(keyElement);
  });

  keyElement.addEventListener("mouseleave", () => {
    triggerNoteOff(keyElement);
  });
  
  // Touch triggers
  keyElement.addEventListener("touchstart", (e) => {
    e.preventDefault();
    triggerNoteOn(basePitch, keyElement);
  });
  
  keyElement.addEventListener("touchend", () => {
    triggerNoteOff(keyElement);
  });
}

function triggerNoteOn(basePitch, sourceId) {
  if (state.pressedKeys.has(sourceId)) return; // Prevents repeat spam
  
  const activePitch = basePitch * Math.pow(2, state.octaveOffset);
  state.pressedKeys.set(sourceId, activePitch);
  
  // Synthesizer hooks based on slide index
  const slideNum = state.currentSlide + 1;
  
  if (slideNum === 12 && state.arpEnabled) {
    // Record note into pattern
    state.arpPattern.push(activePitch);
    updateArpPatternUI();
    
    // Highlight UI piano key visual status across all keybeds using data-base-pitch
    document.querySelectorAll(`[data-base-pitch="${basePitch}"]`).forEach(el => {
      el.classList.add("active");
    });
    return;
  }
  
  synth.playNote(activePitch, slideNum);
  
  if (state.currentSlide === 6) {
    state.s7NoteStartTime = Date.now();
    state.s7NoteReleasedTime = null;
  } else if (state.currentSlide === 7) {
    state.s8NoteStartTime = Date.now();
    state.s8NoteReleasedTime = null;
  }
  
  // Highlight UI piano key visual status across all keybeds using data-base-pitch
  document.querySelectorAll(`[data-base-pitch="${basePitch}"]`).forEach(el => {
    el.classList.add("active");
  });
}

function triggerNoteOff(sourceId) {
  if (!state.pressedKeys.has(sourceId)) return;
  const activePitch = state.pressedKeys.get(sourceId);
  state.pressedKeys.delete(sourceId);
  
  const slideNum = state.currentSlide + 1;
  if (!(slideNum === 12 && state.arpEnabled)) {
    synth.releaseNote(activePitch);
  }
  
  if (state.currentSlide === 6) {
    state.s7NoteReleasedTime = Date.now();
  } else if (state.currentSlide === 7) {
    state.s8NoteReleasedTime = Date.now();
  }
  
  // Remove UI piano key highlights
  let basePitch = null;
  if (typeof sourceId === "string" && NOTE_MAP[sourceId]) {
    basePitch = NOTE_MAP[sourceId].freq;
  } else if (sourceId instanceof HTMLElement) {
    basePitch = parseFloat(sourceId.dataset.basePitch);
  }
  
  if (basePitch) {
    document.querySelectorAll(`[data-base-pitch="${basePitch}"]`).forEach(el => {
      el.classList.remove("active");
    });
  }
}

// Global QWERTY Alphanumeric Listeners
window.addEventListener("keydown", (e) => {
  // Octave triggers
  if (e.code === "KeyZ") {
    setOctave(state.octaveOffset - 1);
    return;
  }
  if (e.code === "KeyX") {
    setOctave(state.octaveOffset + 1);
    return;
  }
  
  const mapped = NOTE_MAP[e.code];
  if (mapped) {
    e.preventDefault();
    triggerNoteOn(mapped.freq, e.code);
  }
});

window.addEventListener("keyup", (e) => {
  const mapped = NOTE_MAP[e.code];
  if (mapped) {
    e.preventDefault();
    triggerNoteOff(e.code);
  }
});

// Auto-blur focused input/select/button elements on pointerup or value change
// so that focus immediately returns to the body, ensuring key listeners are always active.
document.addEventListener("pointerup", () => {
  const active = document.activeElement;
  if (active && ["INPUT", "SELECT", "BUTTON"].includes(active.tagName)) {
    active.blur();
  }
});

document.addEventListener("change", (e) => {
  if (e.target && ["INPUT", "SELECT"].includes(e.target.tagName)) {
    e.target.blur();
  }
});

/* ==========================================================================
   3. Slide Deck Router & Lifecycle Hooks
   ========================================================================== */

function setupNavigation() {
  const prevBtn = document.getElementById("btn-deck-prev");
  const nextBtn = document.getElementById("btn-deck-next");
  const segmentsContainer = document.getElementById("deck-progress-segments");
  const slideInfo = document.getElementById("deck-slide-info");
  
  prevBtn.addEventListener("click", () => navigateSlide(-1));
  nextBtn.addEventListener("click", () => navigateSlide(1));
  
  if (segmentsContainer) {
    const segments = segmentsContainer.querySelectorAll(".deck-segment");
    
    segments.forEach((seg) => {
      // Click handler
      seg.addEventListener("click", () => {
        goToSlide(parseInt(seg.dataset.slide, 10));
      });
      
      // Mouseover/hover handler
      seg.addEventListener("mouseover", () => {
        const title = seg.dataset.title;
        const desc = seg.dataset.desc;
        if (slideInfo && title && desc) {
          slideInfo.textContent = `${title} — ${desc}`;
        }
      });
      
      // Mouseleave handler
      seg.addEventListener("mouseleave", () => {
        // Restore the active slide's info
        restoreActiveSlideInfo();
      });
    });
  }
}

function restoreActiveSlideInfo() {
  const slideInfo = document.getElementById("deck-slide-info");
  const activeSeg = document.querySelector(`.deck-segment[data-slide="${state.currentSlide}"]`);
  if (slideInfo && activeSeg) {
    const title = activeSeg.dataset.title;
    const desc = activeSeg.dataset.desc;
    slideInfo.textContent = `${title} — ${desc}`;
  }
}

function goToSlide(targetIndex) {
  if (targetIndex < 0 || targetIndex >= state.totalSlides) return;
  if (targetIndex === state.currentSlide) return;
  
  // Cleanup current active slide animations and audio
  cleanupSlide(state.currentSlide);
  
  // Manage transitions using the View Transitions API
  if (document.startViewTransition) {
    document.startViewTransition(() => {
      updateActiveSlideDOM(targetIndex);
      initializeSlide(targetIndex);
    });
  } else {
    // Fallback if browser doesn't support View Transitions
    updateActiveSlideDOM(targetIndex);
    initializeSlide(targetIndex);
  }
}

function navigateSlide(direction) {
  goToSlide(state.currentSlide + direction);
}

function updateActiveSlideDOM(index) {
  // Update Left Notebook Page active class
  document.querySelectorAll(".slide-curriculum").forEach((el, idx) => {
    if (idx === index) {
      el.classList.add("active");
      el.setAttribute("aria-hidden", "false");
    } else {
      el.classList.remove("active");
      el.setAttribute("aria-hidden", "true");
    }
  });

  // Update Right Workspace page active class
  document.querySelectorAll(".workspace-page").forEach((el, idx) => {
    if (idx === index) {
      el.classList.add("active");
    } else {
      el.classList.remove("active");
    }
  });
  
  // Update State Index
  state.currentSlide = index;
  
  // Update Progress Controls
  const prevBtn = document.getElementById("btn-deck-prev");
  const nextBtn = document.getElementById("btn-deck-next");
  
  prevBtn.disabled = index === 0;
  nextBtn.disabled = index === state.totalSlides - 1;
  
  // Update segments active/completed state
  document.querySelectorAll(".deck-segment").forEach((seg, idx) => {
    seg.classList.remove("active", "completed");
    if (idx === index) {
      seg.classList.add("active");
    } else if (idx < index) {
      seg.classList.add("completed");
    }
  });
  
  // Restore/update active slide info label
  restoreActiveSlideInfo();
}

function cleanupSlide(index) {
  // Halt arpeggiator if running
  if (typeof stopArpeggiator === "function") {
    stopArpeggiator();
  }

  // Halt synth sounds
  synth.stopAllVoices();
  
  // Stop active visualizers
  if (activeVisualizer) {
    activeVisualizer.stop();
    activeVisualizer = null;
  }
  if (activeVisualizer2) {
    activeVisualizer2.stop();
    activeVisualizer2 = null;
  }
  
  // Slide 1 Custom Geometry Cancel
  if (state.s1AnimationId) {
    cancelAnimationFrame(state.s1AnimationId);
    state.s1AnimationId = null;
  }
  
  // Slide 11 LFO Monitor Cancel
  if (state.s11AnimationId) {
    cancelAnimationFrame(state.s11AnimationId);
    state.s11AnimationId = null;
  }

  // Slide 8 Envelope Ball Cancel
  if (state.s8AnimationId) {
    cancelAnimationFrame(state.s8AnimationId);
    state.s8AnimationId = null;
  }

  // Slide 2 sequence cleanup
  synth.stopSlide2Loop();
  
  // Remove highlighted classes from block diagram
  document.querySelectorAll(".diagram-block").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".mod-arrow").forEach(el => el.classList.remove("active"));
  
  // Hide inspector
  const inspector = document.getElementById("diagram-inspector");
  inspector.querySelector(".inspector-content").classList.add("hidden");
  inspector.querySelector(".inspector-prompt").classList.remove("hidden");
}

function initializeSlide(index) {
  const slideNum = index + 1;
  
  // Slide Specific Initialization Hooks
  switch (slideNum) {
    case 1:
      initSlide1();
      break;
    case 2:
      initSlide2();
      break;
    case 3:
      initSlide3();
      break;
    case 4:
      initSlide4();
      break;
    case 5:
      initSlide5();
      break;
    case 6:
      initSlide6();
      break;
    case 7:
      initSlide7();
      break;
    case 8:
      initSlide8();
      break;
    case 9:
      initSlide9();
      break;
    case 10:
      initSlide10();
      break;
    case 11:
      initSlide11();
      break;
    case 12:
      initSlide12();
      break;
  }
}

/* ==========================================================================
   4. Slide-Specific Code & Widgets
   ========================================================================== */

/* --------------------------------------------------------------------------
   Slide 1: Intro - Morphing Geometry Visuals
   -------------------------------------------------------------------------- */
function initSlide1() {
  const canvas = document.getElementById("canvas-s1-geom");
  const ctx = canvas.getContext("2d");
  
  // Handle resizing manually
  function resizeCanvas() {
    const rect = canvas.parentNode.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
  resizeCanvas();
  
  // Attach buttons
  const buttons = document.querySelectorAll(".btn-method");
  buttons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      buttons.forEach(b => b.classList.remove("active"));
      const methodBtn = e.currentTarget;
      methodBtn.classList.add("active");
      
      const method = methodBtn.dataset.method;
      state.s1ActiveMethod = method;
      
      // Trigger synth sound example
      synth.triggerSlide1Demo(method);
    });
  });
  
  // Morphing geometric render loop
  let angle = 0;
  
  const render = () => {
    state.s1AnimationId = requestAnimationFrame(render);
    
    const style = getComputedStyle(canvas);
    const bg = style.getPropertyValue("--canvas-bg").trim() || "#08090d";
    const primaryTrace = style.getPropertyValue("--canvas-trace").trim() || "rgba(102, 252, 241, 0.4)";
    const trace2 = style.getPropertyValue("--canvas-trace-2").trim() || "#d946ef";
    const glowColor = style.getPropertyValue("--canvas-trace-glow").trim();
    
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.strokeStyle = primaryTrace;
    ctx.lineWidth = 2;
    if (glowColor && glowColor !== "none" && glowColor !== "") {
      ctx.shadowBlur = 10;
      ctx.shadowColor = glowColor;
    } else {
      ctx.shadowBlur = 0;
    }
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    angle += 0.01;
    
    if (state.s1ActiveMethod === "subtractive") {
      // Subtractive: Draw vertical wave layers slicing away (lines moving down)
      ctx.strokeStyle = primaryTrace;
      if (glowColor && glowColor !== "none" && glowColor !== "") {
        ctx.shadowColor = glowColor;
      }
      
      const lines = 6;
      for (let i = 0; i < lines; i++) {
        const offset = (angle * 60 + i * (canvas.height / lines)) % canvas.height;
        ctx.beginPath();
        ctx.moveTo(30, offset);
        
        // draw wave line
        for (let x = 30; x < canvas.width - 30; x += 10) {
          const y = offset + Math.sin(x * 0.02 + angle * 2) * 20 * (1 - offset / canvas.height);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      
    } else if (state.s1ActiveMethod === "fm") {
      // FM: Spikey concentric circles
      ctx.strokeStyle = trace2;
      if (glowColor && glowColor !== "none" && glowColor !== "") {
        ctx.shadowColor = glowColor;
      }
      
      const maxRadius = Math.min(centerX, centerY) * 0.75;
      
      ctx.beginPath();
      for (let theta = 0; theta < Math.PI * 2; theta += 0.05) {
        // complex frequency modulation shape mapping
        const fmRatio = 8; 
        const r = maxRadius * 0.7 + Math.sin(theta * fmRatio + angle * 4) * Math.cos(theta * 3) * 20;
        const x = centerX + Math.cos(theta) * r;
        const y = centerY + Math.sin(theta) * r;
        
        if (theta === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      
    } else if (state.s1ActiveMethod === "physical") {
      // Physical: Plucked vibrating string string line
      ctx.strokeStyle = primaryTrace;
      if (glowColor && glowColor !== "none" && glowColor !== "") {
        ctx.shadowColor = glowColor;
      }
      
      ctx.beginPath();
      ctx.moveTo(30, centerY);
      
      // Vibrating string physics simulation
      const frequencyMultiplier = Math.sin(angle * 15) * Math.exp(-((angle * 0.5) % 1.5)) * 40;
      
      ctx.bezierCurveTo(
        centerX - 80, centerY + frequencyMultiplier,
        centerX + 80, centerY - frequencyMultiplier,
        canvas.width - 30, centerY
      );
      ctx.stroke();
      
    } else if (state.s1ActiveMethod === "wavetable") {
      // Wavetable: 3D perspective waterfall stack of 6 wave cycles morphing from Sine to Sawtooth
      const lines = 6;
      const startX = 40;
      const endX = canvas.width - 40;
      const waveWidth = endX - startX;
      const scanIndex = (Math.sin(angle * 1.5) + 1) * 2.5; // active morphing index (0 to 5)
      
      for (let i = 0; i < lines; i++) {
        const morph = i / (lines - 1); // 0 (Sine) to 1 (Sawtooth)
        
        // 3D perspective displacement
        const xShift = (morph - 0.5) * 50;
        const yBase = centerY + (morph - 0.5) * 60;
        
        // Proximity to scanning sweep
        const dist = Math.abs(i - scanIndex);
        const brightness = Math.max(0.15, 1.0 - dist); // active line is highlighted
        
        ctx.strokeStyle = trace2;
        ctx.globalAlpha = brightness;
        
        if (glowColor && glowColor !== "none" && glowColor !== "") {
          ctx.shadowBlur = brightness * 8;
          ctx.shadowColor = glowColor;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.lineWidth = 1 + brightness * 1.5;
        
        ctx.beginPath();
        for (let px = startX; px <= endX; px += 4) {
          const t = (px - startX) / waveWidth; // 0 to 1
          const phase = t * Math.PI * 4; // 2 full cycles
          
          // Sine component
          const sineVal = Math.sin(phase);
          
          // Sawtooth component (additive approximation with 6 harmonics)
          let sawVal = 0;
          for (let h = 1; h <= 6; h++) {
            sawVal += Math.sin(phase * h) / h;
          }
          sawVal *= 0.75;
          
          // Interpolated wave shape
          const yVal = (1 - morph) * sineVal + morph * sawVal;
          
          const x = px + xShift;
          const y = yBase - yVal * 30; // Amplitude of 30px
          
          if (px === startX) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0; // Reset alpha
    }
    
    ctx.shadowBlur = 0;
  };
  
  render();
}

/* --------------------------------------------------------------------------
   Slide 2: Anatomy - Synthesizer Block Diagram & Isolation
   -------------------------------------------------------------------------- */
function initSlide2() {
  const blocks = document.querySelectorAll(".diagram-block");
  const inspector = document.getElementById("diagram-inspector");
  const insTitle = document.getElementById("inspector-title");
  const insBody = document.getElementById("inspector-body");
  const insPrompt = inspector.querySelector(".inspector-prompt");
  const insContent = inspector.querySelector(".inspector-content");
  
  const blockData = {
    vco: {
      title: "Voltage Controlled Oscillator (VCO)",
      body: "Generates the raw, pitch-aligned electrical sound waveform. In this demo, we've bypassed the filter so you can hear its raw, bright, unfiltered harmonic bite."
    },
    vcf: {
      title: "Voltage Controlled Filter (VCF)",
      body: "Carves away high-frequency harmonics (subtractive sculpting). We've activated a resonant lowpass filter sweep, highlighting the warm, sweeping cutoff frequencies."
    },
    vca: {
      title: "Voltage Controlled Amplifier (VCA)",
      body: "Controls the output amplitude (volume over time). The engine shapes a smooth swelling fade-in and fade-out volume gate, isolating sound dynamics."
    },
    lfo: {
      title: "Low Frequency Oscillator (LFO Modulator)",
      body: "Produces cyclical control signals below 20Hz. We've routed it to modulate VCO pitch, resulting in a vibrato pitch warble."
    },
    env: {
      title: "Envelope Generator (ADSR Modulator)",
      body: "Triggers a single volume/filter sweep per note. We've connected the envelope to sweep the lowpass filter cutoff, yielding a sharp pluck sound."
    }
  };
  
  blocks.forEach(block => {
    // Hover interactions
    block.addEventListener("mouseenter", (e) => {
      const mod = e.currentTarget.dataset.module;
      
      // Update UI active highlights
      blocks.forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      
      // Update routing lines visual highlights
      document.querySelectorAll(".mod-arrow").forEach(el => el.classList.remove("active"));
      const routeLine = document.getElementById(`arrow-${mod}`);
      if (routeLine) routeLine.classList.add("active");
      
      // Set LFO destination highlight line
      if (mod === "lfo") {
        document.querySelectorAll(".arrow-lfo-vco").forEach(el => el.classList.add("active"));
      } else if (mod === "env") {
        document.querySelectorAll(".arrow-env-vcf").forEach(el => el.classList.add("active"));
        document.querySelectorAll(".arrow-env-vca").forEach(el => el.classList.add("active"));
      }
      
      // Update Inspector Text
      insPrompt.classList.add("hidden");
      insContent.classList.remove("hidden");
      insTitle.textContent = blockData[mod].title;
      insBody.textContent = blockData[mod].body;
      
      // Audio engine hooks: Play isolated block sound loop
      synth.startSlide2Loop(mod);
    });
    
    block.addEventListener("mouseleave", () => {
      cleanupSlide2Interactions();
    });
  });
}

function cleanupSlide2Interactions() {
  synth.stopSlide2Loop();
  document.querySelectorAll(".diagram-block").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".mod-arrow").forEach(el => el.classList.remove("active"));
  
  const inspector = document.getElementById("diagram-inspector");
  inspector.querySelector(".inspector-content").classList.add("hidden");
  inspector.querySelector(".inspector-prompt").classList.remove("hidden");
}

/* --------------------------------------------------------------------------
   Slide 3: VCO - Oscilloscope time-domain canvas
   -------------------------------------------------------------------------- */
function initSlide3() {
  const canvas = document.getElementById("canvas-s3-scope");
  activeVisualizer = new Visualizer(canvas);
  activeVisualizer.startOscilloscope(synth.analyser);
}

/* --------------------------------------------------------------------------
   Slide 4: Additive synthesis sliders & FFT Spectrum
   -------------------------------------------------------------------------- */
function initSlide4() {
  const canvas = document.getElementById("canvas-s4-fft");
  activeVisualizer = new Visualizer(canvas);
  activeVisualizer.startFFT(synth.analyser);
  
  const sliders = [
    document.getElementById("slider-harm-1"),
    document.getElementById("slider-harm-2"),
    document.getElementById("slider-harm-3"),
    document.getElementById("slider-harm-4"),
    document.getElementById("slider-harm-5"),
    document.getElementById("slider-harm-6"),
    document.getElementById("slider-harm-7"),
    document.getElementById("slider-harm-8")
  ];
  
  const labels = [
    document.getElementById("lbl-harm-1"),
    document.getElementById("lbl-harm-2"),
    document.getElementById("lbl-harm-3"),
    document.getElementById("lbl-harm-4"),
    document.getElementById("lbl-harm-5"),
    document.getElementById("lbl-harm-6"),
    document.getElementById("lbl-harm-7"),
    document.getElementById("lbl-harm-8")
  ];
  
  // Sync sliders to synth engine in real-time
  sliders.forEach((slider, idx) => {
    slider.addEventListener("input", (e) => {
      // Toggle custom active tab
      document.querySelectorAll(".btn-preset").forEach(b => b.classList.remove("active"));
      document.getElementById("btn-add-custom").classList.add("active");
      
      const val = parseFloat(e.target.value);
      labels[idx].textContent = val.toFixed(2);
      synth.setHarmonicGain(idx, val);
    });
  });
  
  // Preset buttons
  const presets = document.querySelectorAll(".btn-preset");
  presets.forEach(btn => {
    btn.addEventListener("click", (e) => {
      presets.forEach(p => p.classList.remove("active"));
      e.currentTarget.classList.add("active");
      
      const type = e.currentTarget.dataset.preset;
      
      if (type === "flute") {
        // Flute harmonic gains (fundamental heavy)
        updateHarmonicSliders([1.0, 0.40, 0.10, 0.05, 0.02, 0.01, 0.0, 0.0]);
      } else if (type === "clarinet") {
        // Clarinet gains (mostly odd harmonics)
        updateHarmonicSliders([1.0, 0.0, 0.70, 0.0, 0.40, 0.0, 0.10, 0.0]);
      } else if (type === "organ") {
        // Organ gains (rich drawbar organ combination)
        updateHarmonicSliders([1.0, 0.80, 0.70, 0.50, 0.40, 0.30, 0.0, 0.60]);
      }
    });
  });

  function updateHarmonicSliders(gains) {
    gains.forEach((gain, idx) => {
      if (sliders[idx]) {
        sliders[idx].value = gain;
        labels[idx].textContent = gain.toFixed(2);
      }
    });
    synth.updateAllHarmonics(gains);
  }
}

/* --------------------------------------------------------------------------
   Slide 5: Complex timbres - Pulse Width slider
   -------------------------------------------------------------------------- */
function initSlide5() {
  const canvasScope = document.getElementById("canvas-s5-scope");
  const canvasFft = document.getElementById("canvas-s5-fft");
  
  activeVisualizer = new Visualizer(canvasScope);
  activeVisualizer.startOscilloscope(synth.analyser);
  
  activeVisualizer2 = new Visualizer(canvasFft);
  activeVisualizer2.startFFT(synth.analyser);
  
  const pwSlider = document.getElementById("slider-s5-pw");
  const pwLabel = document.getElementById("lbl-s5-pw");
  const pwBox = document.getElementById("pw-slider-box");
  
  pwSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    pwLabel.textContent = `${(val * 100).toFixed(0)}%`;
    synth.setPulseWidth(val);
  });
  
  const waveButtons = document.querySelectorAll("#slide-right-5 .btn-wave-select");
  waveButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      waveButtons.forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      
      const wave = e.currentTarget.dataset.wave;
      synth.s5WaveType = wave;
      
      // Hide pulse width control slider if not pulse wave
      if (wave === "pulse") {
        pwBox.style.display = "flex";
      } else {
        pwBox.style.display = "none";
      }
    });
  });
}

/* --------------------------------------------------------------------------
   Slide 6: Noise crossfader & FFT
   -------------------------------------------------------------------------- */
function initSlide6() {
  const canvas = document.getElementById("canvas-s6-fft");
  activeVisualizer = new Visualizer(canvas);
  activeVisualizer.startFFT(synth.analyser);
  
  const fader = document.getElementById("slider-noise-fade");
  fader.oninput = (e) => {
    synth.updateNoiseFade(parseFloat(e.target.value));
  };
  
  const btnToggle = document.getElementById("btn-noise-toggle");
  btnToggle.textContent = "PLAY NOISE"; // Reset state on entry
  btnToggle.onclick = () => {
    if (synth.noiseGainNode) {
      synth.stopNoise();
      btnToggle.textContent = "PLAY NOISE";
    } else {
      synth.playNoise();
      btnToggle.textContent = "STOP NOISE";
    }
  };
  
  const btnEnv = document.getElementById("btn-noise-envelope");
  btnEnv.onclick = () => {
    synth.triggerNoiseEnvelope();
  };
}

/* --------------------------------------------------------------------------
   Slide 7: Modulation patch bay & SVG cables
   -------------------------------------------------------------------------- */
function initSlide7() {
  const patchContainer = document.getElementById("patch-bay-container");
  const svg = document.getElementById("patch-cables-svg");
  const depthSlider = document.getElementById("slider-patch-depth");
  const depthLabel = document.getElementById("lbl-patch-depth");
  const disconnectBtn = document.getElementById("btn-clear-cables");
  const triggerBtn = document.getElementById("btn-patch-trigger");
  
  // Dest dials DOM elements
  const dials = {
    pitch: { body: document.getElementById("dial-dest-pitch"), lbl: document.getElementById("lbl-dest-pitch"), base: 0, scale: "C4" },
    filter: { body: document.getElementById("dial-dest-filter"), lbl: document.getElementById("lbl-dest-filter"), base: 1000, scale: "1000Hz" },
    volume: { body: document.getElementById("dial-dest-volume"), lbl: document.getElementById("lbl-dest-volume"), base: 100, scale: "100%" }
  };
  
  // Set initial engine depth and routing
  synth.updateModulationDepth(parseFloat(depthSlider.value));
  syncModRoutingToEngine();

  // Re-sync SVG overlay boundaries
  function resizeSvg() {
    const rect = patchContainer.getBoundingClientRect();
    svg.setAttribute("width", rect.width);
    svg.setAttribute("height", rect.height);
  }
  resizeSvg();
  window.addEventListener("resize", resizeSvg);
  
  // Gather socket coordinates relative to the SVG container
  function getSocketCenter(el) {
    const sRect = el.getBoundingClientRect();
    const cRect = patchContainer.getBoundingClientRect();
    return {
      x: sRect.left - cRect.left + sRect.width / 2,
      y: sRect.top - cRect.top + sRect.height / 2
    };
  }

  // Draw a droopy curve path representing a hanging patch cable
  function makeCablePath(x1, y1, x2, y2) {
    const midY = (y1 + y2) / 2 + Math.abs(x2 - x1) * 0.25;
    return `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`;
  }

  function redrawCables() {
    svg.innerHTML = "";
    state.activeConnections.forEach((sourceId, destId) => {
      const sourceEl = document.getElementById(sourceId);
      const destEl = document.getElementById(destId);
      if (sourceEl && destEl) {
        const pt1 = getSocketCenter(sourceEl);
        const pt2 = getSocketCenter(destEl);
        
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", makeCablePath(pt1.x, pt1.y, pt2.x, pt2.y));
        path.setAttribute("stroke", sourceId.includes("lfo") ? "var(--canvas-trace)" : "var(--canvas-trace-2)");
        path.setAttribute("stroke-width", "4");
        path.setAttribute("fill", "none");
        path.setAttribute("filter", "drop-shadow(0px 2px 4px rgba(0,0,0,0.3))");
        svg.appendChild(path);
      }
    });
  }

  function syncModRoutingToEngine() {
    synth.modRouting.lfo = { pitch: false, filter: false, volume: false };
    synth.modRouting.env = { pitch: false, filter: false, volume: false };
    
    state.activeConnections.forEach((sourceId, destId) => {
      const sourceEl = document.getElementById(sourceId);
      const destEl = document.getElementById(destId);
      if (sourceEl && destEl) {
        const sourceName = sourceEl.dataset.source; // "lfo", "env"
        const destName = destEl.dataset.destination;  // "pitch", "filter", "volume"
        if (sourceName === "lfo" && destName in synth.modRouting.lfo) {
          synth.modRouting.lfo[destName] = true;
        } else if (sourceName === "env" && destName in synth.modRouting.env) {
          synth.modRouting.env[destName] = true;
        }
      }
    });
  }

  // Cable dragging events
  const sourcePorts = document.querySelectorAll(".patch-jack-out");
  
  sourcePorts.forEach(port => {
    port.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      port.setPointerCapture(e.pointerId);
      
      const pt1 = getSocketCenter(port);
      
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("stroke", port.id.includes("lfo") ? "var(--canvas-trace)" : "var(--canvas-trace-2)");
      path.setAttribute("stroke-width", "4");
      path.setAttribute("fill", "none");
      svg.appendChild(path);
      
      state.draggingCable = {
        sourceId: port.id,
        pathElement: path,
        startPoint: pt1
      };
    });
    
    port.addEventListener("pointermove", (e) => {
      if (!state.draggingCable) return;
      
      const cRect = patchContainer.getBoundingClientRect();
      const px = e.clientX - cRect.left;
      const py = e.clientY - cRect.top;
      
      const pt1 = state.draggingCable.startPoint;
      state.draggingCable.pathElement.setAttribute("d", makeCablePath(pt1.x, pt1.y, px, py));
    });
    
    port.addEventListener("pointerup", (e) => {
      if (!state.draggingCable) return;
      port.releasePointerCapture(e.pointerId);
      
      const target = document.elementFromPoint(e.clientX, e.clientY);
      let targetJack = null;
      
      if (target) {
        targetJack = target.closest(".patch-jack-in");
      }
      
      if (targetJack) {
        const destId = targetJack.id;
        state.activeConnections.set(destId, state.draggingCable.sourceId);
        syncModRoutingToEngine();
      }
      
      state.draggingCable.pathElement.remove();
      state.draggingCable = null;
      
      redrawCables();
    });
  });
  
  function updateModulationSVGs(val) {
    const pathLfo = document.getElementById("path-lfo-mod");
    const pathEnv = document.getElementById("path-env-mod");
    if (!pathLfo || !pathEnv) return;
    
    // LFO sine wave calculation (viewBox 100 x 40)
    const width = 100;
    const height = 40;
    const centerY = height / 2;
    const maxAmp = 16;
    const amp = maxAmp * val;
    
    let dLfo = "";
    for (let x = 2; x <= width - 2; x++) {
      const angle = ((x - 2) / (width - 4)) * 2.5 * Math.PI * 2; // 2.5 cycles
      const y = centerY - Math.sin(angle) * amp;
      if (x === 2) {
        dLfo += `M ${x} ${y}`;
      } else {
        dLfo += ` L ${x} ${y}`;
      }
    }
    pathLfo.setAttribute("d", dLfo);
    
    // Envelope shape calculation (viewBox 100 x 40)
    const yZero = 38;
    const yPeak = yZero - (yZero - 4) * val;
    const ySustain = yZero - (yZero - 18) * val;
    const dEnv = `M 2 38 L 20 ${yPeak} L 40 ${ySustain} L 70 ${ySustain} L 98 38`;
    pathEnv.setAttribute("d", dEnv);
  }

  depthSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    depthLabel.textContent = `${(val * 100).toFixed(0)}%`;
    synth.updateModulationDepth(val);
    updateModulationSVGs(val);
  });

  // Initial draw of sources on entry
  updateModulationSVGs(parseFloat(depthSlider.value));

  disconnectBtn.addEventListener("click", () => {
    state.activeConnections.clear();
    syncModRoutingToEngine();
    redrawCables();
    resetDials();
  });
  
  if (triggerBtn) {
    triggerBtn.onclick = () => {
      const freq = 261.63; // C4
      synth.playNote(freq, 7);
      state.s7NoteStartTime = Date.now();
      state.s7NoteReleasedTime = null;
      
      setTimeout(() => {
        synth.releaseNote(freq);
        state.s7NoteReleasedTime = Date.now();
      }, 1200);
    };
  }
  
  function resetDials() {
    Object.keys(dials).forEach(key => {
      dials[key].body.style.transform = `rotate(0deg)`;
      dials[key].lbl.textContent = dials[key].scale;
    });
  }
  
  function getS7EnvelopeValue() {
    if (!state.s7NoteStartTime) return 0;
    
    const now = Date.now();
    const elapsed = (now - state.s7NoteStartTime) / 1000;
    
    const A = synth.adsr.attack;
    const D = synth.adsr.decay;
    const S = synth.adsr.sustain;
    const R = synth.adsr.release;
    
    if (!state.s7NoteReleasedTime) {
      if (elapsed < A) {
        return elapsed / A;
      } else if (elapsed < A + D) {
        return 1.0 - ((elapsed - A) / D) * (1.0 - S);
      } else {
        return S;
      }
    } else {
      const releaseElapsed = (now - state.s7NoteReleasedTime) / 1000;
      if (releaseElapsed < R) {
        const releaseTimeVal = (state.s7NoteReleasedTime - state.s7NoteStartTime) / 1000;
        let startVal = S;
        if (releaseTimeVal < A) {
          startVal = releaseTimeVal / A;
        } else if (releaseTimeVal < A + D) {
          startVal = 1.0 - ((releaseTimeVal - A) / D) * (1.0 - S);
        }
        return startVal * (1.0 - releaseElapsed / R);
      } else {
        return 0;
      }
    }
  }
  
  // Slide 7 Dial Mod animation rendering loop
  const animateDials = () => {
    if (state.currentSlide !== 6) return; // slide 7 index = 6
    requestAnimationFrame(animateDials);
    
    const depth = parseFloat(depthSlider.value);
    
    // Reset dials to default representation first
    resetDials();
    
    // Free-running LFO (3Hz)
    const lfoVal = Math.sin(Date.now() * 0.001 * 3.0 * 2 * Math.PI);
    
    // Triggered Envelope Value
    const envVal = getS7EnvelopeValue();
    
    state.activeConnections.forEach((sourceId, destId) => {
      const destEl = document.getElementById(destId);
      if (!destEl) return;
      
      const destName = destEl.dataset.destination;
      const dial = dials[destName];
      if (!dial) return;
      
      const isLfo = sourceId.includes("lfo");
      const modVal = isLfo ? lfoVal : envVal;
      
      // Calculate rotation angle (LFO is bipolar centered at 0; Env is unipolar centered at min)
      let shiftAngle = 0;
      if (isLfo) {
        shiftAngle = modVal * depth * 110; // -110 to 110
      } else {
        shiftAngle = (modVal - 0.5) * 2 * 110; // -110 to 110
      }
      
      dial.body.style.transform = `rotate(${shiftAngle}deg)`;
      
      // Update dial readouts with realistic values based on type of modulator
      if (destName === "pitch") {
        if (isLfo) {
          const cents = Math.round(modVal * depth * 200);
          dial.lbl.textContent = cents >= 0 ? `C4 (+${cents}c)` : `C4 (${cents}c)`;
        } else {
          const pitchHz = Math.round(261.63 + modVal * depth * 400);
          dial.lbl.textContent = `${pitchHz}Hz`;
        }
      } else if (destName === "filter") {
        if (isLfo) {
          const hz = Math.max(100, Math.round(dial.base + modVal * depth * 800));
          dial.lbl.textContent = `${hz}Hz`;
        } else {
          const hz = Math.max(100, Math.round(300 + modVal * depth * 4000));
          dial.lbl.textContent = `${hz}Hz`;
        }
      } else if (destName === "volume") {
        if (isLfo) {
          const vol = Math.max(0, Math.min(100, Math.round((0.5 + modVal * depth * 0.3) * 100)));
          dial.lbl.textContent = `${vol}%`;
        } else {
          const vol = Math.round(modVal * 100);
          dial.lbl.textContent = `${vol}%`;
        }
      }
    });
  };
  
  redrawCables();
  animateDials();
}

/* --------------------------------------------------------------------------
   Slide 8: ADSR - Canvas vector envelope & listening challenge
   -------------------------------------------------------------------------- */
function initSlide8() {
  const canvas = document.getElementById("canvas-s8-envelope");
  const ctx = canvas.getContext("2d");
  
  const sliderA = document.getElementById("slider-env-a");
  const sliderD = document.getElementById("slider-env-d");
  const sliderS = document.getElementById("slider-env-s");
  const sliderR = document.getElementById("slider-env-r");
  
  const lblA = document.getElementById("lbl-env-a");
  const lblD = document.getElementById("lbl-env-d");
  const lblS = document.getElementById("lbl-env-s");
  const lblR = document.getElementById("lbl-env-r");
  
  // Set dimensions
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentNode.getBoundingClientRect().width;
  const h = 180;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.scale(dpr, dpr);
  
  // Position visual node handles according to parameters
  function syncNodesFromSliders() {
    // Decode quadratic curves: time = min + (max - min) * (x^2)
    const rawValA = parseFloat(sliderA.value);
    const rawValD = parseFloat(sliderD.value);
    const rawValR = parseFloat(sliderR.value);
    
    const A = 0.005 + 1.995 * Math.pow(rawValA, 2);
    const D = 0.005 + 1.995 * Math.pow(rawValD, 2);
    const S = parseFloat(sliderS.value); // Sustain remains linear 0.0 - 1.0
    const R = 0.005 + 2.995 * Math.pow(rawValR, 2);
    
    // Scale slider values to canvas layout space (width=w, height=h)
    const maxSegmentW = w * 0.25;
    const maxReleaseW = w * 0.35;
    
    const attackX = 15 + (A / 2.0) * maxSegmentW;
    const decayX = attackX + (D / 2.0) * maxSegmentW;
    const sustainY = h - 30 - S * (h - 60);
    const releaseX = Math.max(decayX + 20, w - 25 - (R / 3.0) * maxReleaseW);
    
    state.adsrNodes[0].x = attackX;
    state.adsrNodes[0].y = 30; // peak is top
    
    state.adsrNodes[1].x = decayX;
    state.adsrNodes[1].y = sustainY;
    
    state.adsrNodes[2].x = releaseX;
    state.adsrNodes[2].y = sustainY; // release start is sustain level
    
    // Update synth envelope parameters
    synth.adsr.attack = A;
    synth.adsr.decay = D;
    synth.adsr.sustain = S;
    synth.adsr.release = R;
    synth.updateADSREnvelope();
    
    lblA.textContent = `${A.toFixed(2)}s`;
    lblD.textContent = `${D.toFixed(2)}s`;
    lblS.textContent = `${S.toFixed(2)}`;
    lblR.textContent = `${R.toFixed(2)}s`;
    
    drawEnvelope();
  }

  function getBallPosition(A, D, S, R, nodeA, nodeD, nodeR) {
    if (!state.s8NoteStartTime) {
      return { x: 15, y: h - 30 };
    }
    
    const x0 = 15;
    const y0 = h - 30;
    const xA = nodeA.x;
    const yA = nodeA.y;
    const xD = nodeD.x;
    const yD = nodeD.y;
    const xS = nodeR.x;
    const yS = nodeD.y;
    const xR = w - 25;
    const yR = h - 30;
    
    const nowMs = Date.now();
    
    if (state.s8NoteReleasedTime !== null) {
      const tRelease = (nowMs - state.s8NoteReleasedTime) / 1000;
      if (tRelease >= R) {
        return { x: xR, y: yR };
      }
      const ratio = tRelease / R;
      return {
        x: xS + ratio * (xR - xS),
        y: yS + ratio * (yR - yS)
      };
    }
    
    const tPress = (nowMs - state.s8NoteStartTime) / 1000;
    if (tPress < A) {
      const ratio = tPress / A;
      return {
        x: x0 + ratio * (xA - x0),
        y: y0 + ratio * (yA - y0)
      };
    } else if (tPress < A + D) {
      const ratio = (tPress - A) / D;
      return {
        x: xA + ratio * (xD - xA),
        y: yA + ratio * (yD - yA)
      };
    } else {
      const tSustain = tPress - A - D;
      const ratio = Math.min(1.0, tSustain / 2.0);
      return {
        x: xD + ratio * (xS - xD),
        y: yS
      };
    }
  }

  function drawEnvelope() {
    const style = getComputedStyle(canvas);
    const bg = style.getPropertyValue("--canvas-bg").trim() || "#08090d";
    const grid = style.getPropertyValue("--canvas-grid").trim() || "rgba(255,255,255,0.03)";
    const trace2 = style.getPropertyValue("--canvas-trace-2").trim() || "#d946ef";
    const glowColor = style.getPropertyValue("--canvas-trace-glow").trim();
    const textColor = style.getPropertyValue("--canvas-text").trim() || "#8e9099";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    
    // Draw envelope background grids
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 30) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 30) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    
    // Draw envelope vector line
    ctx.strokeStyle = trace2;
    if (glowColor && glowColor !== "none" && glowColor !== "") {
      ctx.shadowBlur = 10;
      ctx.shadowColor = glowColor;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(15, h - 30); // start coordinates
    
    const nodeA = state.adsrNodes[0];
    const nodeD = state.adsrNodes[1];
    const nodeR = state.adsrNodes[2];
    
    ctx.lineTo(nodeA.x, nodeA.y); // Attack phase
    ctx.lineTo(nodeD.x, nodeD.y); // Decay phase
    ctx.lineTo(nodeR.x, nodeR.y); // Sustain hold flat line
    ctx.lineTo(w - 25, h - 30); // Release phase to fixed end
    ctx.stroke();
    ctx.shadowBlur = 0; // reset
    
    // Draw visual handle circles
    state.adsrNodes.forEach(node => {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(node.x, node.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = trace2;
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Node text labels
      ctx.fillStyle = textColor;
      ctx.font = "10px sans-serif";
      ctx.fillText(node.label, node.x - 4, node.y - 12);
    });

    // Draw animated envelope tracker ball
    const A = parseFloat(sliderA.value);
    const D = parseFloat(sliderD.value);
    const S = parseFloat(sliderS.value);
    const R = parseFloat(sliderR.value);
    
    const ballPos = getBallPosition(A, D, S, R, nodeA, nodeD, nodeR);
    
    const nowMs = Date.now();
    let isAudible = false;
    if (state.s8NoteStartTime) {
      if (state.s8NoteReleasedTime === null) {
        isAudible = true;
      } else {
        const tRelease = (nowMs - state.s8NoteReleasedTime) / 1000;
        if (tRelease < R) {
          isAudible = true;
        }
      }
    }
    
    if (isAudible) {
      ctx.fillStyle = "var(--primary)";
      ctx.beginPath();
      ctx.arc(ballPos.x, ballPos.y, 8, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.strokeStyle = "var(--primary-glow)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(ballPos.x, ballPos.y, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Pointer dragging handler on canvas
  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    // Find closest node to coordinates
    const clickedNode = state.adsrNodes.find(node => {
      const dist = Math.hypot(node.x - mx, node.y - my);
      return dist < 15; // 15px interaction radius
    });
    
    if (clickedNode) {
      state.draggingAdsrNode = clickedNode.id;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.draggingAdsrNode) return;
    
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    const maxSegmentW = w * 0.25;
    
    if (state.draggingAdsrNode === "attack") {
      // Modify Attack time
      // attackX range: [15, 15 + maxSegmentW]
      const ax = Math.max(15, Math.min(15 + maxSegmentW, mx));
      const A = ((ax - 15) / maxSegmentW) * 2.0;
      // Encode back to quadratic slider value: x = Math.sqrt((A - min) / (max - min))
      const sliderVal = Math.sqrt(Math.max(0, A - 0.005) / 1.995);
      sliderA.value = sliderVal.toFixed(3);
    } else if (state.draggingAdsrNode === "sustain") {
      // Modify Decay time and Sustain level
      const nodeA = state.adsrNodes[0];
      const dx = Math.max(nodeA.x + 10, Math.min(nodeA.x + maxSegmentW, mx));
      const D = ((dx - nodeA.x) / maxSegmentW) * 2.0;
      
      const sy = Math.max(35, Math.min(h - 30, my));
      const S = (h - 30 - sy) / (h - 60);
      
      const sliderValD = Math.sqrt(Math.max(0, D - 0.005) / 1.995);
      sliderD.value = sliderValD.toFixed(3);
      sliderS.value = S.toFixed(2);
    } else if (state.draggingAdsrNode === "release") {
      // Modify Release time
      const nodeD = state.adsrNodes[1];
      const maxReleaseW = w * 0.35;
      const rxMax = w - 25;
      const rxMin = Math.max(nodeD.x + 20, w - 25 - maxReleaseW);
      const mxClamped = Math.max(rxMin, Math.min(rxMax, mx));
      
      const rx = w - 25 - mxClamped;
      const R = (rx / maxReleaseW) * 3.0;
      
      const sliderValR = Math.sqrt(Math.max(0, R - 0.005) / 2.995);
      sliderR.value = sliderValR.toFixed(3);
    }
    
    syncNodesFromSliders();
  });

  canvas.addEventListener("pointerup", (e) => {
    if (state.draggingAdsrNode) {
      canvas.releasePointerCapture(e.pointerId);
      state.draggingAdsrNode = null;
    }
  });
  
  // Target mode buttons setup
  const btnEnvVca = document.getElementById("btn-env-mode-vca");
  const btnEnvVcf = document.getElementById("btn-env-mode-vcf");
  
  if (btnEnvVca && btnEnvVcf) {
    if (synth.s8EnvTarget === "vcf") {
      btnEnvVcf.classList.add("active");
      btnEnvVca.classList.remove("active");
    } else {
      btnEnvVca.classList.add("active");
      btnEnvVcf.classList.remove("active");
    }
    
    btnEnvVca.addEventListener("click", () => {
      btnEnvVca.classList.add("active");
      btnEnvVcf.classList.remove("active");
      synth.s8EnvTarget = "vca";
      synth.stopAllVoices();
    });
    
    btnEnvVcf.addEventListener("click", () => {
      btnEnvVcf.classList.add("active");
      btnEnvVca.classList.remove("active");
      synth.s8EnvTarget = "vcf";
      synth.stopAllVoices();
    });
  }
  
  // Sync sliders to canvas on range updates
  [sliderA, sliderD, sliderS, sliderR].forEach(slider => {
    slider.addEventListener("input", syncNodesFromSliders);
  });
  
  // Render visual envelope initial shape
  syncNodesFromSliders();
  
  // Start animation loop for tracking ball
  const render = () => {
    if (state.currentSlide !== 7) return;
    state.s8AnimationId = requestAnimationFrame(render);
    drawEnvelope();
  };
  render();
}

/* --------------------------------------------------------------------------
   Slide 9: VCF Filter - Cutoff & Resonance X-Y Pad
   -------------------------------------------------------------------------- */
/* --------------------------------------------------------------------------
   Slide 9: Filter Types & Slopes - Static Response Plot
   -------------------------------------------------------------------------- */
function initSlide9() {
  const canvas = document.getElementById("canvas-s9-filter-types");
  const ctx = canvas.getContext("2d");
  const cutoffSlider = document.getElementById("slider-s9-cutoff");
  const cutoffLbl = document.getElementById("lbl-s9-cutoff");
  const slopeBox = document.getElementById("slope-control-box");
  const cutoffBox = document.getElementById("cutoff-control-box");

  // Resize canvas
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentNode.getBoundingClientRect().width;
  const h = 180;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.scale(dpr, dpr);

  function getActiveConfig() {
    const typeBtn = document.querySelector("#slide-right-9 .btn-filter-type.active");
    const type = typeBtn ? typeBtn.dataset.filtertype : "lowpass";
    const slopeBtn = document.querySelector("#slide-right-9 .btn-filter-slope.active");
    const slope = slopeBtn ? slopeBtn.dataset.filterslope : "2-pole";
    const cutoff = parseFloat(cutoffSlider.value);
    return { type, slope, cutoff };
  }

  function drawFilterCurve(cutoffHz, type, slope) {
    const style = getComputedStyle(canvas);
    const bg = style.getPropertyValue("--canvas-bg").trim() || "#08090d";
    const grid = style.getPropertyValue("--canvas-grid").trim() || "rgba(255,255,255,0.03)";
    const trace = style.getPropertyValue("--canvas-trace").trim() || "#66fcf1";
    const glowColor = style.getPropertyValue("--canvas-trace-glow").trim();

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    
    // Draw frequency grids
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    
    ctx.strokeStyle = trace;
    if (glowColor && glowColor !== "none" && glowColor !== "") {
      ctx.shadowBlur = 10;
      ctx.shadowColor = glowColor;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.lineWidth = 3;
    ctx.beginPath();
    
    const minF = Math.log10(20);
    const maxF = Math.log10(15000);
    
    for (let x = 0; x < w; x++) {
      const ratioX = x / w;
      const f = Math.pow(10, minF + ratioX * (maxF - minF));
      
      let gain = 0;
      if (type === "lowpass") {
        const ratioF = f / cutoffHz;
        if (slope === "1-pole") {
          gain = 1 / Math.sqrt(1 + ratioF * ratioF);
        } else if (slope === "2-pole") {
          gain = 1 / (1 + ratioF * ratioF);
        } else if (slope === "4-pole") {
          gain = 1 / Math.pow(1 + ratioF * ratioF, 2);
        }
      } else if (type === "highpass") {
        const ratioF = f / cutoffHz;
        gain = (ratioF * ratioF) / (1 + ratioF * ratioF);
      } else if (type === "bandpass") {
        const ratioF = f / cutoffHz;
        gain = ratioF / Math.sqrt(Math.pow(1 - ratioF * ratioF, 2) + ratioF * ratioF);
      }
      
      const y = (h - 40) - gain * (h - 90);
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function updateSlide9Filter() {
    const config = getActiveConfig();
    
    // Toggle slope selector visibility and layout spanning
    if (config.type === "lowpass") {
      slopeBox.style.display = "flex";
      cutoffBox.classList.add("span-all");
    } else {
      slopeBox.style.display = "none";
      cutoffBox.classList.remove("span-all");
    }

    cutoffLbl.textContent = `${config.cutoff} Hz`;
    synth.updateS9FilterConfig(config.type, config.slope, config.cutoff);
    drawFilterCurve(config.cutoff, config.type, config.slope);
  }

  // Type buttons click
  const typeButtons = document.querySelectorAll("#slide-right-9 .btn-filter-type");
  typeButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      typeButtons.forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      updateSlide9Filter();
    });
  });

  // Slope buttons click
  const slopeButtons = document.querySelectorAll("#slide-right-9 .btn-filter-slope");
  slopeButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      slopeButtons.forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      updateSlide9Filter();
    });
  });

  // Cutoff slider input
  cutoffSlider.addEventListener("input", () => {
    updateSlide9Filter();
  });

  // Initial Sync
  updateSlide9Filter();
}

/* --------------------------------------------------------------------------
   Slide 10: Filter Resonance - 2D XY Pad Grid
   -------------------------------------------------------------------------- */
function initSlide10() {
  const canvas = document.getElementById("canvas-s10-filter");
  const ctx = canvas.getContext("2d");
  const pad = document.getElementById("vcf-xy-pad");
  const cursor = document.getElementById("vcf-xy-cursor");
  
  const lblCutoff = document.getElementById("lbl-xy-cutoff");
  const lblRes = document.getElementById("lbl-xy-res");
  
  // Resize canvas
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentNode.getBoundingClientRect().width;
  const h = 180;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.scale(dpr, dpr);
  
  // Draw static filter response curve outline
  function drawFilterCurve(cutoffHz, qVal) {
    const style = getComputedStyle(canvas);
    const bg = style.getPropertyValue("--canvas-bg").trim() || "#08090d";
    const grid = style.getPropertyValue("--canvas-grid").trim() || "rgba(255,255,255,0.03)";
    const trace = style.getPropertyValue("--canvas-trace").trim() || "#66fcf1";
    const glowColor = style.getPropertyValue("--canvas-trace-glow").trim();

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    
    // Draw frequency grids
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    
    // Lowpass filter frequency response approximation drawer
    ctx.strokeStyle = trace;
    if (glowColor && glowColor !== "none" && glowColor !== "") {
      ctx.shadowBlur = 10;
      ctx.shadowColor = glowColor;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.lineWidth = 3;
    ctx.beginPath();
    
    const cutoffX = (Math.log10(cutoffHz) - Math.log10(20)) / (Math.log10(15000) - Math.log10(20)) * w;
    const curvePeakY = h - 60 - (qVal * 4); // Peak resonance pushes up
    
    ctx.moveTo(0, h - 60);
    
    // Flat response before cutoff frequency
    ctx.lineTo(cutoffX * 0.75, h - 60);
    
    // Peak resonance curve right at cutoff frequency
    ctx.bezierCurveTo(
      cutoffX * 0.9, h - 60,
      cutoffX * 0.95, curvePeakY,
      cutoffX, curvePeakY
    );
    
    // Steep roll-off slope after cutoff frequency (subtractive filter cuts highs)
    ctx.bezierCurveTo(
      cutoffX * 1.1, curvePeakY,
      cutoffX * 1.3, h - 10,
      w, h - 5
    );
    
    ctx.stroke();
    ctx.shadowBlur = 0; // reset
  }

  function handlePadCoordChange(clientX, clientY) {
    const rect = pad.getBoundingClientRect();
    const px = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const py = Math.max(0, Math.min(rect.height, clientY - rect.top));
    
    // Move cursor overlay
    cursor.style.left = `${px}px`;
    cursor.style.top = `${py}px`;
    
    // Map X coordinate logarithmically to lowpass filter cutoff frequency (20Hz to 15,000Hz)
    const ratioX = px / rect.width;
    const minF = Math.log10(20);
    const maxF = Math.log10(15000);
    const cutoffHz = Math.round(Math.pow(10, minF + ratioX * (maxF - minF)));
    
    // Map Y coordinate linearly to resonance Q value (0.7 to 15.0)
    const ratioY = 1.0 - (py / rect.height);
    const qVal = parseFloat((0.7 + ratioY * 14.3).toFixed(1));
    
    // Sync to synth engine
    synth.vcf.cutoff = cutoffHz;
    synth.vcf.q = qVal;
    
    lblCutoff.textContent = `${cutoffHz} Hz`;
    lblRes.textContent = qVal.toFixed(1);
    
    // Redraw visual curves background
    drawFilterCurve(cutoffHz, qVal);
    
    // Update filter parameter of active voices dynamically
    synth.activeVoices.forEach(voice => {
      if (voice.filter && voice.slideNum === 10) {
        voice.filter.frequency.setValueAtTime(cutoffHz, synth.ctx.currentTime);
        voice.filter.Q.setValueAtTime(qVal, synth.ctx.currentTime);
      }
    });
  }

  // Bind pad pointer dragging events
  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    state.filterPadDragging = true;
    pad.setPointerCapture(e.pointerId);
    handlePadCoordChange(e.clientX, e.clientY);
  });

  pad.addEventListener("pointermove", (e) => {
    if (state.filterPadDragging) {
      handlePadCoordChange(e.clientX, e.clientY);
    }
  });

  pad.addEventListener("pointerup", (e) => {
    if (state.filterPadDragging) {
      pad.releasePointerCapture(e.pointerId);
      state.filterPadDragging = false;
    }
  });
  
  // Initial static graph curve rendering
  drawFilterCurve(synth.vcf.cutoff, synth.vcf.q);
}

/* --------------------------------------------------------------------------
   Slide 11: LFO - Scrolling Waveform Monitor
   -------------------------------------------------------------------------- */
function initSlide11() {
  const canvas = document.getElementById("canvas-s11-lfo");
  const ctx = canvas.getContext("2d");
  
  const rateSlider = document.getElementById("slider-s11-rate");
  const depthSlider = document.getElementById("slider-s11-depth");
  const rateLbl = document.getElementById("lbl-s11-rate");
  const depthLbl = document.getElementById("lbl-s11-depth");
  
  // Handle resize
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentNode.getBoundingClientRect().width;
  const h = 180;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.scale(dpr, dpr);
  
  function updateLfo() {
    const rate = parseFloat(rateSlider.value);
    const depth = parseFloat(depthSlider.value);
    const waveBtn = document.querySelector("#slide-right-11 .btn-lfo-wave.active");
    const wave = waveBtn ? waveBtn.dataset.lfowave : "sine";
    const destBtn = document.querySelector("#slide-right-11 .btn-lfo-dest.active");
    const destination = destBtn ? destBtn.dataset.lfodest : "none";
    synth.updateLfoParams(rate, depth, wave, destination);
  }

  // Waveform selector buttons
  const waveButtons = document.querySelectorAll("#slide-right-11 .btn-lfo-wave");
  waveButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      waveButtons.forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      updateLfo();
    });
  });

  // Destination selector buttons
  const destButtons = document.querySelectorAll("#slide-right-11 .btn-lfo-dest");
  destButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      destButtons.forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      updateLfo();
    });
  });

  rateSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    rateLbl.textContent = `${val.toFixed(1)} Hz`;
    updateLfo();
  });

  depthSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    depthLbl.textContent = `${(val * 100).toFixed(0)}%`;
    updateLfo();
  });

  // Call initially to sync
  updateLfo();
  
  // Animated scrolling monitor loop
  let offsetTime = 0;
  
  const renderLfoWave = () => {
    if (state.currentSlide !== 10) return; // index for Slide 11 = 10
    state.s11AnimationId = requestAnimationFrame(renderLfoWave);
    
    const style = getComputedStyle(canvas);
    const bg = style.getPropertyValue("--canvas-bg").trim() || "#08090d";
    const axisColor = style.getPropertyValue("--canvas-grid").trim() || "rgba(255,255,255,0.05)";
    const trace = style.getPropertyValue("--canvas-trace").trim() || "#45f3ff";
    const glowColor = style.getPropertyValue("--canvas-trace-glow").trim();
    
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    
    // Draw coordinate axis lines
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    
    // Parameters
    const rate = parseFloat(rateSlider.value);
    const depth = parseFloat(depthSlider.value);
    const waveType = synth.lfoParams.wave;
    
    ctx.strokeStyle = trace;
    if (glowColor && glowColor !== "none" && glowColor !== "") {
      ctx.shadowBlur = 10;
      ctx.shadowColor = glowColor;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    
    // Draw scrolling vector path representing LFO cycle
    offsetTime += 0.05;
    
    for (let x = 0; x < w; x++) {
      // Map x to time cycle
      const timeVal = (x / w) * (1 / rate) * 4 + offsetTime;
      const angle = timeVal * 2 * Math.PI;
      
      let waveY = 0;
      if (waveType === "sine") {
        waveY = Math.sin(angle);
      } else if (waveType === "triangle") {
        waveY = Math.abs((angle % (2 * Math.PI)) / Math.PI - 1) * 2 - 1;
      } else if (waveType === "sawtooth") {
        waveY = 1 - ((angle % (2 * Math.PI)) / (2 * Math.PI)) * 2;
      } else if (waveType === "square") {
        waveY = Math.sin(angle) >= 0 ? 1 : -1;
      }
      
      // Scale height by depth
      const y = h / 2 + waveY * depth * (h / 2 - 20);
      
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    
    ctx.stroke();
    ctx.shadowBlur = 0;
  };
  
  renderLfoWave();
}

/* --------------------------------------------------------------------------
   Slide 12: Master Playground Console
   -------------------------------------------------------------------------- */
function initSlide12() {
  const canvas = document.getElementById("canvas-s12-master");
  activeVisualizer = new Visualizer(canvas);
  
  // Set default view style
  activeVisualizer.startOscilloscope(synth.analyser);
  
  // Toggle visualizers buttons
  const btnScope = document.getElementById("btn-vis-scope");
  const btnFft = document.getElementById("btn-vis-fft");
  
  btnScope.addEventListener("click", () => {
    btnScope.classList.add("active");
    btnFft.classList.remove("active");
    activeVisualizer.startOscilloscope(synth.analyser);
  });
  
  btnFft.addEventListener("click", () => {
    btnFft.classList.add("active");
    btnScope.classList.remove("active");
    activeVisualizer.startFFT(synth.analyser);
  });
  
  // Bind button group selectors
  const waveButtons = document.querySelectorAll("#btn-group-pg-wave .btn-wave-select");
  const pwBox = document.getElementById("pg-pw-box");
  waveButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      waveButtons.forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      const wave = e.currentTarget.dataset.wave;
      pwBox.style.display = (wave === "pulse") ? "block" : "none";
    });
  });

  const noiseColorButtons = document.querySelectorAll("#btn-group-pg-noise-color .btn-wave-select");
  noiseColorButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      noiseColorButtons.forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
    });
  });

  const lfoWaveButtons = document.querySelectorAll("#btn-group-pg-lfo-wave .btn-wave-select");
  lfoWaveButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      lfoWaveButtons.forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      updateLfoParams();
    });
  });

  const lfoDestButtons = document.querySelectorAll("#btn-group-pg-lfo-dest .btn-wave-select");
  lfoDestButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      lfoDestButtons.forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      updateLfoParams();
    });
  });

  // Bind Dial change events
  const cutoffDial = document.getElementById("dial-pg-cutoff");
  const cutoffLbl = document.getElementById("lbl-pg-cutoff");
  cutoffDial.addEventListener("dialchange", () => {
    const val = parseFloat(cutoffDial.dataset.value);
    const res = parseFloat(document.getElementById("dial-pg-res").dataset.value);
    if (val >= 1000) {
      cutoffLbl.textContent = `${(val / 1000).toFixed(1)} kHz`;
    } else {
      cutoffLbl.textContent = `${Math.round(val)} Hz`;
    }
    synth.updatePgFilter(val, res);
  });

  const resDial = document.getElementById("dial-pg-res");
  const resLbl = document.getElementById("lbl-pg-res");
  resDial.addEventListener("dialchange", () => {
    const val = parseFloat(resDial.dataset.value);
    const cutoff = parseFloat(document.getElementById("dial-pg-cutoff").dataset.value);
    resLbl.textContent = val.toFixed(1);
    synth.updatePgFilter(cutoff, val);
  });

  const envDepthDial = document.getElementById("dial-pg-vcf-env-depth");
  const envDepthLbl = document.getElementById("lbl-pg-vcf-env-depth");
  envDepthDial.addEventListener("dialchange", () => {
    const val = parseFloat(envDepthDial.dataset.value);
    const roundedPercent = Math.round(val * 100);
    const sign = roundedPercent > 0 ? "+" : "";
    const displayVal = roundedPercent === 0 ? 0 : roundedPercent;
    envDepthLbl.textContent = `${sign}${displayVal}%`;
    synth.updatePgEnvDepth(val);
  });

  const pwDial = document.getElementById("dial-pg-pw");
  const pwLbl = document.getElementById("lbl-pg-pw");
  pwDial.addEventListener("dialchange", () => {
    const val = parseFloat(pwDial.dataset.value);
    pwLbl.textContent = `${(val * 100).toFixed(0)}%`;
    synth.updatePgPw(val);
  });

  const noiseMixDial = document.getElementById("dial-pg-noise-mix");
  const noiseMixLbl = document.getElementById("lbl-pg-noise-mix");
  noiseMixDial.addEventListener("dialchange", () => {
    const val = parseFloat(noiseMixDial.dataset.value);
    noiseMixLbl.textContent = val < 0.05 ? "100% Osc" : val > 0.95 ? "100% Noise" : `${((1-val)*100).toFixed(0)}% O / ${(val*100).toFixed(0)}% N`;
    synth.updatePgNoiseMix(val);
  });

  const lfoRateDial = document.getElementById("dial-pg-lfo-rate");
  const lfoRateLbl = document.getElementById("lbl-pg-lfo-rate");
  lfoRateDial.addEventListener("dialchange", () => {
    const val = parseFloat(lfoRateDial.dataset.value);
    lfoRateLbl.textContent = `${val.toFixed(1)} Hz`;
    updateLfoParams();
  });

  const lfoDepthDial = document.getElementById("dial-pg-lfo-depth");
  const lfoDepthLbl = document.getElementById("lbl-pg-lfo-depth");
  lfoDepthDial.addEventListener("dialchange", () => {
    const val = parseFloat(lfoDepthDial.dataset.value);
    lfoDepthLbl.textContent = `${(val * 100).toFixed(0)}%`;
    updateLfoParams();
  });

  function updateLfoParams() {
    const rate = parseFloat(lfoRateDial.dataset.value || 2.0);
    const depth = parseFloat(lfoDepthDial.dataset.value || 0.0);
    const waveBtn = document.querySelector("#btn-group-pg-lfo-wave .btn-wave-select.active");
    const wave = waveBtn ? waveBtn.dataset.lfowave : "sine";
    const destBtn = document.querySelector("#btn-group-pg-lfo-dest .btn-wave-select.active");
    const destination = destBtn ? destBtn.dataset.lfodest : "none";
    synth.updatePgLfo(rate, depth, wave, destination);
  }

  // Bind ADSR fader controls
  const adsrSliders = {
    "vca-a": { slider: document.getElementById("slider-pg-vca-a"), lbl: document.getElementById("lbl-pg-vca-a"), suffix: "s" },
    "vca-d": { slider: document.getElementById("slider-pg-vca-d"), lbl: document.getElementById("lbl-pg-vca-d"), suffix: "s" },
    "vca-s": { slider: document.getElementById("slider-pg-vca-s"), lbl: document.getElementById("lbl-pg-vca-s"), suffix: "" },
    "vca-r": { slider: document.getElementById("slider-pg-vca-r"), lbl: document.getElementById("lbl-pg-vca-r"), suffix: "s" },
    "vcf-a": { slider: document.getElementById("slider-pg-vcf-a"), lbl: document.getElementById("lbl-pg-vcf-a"), suffix: "s" },
    "vcf-d": { slider: document.getElementById("slider-pg-vcf-d"), lbl: document.getElementById("lbl-pg-vcf-d"), suffix: "s" },
    "vcf-s": { slider: document.getElementById("slider-pg-vcf-s"), lbl: document.getElementById("lbl-pg-vcf-s"), suffix: "" },
    "vcf-r": { slider: document.getElementById("slider-pg-vcf-r"), lbl: document.getElementById("lbl-pg-vcf-r"), suffix: "s" }
  };
  
  Object.keys(adsrSliders).forEach(key => {
    const item = adsrSliders[key];
    item.slider.addEventListener("input", (e) => {
      const sliderVal = parseFloat(e.target.value);
      let val = sliderVal;
      
      if (key.endsWith("-a") || key.endsWith("-d")) {
        val = 0.005 + 1.995 * Math.pow(sliderVal, 2);
      } else if (key.endsWith("-r")) {
        val = 0.005 + 2.995 * Math.pow(sliderVal, 2);
      }
      
      item.lbl.textContent = `${val.toFixed(2)}${item.suffix}`;
      synth.updateADSREnvelope();
    });
  });

  // Sync initial labels
  Object.keys(adsrSliders).forEach(key => {
    const item = adsrSliders[key];
    const sliderVal = parseFloat(item.slider.value);
    let val = sliderVal;
    if (key.endsWith("-a") || key.endsWith("-d")) {
      val = 0.005 + 1.995 * Math.pow(sliderVal, 2);
    } else if (key.endsWith("-r")) {
      val = 0.005 + 2.995 * Math.pow(sliderVal, 2);
    }
    item.lbl.textContent = `${val.toFixed(2)}${item.suffix}`;
  });

  // Initial Sync
  updateLfoParams();

  // Bind Arpeggiator controls
  initArpeggiatorControls();
}

/* --------------------------------------------------------------------------
   Slide 12: Arpeggiator Sequencer Engine
   -------------------------------------------------------------------------- */
function initArpeggiatorControls() {
  const toggleBtn = document.getElementById("btn-pg-arp-toggle");
  const modeButtons = document.querySelectorAll("#btn-group-pg-arp-mode .btn-wave-select");
  const tempoDial = document.getElementById("dial-pg-arp-tempo");
  const tempoLbl = document.getElementById("lbl-pg-arp-tempo");
  const clearBtn = document.getElementById("btn-pg-arp-clear");

  if (!toggleBtn) return; // Guard for non-playground slides

  // Toggle button listener
  toggleBtn.addEventListener("click", () => {
    if (state.arpEnabled) {
      stopArpeggiator();
    } else {
      startArpeggiator();
    }
  });

  // Mode select listeners
  modeButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      modeButtons.forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      state.arpMode = e.currentTarget.dataset.arpmode;
      state.arpStepIndex = 0; // Reset steps on mode switch
    });
  });

  // Tempo dial listener
  tempoDial.addEventListener("dialchange", () => {
    const val = Math.round(parseFloat(tempoDial.dataset.value));
    tempoLbl.textContent = `${val} BPM`;
    state.arpTempo = val;
    if (state.arpEnabled) {
      // Re-trigger timer immediately with new tempo rate
      startArpTimer();
    }
  });

  // Clear button listener
  clearBtn.addEventListener("click", () => {
    state.arpPattern = [];
    state.arpStepIndex = 0;
    updateArpPatternUI();
    clearArpKeysHighlight();
    
    // Release any lingering active voices
    if (window.synth) {
      synth.activeVoices.forEach((voice, freq) => {
        synth.releaseNote(freq);
      });
    }
  });
}

function startArpeggiator() {
  state.arpEnabled = true;
  state.arpStepIndex = 0;
  
  const toggleBtn = document.getElementById("btn-pg-arp-toggle");
  if (toggleBtn) {
    toggleBtn.classList.add("active");
    toggleBtn.textContent = "STOP";
  }
  
  // Release any keys currently held down to prevent mixing manual notes with sequence
  if (window.synth) {
    synth.activeVoices.forEach((voice, freq) => {
      synth.releaseNote(freq);
    });
  }
  clearArpKeysHighlight();
  
  startArpTimer();
}

function stopArpeggiator() {
  state.arpEnabled = false;
  stopArpTimer();
  
  const toggleBtn = document.getElementById("btn-pg-arp-toggle");
  if (toggleBtn) {
    toggleBtn.classList.remove("active");
    toggleBtn.textContent = "START";
  }
  
  // Release any active voices playing from arpeggiator
  if (window.synth) {
    synth.activeVoices.forEach((voice, freq) => {
      synth.releaseNote(freq);
    });
  }
  clearArpKeysHighlight();
}

function startArpTimer() {
  if (state.arpTimer) {
    clearInterval(state.arpTimer);
    state.arpTimer = null;
  }
  const stepIntervalMs = (60 / state.arpTempo) * 0.5 * 1000; // 8th notes
  state.arpTimer = setInterval(tickArpeggiator, stepIntervalMs);
}

function stopArpTimer() {
  if (state.arpTimer) {
    clearInterval(state.arpTimer);
    state.arpTimer = null;
  }
}

function updateArpPatternUI() {
  const countLbl = document.getElementById("lbl-pg-arp-count");
  if (countLbl) {
    const len = state.arpPattern.length;
    countLbl.textContent = `${len} note${len === 1 ? "" : "s"} stored`;
  }
}

function clearArpKeysHighlight() {
  const matchedKeys = document.querySelectorAll(`#slide-right-12 [data-pitch]`);
  matchedKeys.forEach(el => {
    let isPhysicallyPressed = false;
    const freq = parseFloat(el.dataset.pitch);
    state.pressedKeys.forEach((pressedFreq) => {
      if (Math.abs(pressedFreq - freq) < 0.1) {
        isPhysicallyPressed = true;
      }
    });
    if (!isPhysicallyPressed) {
      el.classList.remove("active");
    }
  });
}

function tickArpeggiator() {
  if (state.arpPattern.length === 0) return;
  if (!state.arpEnabled) return;

  // Resolve active sequence sequence order
  let activeSeq = [];
  if (state.arpMode === "up") {
    activeSeq = [...state.arpPattern].sort((a, b) => a - b);
  } else if (state.arpMode === "down") {
    activeSeq = [...state.arpPattern].sort((a, b) => b - a);
  } else {
    activeSeq = [...state.arpPattern]; // play order
  }

  if (state.arpStepIndex >= activeSeq.length) {
    state.arpStepIndex = 0;
  }

  const freq = activeSeq[state.arpStepIndex];
  
  // Play the note
  synth.playNote(freq, 12);

  // Flash UI key corresponding to this note
  const matchedKeys = document.querySelectorAll(`#slide-right-12 [data-pitch]`);
  const activeKeys = Array.from(matchedKeys).filter(key => Math.abs(parseFloat(key.dataset.pitch) - freq) < 0.1);
  activeKeys.forEach(el => el.classList.add("active"));

  // Calculate step interval and gate lengths
  const stepIntervalMs = (60 / state.arpTempo) * 0.5 * 1000;
  const gateDurationMs = stepIntervalMs * 0.8; // 80% gate length

  // Schedule release
  setTimeout(() => {
    synth.releaseNote(freq);
    activeKeys.forEach(el => {
      // Only remove visual highlight if key is not physically pressed by the user
      let isPhysicallyPressed = false;
      state.pressedKeys.forEach((pressedFreq) => {
        if (Math.abs(pressedFreq - freq) < 0.1) {
          isPhysicallyPressed = true;
        }
      });
      if (!isPhysicallyPressed) {
        el.classList.remove("active");
      }
    });
  }, gateDurationMs);

  state.arpStepIndex++;
}

/* --------------------------------------------------------------------------
   Rotary Dial Knob Dragger Engine
   -------------------------------------------------------------------------- */
function setupInteractiveDials() {
  const dials = document.querySelectorAll(".dial-body.interactive-dial");
  dials.forEach(dial => {
    updateDialVisuals(dial);
    
    let startY = 0;
    let startVal = 0;
    let isDragging = false;
    
    dial.addEventListener("pointerdown", (e) => {
      startY = e.clientY;
      startVal = parseFloat(dial.dataset.value || 0);
      isDragging = true;
      dial.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    
    dial.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      
      const min = parseFloat(dial.dataset.min || 0);
      const max = parseFloat(dial.dataset.max || 1);
      const scale = dial.dataset.scale || "linear";
      const step = parseFloat(dial.dataset.step || 0.01);
      
      const diffY = startY - e.clientY;
      const dragRange = 150;
      
      let newVal = startVal;
      
      if (scale === "log") {
        const logMin = Math.log(min);
        const logMax = Math.log(max);
        const logStart = Math.log(Math.max(min, startVal));
        
        const fStart = (logStart - logMin) / (logMax - logMin);
        const fNew = Math.max(0, Math.min(1, fStart + diffY / dragRange));
        
        newVal = Math.exp(logMin + fNew * (logMax - logMin));
      } else {
        const fStart = (startVal - min) / (max - min);
        const fNew = Math.max(0, Math.min(1, fStart + diffY / dragRange));
        
        newVal = min + fNew * (max - min);
      }
      
      if (step > 0) {
        newVal = Math.round(newVal / step) * step;
      }
      newVal = Math.max(min, Math.min(max, newVal));
      
      dial.dataset.value = newVal;
      updateDialVisuals(dial);
      
      dial.dispatchEvent(new Event("dialchange"));
    });
    
    dial.addEventListener("pointerup", (e) => {
      if (isDragging) {
        dial.releasePointerCapture(e.pointerId);
        isDragging = false;
      }
    });
    
    dial.addEventListener("pointercancel", (e) => {
      if (isDragging) {
        dial.releasePointerCapture(e.pointerId);
        isDragging = false;
      }
    });
  });
}

function updateDialVisuals(dial) {
  const min = parseFloat(dial.dataset.min || 0);
  const max = parseFloat(dial.dataset.max || 1);
  const scale = dial.dataset.scale || "linear";
  const val = parseFloat(dial.dataset.value || 0);
  
  let fraction = 0;
  if (scale === "log") {
    fraction = (Math.log(val) - Math.log(min)) / (Math.log(max) - Math.log(min));
  } else {
    fraction = (val - min) / (max - min);
  }
  
  const angle = -135 + fraction * 270;
  dial.style.transform = `rotate(${angle}deg)`;
}

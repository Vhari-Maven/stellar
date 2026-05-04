// Entry point: build state, wire UI, run animation loop.

import './style.css';
import { createState, record, step } from './physics.js';
import { drawPlot, initPlot, updateStarSVG } from './render.js';
import { updateStats, wireControls } from './ui.js';

const SUB_STEP_YEARS = 5e6;     // years per integration sub-step
const RECORD_INTERVAL_YEARS = 2e7;
const MAX_REAL_DT = 0.1;        // seconds — cap on real-time delta

const state = createState();

const canvas = document.getElementById('plot') as HTMLCanvasElement | null;
if (!canvas) throw new Error('canvas #plot missing');
initPlot(canvas);
wireControls(state);

let lastTime = performance.now();

function loop(now: number): void {
  const dt = Math.min(MAX_REAL_DT, (now - lastTime) / 1000);
  lastTime = now;

  if (!state.paused && state.alive) {
    const dtYears = dt * state.yearsPerSecond;
    const steps = Math.max(1, Math.ceil(dtYears / SUB_STEP_YEARS));
    const subdt = dtYears / steps;
    for (let i = 0; i < steps; i++) step(state, subdt);

    if (state.age - state.lastRecord > RECORD_INTERVAL_YEARS) {
      record(state);
      state.lastRecord = state.age;
    }
  }

  updateStats(state);
  updateStarSVG(state);
  drawPlot(state);

  requestAnimationFrame(loop);
}

record(state);
requestAnimationFrame(loop);

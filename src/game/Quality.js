// Page-wide frame-rate governor.
//
// The display page can run four arenas at once, and every one of them draws on
// its own canvas. Rather than guessing a fixed quality, each arena reports its
// animation-frame timestamps here; when frames start arriving late this drops
// the arena resolution and the particle budget a step at a time, and it climbs
// back up once frames are comfortable again. Effects are cosmetic, so trading
// them for a smooth frame rate is always safe.
//
// One instance per page (this module). Games call observeFrame() every frame;
// already-scheduled frames from other games are ignored, so the timings are the
// page's, not one arena's.
const LEVELS = [
  { name: 'high', resolutionScale: 1, particleBudget: 1400, effectScale: 1 },
  { name: 'medium', resolutionScale: 0.85, particleBudget: 800, effectScale: 0.8 },
  { name: 'low', resolutionScale: 0.7, particleBudget: 450, effectScale: 0.6 },
  { name: 'minimal', resolutionScale: 0.55, particleBudget: 250, effectScale: 0.4 },
];

const SMOOTHING = 0.1; // EMA weight for the frame interval
const SAME_FRAME_MS = 1.5; // callbacks this close together are the same animation frame
const HICCUP_MS = 100; // a single frame longer than this is a stall (GC, layout), not the frame rate
const WARMUP = 5; // frames used to learn the display's refresh period
const MIN_TARGET_MS = 1000 / 70; // never chase faster than ~70 fps: 60 fps is plenty here
// Refresh periods worth believing. requestAnimationFrame can never beat the
// panel's own period, so a "refresh" learned slower than one of these — or
// between two of them — is really a machine dropping frames, not an unusual
// display, and must not raise the bar for what counts as late.
const REFRESH_PERIODS = [1000 / 30, 1000 / 60, 1000 / 75, 1000 / 90, 1000 / 120, 1000 / 144, 1000 / 240];
const REFRESH_TOLERANCE = 0.15;
const SLOW_FACTOR = 1.25; // late once the interval is this far past the display's best
const SLOW_SLACK = 2; // ...plus a little, for timers and vsync jitter
const FAST_FACTOR = 1.05;
const FAST_SLACK = 1.5;
const DEGRADE_AFTER = 20; // consecutive late frames before dropping a level
const RECOVER_AFTER = 150; // consecutive comfortable frames before climbing back
const RECOVER_MAX = 1200; // ...and the cap once climbing back has proved premature
const PREMATURE = 600; // dropping again this soon after climbing back counts as flapping
const COOLDOWN = 30; // frames ignored after a change, so the new level settles

// The frame time this page should be holding, from the fastest interval seen.
function targetFrom(fastest) {
  const known = REFRESH_PERIODS.some((period) => Math.abs(fastest - period) <= period * REFRESH_TOLERANCE);
  const refresh = known ? fastest : 1000 / 60;
  return Math.max(refresh, MIN_TARGET_MS);
}

class QualityController {
  constructor() {
    this.enabled = true;
    this.level = 0;
    this.reset();
  }

  get profile() {
    return LEVELS[this.level];
  }

  reset() {
    this.level = 0;
    this.interval = 0; // EMA of the frame interval, ms
    this.fastest = Infinity; // best interval during warmup, then the fastest recent
    this.warmup = WARMUP;
    this.lastFrameTime = null;
    this.late = 0;
    this.comfortable = 0;
    this.recoverAfter = RECOVER_AFTER;
    this.framesSinceRecover = Infinity; // when the level last climbed back, for flapping
    this.cooldown = 0;
  }

  // Frame timestamp from requestAnimationFrame. Safe to call once per Game.
  observeFrame(time) {
    if (!this.enabled) return;
    // A hidden tab is throttled to a frame a second: that says nothing about
    // whether the effects are too heavy, so don't measure it.
    if (typeof document !== 'undefined' && document.hidden) return;
    const previous = this.lastFrameTime;
    // Several games share one animation frame; only the first callback counts.
    if (previous !== null && Math.abs(time - previous) < SAME_FRAME_MS) return;
    this.lastFrameTime = time;
    if (previous === null) return;

    const dt = time - previous;
    if (!(dt > 0) || dt > 1000) return; // the tab was hidden or the clock jumped
    // One 500 ms stall (garbage collection, a layout, an SSE burst) must not
    // read as "the effects are too heavy". Clamping rather than skipping keeps
    // a machine that is genuinely stuck at a few frames a second detectable.
    const sample = Math.min(dt, HICCUP_MS);

    // Learn this display's cadence from the first few frames, so a 30 Hz screen
    // is not mistaken for a machine that is dropping frames. A cold start that
    // is already overloaded lands here too; targetFrom() below refuses to read
    // that as a slow display.
    if (this.warmup > 0) {
      this.warmup -= 1;
      this.fastest = Math.min(this.fastest, sample);
      this.interval = this.fastest;
      return;
    }

    this.interval += (sample - this.interval) * SMOOTHING;
    // The fastest recent interval is the display's refresh period. Let it creep
    // up slowly (0.01 ms per frame, so seconds), so a display that really is
    // slower is re-learned without a slow patch drifting the target up during
    // the few frames it takes to react.
    if (dt < this.fastest) this.fastest = dt;
    else this.fastest = Math.min(this.fastest + 0.01, this.interval);

    const target = targetFrom(this.fastest);
    const late = this.interval > target * SLOW_FACTOR + SLOW_SLACK;
    const comfortable = this.interval < target * FAST_FACTOR + FAST_SLACK;
    if (this.framesSinceRecover < Infinity) this.framesSinceRecover += 1;

    if (this.cooldown > 0) {
      this.cooldown -= 1;
      this.late = 0;
      this.comfortable = 0;
      return;
    }

    if (late) {
      this.late += 1;
      this.comfortable = 0;
      if (this.late >= DEGRADE_AFTER && this.level < LEVELS.length - 1) {
        this.level += 1;
        this.late = 0;
        this.cooldown = COOLDOWN;
        // A level that proves too slow shortly after climbing back takes longer
        // to climb back to, so a workload sitting between two levels converges
        // instead of flapping every few seconds. A fresh overload event (long
        // after the last recovery) starts from the normal window again.
        if (this.framesSinceRecover < PREMATURE) this.recoverAfter = Math.min(this.recoverAfter * 2, RECOVER_MAX);
        else this.recoverAfter = RECOVER_AFTER;
        this.framesSinceRecover = Infinity;
      }
    } else if (comfortable) {
      this.comfortable += 1;
      this.late = 0;
      if (this.comfortable >= this.recoverAfter && this.level > 0) {
        this.level -= 1;
        this.comfortable = 0;
        this.cooldown = COOLDOWN;
        this.framesSinceRecover = 0;
      }
    } else {
      this.late = 0;
      this.comfortable = 0;
    }
  }
}

export const Quality = new QualityController();

// Frontkamera + MediaPipe Pose Landmarker (läuft komplett im Browser).
//
// Liefert pro Kamerabild eine Probe oder null:
//   { x, y, s, vw, vh, pts }
//   x  = horizontale Rumpfmitte, 0..1, GESPIEGELT (rechts aus Sicht der Person = größer)
//   s  = Rumpflänge (Schulter- bis Hüftmitte) in Pixeln
//   pts = Punkte zum Zeichnen {x, y} (gespiegelt)

const MP_VERSION = '0.10.21';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const LOCAL_MODEL = './models/pose_landmarker_lite.task';

const VIS = 0.25;

export class PoseTracker {
  constructor() {
    this.onSample = () => {};
    this.running = false;
    this.landmarker = null;
    this.stream = null;
    this.video = null;
    this.vw = 0;
    this.vh = 0;
  }

  async start(video, onStatus = () => {}) {
    this.video = video;
    onStatus('Kamera wird gestartet …');
    const portrait = window.innerHeight > window.innerWidth;
    // iOS liefert trotz Hochformat oft ein 16:9-Querformatbild (schmaler Streifen, kleiner
    // vertikaler Ausschnitt). Deshalb mehrere Anfragen nacheinander, bis ein Hochformatbild kommt.
    const fr = { ideal: 30, max: 60 };
    const attempts = portrait
      ? [
          { width: { exact: 720 }, height: { exact: 960 }, frameRate: fr },
          { width: { exact: 720 }, height: { exact: 1280 }, frameRate: fr },
          { width: { ideal: 720 }, height: { ideal: 1280 }, aspectRatio: { ideal: 9 / 16 }, frameRate: fr },
          { width: { ideal: 480 }, height: { ideal: 640 }, aspectRatio: { ideal: 3 / 4 }, frameRate: fr },
          { frameRate: fr },
        ]
      : [{ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: fr }];
    this.stream = null;
    for (let i = 0; i < attempts.length; i++) {
      let st;
      try {
        st = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', ...attempts[i] } });
      } catch (e) {
        if (e?.name === 'NotAllowedError' || e?.name === 'NotFoundError' || i === attempts.length - 1) throw e;
        continue; // Overconstrained: nächste Variante
      }
      video.srcObject = st;
      video.muted = true;
      video.setAttribute('playsinline', '');
      await video.play();
      await new Promise((r) => (video.videoWidth ? r() : video.addEventListener('loadedmetadata', r, { once: true })));
      const ok = !portrait || video.videoHeight >= video.videoWidth;
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = st;
      if (ok) break;
    }
    this.vw = video.videoWidth;
    this.vh = video.videoHeight;
    console.info(`Kamerabild ${this.vw}x${this.vh}`);

    onStatus('Erkennung wird geladen (beim ersten Mal ca. 10 MB) …');
    const vision = await import(`${CDN}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
    const modelAssetPath = await pickModel();
    const make = (delegate) =>
      vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.3,
        minPosePresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      });
    try {
      this.landmarker = await make('GPU');
    } catch (e) {
      console.warn('GPU-Delegate nicht verfügbar, wechsle auf CPU', e);
      this.landmarker = await make('CPU');
    }
    this.running = true;
    this.loop();
  }

  loop() {
    const v = this.video;
    let lastTs = 0;
    let lastMedia = -1;
    const handle = (now) => {
      if (!this.running) return;
      if (v.readyState >= 2 && v.currentTime !== lastMedia) {
        lastMedia = v.currentTime;
        if (v.videoWidth && (v.videoWidth !== this.vw || v.videoHeight !== this.vh)) {
          this.vw = v.videoWidth;
          this.vh = v.videoHeight;
          this.onResize?.();
        }
        const ts = Math.max(lastTs + 1, performance.now());
        lastTs = ts;
        let res = null;
        try {
          res = this.landmarker.detectForVideo(v, ts);
        } catch (e) {
          console.warn('Erkennung fehlgeschlagen', e);
        }
        this.onSample(now ?? performance.now(), this.toSample(res));
      }
      next();
    };
    const next = () => {
      if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback((now) => handle(now));
      else requestAnimationFrame((now) => handle(now));
    };
    next();
  }

  toSample(res) {
    const lm = res?.landmarks?.[0];
    if (!lm) return null;
    const { vw, vh } = this;
    const get = (i) => (lm[i] && (lm[i].visibility ?? 1) >= VIS ? lm[i] : null);
    const sh = [get(11), get(12)].filter(Boolean);
    const hp = [get(23), get(24)].filter(Boolean);
    const all = [...sh, ...hp];
    if (all.length < 2 || !sh.length || !hp.length) return null; // eine Schulter + eine Hüfte reichen
    const avg = (arr, k) => arr.reduce((a, p) => a + p[k], 0) / arr.length;
    const sx = avg(sh, 'x');
    const sy = avg(sh, 'y');
    const hx = avg(hp, 'x');
    const hy = avg(hp, 'y');
    const s = Math.hypot((sx - hx) * vw, (sy - hy) * vh);
    const x = 1 - avg(all, 'x'); // spiegeln: rechts der Person = größeres x
    const y = avg(all, 'y');
    const pts = [...all, lm[0] && (lm[0].visibility ?? 1) >= VIS ? lm[0] : null].filter(Boolean).map((p) => ({ x: 1 - p.x, y: p.y }));
    return { x, y, s, vw, vh, pts };
  }

  stop() {
    this.running = false;
    try {
      this.landmarker?.close();
    } catch {
      /* ignorieren */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
  }
}

async function pickModel() {
  try {
    const r = await fetch(LOCAL_MODEL, { method: 'HEAD' });
    if (r.ok && Number(r.headers.get('content-length') || 1) > 1000) return LOCAL_MODEL;
  } catch {
    /* kein lokales Modell */
  }
  return REMOTE_MODEL;
}

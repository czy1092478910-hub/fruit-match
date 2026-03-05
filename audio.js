/**
 * 水果连连看 - Web Audio API 合成音效与 BGM（无外部文件优先，可兜底 MP3）
 */
(function (global) {
  const BGM_VOLUME = 0.2;
  const BGM_STORAGE_KEY = 'fruit-match-bgm-enabled';
  const BGM_TRACKS = 5;

  let ctx = null;
  let bgmEnabled = true;
  let bgmNodes = null;
  let bgmSource = null;

  try {
    const saved = localStorage.getItem(BGM_STORAGE_KEY);
    if (saved !== null) bgmEnabled = saved === '1';
  } catch (_) {}

  function getCtx() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function getBGMEnabled() { return bgmEnabled; }
  function setBGMEnabled(on) {
    bgmEnabled = !!on;
    try { localStorage.setItem(BGM_STORAGE_KEY, bgmEnabled ? '1' : '0'); } catch (_) {}
    if (!bgmEnabled) stopBGM();
  }

  /** 轻快不刺激的合成 BGM 旋律（每关不同） */
  function startSynthBGM(levelIndex) {
    stopBGM();
    if (!bgmEnabled) return;
    const ac = getCtx();
    const gain = ac.createGain();
    gain.gain.setValueAtTime(BGM_VOLUME, ac.currentTime);
    gain.connect(ac.destination);

    const trackIndex = levelIndex % BGM_TRACKS;
    const tempo = 0.35;
    const notes = [
      [392, 440, 493, 523, 493, 440, 392, 330],
      [262, 294, 330, 349, 330, 294, 262, 220],
      [523, 587, 659, 698, 659, 587, 523, 440],
      [349, 392, 440, 493, 440, 392, 349, 294],
      [294, 330, 349, 392, 440, 392, 349, 330],
    ];
    const mel = notes[trackIndex];
    let t = ac.currentTime;
    const playNote = (freq, dur) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(BGM_VOLUME * 0.7, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(ac.destination);
      o.start(t);
      o.stop(t + dur);
      t += dur;
    };
    const loopDur = mel.length * tempo;
    function schedule() {
      t = ac.currentTime;
      for (let i = 0; i < mel.length; i++) playNote(mel[i], tempo);
      bgmNodes = setTimeout(schedule, loopDur * 1000);
    }
    schedule();
    bgmSource = { type: 'synth', stop: () => { if (bgmNodes) clearTimeout(bgmNodes); bgmNodes = null; } };
  }

  function stopBGM() {
    if (bgmSource && bgmSource.stop) bgmSource.stop();
    bgmSource = null;
    if (bgmNodes) clearTimeout(bgmNodes);
    bgmNodes = null;
  }

  /** 每关开始调用：仅用 Web Audio 合成 BGM，循环播放，轻快不刺激 */
  function startBGM(levelIndex) {
    startSynthBGM(levelIndex);
  }

  function beep(opt) {
    const ac = getCtx();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g);
    g.connect(ac.destination);
    o.type = opt.type || 'sine';
    o.frequency.setValueAtTime(opt.freq || 440, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(opt.freqEnd || opt.freq || 440, ac.currentTime + (opt.duration || 0.1));
    g.gain.setValueAtTime(opt.volume !== undefined ? opt.volume : 0.15, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + (opt.duration || 0.1));
    o.start(ac.currentTime);
    o.stop(ac.currentTime + (opt.duration || 0.1));
  }

  function noise(opt) {
    const ac = getCtx();
    const buf = ac.createBuffer(1, ac.sampleRate * (opt.duration || 0.05), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (opt.volume !== undefined ? opt.volume : 0.08);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain();
    g.gain.setValueAtTime(1, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + (opt.duration || 0.05));
    src.connect(g);
    g.connect(ac.destination);
    src.start(ac.currentTime);
  }

  function playClick() {
    beep({ freq: 520, duration: 0.06, volume: 0.12 });
  }

  function playMatchSuccess() {
    beep({ freq: 523, freqEnd: 784, duration: 0.12, volume: 0.18 });
    setTimeout(() => { noise({ duration: 0.04, volume: 0.06 }); }, 40);
  }

  function playMatchFail() {
    beep({ freq: 200, freqEnd: 180, duration: 0.15, volume: 0.12 });
  }

  function playShuffle() {
    beep({ freq: 400, duration: 0.08, volume: 0.1 });
    setTimeout(() => beep({ freq: 500, duration: 0.08, volume: 0.1 }), 80);
    setTimeout(() => beep({ freq: 600, duration: 0.08, volume: 0.1 }), 160);
  }

  function playHint() {
    beep({ freq: 660, duration: 0.1, volume: 0.12 });
    setTimeout(() => beep({ freq: 880, duration: 0.1, volume: 0.1 }), 100);
  }

  function playLevelClear() {
    beep({ freq: 523, duration: 0.1, volume: 0.15 });
    setTimeout(() => beep({ freq: 659, duration: 0.1, volume: 0.15 }), 120);
    setTimeout(() => beep({ freq: 784, duration: 0.1, volume: 0.15 }), 240);
    setTimeout(() => beep({ freq: 1047, duration: 0.2, volume: 0.18 }), 360);
  }

  function playTimeUp() {
    beep({ freq: 300, duration: 0.2, volume: 0.15 });
    setTimeout(() => beep({ freq: 250, duration: 0.25, volume: 0.15 }), 220);
  }

  /** 通关掌声音效：Web Audio 合成短促击掌（无外部文件） */
  function playClap() {
    const ac = getCtx();
    const t = ac.currentTime;
    for (let i = 0; i < 3; i++) {
      const buf = ac.createBuffer(1, ac.sampleRate * 0.06, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let j = 0; j < data.length; j++) {
        data[j] = (Math.random() * 2 - 1) * 0.25 * Math.exp(-j / (ac.sampleRate * 0.02));
      }
      const src = ac.createBufferSource();
      src.buffer = buf;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.2, t + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.06);
      src.connect(g);
      g.connect(ac.destination);
      src.start(t + i * 0.12);
    }
  }

  /** 连消时轻微升调，不刺激 */
  function playComboSound(comboCount) {
    const base = 523;
    const step = Math.min(comboCount - 1, 3) * 40;
    beep({ freq: base + step, duration: 0.08, volume: 0.12 });
  }

  global.FruitMatchAudio = {
    playClick,
    playMatchSuccess,
    playMatchFail,
    playShuffle,
    playHint,
    playLevelClear,
    playTimeUp,
    playClap,
    playComboSound,
    getBGMEnabled,
    setBGMEnabled,
    startBGM,
    stopBGM,
  };
})(typeof window !== 'undefined' ? window : this);

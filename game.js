/**
 * 水果连连看 - 游戏逻辑（关卡、计时、虚拟边界连通、音效）
 */

const FRUITS = ['🍎','🍊','🍋','🍇','🍓','🍑','🍒','🥝','🍐','🍌','🍉','🍈','🫐','🍍','🥭','🍏'];

const COMBO_WINDOW_MS = 2000;  // 2 秒内连消算 combo，额外 +1s

let rows = 8, cols = 8;
let grid = [];
let selected = null;
let currentLevel = 0;
let levelStartTime = 0;
let levelTimeLimit = 120;
let bonusTimePerMatch = 3;
let timeLeft = 120;
let timerId = null;
let eliminateCount = 0;
let lastEliminateTime = 0;
let comboCount = 0;
let isPaused = false;

const BOARD_SCALE_MIN = 0.8;
const BOARD_SCALE_MAX = 1.2;
const BOARD_SCALE_STORAGE_KEY = 'fruit-match-board-scale';
const OVERLAY_PAD = 25;

let boardEl, resultOverlay;
let resultTitleEl, resultStatsEl, resultBtnEl;
let levelEl, timeEl;
let pauseOverlayFullscreenEl, pauseBtnEl;
let boardZoomWrapperEl, boardWrapEl, boardScalableEl;
let boardScale = 1;
let lineOverlayLines = [];
let lineOverlayRaf = null;
let lastConnectionInfo = null;
let debugPanelVisible = false;
let debugRefreshTimer = null;
let titleClickCount = 0;
let titleClickTimer = null;

function getLevelConfig() {
  return LEVELS[currentLevel] || LEVELS[0];
}

function init() {
  boardEl = document.getElementById('board');
  resultOverlay = document.getElementById('resultOverlay');
  resultTitleEl = document.getElementById('resultTitle');
  resultStatsEl = document.getElementById('resultStats');
  resultBtnEl = document.getElementById('resultBtn');
  levelEl = document.getElementById('levelDisplay');
  timeEl = document.getElementById('timeNum');
  if (!boardEl) return;

  document.getElementById('btnHint').addEventListener('click', hint);
  document.getElementById('btnShuffle').addEventListener('click', shuffle);
  document.getElementById('btnRestart').addEventListener('click', restartLevel);
  resultBtnEl.addEventListener('click', onResultButtonClick);
  pauseOverlayFullscreenEl = document.getElementById('pauseOverlayFullscreen');
  pauseBtnEl = document.getElementById('btnPause');
  if (pauseBtnEl) pauseBtnEl.addEventListener('click', togglePause);
  const btnBGM = document.getElementById('btnBGM');
  if (btnBGM) btnBGM.addEventListener('click', toggleBGM);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') togglePause();
    if (e.key === 'd' && e.ctrlKey) { e.preventDefault(); toggleDebugPanel(); }
  });
  document.getElementById('btnZoomIn').addEventListener('click', () => setBoardScale(Math.min(BOARD_SCALE_MAX, boardScale + 0.1)));
  document.getElementById('btnZoomOut').addEventListener('click', () => setBoardScale(Math.max(BOARD_SCALE_MIN, boardScale - 0.1)));

  try {
    const s = localStorage.getItem(BOARD_SCALE_STORAGE_KEY);
    if (s != null) boardScale = Math.max(BOARD_SCALE_MIN, Math.min(BOARD_SCALE_MAX, parseFloat(s)));
  } catch (_) {}
  boardZoomWrapperEl = document.getElementById('boardZoomWrapper');
  boardWrapEl = document.getElementById('boardWrap');
  boardScalableEl = document.getElementById('boardScalable');

  const titleEl = document.querySelector('.header h1');
  if (titleEl) {
    titleEl.addEventListener('click', () => {
      titleClickCount++;
      if (titleClickCount === 1) titleClickTimer = setTimeout(() => { titleClickCount = 0; titleClickTimer = null; }, 2000);
      if (titleClickCount >= 5) {
        if (titleClickTimer) clearTimeout(titleClickTimer);
        titleClickCount = 0;
        titleClickTimer = null;
        toggleDebugPanel();
      }
    });
  }
  document.getElementById('debugCopy').addEventListener('click', copyDiagnostic);
  document.getElementById('debugResetZoom').addEventListener('click', () => setBoardScale(1));
  document.getElementById('debugRedrawLines').addEventListener('click', forceRedrawLineLayer);

  startLevel(0);
  updateZoomDisplay();
  updateBoardWrapSize();
  window.addEventListener('resize', () => { updateBoardWrapSize(); ensureLineOverlayCanvas(); });
}

function startLevel(levelIndex) {
  currentLevel = levelIndex;
  const cfg = getLevelConfig();
  rows = cfg.rows;
  cols = cfg.cols;
  levelTimeLimit = cfg.time;
  bonusTimePerMatch = cfg.bonusTime;
  timeLeft = levelTimeLimit;
  levelStartTime = Date.now();
  eliminateCount = 0;
  lastEliminateTime = 0;
  comboCount = 0;

  const pairs = createPairs();
  grid = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      grid[r][c] = pairs[r * cols + c];
    }
  }
  selected = null;
  isPaused = false;
  resultOverlay.hidden = true;
  if (pauseOverlayFullscreenEl) pauseOverlayFullscreenEl.hidden = true;
  if (pauseBtnEl) pauseBtnEl.textContent = '⏸ 暂停';
  updateLevelDisplay();
  updateTimeDisplay();
  updateBGMButton();
  startTimer();
  render();
  if (typeof FruitMatchAudio !== 'undefined') FruitMatchAudio.startBGM(currentLevel);
}

function createPairs() {
  const cfg = getLevelConfig();
  const pairCount = (rows * cols) / 2;
  const types = Math.min(cfg.types, FRUITS.length);
  const arr = [];
  for (let i = 0; i < pairCount; i++) {
    const t = i % types;
    arr.push(t, t);
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function updateLevelDisplay() {
  if (levelEl) levelEl.textContent = `第 ${currentLevel + 1} 关 / 共 10 关`;
}

function updateTimeDisplay() {
  if (timeEl) timeEl.textContent = timeLeft;
  const fill = document.getElementById('timeBarFill');
  if (fill) {
    const pct = levelTimeLimit > 0 ? (timeLeft / levelTimeLimit) * 100 : 0;
    fill.style.height = pct + '%';
    fill.setAttribute('data-theme', (currentLevel % 5));
  }
}

function startTimer() {
  stopTimer();
  timerId = setInterval(() => {
    if (isPaused) return;
    if (timeLeft <= 0) {
      stopTimer();
      onTimeUp();
      return;
    }
    timeLeft--;
    updateTimeDisplay();
  }, 1000);
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function addTime(seconds) {
  timeLeft = Math.max(0, timeLeft + seconds);
  updateTimeDisplay();
}

function onTimeUp() {
  stopTimer();
  if (typeof FruitMatchAudio !== 'undefined') FruitMatchAudio.playTimeUp();
  showResult(false, 0, 0);
}

function showResult(isWin, timeUsed, eliminations) {
  if (typeof FruitMatchAudio !== 'undefined') FruitMatchAudio.stopBGM();
  resultOverlay.hidden = false;
  if (isWin) {
    resultTitleEl.textContent = currentLevel + 1 >= LEVELS.length ? '🎉 全部通关！' : '🎉 恭喜过关！';
    resultStatsEl.innerHTML = `本关用时 ${timeUsed} 秒 &nbsp;|&nbsp; 消除 ${eliminations} 对`;
    if (currentLevel + 1 >= LEVELS.length) {
      resultBtnEl.textContent = '从第 1 关再玩';
    } else {
      resultBtnEl.textContent = '进入下一关';
    }
  } else {
    resultTitleEl.textContent = '⏰ 时间到';
    resultStatsEl.textContent = '再试一次本关吧';
    resultBtnEl.textContent = '重试本关';
  }
}

function onResultButtonClick() {
  resultOverlay.hidden = true;
  if (resultBtnEl.textContent === '进入下一关') {
    startLevel(currentLevel + 1);
  } else if (resultBtnEl.textContent === '从第 1 关再玩') {
    startLevel(0);
  } else {
    startLevel(currentLevel);
  }
}

function restartLevel() {
  startLevel(currentLevel);
}

function render() {
  const { boardInnerW, boardInnerH, boardInnerBoxW, boardInnerBoxH, boxMargin } = getBoardContentSize();
  const innerEl = boardEl.closest('.board-inner');
  const gridWrapper = boardEl.closest('.grid-wrapper');
  if (innerEl) {
    innerEl.style.width = boardInnerBoxW + 'px';
    innerEl.style.height = boardInnerBoxH + 'px';
    innerEl.style.padding = boxMargin + 'px';
  }
  if (gridWrapper) {
    gridWrapper.style.width = boardInnerW + 'px';
    gridWrapper.style.height = boardInnerH + 'px';
  }
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${cols}, var(--cell))`;
  boardEl.style.gridTemplateRows = `repeat(${rows}, var(--cell))`;
  boardEl.style.width = boardInnerW + 'px';
  boardEl.style.height = boardInnerH + 'px';
  boardEl.setAttribute('aria-label', `${rows}行${cols}列水果棋盘`);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.setAttribute('role', 'gridcell');
      const v = grid[r][c];
      if (v === null) {
        cell.classList.add('empty');
        cell.textContent = '';
        cell.setAttribute('aria-label', '空');
      } else {
        cell.textContent = FRUITS[v];
        cell.setAttribute('aria-label', '水果 ' + (v + 1));
        if (selected && selected.r === r && selected.c === c) {
          cell.classList.add('selected');
        }
        cell.addEventListener('click', () => onCellClick(r, c));
      }
      boardEl.appendChild(cell);
    }
  }
  updateBoardWrapSize();
  ensureLineOverlayCanvas();
}

function getCellEl(r, c) {
  return boardEl ? boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`) : null;
}

function onCellClick(r, c) {
  if (isPaused) return;
  if (grid[r][c] === null) return;
  if (typeof FruitMatchAudio !== 'undefined') FruitMatchAudio.playClick();

  if (selected) {
    if (selected.r === r && selected.c === c) {
      selected = null;
      render();
      return;
    }
    if (grid[selected.r][selected.c] === grid[r][c] && canConnect(selected.r, selected.c, r, c)) {
      playMatch(selected.r, selected.c, r, c);
      selected = null;
      return;
    }
    if (typeof FruitMatchAudio !== 'undefined') FruitMatchAudio.playMatchFail();
    selected = { r, c };
  } else {
    selected = { r, c };
  }
  render();
}

/**
 * 判断 (r,c) 在寻路中是否可通行。
 * 棋盘外一圈 (-1..rows, -1..cols) 视为虚拟空白，经典连连看规则。
 */
function isEmpty(r1, c1, r2, c2, r, c) {
  if (r === r1 && c === c1) return true;
  if (r === r2 && c === c2) return true;
  if (r < 0 || r >= rows || c < 0 || c >= cols) return true;
  return grid[r][c] === null;
}

/** 两点间是否可连（最多两折），支持棋盘外绕行 */
function canConnect(r1, c1, r2, c2) {
  return getConnectPath(r1, c1, r2, c2) !== null;
}

/** 从 (r,c) 到 (nr,nc) 的移动方向：1右 2左 3下 4上，0起点 */
function getMoveDir(r, c, nr, nc) {
  if (nr < r) return 4;
  if (nr > r) return 3;
  if (nc > c) return 1;
  if (nc < c) return 2;
  return 0;
}
/** 是否算拐弯：fromDir 与 newDir 一个水平一个垂直则拐弯 */
function isTurn(fromDir, newDir) {
  if (fromDir === 0) return false;
  const h = (d) => d === 1 || d === 2;
  return h(fromDir) !== h(newDir);
}

/**
 * BFS 寻路：最多 2 拐，返回最短路径（优先拐点少，其次步数少）。
 * 返回 [p1, corner1?, corner2?, p2] 或 null。
 */
function getConnectPath(r1, c1, r2, c2) {
  if (r1 === r2 && c1 === c2) return null;
  const v1 = grid[r1][c1], v2 = grid[r2][c2];
  if (v1 === null || v2 === null || v1 !== v2) return null;

  const empty = (r, c) => isEmpty(r1, c1, r2, c2, r, c);
  const R = rows + 2, C = cols + 2;
  const toKey = (r, c) => (r + 1) * C + (c + 1);
  const INF = 1e9;
  const best = {};
  function getBest(r, c, dir, turns) {
    const k = (toKey(r, c) << 8) | (dir << 2) | turns;
    return best[k] !== undefined ? best[k] : INF;
  }
  function setBest(r, c, dir, turns, steps) {
    const k = (toKey(r, c) << 8) | (dir << 2) | turns;
    if (steps < (best[k] ?? INF)) { best[k] = steps; return true; }
    return false;
  }

  const Q = [[], [], []];
  function enqueue(turns, r, c, fromDir, steps, path) {
    if (turns > 2) return;
    if (!setBest(r, c, fromDir, turns, steps)) return;
    const copy = path.slice();
    copy.push({ r, c });
    Q[turns].push({ r, c, fromDir, steps, path: copy });
  }

  enqueue(0, r1, c1, 0, 0, []);
  let bestPath = null;
  let bestTurns = Infinity;
  let bestSteps = Infinity;
  const dr = [-1, 1, 0, 0], dc = [0, 0, 1, -1];
  for (let t = 0; t <= 2; t++) {
    while (Q[t].length) {
      const { r, c, fromDir, steps, path } = Q[t].shift();
      if (r === r2 && c === c2) {
        if (t < bestTurns || (t === bestTurns && steps < bestSteps)) {
          bestPath = path;
          bestTurns = t;
          bestSteps = steps;
        }
        continue;
      }
      for (let i = 0; i < 4; i++) {
        const nr = r + dr[i], nc = c + dc[i];
        if (nr < -1 || nr > rows || nc < -1 || nc > cols) continue;
        if (!empty(nr, nc)) continue;
        const newDir = getMoveDir(r, c, nr, nc);
        const newTurns = isTurn(fromDir, newDir) ? t + 1 : t;
        if (newTurns > 2) continue;
        enqueue(newTurns, nr, nc, newDir, steps + 1, path);
      }
    }
  }
  return bestPath ? compressPath(bestPath) : null;
}

/** 将逐格路径压缩为 [起点, 拐点..., 终点] */
function compressPath(path) {
  if (!path || path.length <= 2) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1], b = path[i], c = path[i + 1];
    const mid = (a.r === b.r && b.r === c.r) || (a.c === b.c && b.c === c.c);
    if (!mid) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}

/** 与 CSS 统一：--cell, --gap, --border；大框边距 = (cell+gap)/2 */
function getBoardMetrics() {
  const root = document.documentElement;
  const cell = parseFloat(getComputedStyle(root).getPropertyValue('--cell').trim()) || 64;
  const gap = parseFloat(getComputedStyle(root).getPropertyValue('--gap').trim()) || 4;
  const border = parseFloat(getComputedStyle(root).getPropertyValue('--border').trim()) || 3;
  const boxMargin = (cell + gap) / 2;
  return { cell, gap, border, boxMargin };
}

/** 大背景框 (n+1)×(n+1)：boxInner=(cols+1)*cell+cols*gap，网格=cols*cell+(cols-1)*gap 居中 */
function getBoardContentSize() {
  const { cell, gap, border, boxMargin } = getBoardMetrics();
  const boardInnerGridW = cols * cell + (cols - 1) * gap;
  const boardInnerGridH = rows * cell + (rows - 1) * gap;
  const boardInnerBoxW = (cols + 1) * cell + cols * gap;
  const boardInnerBoxH = (rows + 1) * cell + rows * gap;
  const boardWidth = boardInnerBoxW + 2 * border;
  const boardHeight = boardInnerBoxH + 2 * border;
  return {
    w: boardWidth,
    h: boardHeight,
    boardInnerW: boardInnerGridW,
    boardInnerH: boardInnerGridH,
    boardInnerBoxW,
    boardInnerBoxH,
    boxMargin,
  };
}

function updateBoardWrapSize() {
  if (!boardZoomWrapperEl || !boardWrapEl || !boardScalableEl) return;
  const { w, h } = getBoardContentSize();
  const { border } = getBoardMetrics();
  const s = boardScale;
  const innerTotalW = w - 2 * border;
  const innerTotalH = h - 2 * border;
  boardScalableEl.style.width = innerTotalW + 'px';
  boardScalableEl.style.height = innerTotalH + 'px';
  boardWrapEl.style.width = w + 'px';
  boardWrapEl.style.height = h + 'px';
  boardWrapEl.style.transform = `scale(${s})`;
  const wrapperSize = Math.max(1, s);
  boardZoomWrapperEl.style.width = (w * wrapperSize) + 'px';
  boardZoomWrapperEl.style.height = (h * wrapperSize) + 'px';
}

function setBoardScale(s) {
  boardScale = Math.max(BOARD_SCALE_MIN, Math.min(BOARD_SCALE_MAX, s));
  try { localStorage.setItem(BOARD_SCALE_STORAGE_KEY, String(boardScale)); } catch (_) {}
  if (boardWrapEl) boardWrapEl.style.transform = `scale(${boardScale})`;
  updateBoardWrapSize();
  updateZoomDisplay();
}

function updateZoomDisplay() {
  const el = document.getElementById('zoomPercent');
  if (el) el.textContent = Math.round(boardScale * 100) + '%';
}

/** 格子 (r,c) 在 overlay 坐标系中的中心（网格距框边 boxMargin，中心 = boxMargin + (i+0.5)*cell + i*gap） */
function gridToOverlayPixel(r, c) {
  const { cell, gap, boxMargin } = getBoardMetrics();
  return {
    x: OVERLAY_PAD + boxMargin + (c + 0.5) * cell + c * gap,
    y: OVERLAY_PAD + boxMargin + (r + 0.5) * cell + r * gap,
  };
}

function ensureLineOverlayCanvas() {
  const container = document.getElementById('lineOverlay');
  if (!container) return;
  const { boardInnerBoxW, boardInnerBoxH } = getBoardContentSize();
  const ow = boardInnerBoxW + 2 * OVERLAY_PAD;
  const oh = boardInnerBoxH + 2 * OVERLAY_PAD;
  let canvas = container.querySelector('canvas');
  const dpr = window.devicePixelRatio || 1;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    container.appendChild(canvas);
  }
  var needResize = canvas.width !== ow * dpr || canvas.height !== oh * dpr;
  if (needResize) {
    canvas.width = ow * dpr;
    canvas.height = oh * dpr;
  }
  canvas.style.width = ow + 'px';
  canvas.style.height = oh + 'px';
  container.style.width = ow + 'px';
  container.style.height = oh + 'px';
  container.style.left = (-OVERLAY_PAD) + 'px';
  container.style.top = (-OVERLAY_PAD) + 'px';
  return { canvas, dpr, ow, oh };
}

function drawLineThenFade(r1, c1, r2, c2) {
  const pathPoints = getConnectPath(r1, c1, r2, c2);
  if (!pathPoints || pathPoints.length < 2) return;
  const turns = pathPoints.length - 2;
  let length = 0;
  for (let i = 1; i < pathPoints.length; i++) {
    const a = pathPoints[i - 1], b = pathPoints[i];
    length += Math.abs(b.r - a.r) + Math.abs(b.c - a.c);
  }
  lastConnectionInfo = { path: pathPoints, turns, length };
  const obj = ensureLineOverlayCanvas();
  if (!obj) return;
  const pts = pathPoints.map(p => gridToOverlayPixel(p.r, p.c));
  lineOverlayLines.push({ pts, startTime: Date.now() });
  function drawFrame() {
    const { canvas, dpr, ow, oh } = ensureLineOverlayCanvas() || {};
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const now = Date.now();
    const dur = 320;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    let anyLeft = false;
    for (let i = lineOverlayLines.length - 1; i >= 0; i--) {
      const { pts: p, startTime } = lineOverlayLines[i];
      const elapsed = now - startTime;
      const opacity = Math.max(0, 1 - elapsed / dur);
      if (opacity <= 0) {
        lineOverlayLines.splice(i, 1);
        continue;
      }
      anyLeft = true;
      const path = new Path2D();
      path.moveTo(p[0].x, p[0].y);
      for (let j = 1; j < p.length; j++) path.lineTo(p[j].x, p[j].y);
      ctx.strokeStyle = `rgba(230,81,0,${0.5 * opacity})`;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
      ctx.strokeStyle = `rgba(230,81,0,${opacity})`;
      ctx.lineWidth = 5;
      ctx.stroke(path);
    }
    ctx.restore();
    if (anyLeft) {
      lineOverlayRaf = requestAnimationFrame(drawFrame);
    } else {
      lineOverlayRaf = null;
    }
  }
  if (!lineOverlayRaf) lineOverlayRaf = requestAnimationFrame(drawFrame);
}

function showCombo(count) {
  if (count < 2) return;
  if (typeof FruitMatchAudio !== 'undefined') FruitMatchAudio.playComboSound(count);
  const inner = boardEl.closest('.board-inner');
  if (!inner) return;
  const el = document.createElement('div');
  el.className = 'combo-float';
  el.textContent = '连消 x' + count;
  inner.appendChild(el);
  el.animate([{ opacity: 1, transform: 'scale(1.1)' }, { opacity: 0, transform: 'scale(1.2)' }], { duration: 2000, fill: 'forwards' });
  setTimeout(() => el.remove(), 2100);
}

function playMatch(r1, c1, r2, c2) {
  if (typeof FruitMatchAudio !== 'undefined') FruitMatchAudio.playMatchSuccess();

  drawLineThenFade(r1, c1, r2, c2);

  const el1 = getCellEl(r1, c1);
  const el2 = getCellEl(r2, c2);
  if (el1) el1.classList.add('match');
  if (el2) el2.classList.add('match');

  const now = Date.now();
  if (now - lastEliminateTime <= COMBO_WINDOW_MS) {
    comboCount++;
    addTime(1);
    showCombo(comboCount);
  } else {
    comboCount = 1;
  }
  lastEliminateTime = now;

  addTime(bonusTimePerMatch);
  eliminateCount++;

  setTimeout(() => {
    grid[r1][c1] = null;
    grid[r2][c2] = null;
    render();
    if (isWin()) {
      stopTimer();
      const timeUsed = Math.round((Date.now() - levelStartTime) / 1000);
      if (currentLevel + 1 >= LEVELS.length && typeof window.showWinPage === 'function') {
        if (typeof FruitMatchAudio !== 'undefined') FruitMatchAudio.stopBGM();
        window.showWinPage(false);
      } else {
        if (typeof FruitMatchAudio !== 'undefined') FruitMatchAudio.playLevelClear();
        showResult(true, timeUsed, eliminateCount);
      }
    }
  }, 400);
}

function isWin() {
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] !== null) return false;
  return true;
}

function findHint() {
  const list = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] !== null) list.push({ r, c });
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (grid[a.r][a.c] === grid[b.r][b.c] && canConnect(a.r, a.c, b.r, b.c)) {
        return [a.r, a.c, b.r, b.c];
      }
    }
  }
  return null;
}

function togglePause() {
  isPaused = !isPaused;
  if (pauseOverlayFullscreenEl) pauseOverlayFullscreenEl.hidden = !isPaused;
  if (pauseBtnEl) pauseBtnEl.textContent = isPaused ? '▶ 继续' : '⏸ 暂停';
}

function toggleBGM() {
  if (typeof FruitMatchAudio === 'undefined') return;
  FruitMatchAudio.setBGMEnabled(!FruitMatchAudio.getBGMEnabled());
  updateBGMButton();
  if (FruitMatchAudio.getBGMEnabled()) FruitMatchAudio.startBGM(currentLevel);
  else FruitMatchAudio.stopBGM();
}

function updateBGMButton() {
  const btn = document.getElementById('btnBGM');
  if (!btn) return;
  btn.textContent = (typeof FruitMatchAudio !== 'undefined' && FruitMatchAudio.getBGMEnabled()) ? '🔊 音乐开' : '🔇 音乐关';
}

function hint() {
  if (isPaused) return;
  const h = findHint();
  if (!h) return;
  if (typeof FruitMatchAudio !== 'undefined') FruitMatchAudio.playHint();
  const [r1, c1, r2, c2] = h;
  const el1 = getCellEl(r1, c1);
  const el2 = getCellEl(r2, c2);
  if (el1) el1.classList.add('hint');
  if (el2) el2.classList.add('hint');
  setTimeout(() => {
    if (el1) el1.classList.remove('hint');
    if (el2) el2.classList.remove('hint');
  }, 1200);
}

function shuffle() {
  if (isPaused) return;
  if (typeof FruitMatchAudio !== 'undefined') FruitMatchAudio.playShuffle();
  const list = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] !== null) list.push(grid[r][c]);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  let i = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      grid[r][c] = grid[r][c] === null ? null : list[i++];
  selected = null;
  render();
}

function toggleDebugPanel() {
  debugPanelVisible = !debugPanelVisible;
  const panel = document.getElementById('debugPanel');
  if (!panel) return;
  panel.hidden = !debugPanelVisible;
  if (debugPanelVisible) {
    refreshDebugPanel();
    if (!debugRefreshTimer) debugRefreshTimer = setInterval(refreshDebugPanel, 200);
  } else {
    if (debugRefreshTimer) {
      clearInterval(debugRefreshTimer);
      debugRefreshTimer = null;
    }
  }
}

function getDiagnosticText() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const wrap = boardWrapEl ? boardWrapEl.getBoundingClientRect() : null;
  const wrapLeft = wrap ? wrap.left : 0;
  const wrapTop = wrap ? wrap.top : 0;
  const wrapWidth = wrap ? wrap.width : 0;
  const wrapHeight = wrap ? wrap.height : 0;
  const overflowX = wrap ? (wrap.left < 0 || wrap.right > vw) : false;
  const overflowY = wrap ? (wrap.top < 0 || wrap.bottom > vh) : false;
  let clipped = false;
  if (boardWrapEl && boardScalableEl) {
    const wrapRect = boardWrapEl.getBoundingClientRect();
    const scalRect = boardScalableEl.getBoundingClientRect();
    if (scalRect.left < wrapRect.left - 1 || scalRect.top < wrapRect.top - 1 ||
        scalRect.right > wrapRect.right + 1 || scalRect.bottom > wrapRect.bottom + 1) {
      clipped = true;
    }
  }
  const lineEl = document.getElementById('lineOverlay');
  const lineW = lineEl ? lineEl.offsetWidth : 0;
  const lineH = lineEl ? lineEl.offsetHeight : 0;
  const { w, h } = getBoardContentSize();
  const lineMatch = (lineW === w + 2 * OVERLAY_PAD && lineH === h + 2 * OVERLAY_PAD);
  let lastLine = '无';
  if (lastConnectionInfo) {
    const { path, turns, length } = lastConnectionInfo;
    const ptsStr = path.map(p => `(${p.r},${p.c})`).join(' ');
    lastLine = `拐点=${turns} 长度=${length} 路径=${ptsStr}`;
  }
  return [
    `当前缩放比例: scale = ${Math.round(boardScale * 100)}%`,
    `视口尺寸: ${vw} x ${vh}`,
    `棋盘容器 bounding box: left=${Math.round(wrapLeft)} top=${Math.round(wrapTop)} width=${Math.round(wrapWidth)} height=${Math.round(wrapHeight)}`,
    `棋盘是否溢出视口: overflowX = ${overflowX}, overflowY = ${overflowY}`,
    `棋盘是否被裁切: clipped = ${clipped}`,
    `连线层尺寸: lineLayer width=${lineW} height=${lineH} 与棋盘+边距一致=${lineMatch}`,
    `最近一次连线: ${lastLine}`,
  ].join('\n');
}

function refreshDebugPanel() {
  const content = document.getElementById('debugPanelContent');
  if (content && debugPanelVisible) content.textContent = getDiagnosticText();
}

function copyDiagnostic() {
  const text = getDiagnosticText();
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('debugCopy');
    if (btn) { const t = btn.textContent; btn.textContent = '已复制'; setTimeout(() => { btn.textContent = t; }, 800); }
  }).catch(() => {});
}

function forceRedrawLineLayer() {
  ensureLineOverlayCanvas();
  const canvas = document.querySelector('#lineOverlay canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  refreshDebugPanel();
}

// ---------- 连通性测试（虚拟边界 + 不穿过非空格） ----------
function runConnectivityTests() {
  const results = [];
  let passed = 0, failed = 0;

  function test(name, rows_, cols_, gridData, pairs, expectConnected) {
    const backup = { rows, cols, grid };
    rows = rows_;
    cols = cols_;
    grid = gridData.map(row => [...row]);
    let ok = true;
    for (const [r1, c1, r2, c2] of pairs) {
      const res = canConnect(r1, c1, r2, c2);
      if (res !== expectConnected) {
        ok = false;
        break;
      }
    }
    rows = backup.rows;
    cols = backup.cols;
    grid = backup.grid;
    if (ok) { passed++; results.push({ name, ok: true }); }
    else { failed++; results.push({ name, ok: false, expect: expectConnected }); }
  }

  // 1) 上边缘：顶行 (0,0) 与 (0,3) 同色，中间被挡，须经上方虚拟行绕行
  test('上边缘绕行', 2, 4,
    [[0, 1, 1, 0], [1, 0, 0, 1]],
    [[0, 0, 0, 3]],
    true);

  // 2) 下边缘：(1,0) 与 (1,3) 同色，经下方虚拟行绕行
  test('下边缘绕行', 2, 4,
    [[0, 1, 1, 0], [1, 0, 0, 1]],
    [[1, 0, 1, 3]],
    true);

  // 3) 左边缘：(0,0) 与 (3,0) 同色，经左侧虚拟列绕行
  test('左边缘绕行', 4, 2,
    [[0, 1], [1, 0], [1, 0], [0, 1]],
    [[0, 0, 3, 0]],
    true);

  // 4) 右边缘：(0,1) 与 (3,1) 同色，经右侧虚拟列绕行
  test('右边缘绕行', 4, 2,
    [[0, 1], [1, 0], [1, 0], [0, 1]],
    [[0, 1, 3, 1]],
    true);

  // 5) 角落绕行：(0,0) 与 (1,1) 同色，沿棋盘外两折可连
  test('角落绕行', 2, 2,
    [[0, 1], [1, 0]],
    [[0, 0, 1, 1]],
    true);

  // 6) 路径不能穿过非空格：(0,0) 与 (2,2) 同色，但中间 (1,1) 被挡
  test('路径穿过非空应失败', 3, 3,
    [[0, 1, 0], [1, 1, 1], [0, 1, 0]],
    [[0, 0, 2, 2]],
    false);

  return { passed, failed, results };
}

if (typeof window !== 'undefined') {
  window.runConnectivityTests = runConnectivityTests;
  window.startLevel = startLevel;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

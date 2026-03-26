<template>
  <div class="sudoku-page">
    <div class="page-shell">
      <section class="main-area">
        <div class="primary">
          <header class="hero">
            <div class="hero-copy">
              <p class="eyebrow">sudoku game</p>
              <h1>Sudoku</h1>
              <p class="subtitle">
                Rule: each row, column, and 3x3 box must contain 1-9 with no repeats.
              </p>
            </div>
          </header>

          <div class="board-section">
            <div class="board" role="grid" aria-label="Sudoku board">
              <div v-for="(row, r) in grid" :key="'row-' + r" class="row" role="row">
                <div
                  v-for="(cell, c) in row"
                  :key="'cell-' + r + '-' + c"
                  class="cell"
                  :class="cellClasses(cell, r, c)"
                  role="gridcell"
                >
                  <input
                    class="cell-input"
                    type="text"
                    inputmode="numeric"
                    pattern="[1-9]"
                    maxlength="1"
                    :value="cell.value === 0 ? '' : cell.value"
                    :readonly="cell.given || solving"
                    :aria-label="`Row ${r + 1} Column ${c + 1}`"
                    @input="onCellInput(r, c, $event)"
                  />
                </div>
              </div>
            </div>
          </div>

          <div class="status status-below" :data-state="statusState">{{ statusMessage }}</div>
        </div>

        <aside class="side-panel">
          <div class="legend">
            <div class="legend-item">
              <span class="swatch given"></span>
              <span>Given cell</span>
            </div>
            <div class="legend-item">
              <span class="swatch number given-number">1</span>
              <span>Given number</span>
            </div>
            <div class="legend-item">
              <span class="swatch empty"></span>
              <span>Empty cell</span>
            </div>
            <div class="legend-item">
              <span class="swatch number user-number">1</span>
              <span>User number</span>
            </div>
            <div class="legend-item">
              <span class="swatch error"></span>
              <span>Conflict cell</span>
            </div>
          </div>

          <section class="controls">
            <button class="btn validate" type="button" @click="validatePuzzle" :disabled="solving">
              Validate
            </button>
            <button
              class="btn secondary"
              type="button"
              @click="generateNewPuzzle"
              :disabled="solving"
            >
              Random
            </button>
            <button class="btn accent" type="button" @click="solveAnimated" :disabled="solving">
              Auto Solve
            </button>
            <button class="btn pause" type="button" @click="togglePause" :disabled="!solving">
              {{ pauseLabel }}
            </button>
          </section>

          <section class="sliders">
            <div class="slider difficulty">
              <label class="slider-label" for="difficulty">
                Difficulty: {{ difficultyLabel }}
              </label>
              <input
                id="difficulty"
                type="range"
                min="1"
                max="5"
                step="1"
                v-model.number="difficulty"
                :disabled="solving"
              />
              <div class="slider-hint">Givens: {{ givenCount }}</div>
            </div>
            <div class="slider speed">
              <label class="slider-label" for="speed">
                Solve speed:
                <span class="speed-value" aria-live="polite">{{ speed }}</span>
                ms / step
              </label>
              <input
                id="speed"
                type="range"
                min="0"
                max="100"
                step="1"
                v-model.number="speed"
              />
              <div class="slider-hint">Backtracking is shown live.</div>
            </div>
          </section>
        </aside>
      </section>
    </div>
  </div>
</template>

<script setup>
import {computed, nextTick, onMounted, ref, watch} from 'vue';

const grid = ref(makeGrid());
const difficulty = ref(3);
const speed = ref(50);
const solving = ref(false);
const paused = ref(false);
const abortSolve = ref(false);
const statusMessage = ref('Ready');
const statusState = ref('idle');

const difficultyTable = [
  { label: 'Easy', removals: 32 },
  { label: 'Normal', removals: 42 },
  { label: 'Hard', removals: 52 },
  { label: 'Expert', removals: 58 },
  { label: 'Master', removals: 62 },
];

const difficultyLabel = computed(() => difficultyTable[difficulty.value - 1].label);
const givenCount = computed(
  () => 81 - difficultyTable[difficulty.value - 1].removals
);
const pauseLabel = computed(() => (solving.value && paused.value ? 'Resume' : 'Pause'));

onMounted(() => {
  generateNewPuzzle();
});

watch(difficulty, () => {
  if (!solving.value) {
    generateNewPuzzle();
  }
});

watch(speed, (nextSpeed) => {
  if (solving.value && nextSpeed === 0) {
    abortSolve.value = true;
    paused.value = false;
  }
});

function makeGrid() {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => ({
      row: r,
      col: c,
      value: 0,
      given: false,
      user: false,
      auto: false,
      error: false,
      flash: '',
    }))
  );
}

function resetGrid(puzzle) {
  grid.value = puzzle.map((row, r) =>
    row.map((value, c) => ({
      row: r,
      col: c,
      value,
      given: value !== 0,
      user: false,
      auto: false,
      error: false,
      flash: '',
    }))
  );
}

function generateNewPuzzle() {
  if (solving.value) return;
  const { puzzle } = createPuzzle(difficulty.value);
  resetGrid(puzzle);
  setStatus('New puzzle ready.', 'idle');
}

function onCellInput(row, col, event) {
  if (solving.value) return;
  const cell = grid.value[row][col];
  if (cell.given) return;
  const raw = event.target.value.replace(/[^1-9]/g, '');
  const value = raw ? Number(raw[0]) : 0;
  cell.value = value;
  cell.user = value !== 0;
  cell.auto = false;
  event.target.value = value === 0 ? '' : String(value);
  updateConflicts();
}

function cellClasses(cell, row, col) {
  return {
    given: cell.given,
    empty: !cell.given && cell.value === 0,
    user: cell.user,
    auto: cell.auto,
    error: cell.error,
    'flash-fill': cell.flash === 'fill',
    'flash-backtrack': cell.flash === 'backtrack',
    'thick-top': row === 0,
    'thick-left': col === 0,
    'thick-bottom': (row + 1) % 3 === 0,
    'thick-right': (col + 1) % 3 === 0,
  };
}

function validatePuzzle() {
  if (solving.value) return;
  const conflicts = updateConflicts();
  const board = boardFromGrid();
  const hasEmpty = board.some((row) => row.some((value) => value === 0));
  if (conflicts.size > 0) {
    setStatus('Conflicts found. Check highlighted cells.', 'error');
  } else if (hasEmpty) {
    setStatus('Incomplete. Keep going.', 'warn');
  } else {
    setStatus('Correct. Nice work.', 'ok');
  }
}

async function solveAnimated() {
  if (solving.value) return;
  const conflicts = updateConflicts();
  if (conflicts.size > 0) {
    setStatus('Fix conflicts before auto solving.', 'error');
    return;
  }
  solving.value = true;
  paused.value = false;
  abortSolve.value = false;
  setStatus('Solving with backtracking...', 'solving');
  const startBoard = boardFromGrid();
  const board = startBoard.map((row) => row.slice());
  let solved = false;
  if (speed.value === 0) {
    solved = solveBoardInstant(board);
    if (solved) {
      applySolutionToGrid(board);
    }
  } else {
    const result = await solveBoard(board);
    if (result === null && abortSolve.value) {
      const finalBoard = startBoard.map((row) => row.slice());
      const instantSolved = solveBoardInstant(finalBoard);
      if (instantSolved) {
        applySolutionToGrid(finalBoard);
      }
      solved = instantSolved;
    } else {
      solved = result === true;
    }
  }
  solving.value = false;
  paused.value = false;
  abortSolve.value = false;
  if (solved) {
    setStatus('Solved.', 'ok');
  } else {
    setStatus('No solution from current state.', 'error');
  }
  updateConflicts();
}

function togglePause() {
  if (!solving.value) return;
  paused.value = !paused.value;
  if (paused.value) {
    setStatus('Paused.', 'warn');
  } else {
    setStatus('Solving with backtracking...', 'solving');
  }
}

function setStatus(message, state) {
  statusMessage.value = message;
  statusState.value = state;
}

function updateConflicts() {
  const board = boardFromGrid();
  const conflicts = computeConflicts(board);
  for (const row of grid.value) {
    for (const cell of row) {
      const key = `${cell.row}-${cell.col}`;
      cell.error = conflicts.has(key);
    }
  }
  return conflicts;
}

function boardFromGrid() {
  return grid.value.map((row) => row.map((cell) => cell.value));
}

function computeConflicts(board) {
  const conflicts = new Set();
  const addGroupConflicts = (positions) => {
    for (let num = 1; num <= 9; num += 1) {
      if (positions[num].length > 1) {
        for (const pos of positions[num]) {
          conflicts.add(`${pos.r}-${pos.c}`);
        }
      }
    }
  };

  for (let r = 0; r < 9; r += 1) {
    const positions = Array.from({ length: 10 }, () => []);
    for (let c = 0; c < 9; c += 1) {
      const value = board[r][c];
      if (value !== 0) {
        positions[value].push({ r, c });
      }
    }
    addGroupConflicts(positions);
  }

  for (let c = 0; c < 9; c += 1) {
    const positions = Array.from({ length: 10 }, () => []);
    for (let r = 0; r < 9; r += 1) {
      const value = board[r][c];
      if (value !== 0) {
        positions[value].push({ r, c });
      }
    }
    addGroupConflicts(positions);
  }

  for (let boxRow = 0; boxRow < 3; boxRow += 1) {
    for (let boxCol = 0; boxCol < 3; boxCol += 1) {
      const positions = Array.from({ length: 10 }, () => []);
      for (let r = boxRow * 3; r < boxRow * 3 + 3; r += 1) {
        for (let c = boxCol * 3; c < boxCol * 3 + 3; c += 1) {
          const value = board[r][c];
          if (value !== 0) {
            positions[value].push({ r, c });
          }
        }
      }
      addGroupConflicts(positions);
    }
  }

  return conflicts;
}

function createPuzzle(level) {
  const solution = createBoard();
  fillBoard(solution);
  const puzzle = solution.map((row) => row.slice());
  const removalCount = difficultyTable[level - 1].removals;
  let removed = 0;

  while (removed < removalCount) {
    const row = Math.floor(Math.random() * 9);
    const col = Math.floor(Math.random() * 9);
    if (puzzle[row][col] !== 0) {
      puzzle[row][col] = 0;
      removed += 1;
    }
  }

  return { puzzle, solution };
}

function createBoard() {
  return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0));
}

function fillBoard(board) {
  const empty = findEmpty(board);
  if (!empty) return true;
  const [row, col] = empty;
  for (const num of shuffledNumbers()) {
    if (isValid(board, row, col, num)) {
      board[row][col] = num;
      if (fillBoard(board)) return true;
      board[row][col] = 0;
    }
  }
  return false;
}

function findEmpty(board) {
  for (let r = 0; r < 9; r += 1) {
    for (let c = 0; c < 9; c += 1) {
      if (board[r][c] === 0) return [r, c];
    }
  }
  return null;
}

function isValid(board, row, col, num) {
  for (let c = 0; c < 9; c += 1) {
    if (board[row][c] === num) return false;
  }
  for (let r = 0; r < 9; r += 1) {
    if (board[r][col] === num) return false;
  }
  const startRow = Math.floor(row / 3) * 3;
  const startCol = Math.floor(col / 3) * 3;
  for (let r = startRow; r < startRow + 3; r += 1) {
    for (let c = startCol; c < startCol + 3; c += 1) {
      if (board[r][c] === num) return false;
    }
  }
  return true;
}

function shuffledNumbers() {
  const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = nums.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums;
}

async function solveBoard(board) {
  if (abortSolve.value) return null;
  const empty = findEmpty(board);
  if (!empty) return true;
  const [row, col] = empty;
  for (const num of shuffledNumbers()) {
    if (abortSolve.value) return null;
    if (!isValid(board, row, col, num)) continue;
    await applyStep(board, row, col, num, 'fill');
    const result = await solveBoard(board);
    if (result === true) return true;
    if (result === null) return null;
    await applyStep(board, row, col, 0, 'backtrack');
  }
  return false;
}

function solveBoardInstant(board) {
  const empty = findEmpty(board);
  if (!empty) return true;
  const [row, col] = empty;
  for (const num of shuffledNumbers()) {
    if (!isValid(board, row, col, num)) continue;
    board[row][col] = num;
    if (solveBoardInstant(board)) return true;
    board[row][col] = 0;
  }
  return false;
}

async function applyStep(board, row, col, value, flash) {
  board[row][col] = value;
  if (abortSolve.value) return;
  const cell = grid.value[row][col];
  if (!cell.given) {
    cell.value = value;
    cell.auto = value !== 0;
    cell.user = false;
    cell.flash = flash;
  }
  await nextTick();
  await waitStep();
  if (!cell.given) {
    cell.flash = '';
  }
}

function applySolutionToGrid(board) {
  for (let r = 0; r < 9; r += 1) {
    for (let c = 0; c < 9; c += 1) {
      const cell = grid.value[r][c];
      const value = board[r][c];
      cell.value = value;
      cell.user = false;
      cell.auto = !cell.given && value !== 0;
      cell.flash = '';
    }
  }
}

function waitStep() {
  const delay = Math.max(0, speed.value);
  return new Promise((resolve) => {
    if (abortSolve.value) {
      resolve();
      return;
    }
    if (!paused.value) {
      if (delay === 0) {
        setTimeout(resolve, 0);
      } else {
        setTimeout(resolve, delay);
      }
      return;
    }
    const timer = setInterval(() => {
      if (abortSolve.value) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (!paused.value) {
        clearInterval(timer);
        if (delay === 0) {
          setTimeout(resolve, 0);
        } else {
          setTimeout(resolve, delay);
        }
      }
    }, 60);
  });
}
</script>

<style scoped>
.sudoku-page {
  --frame-radius: 16px;
  --board-radius: 14px;
  --bg-1: #f7f4ed;
  --bg-2: #e6eef3;
  --ink: #1b1f26;
  --muted: #5d6775;
  --border: #1f2937;
  --grid-line: rgba(31, 41, 55, 0.25);
  --grid-strong: #111827;
  --given-bg: #dbeafe;
  --given-text: #1e3a8a;
  --empty-bg: #fef3c7;
  --user-text: #0f766e;
  --error-bg: #fee2e2;
  --auto-text: #0f766e;
  --accent: #c2410c;
  --accent-dark: #7c2d12;
  --cell-size: clamp(32px, 5.4vw, 52px);
  --board-size: calc(9 * var(--cell-size) + 12px);
  position: relative;
  padding: clamp(16px, 2.5vw, 32px);
  border-radius: var(--frame-radius);
  background: radial-gradient(circle at top, #ffffff 0%, var(--bg-1) 45%, var(--bg-2) 100%);
  color: var(--ink);
  overflow: hidden;
  font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif;
}

.sudoku-page::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: linear-gradient(120deg, rgba(31, 41, 55, 0.04), rgba(31, 41, 55, 0)),
    repeating-linear-gradient(45deg, rgba(31, 41, 55, 0.03), rgba(31, 41, 55, 0.03) 1px, transparent 1px, transparent 12px);
  pointer-events: none;
}

.page-shell {
  position: relative;
  z-index: 1;
  display: grid;
  gap: clamp(16px, 2.5vw, 28px);
  max-width: 1360px;
  margin: 0 auto;
}

.hero {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr;
  animation: fade-in 0.6s ease-out both;
}

.hero-copy h1 {
  font-size: clamp(28px, 4vw, 44px);
  margin: 8px 0 10px;
  letter-spacing: 0.02em;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.2em;
  font-size: 12px;
  color: var(--muted);
  margin: 0;
}

.subtitle {
  font-size: clamp(14px, 2.4vw, 18px);
  color: var(--muted);
  margin: 0;
}

.main-area {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: center;
  animation: fade-in 0.6s ease-out 0.1s both;
}

.primary {
  display: grid;
  gap: 16px;
  align-content: start;
  width: var(--board-size);
  flex: 0 0 auto;
}

.side-panel {
  display: grid;
  gap: 14px;
  align-content: start;
  justify-self: end;
  flex: 0 0 320px;
}

.legend {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
  animation: fade-in 0.6s ease-out 0.1s both;
  width: min(220px, 100%);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--muted);
}

.swatch {
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1px solid rgba(31, 41, 55, 0.15);
  background: var(--empty-bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.swatch.given {
  background: var(--given-bg);
}

.swatch.empty {
  background: var(--empty-bg);
}

.swatch.error {
  background: var(--error-bg);
}

.swatch.number {
  background: #ffffff;
  border: 1px dashed rgba(31, 41, 55, 0.2);
}

.swatch.given-number {
  color: var(--given-text);
}

.swatch.user-number {
  color: var(--user-text);
}

.board-section {
  display: grid;
  justify-items: end;
  min-width: 0;
}

.board {
  display: grid;
  grid-template-columns: repeat(9, var(--cell-size));
  grid-auto-rows: var(--cell-size);
  gap: 0;
  padding: 6px;
  border-radius: var(--board-radius);
  background: #ffffff;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.2);
  overflow: hidden;
  width: var(--board-size);
}

.row {
  display: contents;
}

.cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--grid-line);
  background: var(--empty-bg);
  transition: background-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.cell.given {
  background: var(--given-bg);
}

.cell.empty {
  background: var(--empty-bg);
}

.cell.error {
  background: var(--error-bg);
}

.cell.flash-fill {
  box-shadow: 0 0 0 3px rgba(12, 74, 110, 0.2);
  transform: scale(1.03);
}

.cell.flash-backtrack {
  box-shadow: 0 0 0 3px rgba(190, 24, 93, 0.2);
  transform: scale(0.98);
}

.cell.thick-top {
  border-top: 3px solid var(--grid-strong);
}

.cell.thick-left {
  border-left: 3px solid var(--grid-strong);
}

.cell.thick-bottom {
  border-bottom: 3px solid var(--grid-strong);
}

.cell.thick-right {
  border-right: 3px solid var(--grid-strong);
}

.cell-input {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  text-align: center;
  font-size: clamp(18px, 3vw, 24px);
  font-family: "Menlo", "Consolas", "Liberation Mono", "Courier New", monospace;
  font-weight: 600;
  color: var(--user-text);
  cursor: text;
  caret-color: var(--accent-dark);
  font-variant-numeric: tabular-nums;
}

.cell.given .cell-input {
  color: var(--given-text);
  cursor: default;
}

.cell.auto .cell-input {
  color: var(--auto-text);
}

.cell-input:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(194, 65, 12, 0.4);
  border-radius: 4px;
}

.controls {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr;
  align-items: center;
  justify-items: start;
}

.btn {
  border: none;
  padding: 12px 16px;
  border-radius: 12px;
  background: #ffffff;
  color: var(--ink);
  font-weight: 600;
  letter-spacing: 0.02em;
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.12);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  width: 100%;
}

.btn:hover:enabled {
  transform: translateY(-2px);
  box-shadow: 0 14px 24px rgba(15, 23, 42, 0.18);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.btn.validate {
  background: #e0f2fe;
  color: #0c4a6e;
}

.btn.secondary {
  background: #fef3c7;
  color: var(--accent-dark);
}

.btn.accent {
  background: #fed7aa;
  color: var(--accent-dark);
}

.btn.pause {
  background: #ede9fe;
  color: #5b21b6;
}

.status {
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  color: var(--muted);
}

.status-below {
  justify-self: end;
  width: min(100%, calc(var(--cell-size) * 9 + 12px));
}

.status[data-state="ok"] {
  background: rgba(187, 247, 208, 0.7);
  color: #14532d;
}

.status[data-state="warn"] {
  background: rgba(254, 249, 195, 0.7);
  color: #92400e;
}

.status[data-state="error"] {
  background: rgba(254, 226, 226, 0.8);
  color: #7f1d1d;
}

.status[data-state="solving"] {
  background: rgba(219, 234, 254, 0.8);
  color: #1e3a8a;
}

.sliders {
  display: grid;
  gap: 18px;
}

.slider {
  background: rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  padding: 14px 18px;
  display: grid;
  gap: 8px;
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08);
  justify-items: start;
  width: 100%;
}

.slider-label {
  font-size: 14px;
  color: var(--ink);
}

.speed-value {
  display: inline-flex;
  justify-content: flex-end;
  min-width: 3ch;
  font-variant-numeric: tabular-nums;
  margin: 0 4px;
}

.slider-hint {
  font-size: 12px;
  color: var(--muted);
}

input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
}

.legend {
  width: 100%;
}

.slider.difficulty input[type="range"] {
  accent-color: #0ea5e9;
}

.slider.speed input[type="range"] {
  accent-color: #f97316;
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes rise-in {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 900px) {
  .main-area {
    flex-direction: column;
    align-items: center;
  }
  .controls {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }
}

:global(.Layout.sudoku-wide .VPDoc .container),
:global(.Layout.sudoku-wide .VPDoc .content),
:global(.Layout.sudoku-wide .VPDoc .content-container),
:global(.Layout.sudoku-wide .VPDoc .main) {
  max-width: none;
  width: 100%;
}

:global(.Layout.sudoku-wide .VPDoc) {
  padding-left: clamp(16px, 3vw, 32px);
  padding-right: clamp(16px, 3vw, 32px);
}
</style>

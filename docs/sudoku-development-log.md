---
title: sudoku 游戏开发日志（SudokuGame）
description: 记录 SudokuGame 从能玩到能展示算法过程的实现过程，包含校验、出题和自动解题的关键设计。
outline: deep
---

直接体验：[`/sudoku`](./sudoku)。

## 1. 我想实现的效果

我希望这个数独同时满足三点：

- 校验：行 / 列 / 3x3 宫格若出现重复数字，就把冲突格高亮出来
- 出题：根据难度随机挖空，保证棋盘可以求解
- 自动解题：用回溯法一步步推进，并支持 `Pause / Resume`、速度控制

## 2. 状态建模：把“游戏规则”落到数据结构上

在 `SudokuGame.vue` 中，棋盘是一个 9x9 的 `grid`。每个格子除了 `value` 之外，还携带一组状态：

- `given`：题面给定数字（不可编辑）
- `user` / `auto`：用户输入还是自动求解填入
- `error`：当前格子是否落在“冲突集合”里
- `flash`：用于回溯动画的视觉提示（例如 `fill` / `backtrack`）

这种结构让渲染层只需要根据 class（由 `cellClasses()` 计算）呈现状态，而不需要把算法逻辑揉进模板。

## 3. 出题：先生成完整解，再按难度挖空

生成题面走的是经典流程：

1. `fillBoard()` 用回溯法填满 9x9，得到 `solution`
2. 复制一份作为 `puzzle`
3. 根据难度表的 `removals` 随机把若干格置为 0（空格）

难度目前主要通过“挖空数量”控制；后续如果想更严谨，还可以引入唯一解校验或更细的难度评估。

## 4. 冲突检测：一次扫描得到“冲突集合”

当用户输入数字、点击 `Validate`，或自动解题结束时，会调用 `updateConflicts()`：

- 把当前棋盘 `board` 当作纯数字矩阵
- 分别扫描每一行、每一列、每个 3x3 宫格
- 对每个数字收集它出现的位置；一旦同组内出现次数 > 1，就把对应格加入 `conflicts` 集合

最后把集合落到每个格的 `cell.error` 上，进而触发样式高亮。

## 5. 自动解题：回溯 + 动画分步

自动解题按钮 `Auto Solve` 会走两条路径：

- `speed === 0`：直接瞬时求解（`solveBoardInstant`），无需动画
- 否则：调用 `solveBoard()`，每一步用 `applyStep()` 写入试探值，并通过 `await waitStep()` 控制节奏

暂停/继续通过 `paused` 驱动：在 `waitStep()` 里轮询等待。中断则通过 `abortSolve` 在递归与动画步骤中做保护。

## 6. 后续方向

如果继续迭代，我会优先考虑：

- 更“像人”的解题展示（候选集、唯一数、行列宫推理等），让步骤解释更友好
- 评估与生成更稳定的难度（唯一解 + 难度评分）
- 进一步做可访问性与移动端交互细节优化

<!--
# Markdown Extension Examples

This page demonstrates some of the built-in markdown extensions provided by VitePress.

## Syntax Highlighting

VitePress provides Syntax Highlighting powered by [Shiki](https://github.com/mora-na), with additional features like line-highlighting:

**Input**

````md
```js{4}
export default {
  data () {
    return {
      msg: 'Highlighted!'
    }
  }
}
```
````

**Output**

```js{4}
export default {
  data () {
    return {
      msg: 'Highlighted!'
    }
  }
}
```

## Custom Containers

**Input**

```md
::::: info
This is an info box.
:::::

::::: tip
This is a tip.
:::::

::::: warning
This is a warning.
:::::

::::: danger
This is a dangerous warning.
:::::

::::: details
This is a details block.
:::::
```

**Output**

:::: info
This is an info box.
:::::

:::: tip
This is a tip.
:::::

:::: warning
This is a warning.
:::::

:::: danger
This is a dangerous warning.
:::::

:::: details
This is a details block.
:::::

## More

Check out the documentation for the [full list of markdown extensions](https://vitepress.dev/guide/markdown).
-->

## 7. 题目生成（回溯填满 + 随机挖空）

`createPuzzle()` 先调用 `fillBoard(solution)` 用回溯构造一个完整合法解，然后复制成 `puzzle`，按难度的 `removals` 随机置零：

```ts
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
```

`fillBoard()` 是典型回溯骨架：找到第一个空位 `findEmpty()`，尝试一个随机后的 `1..9`，满足 `isValid()` 就递归，否则回退为 `0`。

```ts
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
```

## 8. 冲突检测（computeConflicts + updateConflicts）

冲突检测的核心是：把棋盘当作纯数字矩阵 `board`，对每个“组”（行/列/3x3 宫）收集每个数字出现的位置；某个数字在同组内出现次数 > 1，则把对应格都加入 `conflicts` 集合，最后回填到 `cell.error`。

```ts
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

  // rows
  for (let r = 0; r < 9; r += 1) {
    const positions = Array.from({ length: 10 }, () => []);
    for (let c = 0; c < 9; c += 1) {
      const value = board[r][c];
      if (value !== 0) positions[value].push({ r, c });
    }
    addGroupConflicts(positions);
  }

  // cols
  for (let c = 0; c < 9; c += 1) {
    const positions = Array.from({ length: 10 }, () => []);
    for (let r = 0; r < 9; r += 1) {
      const value = board[r][c];
      if (value !== 0) positions[value].push({ r, c });
    }
    addGroupConflicts(positions);
  }

  // boxes
  for (let boxRow = 0; boxRow < 3; boxRow += 1) {
    for (let boxCol = 0; boxCol < 3; boxCol += 1) {
      const positions = Array.from({ length: 10 }, () => []);
      for (let r = boxRow * 3; r < boxRow * 3 + 3; r += 1) {
        for (let c = boxCol * 3; c < boxCol * 3 + 3; c += 1) {
          const value = board[r][c];
          if (value !== 0) positions[value].push({ r, c });
        }
      }
      addGroupConflicts(positions);
    }
  }

  return conflicts;
}
```

## 9. 回溯求解（solveBoard + solveBoardInstant）

动画版 `solveBoard()` 和瞬时版 `solveBoardInstant()` 本质同构：都以“递归找空位 + 尝试合法数字”为骨架，只是动画版用 `applyStep()` + `await waitStep()` 把过程显式展示出来。

```ts
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
```

## 10. 逐步动画与中断（applyStep + waitStep + Pause/Resume）

`applyStep()` 负责把“尝试值/回退”同步到 `board` 和 `grid`；`waitStep()` 决定每一步展示多久，且在 `paused` 为真时轮询等待。

```ts
async function applyStep(board, row, col, value, flash) {
  board[row][col] = value;
  if (abortSolve.value) return;

  const cell = grid.value[row][col];
  if (!cell.given) {
    cell.value = value;
    cell.auto = value !== 0;
    cell.user = false;
    cell.flash = flash; // 'fill' 或 'backtrack'
  }

  await nextTick();
  await waitStep();

  if (!cell.given) {
    cell.flash = '';
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
```

调度入口 `solveAnimated()` 做两件事：先校验冲突（`updateConflicts()`）；再根据 `speed` 选择瞬时或动画求解，求解过程可被 `abortSolve` 安全中断。

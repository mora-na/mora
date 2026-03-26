---
title: sudo 游戏开发日志（SudokuGame）
outline: deep
---

这篇日志记录我在 `docs/sudo.md` 里做的 `SudokuGame`（数独）页面，从“能玩”到“能展示算法过程”的实现过程。你可以直接在这里体验：[`/sudo`](./sudo)。

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
::: info
This is an info box.
:::

::: tip
This is a tip.
:::

::: warning
This is a warning.
:::

::: danger
This is a dangerous warning.
:::

::: details
This is a details block.
:::
```

**Output**

::: info
This is an info box.
:::

::: tip
This is a tip.
:::

::: warning
This is a warning.
:::

::: danger
This is a dangerous warning.
:::

::: details
This is a details block.
:::

## More

Check out the documentation for the [full list of markdown extensions](https://vitepress.dev/guide/markdown).
-->

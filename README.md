# mora

> 一个基于 VitePress 构建的个人技术文档站点，包含技术文章、命令备忘与互动小游戏。

## 简介

**mora** 是一个轻量级的个人知识库与技术分享平台，使用 VitePress 驱动，部署于 GitHub Pages。站点涵盖技术排障日志、开发心得、命令备忘录以及可交互的数独游戏。

站点地址：[https://blog.mora.cloudns.ch](https://blog.mora.cloudns.ch)

## 功能特性

### 技术文章（碎片）

收录实际开发与运维过程中的排障日志与技术总结：

- **Cloudflare Workers 超时排障** - 从 15 秒 axios 超时到平台入口延迟的完整排查链路
- **告别 oh-my-zsh 启动卡顿** - 使用 Starship + Zint 替代 oh-my-zsh 的迁移实践
- **OpenClaw 网关启动 OOM 排查** - Node.js 容器内存优化与 V8 堆参数动态计算
- **Clash Party TUN 模式排查** - macOS 系统代理配置与环境变量脚本方案

### 数独游戏

内置完整的数独游戏功能：

- 支持多难度随机出题
- 冲突检测与高亮提示
- 回溯算法自动求解演示
- 支持 Pause/Resume 与速度控制

### 命令备忘

常用命令速查备忘录，便于快速复制使用。

## 技术栈

| 类别 | 技术 |
|------|------|
| 文档框架 | VitePress 1.6.4 |
| 前端框架 | Vue 3 |
| 包管理器 | npm / pnpm |
| 运行时 | Node.js 20+ |
| 部署平台 | GitHub Pages |
| CI/CD | GitHub Actions |

## 项目结构

```
mora/
├── .github/
│   └── workflows/
│       └── deploy-gh-pages.yml    # GitHub Actions 部署配置
├── docs/
│   ├── .vitepress/
│   │   ├── cache/                 # 构建缓存
│   │   ├── components/            # Vue 组件
│   │   │   ├── DocHeader.vue      # 文档页头组件
│   │   │   └── SudokuGame.vue     # 数独游戏组件
│   │   ├── config.mts             # VitePress 配置文件
│   │   ├── dist/                  # 构建输出目录
│   │   └── theme/                 # 主题定制
│   │       ├── index.js           # 主题入口
│   │       └── style.css          # 自定义样式
│   ├── public/
│   │   └── favicon.png            # 站点图标
│   ├── clash-party-tun-macos.md   # macOS 代理配置文章
│   ├── cloudflare-workers-timeout-tracing.md  # Cloudflare 排障文章
│   ├── command.md                 # 命令备忘录
│   ├── index.md                   # 首页配置
│   ├── ohmyzsh-starship-zinit.md  # zsh 配置优化文章
│   ├── openclaw-gateway-startup-oom-troubleshooting.md  # OOM 排障文章
│   ├── sudoku.md                  # 数独游戏页面
│   └── sudoku-development-log.md  # 数独开发日志
├── .gitignore
├── CNAME                          # 自定义域名配置
├── package.json
└── pnpm-lock.yaml
```

## 快速开始

### 环境要求

- Node.js 20+
- npm 或 pnpm

### 安装依赖

```bash
# 使用 npm
npm install

# 或使用 pnpm
pnpm install
```

### 本地开发

```bash
npm run docs:dev
```

启动后访问 `http://localhost:5173` 即可预览站点。

### 构建生产版本

```bash
npm run docs:build
```

构建产物位于 `docs/.vitepress/dist` 目录。

### 预览构建结果

```bash
npm run docs:preview
```

## 文档内容概览

### 碎片（技术文章）

| 文章 | 描述 |
|------|------|
| [PaddleOCR-VL 1.5 开发日志](docs/paddleocr-vl-1-5-q4-k-m-development-log.md) | 记录无 GPU、4GB RAM 约束下的模型选型、量化推理、引擎切换、输入预算和兜底机制 |
| [AutoFillingForm 开发日志](docs/autofillingform-development-log.md) | 自动填单插件的录制、回放、校验与速度配置开发过程 |
| [FinderToolkit 开发日志](docs/finder-toolkit-development-log.md) | Finder 右键菜单工具从扩展架构到手动签名打包的完整开发过程 |
| [Sudoku Development Log](docs/sudoku-development-log.md) | 数独游戏的完整开发日志，包含状态建模、出题算法、冲突检测与回溯求解 |
| [告别 oh-my-zsh 启动卡顿](docs/ohmyzsh-starship-zinit.md) | 从终端启动变慢问题出发，使用 Starship + Zint 重构 zsh 环境 |
| [Clash Party TUN on macOS](docs/clash-party-tun-macos.md) | macOS 上 Clash Party TUN 模式失效排查与环境变量兜底脚本 |
| [Cloudflare Workers 超时排障](docs/cloudflare-workers-timeout-tracing.md) | 前端部署在 Cloudflare Pages 时的接口超时完整排查过程 |
| [OpenClaw 网关启动 OOM 排查](docs/openclaw-gateway-startup-oom-troubleshooting.md) | 容器内 Node.js 启动阶段 OOM 的排查与动态堆参数方案 |

### 游戏

- **[Sudoku](docs/sudoku.md)** - 可直接游玩的数独游戏，支持校验、随机出题和自动解题演示

### 备忘

- **[Command](docs/command.md)** - 常用命令速查备忘

## 部署说明

### GitHub Pages 自动部署

项目配置了 GitHub Actions 工作流，推送到 `main` 或 `master` 分支时自动构建并部署到 GitHub Pages。

部署流程：

1. 推送代码到主分支
2. GitHub Actions 自动触发构建
3. 执行 `npm ci` 安装依赖
4. 执行 `npm run docs:build` 构建站点
5. 部署到 GitHub Pages

### 自定义域名

项目根目录的 `CNAME` 文件配置了自定义域名：

```
blog.mora.cloudns.ch
```

如需修改域名，请更新 `CNAME` 文件内容。

## 开发指南

### 新增文章

1. 在 `docs/` 目录下创建 `.md` 文件
2. 在文件头部添加 Frontmatter：

```yaml
---
title: 文章标题
description: 文章描述
outline: deep  # 可选，显示深度目录
---
```

3. 在 `docs/.vitepress/config.mts` 中添加导航和侧边栏配置

### 新增 Vue 组件

1. 在 `docs/.vitepress/components/` 目录下创建 `.vue` 文件
2. 在 `docs/.vitepress/theme/index.js` 中注册组件：

```javascript
import YourComponent from '../components/YourComponent.vue';

export default {
  // ...
  enhanceApp(ctx) {
    DefaultTheme.enhanceApp?.(ctx);
    ctx.app.component('YourComponent', YourComponent);
  },
};
```

### 自定义样式

全局样式位于 `docs/.vitepress/theme/style.css`，可覆盖 VitePress 默认主题变量。

### VitePress 配置

主配置文件为 `docs/.vitepress/config.mts`，可修改：

- 站点标题与描述
- 导航栏配置
- 侧边栏配置
- 社交链接
- 自定义 head 标签

## 相关项目

| 项目 | 描述 |
|------|------|
| [LogCollect](https://github.com/mora-na/LogCollect) | 轻量级业务日志聚合框架，支持将日志聚合到自定义通道 |
| [openclaw](https://github.com/mora-na/openclaw) | 自定义 openclaw 镜像，首次启动自动初始化无需配置 |
| [demo](https://github.com/mora-na/demo) | 模仿 Ruoyi 开发的管理系统脚手架 |

## 许可证

[ISC](LICENSE)

---

由 [VitePress](https://vitepress.dev/) 驱动 | 托管于 [GitHub Pages](https://pages.github.com/)

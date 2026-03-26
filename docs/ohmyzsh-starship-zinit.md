---
title: 告别 oh-my-zsh 启动卡顿：用 Starship + Zinit 完成一次干净升级
description: 从终端启动变慢开始，定位 oh-my-zsh 的启动开销，改用 Starship + Zinit 承接提示符与插件能力，并补齐历史共享、去重和 NVM 初始化。
outline: deep
---

## 每次打开终端，都像先“跑一段脚本”

这次折腾的起点很简单：**终端并不是打不开，而是每次新开一个窗口，都要先等一会儿。**

体感上很明显：

- 输入法已经能切了，但提示符还没完全就绪
- 首屏不是立刻可用，而是像后台先执行了一串初始化脚本
- 新开第二个、第三个终端时，这种等待会重复出现

这种问题最烦的地方在于，它不是“彻底坏了”，而是一直在消耗日常操作的流畅度。打开终端本来应该是瞬时反馈，但 shell 一旦变重，这个动作就会变成固定损耗。

## 第一步：先确认不是错觉，而是真的启动慢

我没有一上来就改配置，而是先验证到底是不是 shell 初始化变重。

最直接的方式有两个：

```bash
time zsh -i -c exit
```

如果想看得更细一点，可以临时加上性能分析：

```bash
zmodload zsh/zprof
source ~/.zshrc
zprof
```

以及在 `~/.zshrc` 里观察最重的一段初始化到底来自哪里。

排查下来，问题并不在某一个 alias，也不在某一条 export，而是集中在这一类逻辑：

- `oh-my-zsh.sh` 的整体启动链路
- 主题加载
- 多个插件的初始化
- 补全系统 `compinit`

也就是说，**真正慢的不是 zsh 本身，而是 oh-my-zsh 这套“全家桶式初始化”。**

## 根因：oh-my-zsh 很方便，但它的代价就是“重”

`oh-my-zsh` 最大的优点是开箱即用：主题、插件、补全、函数都帮你组织好了。

但问题也恰恰在这里。

当 `~/.zshrc` 中存在这类配置时：

```bash
export ZSH="$HOME/.oh-my-zsh"
plugins=(git kubectl docker ...)
source $ZSH/oh-my-zsh.sh
```

每次启动一个新的 zsh，会发生这些事：

- 读取 oh-my-zsh 主框架
- 扫描并加载主题
- 初始化插件脚本
- 跑补全初始化
- 顺带把一些你未必每天都用到的能力一起拉起来

这套机制的优点是统一，缺点是**不够轻**。插件数量一多，或者主题本身逻辑复杂，启动开销就会变得很明显。

所以这次我的目标不是“再继续优化 oh-my-zsh”，而是直接拆解它的职责：

- **提示符**：交给 `Starship`
- **插件管理**：交给 `Zinit`
- **oh-my-zsh 里好用的插件能力**：按需加载，不再整包启动

## 替代方案：Starship + Zinit 的组合为什么更合适

我最后选的是：

- `Starship`：负责 prompt
- `Zinit`：负责 zsh 插件加载

这个组合比 oh-my-zsh 更适合“保留体验，但减掉启动负担”。

### Starship：只做一件事，就是把提示符做快

`Starship` 是用 Rust 写的，定位很明确：**跨 shell 的高性能提示符**。

它的优点很适合替换 oh-my-zsh 的主题层：

- 启动快
- 配置集中
- Git、Node、Python、Kubernetes 等上下文展示能力足够强
- 不再依赖 oh-my-zsh 的主题体系

安装后只需要：

```bash
eval "$(starship init zsh)"
```

这一步就能把“主题”从 oh-my-zsh 里独立出来。

### Zinit：保留插件生态，但不必继续背整套框架

只换提示符还不够，因为日常还会依赖这些能力：

- `git` 别名和函数
- `kubectl` 辅助命令
- `docker` 插件
- 自动建议
- 语法高亮
- 更多补全

如果放弃 oh-my-zsh 后这些都要手搓，那就得不偿失。`Zinit` 的价值就在这里：**它可以按需加载插件，而且还能直接加载 oh-my-zsh 的插件片段。**

也就是说，可以不要 `oh-my-zsh.sh`，但继续用：

- `OMZP::git`
- `OMZP::kubectl`
- `OMZP::docker`

这就完成了“拆框架、留能力”。

## 迁移思路：不是推倒重来，而是逐层替换

这次迁移我按下面的顺序做：

1. 先去掉 `source $ZSH/oh-my-zsh.sh`
2. 用 `Starship` 顶掉原来的主题
3. 用 `Zinit` 接管插件加载
4. 保留常用的 oh-my-zsh 插件能力
5. 处理 shell 历史记录共享与去重
6. 修复迁移后暴露出来的 `nvm` 初始化问题

这样做的好处是，每一步都能单独验证，不会把问题混在一起。

## 第二个问题：autosuggestions 只能在当前终端有效

完成替换后，新的提示符和插件都正常了，但很快又出现了一个体验问题：

**`zsh-autosuggestions` 的建议，只能看到当前终端里刚输入过的命令。**

表现很典型：

- 当前窗口里刚执行过的命令，马上能给建议
- 新开一个终端窗口，建议明显变少
- 很像“插件没坏，但历史没共享”

这其实不是 `zsh-autosuggestions` 自身的问题，而是 shell history 的策略问题。

如果没有正确开启这些选项：

- `APPEND_HISTORY`
- `INC_APPEND_HISTORY`
- `SHARE_HISTORY`

那么命令历史往往只会在会话结束时写回文件，或者不同终端之间不能及时同步。这样自动建议当然就只能“看见当前窗口里的局部历史”。

所以这一轮优化的关键，不只是装插件，而是把 **history 的写入、共享、去重策略一起整理干净**。

## 第三个问题：历史共享之后，还要顺手把重复命令清掉

仅仅让多个终端共享历史，还不够“顺手”。

如果历史记录没有去重，使用一段时间后会很乱：

- 相同命令被重复记录几十次
- 搜索历史时噪音很大
- autosuggestions 命中质量下降

所以我把去重和清理一起配上了：

- `HIST_IGNORE_ALL_DUPS`
- `HIST_SAVE_NO_DUPS`
- `HIST_FIND_NO_DUPS`
- `HIST_EXPIRE_DUPS_FIRST`
- `HIST_REDUCE_BLANKS`

这样做之后，历史记录的质量会明显更高，也更适合自动建议和模糊搜索。

## 第四个问题：oh-my-zsh 删掉以后，nvm 也跟着“失效”

这一步很容易被忽略。

很多时候我们以为是 `nvm` 自己坏了，实际上是因为之前的 shell 配置里，`nvm` 的初始化被 oh-my-zsh 的某个插件、某段旧配置，或者某个被顺带 source 的脚本接住了。

当 oh-my-zsh 被拿掉以后，这层隐式依赖也一起消失了，于是就会出现：

```bash
nvm: command not found
```

解决方法也不复杂，核心就是显式初始化：

```bash
export NVM_DIR="$HOME/.nvm"

[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && source "/opt/homebrew/opt/nvm/nvm.sh"
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && source "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"
```

这一步补上以后，Node 版本切换能力就恢复正常了。

## 最终方案：一份可直接放进 `~/.zshrc` 的配置

下面这份配置就是我最后稳定使用的版本。它解决了几个关键问题：

- 去掉 oh-my-zsh 的重型启动链路
- 用 Starship 接管提示符
- 用 Zinit 加载插件，并继续使用部分 oh-my-zsh 插件
- 让 autosuggestions 在多个终端之间共享历史
- 做好历史去重和清理
- 补回 `nvm` 初始化

```bash
# =========================
# History 高级配置
# =========================

HISTFILE=~/.zsh_history
HISTSIZE=50000
SAVEHIST=50000

setopt APPEND_HISTORY
setopt INC_APPEND_HISTORY
setopt SHARE_HISTORY

# 去重核心
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_SAVE_NO_DUPS
setopt HIST_FIND_NO_DUPS
setopt HIST_REDUCE_BLANKS

# 更安全/更干净
setopt EXTENDED_HISTORY
setopt HIST_VERIFY
setopt HIST_EXPIRE_DUPS_FIRST

### Added by Zinit's installer
if [[ ! -f $HOME/.local/share/zinit/zinit.git/zinit.zsh ]]; then
    print -P "%F{33} %F{220}Installing %F{33}ZDHARMA-CONTINUUM%F{220} Initiative Plugin Manager (%F{33}zdharma-continuum/zinit%F{220})…%f"
    command mkdir -p "$HOME/.local/share/zinit" && command chmod g-rwX "$HOME/.local/share/zinit"
    command git clone https://github.com/zdharma-continuum/zinit "$HOME/.local/share/zinit/zinit.git" && \
        print -P "%F{33} %F{34}Installation successful.%f%b" || \
        print -P "%F{160} The clone has failed.%f%b"
fi

source "$HOME/.local/share/zinit/zinit.git/zinit.zsh"
autoload -Uz _zinit
(( ${+_comps} )) && _comps[zinit]=_zinit

# Load a few important annexes, without Turbo
# (this is currently required for annexes)
zinit light-mode for \
    zdharma-continuum/zinit-annex-as-monitor \
    zdharma-continuum/zinit-annex-bin-gem-node \
    zdharma-continuum/zinit-annex-patch-dl \
    zdharma-continuum/zinit-annex-rust \
    zsh-users/zsh-autosuggestions \
    zsh-users/zsh-completions \
    zsh-users/zsh-syntax-highlighting \
    OMZP::git \
    OMZP::kubectl \
    OMZP::docker \

autoload -Uz compinit && compinit

### End of Zinit's installer chunk

eval "$(starship init zsh)"


# ==============================
# NVM 初始化
# ==============================
export NVM_DIR="$HOME/.nvm"

[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && source "/opt/homebrew/opt/nvm/nvm.sh"
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && source "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"
```

## 安装顺序建议

如果你是从旧的 oh-my-zsh 环境迁移，我建议按这个顺序来：

### 1. 安装 Starship

```bash
brew install starship
```

### 2. 保留旧配置备份

```bash
cp ~/.zshrc ~/.zshrc.backup
```

### 3. 移除或注释旧的 oh-my-zsh 主入口

重点是这几类：

```bash
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="..."
plugins=(...)
source $ZSH/oh-my-zsh.sh
```

### 4. 写入新的 Zinit + Starship 配置

把上面的最终配置放进去，然后重启终端即可。

## 升级结果：不是“花哨更多了”，而是启动终于干脆了

这次升级完成后，最直接的收益不是某个新插件，而是整体体验终于变顺了：

- 新开终端基本就是直接可用
- 提示符更轻，信息展示仍然完整
- 常用的 `git / kubectl / docker` 插件能力还在
- `autosuggestions` 不再只认当前窗口
- 历史记录明显更干净
- `nvm` 也重新恢复可用

从结果看，这并不是一次“换皮”，而是一次很典型的 shell 架构整理：

- 把提示符从大框架里拆出来
- 把插件管理改成按需加载
- 把历史记录从“能用”升级到“可维护”
- 把以前依赖隐式初始化的环境显式化

## 小结

`oh-my-zsh` 仍然是非常好的入门方案，但当你已经明确感受到“每次启动终端都要先跑半天脚本”时，就说明它开始成为成本了。

这时与其继续在旧框架里打补丁，不如直接换成更清晰的职责拆分：

- `Starship` 负责 prompt
- `Zinit` 负责插件
- history 单独治理
- `nvm` 单独初始化

这样最终得到的不是“少一点卡顿”，而是一套更轻、更稳、也更容易长期维护的 zsh 环境。

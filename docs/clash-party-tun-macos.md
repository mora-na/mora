---
title: macOS 上 Clash Party TUN 失效排查与兜底脚本
description: Clash Party 在 macOS 上 TUN 模式疑似未完成 Network Extension/Helper 授权，导致系统未接管流量；记录排查过程，并用 sh 脚本自动设置代理环境变量作为兜底。
---

## 起因：TUN 看似开启，但系统层面没有“接管”

最近在 macOS 上使用 Clash Party 时遇到一个很别扭的问题：**TUN 模式看起来已经开启，但实际网络行为不像被系统级代理接管**。最直观的体感是：有些应用能走代理，有些完全直连；命令行工具尤其不稳定。

这种问题最容易把人带到“配置/规则/节点”的方向，但我这次的结论是：**核心不在配置，而更像是 macOS 新版本的系统网络能力与权限链路没有完全打通。**

## 现象：命令行最先暴露问题

我当时观察到的症状大致是：

- `git`、`curl`、`brew`、`pip` 这类命令行请求经常超时或直连
- 浏览器表现为“时好时坏”，像 DNS/路由层面没有稳定被接管
- Clash Party UI 上显示 TUN 已开启，但整体行为更像“半生效”

这些现象的共同点是：**不像节点坏了**（坏节点通常是稳定地坏），更像“系统没有按预期把流量交给 TUN”。

## 先按常规思路排查：配置层面没有实锤

我先做了一轮常规排查（也值得做，但这次不是根因）：

- 更换节点、切换不同订阅/策略组
- 调整 DNS/Fake-IP 相关选项、尝试关闭 IPv6
- 观察日志，确认并非规则命中导致的误拦截

折腾一圈后发现：**这些手段只能改变局部表现，但无法解释“系统级接管不稳定”这个主问题。**

## 把视角从“规则”切到“系统”：Network Extension / Helper / 授权

接下来我把注意力放到了 macOS 的系统网络机制上。

在较新的 macOS 上，想做稳定的系统级网络接管，通常离不开：

- **Network Extension（网络扩展）**：是否正确安装并启用
- **Helper（特权辅助工具）**：是否需要、是否已授权安装

而我的情况非常像是：**Clash Party 没有成功完成网络扩展设置，或者 Helper 未安装/未授权**，导致 TUN 虽然“开了”，但系统层面并没有稳定把流量交给它处理。

到这里我的选择就很现实了：与其继续和 TUN 的系统权限/兼容性较劲，不如先做一个“确定可用”的兜底，至少把命令行生产力救回来。

## 兜底方案：用环境变量代理（带端口检测自动开关）

我最终写了一个 `sh` 脚本，逻辑很简单：

- 用 `nc` 检测本地代理端口是否已监听
- 若端口可用，则导出 `http_proxy` / `https_proxy` / `all_proxy` 等环境变量
- 若不可用，则清理这些变量，避免“挂着错误代理导致全局超时”

脚本如下：

```sh
# ==============================
# Proxy 控制（带端口检测）
# ==============================

export PROXY_HOST=127.0.0.1
export PROXY_PORT=7890

# 检测端口是否开放
proxy_check() {
  nc -z $PROXY_HOST $PROXY_PORT >/dev/null 2>&1
}

# 开启代理
proxy_on() {
  export http_proxy="http://$PROXY_HOST:$PROXY_PORT"
  export https_proxy="http://$PROXY_HOST:$PROXY_PORT"
  export all_proxy="socks5://$PROXY_HOST:$PROXY_PORT"

  export no_proxy="localhost,127.0.0.1,::1,*.local,192.168.0.0/16,10.0.0.0/8"

  echo "Proxy ON"
}

# 关闭代理
proxy_off() {
  unset http_proxy https_proxy all_proxy no_proxy
  echo "Proxy OFF"
}

# ==============================
# 自动启用（关键逻辑）
# ==============================

if proxy_check; then
  proxy_on
else
  proxy_off
fi
```

## 使用方式（示例）

把脚本保存成比如 `proxy-auto.sh`，然后在需要的 shell 里 **source** 它（这样环境变量才会留在当前会话里）：

```sh
source /path/to/proxy-auto.sh
```

如果你希望每次打开终端自动生效，可以把它集成到 `~/.zshrc` / `~/.bashrc`（这部分按个人习惯来）。

## 小结

这次问题的教训是：当你在 macOS 上遇到“代理客户端显示已开启，但系统行为不一致”时，除了配置层面，更要关注 **Network Extension / Helper / 授权** 这条链路是否完整。

在彻底解决 TUN 兼容性之前，一个带端口检测的环境变量代理脚本是非常实用的兜底方案：**可控、可回滚、对命令行立竿见影。**

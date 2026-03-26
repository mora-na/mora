---
title: 常用命令记忆
description: 把常用命令放在这里，方便随手复制。
outline: deep
---

```bash
# 更新跨域设置
openclaw config set gateway.controlUi.allowedOrigins '[\"https://your-domain\"]'
# 展示设备列表
openclaw devices list
# 授权设备连接
openclaw devices approve your_request_id
# 完整的首次引导流程：包含 OAuth 登录 + 生成/更新基础配置
openclaw onboard --auth-choice openai-codex
# 只做模型提供方的 OAuth 登录/刷新
openclaw models auth login --provider openai-codex
```

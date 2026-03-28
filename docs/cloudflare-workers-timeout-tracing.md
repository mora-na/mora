---
title: 一次 Cloudflare Workers 到容器源站的超时排障：从 15 秒 axios 超时到平台入口延迟
description: 记录一次前端部署在 Cloudflare Pages、API 通过 Cloudflare Workers 中转到容器源站时的超时排查过程。重点包括链路追踪、日志补点、x-request-id 被网关改写、530 回源错误，以及最终把问题定位到应用之前的平台入口层。
outline: deep
---

## 起点：前端偶发报 `timeout of 15000ms exceeded`

这次排障的起点并不复杂。

前端部署在 **Cloudflare Pages**，API 走单独域名，先到 **Cloudflare Workers**，再由 Worker 转发到后端容器服务。用户侧的现象是：

- 偶发接口超时
- 不是某一个固定接口
- 前端提示 `timeout of 15000ms exceeded`
- 后端应用没有异常
- 没看到慢 SQL

这类问题最容易先怀疑三个方向：

- Cloudflare Workers 会不会偶发丢请求
- 后端应用是不是偶发慢，但日志没打出来
- 数据库或下游有没有隐藏的阻塞

真正麻烦的地方在于：**没有统一的请求标识时，三段日志根本对不起来。**

## 第一个关键判断：这不是 Cloudflare 固定报错，而是前端自己超时

先看前端代码，确认这句报错是谁抛出来的。

结论很快明确：`timeout of 15000ms exceeded` 来自前端 `axios` 的 15 秒超时配置，而不是 Cloudflare 自己返回的固定错误页。

这件事很重要，因为它直接改变了问题定义：

- 它不代表 Cloudflare 一定失败了
- 它只代表浏览器在 15 秒内没有拿到完整响应

也就是说，真正可能卡住的点有很多：

```text
浏览器
  -> Cloudflare Pages/Worker
  -> Worker 到源站入口
  -> 源站入口到应用
  -> 应用代码
  -> 应用响应回传
```

如果一开始就把问题定义成“Workers 丢请求”，排查会很容易跑偏。

## 原始误判：只看后端异常日志和慢 SQL，证据不够

最初后端能提供的信息很有限：

- 没有异常
- 没有慢 SQL

这只能说明一件事：**应用代码层没有明显报错。**

它完全不能说明：

- 请求一定到过应用
- 请求一定在应用里执行过
- 请求不是卡在容器入口、反向代理、负载均衡、连接建立、TLS 握手、平台排队

这类跨 CDN、边缘计算和容器平台的链路问题，最大陷阱就是“应用没报错”被误解成“应用一定没问题”。

## 第一轮证据：Worker 看到的是 `outcome: canceled`

在 Cloudflare Workers 日志里，先看到过这种记录：

```json
{
  "outcome": "canceled",
  "wallTimeMs": 14786,
  "cpuTimeMs": 0
}
```

结合前端固定的 15 秒超时，这类日志的含义很清楚：

- Worker 收到了请求
- Worker 自己几乎没做计算，`cpuTimeMs = 0`
- Worker 更像是在等待 `fetch(origin)`
- 浏览器先在 15 秒时放弃
- Worker 被动记录成 `canceled`

这一步已经能排除一种常见误判：

**不是“浏览器请求都没到 Cloudflare”，而是请求到了 Worker，但 Worker 等源站等太久。**

## 真正开始定位之前，必须先做统一链路追踪

### 旧方案为什么不够

最初后端里只有本地生成的 `traceId`。这意味着：

- 前端看不到它
- Worker 也看不到它
- 一次超时请求发生后，没法把三端串起来

这时候即使日志很多，也很难回答最关键的问题：

**这条超时请求到底有没有到后端？如果到了，是什么时候才到的？**

### 新方案：把“客户端请求 ID”和“服务端 Trace ID”拆开

排障过程中我最后定下来的策略是：

- 前端生成 `X-Client-Request-Id`
- Worker 原样透传 `X-Client-Request-Id`
- 后端记录 `clientRequestId`
- 后端再单独生成自己的 `X-Trace-Id`

这一步后来被证明是必要的，因为链路中还有一层网关/Envoy，会自己处理 `x-request-id`。如果继续把所有含义都塞进 `X-Request-Id`，后面会越来越乱。

## 为什么不能继续把业务链路 ID 放在 `X-Request-Id`

这是这次排障里非常关键的一次转向。

一开始前端用的是 `X-Request-Id`。后来发现有些请求里：

- 浏览器发出的 `x-request-id` 和后端日志里的 `requestId` 不一致
- 但 `cf-ray` 又能对上

继续排后发现两个事实：

1. 浏览器响应头里有 `x-envoy-upstream-service-time`
2. 后端入口日志里能读到一个并非前端生成的 `headerRequestId`

这说明 Spring 前面还有一层 **Envoy / 平台网关**，而这一层会生成或重写 `x-request-id`。

这一步的教训很直接：

**`X-Request-Id` 更适合交给基础设施自己用，不适合拿来当业务侧的唯一链路 ID。**

所以后面把前端和 Worker 追踪头改成了自定义的：

```text
X-Client-Request-Id
```

服务端自己的链路 ID 则单独放在：

```text
X-Trace-Id
```

这样日志就不会再把两套 ID 混在一起。

## 实际增加了哪些代码

这次排障里，真正起作用的不是“看更多日志”，而是**改造日志结构**。

### 1. 前端：生成并打印 `X-Client-Request-Id`

前端的改动目标很简单：

- 每个请求生成一个 `clientRequestId`
- 请求时打印一次
- 响应成功打印一次
- 响应失败打印一次

重点字段包括：

- `clientRequestId`
- 方法
- URL
- 状态码
- 耗时
- `cfRay`
- `traceId`
- `upstreamTraceId`

这样前端控制台里的超时样本，终于能和 Worker / 后端对齐。

### 2. Worker：把“收到请求”和“回源完成”拆成两段日志

Worker 侧增加了四类日志：

- `worker.request.start`
- `worker.origin.fetch.start`
- `worker.origin.fetch.complete`
- `worker.origin.fetch.error`

其中最关键的是这两条：

```text
worker.origin.fetch.start
worker.origin.fetch.complete
```

因为它们能直接告诉我：

- Worker 什么时候开始请求源站
- 请求的是哪个 `targetUrl`
- 实际透传了哪个 `clientRequestId`
- 源站有没有回响应
- 源站状态码是多少
- Worker 等了多久

这是判断“卡在 Worker 之前”还是“卡在 Worker 之后”的核心证据。

### 3. 后端：同时记录 `clientRequestId` 和 `traceId`

后端增加了两层日志：

1. `TraceIdFilter`
2. `RequestTraceLoggingFilter`

`TraceIdFilter` 负责：

- 读取 `X-Client-Request-Id`
- 读取 Cloudflare 透传的 `cfRay`
- 生成服务端 `traceId`
- 把 `X-Trace-Id` 写回响应

`RequestTraceLoggingFilter` 负责：

- 请求开始日志
- 请求完成日志
- 请求异常日志

最终后端请求日志会稳定长成这样：

```text
http.request.start traceId=... clientRequestId=... cfRay=... method=... uri=...
http.request.complete traceId=... clientRequestId=... cfRay=... status=... durationMs=...
```

这一步之后，整个链路终于可以用这三组字段串起来：

- `clientRequestId`
- `cfRay`
- `traceId`

## 还踩过一个坑：Worker 环境变量没配，直接回退到了 `mora.local`

排障中间还遇到过一次看起来很离谱的错误：

```text
targetUrl: https://mora.local/auth/captcha
status: 530
```

这不是 Cloudflare 随机抽风，而是代码里给 `BACKEND_ORIGIN` 写了默认值：

```text
https://mora.local
```

如果线上没有正确配置环境变量，Worker 就会回退到这个默认值。

而 `mora.local` 这种地址对 Cloudflare 的公网回源来说通常并不成立，于是直接得到 `530`。

这里的教训也很实用：

- Worker 代码里可以写默认值
- 但像 `BACKEND_ORIGIN` 这种关键配置，不应该 silent fallback 到一个看似“开发态”的地址

更稳妥的做法是：

- `WORKER_ORIGIN` 必填
- `BACKEND_ORIGIN` 必填
- `STRIP_PREFIX` 可选

缺少关键变量时，Worker 应该直接明确报错，而不是偷偷回退到 `mora.local`。

## 真正把问题钉住的一组日志

最终真正把问题定位下来的，是这样一组完整链路。

### 前端

前端发出：

```text
X-Client-Request-Id = 0551be19-3c48-4861-889e-1df28880361a
GET /prod-api/sys/dict/type/list?pageNum=1&pageSize=10
```

### Worker

Worker 记录到：

```text
worker.request.start
clientRequestId = 0551be19-3c48-4861-889e-1df28880361a
cfRay = 9e3626687c257d8f

worker.origin.fetch.start
targetUrl = https://...clawcloudrun.com/sys/dict/type/list?pageNum=1&pageSize=10
forwardedClientRequestId = 0551be19-3c48-4861-889e-1df28880361a
```

但没有看到 `worker.origin.fetch.complete`，取而代之的是：

```text
outcome = canceled
wallTime = 14783
cpuTime = 0
```

### 后端

后端同时记录到：

```text
headerClientRequestId = 0551be19-3c48-4861-889e-1df28880361a
cfRay = 9e3626687c257d8f
http.request.start ...
http.request.complete ... durationMs = 82
```

这组日志的结论非常直接：

1. 前端请求 ID 到了 Worker
2. Worker 又把它原样发给了源站
3. 最终 Spring 应用也收到了同一个 `clientRequestId`
4. Spring 业务处理只花了 `82ms`
5. 但浏览器仍然在 `15s` 超时

如果应用真正处理只花了 `82ms`，那问题就不可能在业务代码和 SQL 本身。

## 最终定位：慢点在应用之前，而不是应用之内

到这一步，问题已经能比较清楚地描述成：

**请求不是没到后端，而是太晚才到后端。**

更准确一点说，是慢在：

```text
Worker
  -> 云平台入口 / Envoy / Ingress
  -> 容器真正接到请求
```

而不是慢在：

```text
Spring Controller
  -> Service
  -> Mapper
  -> SQL
```

为什么能这么判断？

- Worker `cpuTime = 0`，说明不是 Worker 自己计算慢
- Worker `wallTime ≈ 15s`，说明它是在等回源
- 后端一旦真正开始处理，只要几十毫秒
- 说明请求在“应用收到之前”已经消耗掉了大部分时间

## 那它最可能卡在哪？

结合部署形态，最值得怀疑的是这些层：

- 容器平台的入口网关
- Envoy / Ingress 排队
- 容器冷启动
- 平台层连接建立
- 平台层 TLS / 代理转发

如果你的源站跑在支持 scale-to-zero 的容器平台上，这种现象尤其值得优先考虑：

- 请求先到平台入口
- 平台准备实例 / 恢复实例 / 连接实例
- 应用真正收到请求时，浏览器侧 15 秒已经所剩无几

这也是为什么“后端没有异常”并不能洗清平台入口层的嫌疑。

## 这次排障里最有价值的几个结论

### 1. `axios 15s timeout` 不是根因，只是观察窗口

一开始最显眼的是浏览器报错：

```text
timeout of 15000ms exceeded
```

但它不是根因，只是一个时间窗口。

真正的问题是：**15 秒内浏览器没有拿到完整响应。**

这句话背后可能对应的根因完全不同：

- Worker 到源站 DNS 错误
- Worker 到源站连接失败
- 平台入口排队
- 容器冷启动
- 应用代码慢

所以第一步一定要先把报错语义拆开。

### 2. `cfRay` 非常适合用来跨 Cloudflare 和源站对时

当 `clientRequestId` 还没打通时，`cfRay` 是很好的兜底字段。

它至少能回答两件事：

- 这是不是同一条经过 Cloudflare 的请求
- Cloudflare 侧看到的请求，源站最终有没有对应记录

### 3. `X-Request-Id` 不要轻易当作唯一业务链路 ID

如果链路中有 Envoy、Ingress、API Gateway、云平台网关，这个字段极可能被基础设施拿去使用。

更稳妥的方式是：

- 自己单独定义 `X-Client-Request-Id`
- 服务端自己生成 `X-Trace-Id`
- 把两个概念彻底分开

### 4. 只看“应用异常日志”会漏掉大量平台层问题

这次最典型的误区就是：

- 应用没有报错
- 没有慢 SQL
- 所以直觉上开始怀疑 Worker

但最后的证据链恰恰说明，应用代码反而是最清白的一段。

## 现在这套日志应该怎么用

后面再遇到同类超时，可以按下面这个顺序判断：

### 情况 1：前端有 `clientRequestId`，Worker 根本没日志

优先查：

- 浏览器到 Cloudflare
- 域名、DNS、前端跨域、请求是否真的发出

### 情况 2：Worker 有 `worker.request.start`，但没有 `worker.origin.fetch.start`

优先查：

- Worker 自己的逻辑
- CORS 拒绝
- 路径重写
- 关键环境变量缺失

### 情况 3：Worker 有 `worker.origin.fetch.start`，但没有 `worker.origin.fetch.complete`

优先查：

- Worker 到源站
- DNS
- 建连
- TLS
- 源站平台入口
- 浏览器先超时取消

### 情况 4：后端已经打印了 `http.request.start`，但浏览器仍然超时

优先查：

- 平台入口到应用之间的剩余耗时
- 响应回传
- 长连接 / 大响应体 / SSE
- 应用真正处理时长

## 这次排障最后该怎么落地

如果把这次结论转成工程动作，我会优先做这几件事：

1. 保留 `X-Client-Request-Id + X-Trace-Id + cfRay` 这套日志结构
2. Worker 缺少 `BACKEND_ORIGIN` 时直接报错，不再回退到开发态域名
3. 检查容器平台是否开启了 scale-to-zero 或存在明显冷启动
4. 查云平台入口网关 / Envoy / Ingress 的访问日志和转发耗时
5. 视情况把前端超时从 15 秒临时调高到 30 秒，仅作为定位手段，而不是最终修复

真正的修复通常不在前端，而在源站平台层：

- 让实例常驻
- 优化入口层转发
- 缩短冷启动
- 优化跨区域部署

## 小结

这次问题表面上看像是：

> Cloudflare Workers 偶发把请求弄丢了。

但完整证据链给出的答案其实是：

> Worker 没丢请求。请求到过 Worker，也最终到过应用，只是太晚才到应用。真正的慢点在应用之前的平台入口层。

这类问题最难的不是修某一行代码，而是先建立一条足够可信的证据链。

一旦 `clientRequestId`、`traceId`、`cfRay` 三个字段都打通，很多原本只能靠猜的判断，就会变成可以直接对日志下结论。

如果以后再遇到类似的跨 CDN、边缘计算、网关、容器平台链路超时，这套方法基本可以原样复用。

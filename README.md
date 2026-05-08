# fast-spider-skills-kit

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Python](https://img.shields.io/badge/python-%3E%3D3.10-blue)](https://python.org)

面向爬虫逆向的 **浏览器环境补全（env patching）** 工作流：在 Node `vm` 中搭建假浏览器环境，将站点原样的加签 JS 丢进沙箱离线出参。适用于 JSVMP / 重度混淆、难以纯算法复现的签名字段场景。

> **声明**：本仓库只提供通用方法论与模板代码，不包含任何第三方站点的加签 SDK 或敏感数据。请仅在合法授权、自家系统或明确允许测试的范围内使用；禁止用于未授权的爬取或绕过保护措施。

## English Summary

**fast-spider-skills-kit** is a browser environment patching toolkit for crawler reverse engineering. Build a fake `window`/`document`/`navigator`/XHR surface inside Node's `vm`, load the target's obfuscated signing bundle as-is, and produce signatures offline — without a headless browser in the final crawler.

- **Templates**: `core/` — ready-to-copy JS and Python starters
- **Your captured JS goes in**: `bundles/` (private; do not commit third-party SDKs)

## Quick Start

```bash
git clone https://github.com/alei-xi/fast-spider-skills-kit.git
cd fast-spider-skills-kit

# 0. 安装 Playwright 浏览器（仅首次）
npx playwright install chromium

# 1. 自动抓取 + 自动搭建环境（两步即可出签名）
node core/capture_sdk.js --url "https://www.<target>.com/"
node core/trace_env.js bundles/signer.js > bundles/fake_env.js

# 2. 编写 sign.js 加载 fake_env.js + 你的 SDK，启动签名服务

# 3. 从 Python 调用
pip install curl_cffi
python core/persistent_signer.py
```

## 前置依赖

| 组件 | 版本要求 | 用途 |
|------|----------|------|
| Node.js | >= 18 | 运行 `vm` 沙箱、JS 模板 |
| Playwright | latest | `capture_sdk.js` 自动抓取 SDK |
| Python | >= 3.10 | `persistent_signer.py` 子进程管理 |
| curl_cffi | latest | 端到端验证时的 TLS 指纹模拟 |

## 决策树：纯算法复现 vs 补环境

```
签名 SDK 是否为 JSVMP / 重度虚拟化？
├── 否，普通压缩 JS
│   ├── < 5 KB → 直接翻译到 Python
│   └── 5-50 KB → 纯算法翻译，几天内交付
└── 是，JSVMP / 栈式虚拟机解释器模式
    ├── 单一目标、低流量、接受 Node 依赖 → 补环境（本仓库方案）
    ├── 多目标 / 大规模 / 禁止 Node 运行时 → 先补环境验证，再规划移植
    └── 延迟关键（<5ms p99）→ 硬着头皮翻译，或用预计算签名
```

## 七阶段工作流

```
- [ ] Phase 1: 从目标页面抓取 SDK 文件
- [ ] Phase 2: 通过 Proxy 追踪 SDK 实际触碰的浏览器属性
- [ ] Phase 3: 搭建假浏览器环境
- [ ] Phase 4: 拦截签名触发点（XHR / fetch）
- [ ] Phase 5: 找到正确的 SDK 初始化配置（最容易静默出错的阶段）
- [ ] Phase 6: 锁定随机性实现确定性加签（可选）
- [ ] Phase 7: 端到端验证（真实 HTTP 请求）
```

### Phase 1: 抓取 SDK

打开目标页面，在 DevTools / Playwright 中抓取签名链涉及的**每一个** JS 文件的精确 URL 和内容。**不要**从 GitHub 镜像或博客复制 —— 版本每周都在变化。

**自动抓取**（推荐）：

```bash
# 基本用法
node core/capture_sdk.js --url "https://www.<target>.com/"

# 完整参数
node core/capture_sdk.js \
  --url "https://www.<target>.com/" \
  --out bundles/ \
  --timeout 15000 \
  --ua "Mozilla/5.0 ... Chrome/146.0.0.0 ..." \
  --cookie "session=abc123" \
  --min-size 30000 \
  --pattern "signer|vmp|sdk" \
  --screenshot
```

脚本会自动：打开 Chromium → 加载目标页面 → 按大小和文件名正则匹配 JS → 保存到 `bundles/` → 输出 `manifest.json`（含来源 URL、文件大小、sha256、抓取时间、cookie）。

SDK 链通常由 4 个角色构成（文件名因站点而异）：

| 角色 | 作用 | 识别方式 |
|------|------|----------|
| 核心运行时 | Web 工具函数、polyfill、环境检测 | 最早加载，20-50 KB |
| 反爬框架 | 探测浏览器环境、指纹采集、决定是否加签 | 中等大小；引用 `navigator.webdriver`、canvas、webgl |
| **签名生成器** | 实际的 JSVMP 打包体，输出签名字段 | 最大（100-200 KB）；含栈式虚拟机解释器、opcode 表 |
| 路由胶水层 | 决定哪些路径触发签名、签名如何附加到请求 | 小巧；读取 `XMLHttpRequest.prototype.open` 参数 |

保存到 `bundles/` 并记录来源 URL、文件大小、sha256、抓取时间到 `bundles/manifest.json`。

#### 抓取验证

```js
const text = fs.readFileSync('bundles/<candidate>.js', 'utf8');
console.log({
    has_jsvmp_pattern: /_vc_actionList|__vmp_|opCode|opcodeTable|stack\.push/.test(text),
    has_init_export: /\.init\s*=\s*function|\.init\s*:\s*function/.test(text),
    has_custom_alphabet: /['"][A-Za-z0-9+/=_\-]{60,68}['"]/.test(text),
    size: text.length,
});
```

没有任何一项命中说明抓错了文件。

### Phase 2: Proxy 追踪（全自动自愈）

**一键运行，零手动迭代。** 使用自愈 Proxy：当 SDK 访问不存在的属性时，Proxy 自动创建合理的 stub。如果仍然抛错，脚本会解析错误、注入缺失 stub、自动重跑，直到成功或达上限。

```bash
# 默认 8 轮自愈，输出可直接 require 的 env stub
node core/trace_env.js bundles/signer.js > bundles/fake_env.js

# 更多轮次 + 触发 XHR 签名探测
node core/trace_env.js --max-rounds 12 --init bundles/signer.js
```

脚本输出 stderr 显示每轮的自愈过程：
```
SDK: bundles/signer.js (145822 bytes)

── Round 1/8 ──
ERROR: Cannot read properties of undefined (reading 'userAgent')
  → last access before crash: navigator.userAgent
  → injected: navigator.userAgent

── Round 2/8 ──
ERROR: Cannot read properties of undefined (reading 'getContext')
  → last access before crash: document.createElement
  → injected: document.createElement

── Round 3/8 ──
OK — SDK loaded without throwing.

Total unique accesses: 87
Auto-stubbed: 71

──────────────────────────────────────────
// 最终 env stub 直接写入 stdout →
```

生成的 `bundles/fake_env.js` 是可直接 `require` 的模块，覆盖了 SDK 实际触碰的所有属性。**无需像传统流程那样 3-5 轮手动补属性。**

完整的手动入门模板仍保留在 [core/fake_env.js](core/fake_env.js)，如果你偏好从头手工搭建。

### Phase 3: 搭建假浏览器环境

把 Proxy 追踪日志翻译成有类型的 stub，按浏览器表面分组：

| 表面 | 签名关键属性 | 备注 |
|------|-------------|------|
| `navigator` | UA / platform / hardwareConcurrency / deviceMemory / webdriver=false / connection.effectiveType | UA 必须和 URL 参数（如有）一致 |
| `document` | createElement / cookie / characterSet / addEventListener | `createElement('canvas')` 必须返回可调用 `getContext` 的对象 |
| Canvas 2D 上下文 | fillText / measureText / getImageData / toDataURL | **返回值必须稳定**——随机像素会破坏签名可复现性 |
| WebGL 上下文 | getParameter(VENDOR/RENDERER) / getExtension / getSupportedExtensions | 固定字符串 |
| `screen` | width / height / colorDepth | 匹配 URL 参数 |
| `location` | href / origin / hostname / pathname | 必须和目标域名一致 |
| Web 平台类 | Request / Response / Headers / FormData / Blob / WebSocket / *Observer / AbortController | 全部 `typeof === 'function'`；方法体可为空 |
| Storage / History | localStorage / sessionStorage / history.pushState | 通过 getter/setter 实现类真实行为 |
| 定时器 | setTimeout / setInterval / requestAnimationFrame / requestIdleCallback | 必须真实地回调 |
| Crypto | crypto.getRandomValues | 如需确定性加签，锁死随机源 |

完整 stub（~400 行，可直接 `require`）见 [core/fake_env.js](core/fake_env.js)。

### Phase 4: 拦截签名触发点

大多数签名 SDK 不暴露 `sign(url)` 这样的公开 API——它们**透明地 hook** `XMLHttpRequest.prototype.send` 或 `window.fetch`，在请求发出前改写 URL。为了离线捕获签名，你需要构建一个假 XHR，做到：

1. `open()` 时记录 URL
2. `send()` 时将 `readyState` 设为 4、`status` 设为 200，**同步**触发
3. `responseText` 返回一个**看起来合理的假 token 响应**（签名 SDK 在初始化时经常 POST 到一个 token 接口）
4. 同步调用 `onreadystatechange` / `onload`

然后触发一次签名：

```js
vm.runInContext(`(function(u){
    const x = new XMLHttpRequest();
    x.open('GET', u);
    x.setRequestHeader('content-type', 'application/x-www-form-urlencoded');
    x.send(null);
    return x._url;  // 此时 SDK hook 已经将原始 URL 改写为带签名的 URL
})(${JSON.stringify(targetUrl)})`, ctx);
```

如果 SDK hook 的是 `fetch`，同样需要 stub `window.fetch` 返回 `Promise<FakeResponse>`。

**假响应内容很重要**——如果 SDK 初始化时 POST 获取运行时 token，你的 fake 必须返回它能解析的 JSON。通用最小结构：

```js
'{"data":{"d":"","e":"","f":""},"message":"success","status_code":0}'
'{"data":"","msg":"success","status_code":0}'
'{"code":0,"data":null,"msg":"ok"}'
```

常见坑：有些 SDK 要求 `readyState` 必须经历 1→2→3→4 的完整过渡；`Promise` 身份敏感（`fetch(...).constructor.name === 'Promise'` 必须为 true）；FakeXHR 绝不要真实发出网络请求。

### Phase 5: 找到正确的 SDK 初始化配置

**整个流程中最容易静默出错的阶段。** 配置错误时，`init()` 不抛异常，`sign(url)` 返回长度正确、字母表正确的字符串，LENGTH / FORMAT 检查全绿——但服务端拒绝。

#### 方法 1：读线上调用

在 DevTools Sources 面板全文搜索 `.init(`，找到页面启动时的初始化调用，把配置字面量**原样**复制下来。

#### 方法 2：Proxy 探测配置

```js
const accessed = new Set();
const probe = new Proxy(yourConfig, {
    get(t, p) { accessed.add(String(p)); return Reflect.get(t, p); },
});
realWindow.<signerGlobal>.init(probe);
console.log('SDK reads:', [...accessed].sort());
```

#### 常见配置结构（字段名因 vendor 而异）

```js
{
    appId:     <numeric>,
    pageId:    <numeric>,
    appKey:    '<vendor-string>',
    paths:     ['^/api/v1/', ...],  // 通常是正则前缀，不是字面量路径
    debug:     false,
    staging:   false,
    versionMajor: <float>,
    versionMinor: <float>,
}
```

#### 常见坑

- **`paths` 是正则前缀不是字面量** —— 最常见的错误。`'/api/v1/feed/list/'` 在某些匹配器中是字面量前缀，在另一些中是正则。看 SDK 的匹配代码再判断。
- **appId / pageId 不匹配** —— 错误 ID = 错误签名分支。
- **staging / debug 标志反转** —— `debug`、`staging` 这类字段在省略时通常**默认为 true**，导致 SDK 运行在生产环境会拒绝的签名模式。始终显式设为 `false`。
- **版本号字段是精确浮点数** —— `8.5` ≠ `8` ≠ `8.50`，从线上原样复制。

### Phase 6: 锁定随机性（可选）

签名 SDK 通常混入 `Date.now()` 和 `Math.random()`，每次输出不同。为了调试、回归测试和版本对比，锁死两者：

```js
const fixedNow = 1778048871000;
realWindow.Date.now = () => fixedNow;
realWindow.performance.now = () => fixedNow - 1000;

// 用 mulberry32 替代 Math.random
let state = 0xdeadbeef >>> 0;
realWindow.Math.random = function () {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
};

// 部分 SDK 也使用 crypto.getRandomValues —— 同样锁死
realWindow.crypto.getRandomValues = function (arr) {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256) & 0xff;
    return arr;
};
```

**锁定必须在加载 SDK 之前完成**，否则 SDK 内部会缓存旧引用。验证：同一 URL 签名两次 → 输出必须逐字节一致。

**不要在线上环境锁死**——服务端可能校验时间戳新鲜度。仅在测试和回归中使用。

### Phase 7: 端到端验证

**这是唯一能证明签名正确的步骤。** 长度/格式/固定字节检查只是必要条件，不是充分条件。

```python
import curl_cffi.requests as cr
signed = signer.sign(url)
r = cr.get(signed,
           headers={'User-Agent': UA, 'Cookie': fresh_cookie},
           impersonate='chrome120')
assert r.status_code == 200
data = r.json()
assert data.get('data') and len(data['data'].get('items', [])) > 0
```

**TLS 指纹模拟是必须的**——同样的签名 URL、同样的 cookie：

| 客户端 | 结果 |
|--------|------|
| 浏览器 fetch | 200 + JSON |
| `curl_cffi` `impersonate=chrome120` | 200 + JSON |
| Python `requests` | 200 + 空 body |
| Node `https.request` | 200 + 空 body |

反爬系统读到的是 TLS ClientHello、JA3、HTTP/2 settings——它们和 Chrome 的不一致。

#### 验证失败时的排查顺序

```
status=200 + 空 body
├── 先试：同一个 URL 不带签名参数 → 如果成功，这个接口不需要签名
├── 再试：用浏览器抓到的签名在 30 秒内重放
│   ├── 成功 → 你的本地签名器有 bug
│   └── 失败 → cookie 或一次性 token 过期，刷新再试
├── 排查：刷新一次性 token → 如果解决，只是 token 过期
└── 切换：chrome120 → chrome116 → chrome124 → 如果某个版本成功，是 TLS 指纹差异
```

## 从 Python 调用

启动一次 Node 进程然后复用——首次签名约 1.5s（SDK 加载），后续每次约 10-50ms。线程安全的 Python wrapper 见 [core/persistent_signer.py](core/persistent_signer.py)。

## 常见坑

### "签名生成了，但服务端返回 200 + 空 body"

按可能性排序：
1. **TLS 指纹** — 必须用 `curl_cffi --impersonate chrome120`
2. **Cookie / 一次性 token 过期** — 很多 vendor 签发有效期 < 10 分钟的 token，刷新即可
3. **签名与发送之间 URL 发生偏移** — 任何参数变化都需要重新签名
4. **init 配置错误**（Phase 5）
5. **SDK 包过期**（Phase 1）— 从线上重新抓取

### "签名长度在不同调用间不一致"

对于许多 SDK 来说这是正常的——输出长度和输入 URL 长度以及内部 nonce 有关。没有确凿证据前，不要把短/长输出过滤为"错误分支"。

### "vm.runInContext 报 `process is not defined`"

SDK 探测了 Node 全局变量来检测非浏览器环境。在 `buildContext` 中显式清除：

```js
realWindow.process = undefined;
realWindow.Deno = undefined;
realWindow.require = undefined;
realWindow.global = undefined;
realWindow.module = undefined;
```

### "Node 进程在 CLI 运行后不退出"

SDK 安装了内部定时器（心跳、token 刷新）来维持事件循环。在捕获签名后显式调用 `process.exit(0)`。

## 反模式

- ❌ 不要在最终交付中使用 Playwright/Puppeteer 驱动签名。浏览器仅用于 Phase 1（SDK 抓取）和 Phase 7（cookie 获取）。
- ❌ 不要跳过 Phase 2（Proxy 追踪）凭记忆写 stub。
- ❌ 不要用 `URLSearchParams.toString()` "清理"待签名的 URL。参数顺序会被改变，签名 SDK 对原始 query string 做哈希。
- ❌ 不要从博客 / GitHub 镜像复制 SDK 文件。始终从线上目标页面抓取。
- ❌ 不要仅凭长度检查就宣布成功。必须通过 Phase 7 的端到端 HTTP 验证。

## 目录结构

| 路径 | 说明 |
|------|------|
| `core/` | 可复用模板：`capture_sdk.js`、`trace_env.js`、`fake_env.js`、`persistent_signer.py` |
| `bundles/` | 本地存放抓到的 SDK 文件；**勿将第三方 SDK 提交到公开仓库** |
| `CLAUDE.md` | Claude Code 上下文指引 |

## 案例速览：JSVMP 签名器（脱敏）

从一次实际补环境任务中提炼的要点：

**SDK 链**（4 个文件）：core-runtime.js（30 KB）→ anti-crawl.js（100 KB）→ signer-vmp.js（145 KB）→ host-glue.js（8 KB）

**实际踩的坑**：

1. "我了解浏览器全局变量，直接凭记忆写 stub" → 浪费 2 小时。SDK 探测了 `document.characterSet`、`navigator.connection.effectiveType`、`window.chrome.runtime`、`screen.colorDepth` 等冷门属性。**始终先做 Phase 2。**
2. "签名长度 192，长度 196 一定是不正确的分支" → **错误。** 抓了 30 个真实浏览器签名，长度在 188/192/196 之间均匀分布，取决于 URL 长度。
3. "我把算法从签名器里提取出来" → 签名器是 JSVMP，核心是**执行 100+ KB opcode 的栈式虚拟机**，没有算法可提取。补环境套上原始包是 4 小时，完整移植估算 2-3 周。
4. "init 配置无所谓的，默认值够用了" → **静默杀手。** 最小配置生成的签名长度正确、字母表正确、解码干净——服务端拒绝。从 DevTools 复制线上完整配置后，固定字节匹配率从 50% 升至 71%，服务端接受。
5. "签名正确但服务端返回 200 空 body" → **不是签名的问题。** Node `https.request` 和 Python `requests` 在 TLS/HTTP-2 层被指纹识别。换成 `curl_cffi` 后通过。
6. "我拿浏览器抓到的签名重放来验证" → **30 秒内有效，之后失效。** Vendor 的一次性 token 迅速过期。始终用新鲜签发的签名做验证。
7. "为什么 CLI 运行后 Node 进程 hang 了 2 分钟？" → 签名器安装了心跳定时器。捕获签名后显式调用 `process.exit(0)`。

**性能数据**：首次签名 ~1500ms，后续 ~15ms 中位数。Python 持久化子进程（`persistent_signer.py`）~17ms 中位数。

## 许可证

见 [LICENSE](LICENSE)。

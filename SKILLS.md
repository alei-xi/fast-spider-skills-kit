# fast-spider · 技能能力参考

v2.2 — 配置驱动 · 五层纵深防御 · 种子确定性指纹

## 术语表 (Glossary)

| 英文术语 | 中文圈惯用称呼 | 说明 |
|----------|--------------|------|
| Environment Patching | 补环境 | 在 Node.js `vm` 沙箱中构造假浏览器全局对象 |
| Fingerprint | 浏览器指纹 / 设备指纹 | Canvas/WebGL/Audio 等 API 产出的硬件特征值 |
| JSVMP | JSVMP / JS 虚拟化 | 将 JS 源码编译为自定义字节码，由栈式虚拟机解释执行 |
| Prototype Chain | 原型链 | `window.__proto__ → Window.prototype → ...` 的继承链路 |
| Signer SDK | 加签 SDK / 签名 SDK | 目标站点用于生成请求签名参数（如 `_sign`、`_token` 等）的混淆 JS |
| Anti-Bot / Anti-Crawl | 风控 / 反爬 | 服务端检测非浏览器环境并拒绝请求的机制 |
| beforeParse | 生命周期钩子 / 注入点 | 在 `vm.createContext` 之前注入 cookie/状态的回调窗口 |
| Sandbox | 沙箱 | Node.js `vm.createContext` 创建的隔离 JS 执行环境 |
| Deterministic Seed | 确定性种子 | 固定随机数种子 → 相同输入产出相同"随机"指纹 |
| Proxy Monitoring | 代理监控 | 通过 Proxy 拦截并记录 SDK 对浏览器属性的每一次访问 |
| Anti-Rehost | 反重托管检测 | SDK 检测 `process`/`require` 等 Node 专属全局变量 |
| C++ Addon | C++ 原生插件 | 通过 N-API 编译的 `.node` 文件，实现 JS 引擎级不可伪造行为 |

---

## 1. 核心架构

### 1.1 五层纵深防御体系

本框架不依赖任何单一反检测手段。五层各自独立失效——攻击者必须同时突破全部五层才能识别沙箱环境。

| 层级 | 防御机制 | 实现文件 | 对抗的风控检测点 |
|------|---------|---------|-----------------|
| **L1: 原型链仿真** | `instanceof` + `Symbol.toStringTag` 覆盖 8 个构造函数 | `src/env/core.js` | `navigator instanceof Navigator`、`Object.prototype.toString.call(x)` |
| **L2: 原生函数标记** | `Function.prototype.toString` 全局劫持 → `[native code]` | `src/env/utils.js` | `fn.toString()` 返回是否为 `[native code]` |
| **L3: 属性防篡改** | `PrototypeBuilder.lockAll()` 锁定原型，SDK 无法 `defineProperty` 覆盖 | `src/env/prototype.js` | 运行时原型链篡改检测 |
| **L4: 透明化监控** | `document.all.getAccessLog()` 记录每次属性触碰及完整调用栈 | `src/env/document-all.js` | 静默风控探测行为（不打日志、不抛异常） |
| **L5: 配置隔离** | 每个目标站点独立 `platforms/<name>/` 目录，零交叉感染 | `platforms/<name>/` | 多站点凭证泄露、SDK 全局变量冲突 |

### 1.2 配置驱动架构

```js
const Toolkit = require('./src');
const win = Toolkit.createBrowser({
    platform: '<platform-name>',         // 自动装载 platforms/<name>/ 配置
    href: '<target-url>',
    canvasSeed: 42,                      // 确定性指纹（调试）/ "random"（生产）
    debugAll: true,                      // 开启 document.all 访问监控
    beforeParse(win) {
        // 注入环境状态（Cookies, 全局变量等）
    },
});
const ctx = require('vm').createContext(win);
```

### 1.3 透明化调试

传统"猜测式调试"：签名 403 → 怀疑某个属性没补 → 改代码 → 重跑 → 还是 403。本框架的可观测性设计将这个过程变成精确诊断：

```js
const win = Toolkit.createBrowser({ debugAll: true });
// ... 在 vm 中运行 SDK ...

const log = win.document.all.getAccessLog();
// 返回 [{ prop: String, time: Number, stack: String }, ...]
// prop 为属性名或 ".call()"（作为函数调用时）
// stack 为调用栈前 4 帧
```

---

## 2. 技能清单 (Capability Inventory)

| 技能域 | 核心组件 | 对抗的风控点 |
|--------|---------|-------------|
| **环境保真度** | `src/env/core.js` — 8 构造函数 + 完整原型链 | `instanceof`、原型遍历、冷门属性枚举 |
| | `src/env/navigator.js` — 5 个 Chrome 标准 PDF 插件 + MimeType 反向引用 | `navigator.plugins.length`、`for-of` 遍历 |
| | `src/env/utils.js` — `safefunction()` 函数原生标记 | `Function.prototype.toString` → `[native code]` |
| **确定性指纹** | `src/env/fingerprint/canvas.js` — mulberry32 随机种子 + 300×150 有效 PNG | `canvas.toDataURL()`、`getImageData()` 一致性 |
| | `src/env/fingerprint/webgl.js` — 5 GPU 配置 + WebGL 1.0/2.0 全覆盖 | `getParameter(VENDOR/RENDERER)`、`getSupportedExtensions` |
| | `src/env/fingerprint/audio.js` — AudioContext + AnalyserNode 种子数据 | `getFloatFrequencyData`、振荡器频率微变 |
| **生命周期** | `src/env/browser.js` — `beforeParse(win)` 注入钩子 | Cookie 注入、风控挑战状态（challenge-state）播种 |
| **行为透明化** | `src/env/document-all.js` — 可调用 Proxy + `getAccessLog()` | SDK 静默探测识别 + 调用栈追踪 |
| **反重托管** | `src/env/browser.js` — `process/require/global/module/Deno` → undefined | Node.js 环境检测 |

---

## 3. 平台开发

```bash
# 新站点接入三步走，不碰核心代码
cp -r platforms/example_platform_a platforms/my-target
# ① 编辑 config.json → 设置 homepage、test_url、指纹种子
# ② 编辑 index.js → 实现 3 个必需方法
# ③ node test/env_test.js → 验证通过即上线
```

### 平台接口契约

| 方法 | 返回值 | 必需 | 调用时机 |
|--------|---------|------|----------|
| `getFingerprintOptions()` | `{canvasSeed, webglProfile, ...}` | **是** | `createBrowser()` 内部 |
| `getBeforeParseHook()` | `function(win) \| null` | **是** | 窗口组装后、vm 冻结前 |
| `getScrapeConfig()` | `{headers, cookies, proxy, timeout}` | **是** | `capture_sdk.js` 采集阶段 |
| `onSDKLoaded(ctx)` | void | 否 | SDK 加载完成后 |
| `onBeforeSign(url)` | void | 否 | 每次签名前 |
| `onAfterSign(result)` | void | 否 | 每次签名后 |
| `validate(response)` | `boolean` | 否 | Phase 7 验证 |

---

## 4. 七阶段工作流

| # | 阶段 | 工具 | v2.2 状态 |
|---|------|------|----------|
| 1 | SDK 抓取 | `core/capture_sdk.js` | Playwright 有头浏览器自动抓取 |
| 2 | 环境追踪 | `archives/legacy_v1/trace_env.js` | v1 遗留（自愈 Proxy） |
| 3 | 搭建补环境 | `src/env/` | **全自动**（原型引擎） |
| 4 | 拦截签名触发 | `src/env/browser.js` | **全自动**（伪 XHR/fetch） |
| 5 | SDK 初始化配置 | 平台 `beforeParse` 钩子 | **声明式注入**（JSON 配置） |
| 6 | 锁定随机性 | `canvasSeed` 参数 | **种子驱动** |
| 7 | 端到端验证 | `curl_cffi` | 手动验证（唯一不可自动化的步骤） |

---

## 5. 设计原理

### 5.1 原型优先构造法

引擎通过严格的五步法构造每一个浏览器对象，确保与真实浏览器行为完全一致：

1. **定义不可调用的构造函数** — 直接调用抛出 `TypeError("Illegal constructor")`
2. **设置 `Symbol.toStringTag`** — `Object.prototype.toString.call(navigator)` → `"[object Navigator]"`
3. **创建正确 `[[Prototype]]` 链的实例** — 支持完整 `instanceof` 语义
4. **锁定原型属性** — 防止运行时通过 `Object.defineProperty` 篡改
5. **包装监控感知 Proxy** — 每次属性触碰可追踪、可记录

### 5.2 生命周期注入系统

`beforeParse` 钩子在环境组装完成之后、`vm.createContext` 冻结之前提供一个确定性注入窗口。这允许每个目标平台的配置脚本播种 Cookie、风控挑战状态、自定义全局变量。配合 `debugAll` 监控，SDK 的每一次属性访问都可追溯到具体调用位置。

### 5.3 确定性种子随机化

所有指纹生成器（Canvas 2D、WebGL、AudioContext）接收一个数字种子。相同种子跨调用产出逐字节一致的输出——这对回归测试至关重要。不同种子产出不同但有效的指纹。这一设计直接回应了行业普遍存在的"硬编码固定指纹值"做法——固定值本身就是一种可被风控识别的静态特征。

### 5.4 纵深防御架构

不依赖单一反检测手段。五层模型确保每层独立失效：攻击者需同时突破原型链验证、原生函数标记、属性锁定、访问监控和配置隔离——而监控层全程记录每一次尝试的完整调用链。

---

## 6. 沙箱约束

- `process`、`require`、`global`、`module`、`Deno` → 沙箱内必须为 `undefined`
- 伪 XHR 的 `responseText` 必须是 SDK 能解析的有效 JSON
- `document.all == undefined` 纯 JS 无法伪造（需要 V8 引擎级 `MarkAsUndetectable` C++ 标志）——启用监控代替
- 签名 URL 的参数顺序禁止重排——SDK 对原始 query string 做哈希
- Phase 7 验证必须用 `curl_cffi` 模拟 TLS 指纹，禁止用 `requests`/`urllib`
- SDK 抓取必须使用有头浏览器（`headless: false`），部分站点检测无头模式

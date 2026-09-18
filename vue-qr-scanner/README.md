# vue-qr-scanner

> 一个 **Vue 2 二维码扫码组件**：原生 `getUserMedia` 取流 + 双解码器（`BarcodeDetector` → `jsQR` 降级）+ 纯前端数字变焦 + 拍照回退。
> 零 UI 框架依赖（不需要 Element UI / Vuetify），只需要一个 `jsqr`。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Vue](https://img.shields.io/badge/Vue-2.x-42b883.svg)
![Zero UI deps](https://img.shields.io/badge/UI%20deps-none-brightgreen.svg)

---

## 目录

- [1. 简介](#1-简介)
- [2. 功能特性](#2-功能特性)
- [3. 目录结构](#3-目录结构)
- [4. 依赖与环境要求](#4-依赖与环境要求)
- [5. 快速开始](#5-快速开始)
- [6. 组件 API](#6-组件-api)
- [7. 使用示例](#7-使用示例)
- [8. 核心实现思路](#8-核心实现思路)
- [9. 兼容性与降级策略](#9-兼容性与降级策略)
- [10. 常见问题](#10-常见问题)
- [11. 注意事项](#11-注意事项)
- [12. 贡献指南](#12-贡献指南)
- [13. 许可证](#13-许可证)

---

## 1. 简介

`vue-qr-scanner` 是一个**只做扫码这一件事**的 Vue 2 组件。它的目标是解决移动端网页扫码里最常见的几个坑：

- 微信 / 企业微信 / 安卓内置浏览器**扫码识别率低**；
- 设备不报告 `MediaStreamTrack.zoom` 能力，**无法变焦**；
- `BarcodeDetector` 在部分内核里「存在但永远返回空」，**看起来能用其实扫不出来**；
- 非 HTTPS 环境下摄像头被拒绝，用户**完全没救**。

对应做法：自己控制取流与解码循环、把「变焦」实现为纯前端裁剪、对原生解码器做失效探测、并提供拍照识别作为兜底。

> 组件不含任何业务逻辑（不发请求、不依赖任何后端接口），只负责「把二维码扫出来 → 通过事件告诉你」。

---

## 2. 功能特性

| 特性 | 说明 |
| --- | --- |
| 📷 自定义取流 | `getUserMedia` 显式请求 1080p，避免内核退回到 640×480 导致画面偏糊 |
| 🧠 双解码器 | 优先 `BarcodeDetector`（快、抗畸变），失效自动降级到 `jsQR` |
| 🩺 失效探测 | 原生解码器连续 N 帧无结果即判定「存在但不可用」，避免白等 |
| 🔍 数字变焦 | 0.9x ~ 5.0x，**纯前端裁剪放大**，不依赖设备 zoom 能力 |
| 🤏 双指缩放 | 手势捏合调节倍率，带节流 |
| 💾 倍率记忆 | 记住上次使用的倍率（`localStorage`，可关闭） |
| 🔦 闪光灯 | 设备支持时自动显示开关（`torch` 能力探测） |
| 🖼️ 拍照回退 | 无法取流时用 `capture` 文件输入调起相机，`jsQR` 识别图片 |
| 🐞 调试浮层 | 实时显示分辨率 / 解码器 / 变焦 / 识别结果，支持 `?debug=1` |
| 📳 震动反馈 | 识别成功震动一下（设备支持时） |
| 🧩 零 UI 依赖 | 原生 `<button>` / `<input type="range">` + scoped CSS |

---

## 3. 目录结构

```text
vue-qr-scanner/
├── README.md                 # 本文档
├── LICENSE                   # MIT
├── CONTRIBUTING.md           # 贡献指南
├── CHANGELOG.md              # 版本记录
├── .gitignore
├── docs/
│   ├── IMPLEMENTATION.md     # 核心写法详解（取流/解码/变焦/性能）
│   └── FAQ.md                # 常见问题排查
├── src/
│   ├── QrScanner.vue         # ⭐ 组件本体（唯一核心文件）
│   └── index.js              # 导出与 Vue.use 安装
└── examples/
    └── BasicUsage.vue        # 使用示例（可直接拷到你的页面）
```

---

## 4. 依赖与环境要求

### 依赖

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Vue | 2.x | 组件基于 Vue 2 选项式 API |
| **jsqr** | `^1.4.0` | 唯一第三方依赖：纯 JS 二维码解码（原生解码器不可用时的回退，也是拍照识别的解码器） |

```bash
npm install jsqr --save
```

> 不需要 `html5-qrcode`：组件自己管理取流与解码循环，依赖更少、行为更可控。

### 环境

| 项 | 要求 |
| --- | --- |
| 浏览器 | Chrome / Edge / Safari / 企业微信内置浏览器（需支持 `getUserMedia`） |
| **安全上下文** | **必须 HTTPS 或 localhost**，否则 `getUserMedia` 会被浏览器直接拒绝 |
| 移动端 | 建议 HTTPS + 企业微信内置浏览器；iOS 需 `playsinline`（组件已内置） |

---

## 5. 快速开始

### 5.1 复制文件

把 `src/QrScanner.vue` 放到你的组件目录（例如 `src/components/QrScanner.vue`）。

### 5.2 局部注册（推荐）

```vue
<template>
  <QrScanner @decoded="onDecoded" />
</template>

<script>
import QrScanner from "@/components/QrScanner.vue";

export default {
  components: { QrScanner },
  methods: {
    onDecoded({ text, source }) {
      console.log("扫码结果：", text, "来源：", source);
    },
  },
};
</script>
```

### 5.3 全局注册

```js
import Vue from "vue";
import QrScanner from "vue-qr-scanner";

Vue.use(QrScanner); // 注册为 <qr-scanner />
```

### 5.4 打开调试浮层

在页面 URL 后追加 `?debug=1`（同时兼容 hash 路由），即可看到实时采集参数：

```text
[10:21:03] 环境支持 getUserMedia
[10:21:04] 采集分辨率 1920x1080，引导框占宽 36.6%
[10:21:04] 设备支持闪光灯
[10:21:04] 解码器: 原生 BarcodeDetector
[10:21:04] 变焦区间 0.9x ~ 5x
[10:21:07] 识别成功: 804000363
```

---

## 6. 组件 API

### 6.1 Props

| 名称 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `autoStart` | Boolean | `false` | 挂载后自动开启摄像头 |
| `facingMode` | String | `'environment'` | 首选朝向，`environment` 后置 / `user` 前置；失败会自动尝试另一个 |
| `startText` | String | `'扫描二维码'` | 入口按钮文案 |
| `tipText` | String | `'将二维码放入框内，即可自动扫描'` | 取景提示文案 |
| `idealWidth` | Number | `1920` | 期望采集宽度（内核会协商到最接近的档位） |
| `idealHeight` | Number | `1080` | 期望采集高度 |
| `frameRatio` | Number | `0.65` | 引导框边长占解码采样区的比例（0~1） |
| `zoomMin` | Number | `0.9` | 变焦下限（低于 1x 时画面不再收缩，按 1x 处理） |
| `zoomMax` | Number | `5` | 变焦上限 |
| `zoomStep` | Number | `0.1` | 变焦步进 |
| `rememberZoom` | Boolean | `true` | 是否记忆上次倍率 |
| `zoomStorageKey` | String | `'qr-scanner.zoom'` | 倍率存储键 |
| `showZoom` | Boolean | `true` | 是否渲染变焦滑杆 |
| `showTorch` | Boolean | `true` | 是否允许显示闪光灯（仍需设备支持） |
| `photoFallback` | Boolean | `true` | 无法取流时提供「拍照识别」 |
| `debug` | Boolean | `false` | 调试浮层（也可用 `?debug=1`） |
| `vibrate` | Boolean | `true` | 识别成功震动反馈 |
| `stopOnDecoded` | Boolean | `true` | 识别成功后是否自动停止取流 |

### 6.2 Events

| 名称 | 负载 | 说明 |
| --- | --- | --- |
| `decoded` | `{ text: string, source: 'camera' \| 'photo' }` | 识别成功 |
| `start` | — | 摄像头就绪、解码循环已启动 |
| `stopped` | — | 已停止并释放摄像头 |
| `error` | `{ code: string, message: string }` | 出错（见下表） |
| `zoom-change` | `number` | 变焦变化 |
| `torch-change` | `boolean` | 闪光灯状态变化 |
| `log` | `string` | 调试日志（便于外部收集/上报） |

**`error.code` 取值**

| code | 含义 | 建议处理 |
| --- | --- | --- |
| `INSECURE_CONTEXT` | 非 HTTPS / 非 localhost | 引导用户换 HTTPS 访问；已自动尝试拍照回退 |
| `PERMISSION_DENIED` | 用户拒绝摄像头权限 | 提示在浏览器设置中开启 |
| `NOT_FOUND` | 无可用摄像头 | 提示换设备 |
| `NOT_READABLE` | 摄像头被占用 | 提示关闭其他占用摄像头的应用 |
| `NO_DECODER` | 解码器不可用 | 提示刷新页面（`jsqr` 未正确打包） |
| `TORCH_UNSUPPORTED` | 闪光灯切换失败 | 隐藏开关即可 |
| `PHOTO_DECODE_FAILED` | 图片里没识别到二维码 | 提示重新拍照 |

### 6.3 Methods（通过 `ref` 调用）

| 方法 | 说明 |
| --- | --- |
| `start()` | 开启摄像头并启动解码循环，返回 `Promise<boolean>` |
| `stop()` | 停止解码并释放摄像头 |
| `setZoom(value)` | 设置变焦倍率（自动夹到区间内） |
| `toggleTorch()` | 切换闪光灯 |
| `pickPhoto()` | 打开拍照 / 相册选择 |
| `scanImage(file)` | 直接识别一个图片文件，返回 `Promise<string\|null>` |

### 6.4 插槽

组件不提供插槽（保持简单）。需要自定义 UI 时，建议直接基于 `src/QrScanner.vue` 改写模板部分——**业务逻辑（`methods`）可以原样复用**。

---

## 7. 使用示例

### 7.1 最小用法

```vue
<QrScanner @decoded="({ text }) => (code = text)" />
```

### 7.2 手动控制 + 错误处理

```vue
<template>
  <div>
    <QrScanner ref="scanner" :auto-start="false" @decoded="onDecoded" @error="onError" />
    <button @click="$refs.scanner.start()">开始扫描</button>
  </div>
</template>

<script>
import QrScanner from "@/components/QrScanner.vue";

export default {
  components: { QrScanner },
  methods: {
    onDecoded({ text, source }) {
      this.$message.success(`识别到：${text}（来源：${source}）`);
      // 继续你的业务逻辑，例如查询资产、发起盘点……
    },
    onError({ code, message }) {
      if (code === "INSECURE_CONTEXT") {
        this.$message.error("请使用 HTTPS 或 localhost 访问");
      } else {
        this.$message.warning(message);
      }
    },
  },
};
</script>
```

### 7.3 连续扫描（扫完不停止）

```vue
<QrScanner :stop-on-decoded="false" @decoded="onEach" />
```

> 适合批量盘点场景：扫到一个就记一个，摄像头不中断。

### 7.4 识别已有图片

```js
const file = this.$refs.fileInput.files[0];
const text = await this.$refs.scanner.scanImage(file);
```

完整示例见 [`examples/BasicUsage.vue`](./examples/BasicUsage.vue)。

---

## 8. 核心实现思路

简要版（完整版见 [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md)）：

1. **自己管取流**：`getUserMedia({ video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } } })`，并把 `containerRatio` 与 `frameRatio` 按真实分辨率算出来。
2. **裁剪即变焦**：不做任何设备约束，直接把画面中心按倍率裁一块正方形送解码——裁得越小，二维码在送检图像里占比越大。
3. **双解码器 + 失效探测**：`BarcodeDetector` 连续 3 帧无结果或直接抛错，就永久切到 `jsQR`；两者共用同一块复用画布。
4. **rAF 节流**：用 `requestAnimationFrame` 驱动，上一帧没解完就跳过本帧，帧率由解码速度决定，不做固定间隔等待。
5. **所见即所扫**：`video` 的 CSS `scale` 与解码采样区同口径，引导框随倍率同步收缩，保证「框内一定能扫到」。
6. **降级与兜底**：环境不支持 / 权限被拒时，`capture="environment"` 的文件输入会调起原生相机，用 `jsQR` 识别拍下来的照片。

---

## 9. 兼容性与降级策略

| 场景 | 行为 |
| --- | --- |
| 无 `mediaDevices.getUserMedia` / 非安全上下文 | 触发 `INSECURE_CONTEXT`，自动打开拍照回退 |
| 后置摄像头启动失败 | 自动尝试前置摄像头 |
| 前后置都失败 | 触发对应 `error`（`PERMISSION_DENIED` / `NOT_FOUND` / `NOT_READABLE`） |
| `BarcodeDetector` 不存在（iOS Safari 等） | 直接使用 `jsQR` |
| `BarcodeDetector` 存在但失效 | 连续 3 帧无结果后切换 `jsQR` |
| 高倍变焦导致采样区过小 | 解码输入放大到 320px 下限，保证解码器有足够像素 |
| 识别到深底浅码 | `jsQR` 开启 `inversionAttempts: 'attemptBoth'` |

---

## 10. 常见问题

**Q：摄像头打不开，提示请使用 HTTPS？**
`getUserMedia` 只在安全上下文可用：`https://` 或 `http://localhost`。用 `http://192.168.x.x` 访问会被浏览器直接拒绝。开发时可给本地起 HTTPS（自签证书），或使用 `localhost`。

**Q：画面很糊？**
看调试浮层里的「采集分辨率」。如果只有 640×480，说明内核没接受 1080p 请求；如果已经 1080p 还糊，多半是摄像头本身上限或对焦问题。

**Q：扫不出来，但二维码明明在框里？**
1）调大变焦；2）看调试浮层的「解码器」是原生还是 `jsQR`；3）确认 `jsqr` 正确安装（若打包异常会触发 `NO_DECODER`）。

**Q：变焦到 0.9x 画面没变化？**
这是设计如此：纯前端裁剪无法「看到比原始画面更广」的区域，低于 1x 一律按 1x 处理，避免采样区越界产生黑边。

**Q：iOS 上视频不播放？**
组件已加 `playsinline` / `webkit-playsinline` / `muted`；若被浏览器自动播放策略拦截，首次交互（点击）后再调用 `start()` 即可。

更多见 [docs/FAQ.md](./docs/FAQ.md)。

---

## 11. 注意事项

1. **必须 HTTPS 或 localhost**，这是浏览器的硬性要求，不是组件能绕过的。
2. 组件在 `beforeDestroy` 中会 `await stop()` 释放摄像头；若你把 `QrScanner` 放在 `<keep-alive>` 里，请在 `deactivated` 时手动调用 `stop()`，否则摄像头指示灯会一直亮着。
3. `stopOnDecoded` 默认 `true`。批量场景请设为 `false` 并自行做去重（同一二维码会在连续多帧里命中）。
4. 变焦是**数字裁剪**：倍率越高，送解码的图像越「放大但像素更少」，超过设备分辨率上限后不会更清晰。
5. 调试浮层默认只在 `?debug=1` 或 `:debug="true"` 时渲染，生产环境请保持关闭。
6. 组件不处理业务，不引入 axios / UI 库——请在你的 `@decoded` 回调里做请求与提示。

---

## 12. 贡献指南

欢迎 Issue 与 PR，详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。简要约定：

- 一个 PR 只做一件事，并说明验证方式（设备 / 浏览器 / 是否 HTTPS）；
- 涉及扫码核心逻辑（`_decodeFrame` / 解码器切换 / 变焦口径）的改动，请说明对识别率与性能的影响；
- 保持零 UI 依赖与「只用 `jsqr`」的依赖面。

---

## 13. 许可证

[MIT](./LICENSE) © 2026 vue-qr-scanner contributors

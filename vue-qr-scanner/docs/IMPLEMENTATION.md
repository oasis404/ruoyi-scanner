# 核心实现详解 · Implementation

本文讲解 `QrScanner.vue` 里每一个关键取舍背后的原因，以及踩过的坑。

---

## 0. 整体流程

```text
start()
  ├─ _canUseUserMedia()            环境自检（API 是否存在 + 是否安全上下文）
  ├─ active = true → $nextTick     让 <video> 先渲染出来
  ├─ _openCamera(facingMode)       取流 + 绑定 srcObject + play()
  │    └─ _waitForVideoReady()     等真实分辨率 → 算 containerRatio / frameRatioPct
  ├─ _initTorchCapability()        探测 torch 能力
  ├─ _initDecoder()                选解码器（原生 / jsQR）
  ├─ _resetZoom()                  固定变焦区间 + 恢复上次倍率
  └─ _startDecodeLoop()            rAF 循环
        └─ _decodeFrame()          裁剪采样区 → 画布 → 解码 → 命中则 _onDecoded()
stop()
  ├─ _decoding = false + cancelAnimationFrame
  ├─ _releaseStream()              逐条 track.stop() + srcObject = null
  └─ 复位 torch 状态
```

---

## 1. 取流：为什么必须显式声明分辨率

```js
navigator.mediaDevices.getUserMedia({
  audio: false,
  video: {
    facingMode,
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
});
```

`getUserMedia` 不指定 `width` / `height` 时，**多数内核会退回规范默认的 640×480**。这个分辨率下：

- 远处的小二维码只有几十像素，解码器直接无视；
- 一旦启用变焦裁剪，采样区更小，画质迅速崩坏。

用 `ideal`（而非 `exact`）声明 1080p，内核会协商到「最接近且支持」的档位，不会因为设备只支持 720p 就整体失败。

拿到流之后立刻读取 `videoWidth` / `videoHeight`（必要时等 `loadedmetadata`，并加 2s 兜底定时器），因为**取景比例、引导框尺寸、采样区换算全都依赖它**。

---

## 2. 解码循环：rAF + 「上一帧没解完就跳过」

```js
const loop = () => {
  if (!this._decoding) return;
  if (!this._decodingBusy) {
    this._decodingBusy = true;
    this._decodeFrame()
      .catch(...)
      .then(() => { this._decodingBusy = false; });
  }
  this._rafId = requestAnimationFrame(loop);
};
```

为什么不 `setInterval(200)`：

- 固定间隔会把**有效帧率压得过低**（解码本身可能就要 100~200ms），二维码在视野里一晃就漏掉；
- 而 rAF 天然与屏幕刷新对齐，且用 `_decodingBusy` 做互斥——**帧率由解码速度决定**，快则快扫，慢则自动降频，不会堆积任务。

`_decodeFrame` 内部还有一道保险：`video.readyState < 2` 时直接返回，避免拿到空帧。

---

## 3. 变焦 = 裁剪采样区（不碰设备能力）

这是整个方案里最关键的取舍。

**常见做法**是调用 `track.applyConstraints({ advanced: [{ zoom }] })`，但它：

- 依赖设备上报 `zoom` 能力，企业微信 / 部分安卓内核**根本不报告**；
- 即使报告，可调范围也因机型而异。

**本组件的做法**：完全不动设备，直接把画面中心裁一块正方形送解码：

```js
const side = Math.min(vw, vh) / Math.max(zoom, 1); // 采样区边长
const sx = (vw - side) / 2;
const sy = (vh - side) / 2;
ctx.drawImage(video, sx, sy, side, side, 0, 0, out, out);
```

倍率越大 → `side` 越小 → 二维码在送检图像里占比越大 → 解码命中率越高。

好处：**任何支持 `getUserMedia` 的环境都能变焦**，行为完全可预期。

代价：这是「数字变焦」，本质是放大而不是看得更广，所以：

- 下限不允许 < 1x（否则采样区会超出画面，产生黑边与无效像素），代码里统一 `Math.max(zoom, 1)`；
- 上限受采样区像素数限制（见下一节）。

---

## 4. 采样区像素与性能的三条约束

```js
const DECODE_MIN_PX = 320; // 太小：解码器识别不到
const DECODE_MAX_PX = 800; // 太大：单帧耗时飙升，帧率反而下降
```

```js
let out = Math.round(side);
if (out > DECODE_MAX_PX) out = DECODE_MAX_PX;
else if (out < DECODE_MIN_PX) out = DECODE_MIN_PX;
```

- 常规分辨率（1080p）下 `side ≈ 1080`，会被压到 800，**用一点精度换明显的速度**；
- 高倍变焦时 `side` 可能只有一两百像素，则**放大到 320**，让解码器有足够像素可用。

> 注意这里是「输出尺寸」而非「采样尺寸」：`drawImage` 的第 5、6 个参数决定目标画布大小，浏览器会做缩放。

另外，画布上下文按解码器选择：

```js
this._workCtx = this._detector
  ? canvas.getContext("2d")                                  // 原生解码器直接读画布
  : canvas.getContext("2d", { willReadFrequently: true });   // jsQR 每帧 getImageData
```

`willReadFrequently` 会让浏览器把画布放**软件后备存储**，避免每帧 GPU→CPU 回读造成卡顿。

---

## 5. 双解码器与「存在但失效」的探测

```js
if (typeof window.BarcodeDetector === "function") { /* 尝试创建 */ }
```

原生 `BarcodeDetector` 快且抗畸变，但它有两个坑：

1. **不存在**：iOS Safari、部分内核直接没有 → 用 `jsQR`；
2. **存在但永远返回空**：部分安卓内核实现是失效的——API 有、调用不报错、`detect()` 恒为空数组。

只判断「有没有」会让这些设备「看着在扫、其实永远扫不出来」。所以加了失效探测：

```js
this._detectorMisses += 1;
if (this._detectorMisses >= DETECTOR_MAX_MISSES) {
  this._switchToJsQr(`BarcodeDetector 连续 ${DETECTOR_MAX_MISSES} 帧无结果`);
}
```

阈值取 **3** 是有意为之：正常实现哪怕画面里暂时没有二维码，也只是一次空结果，**真命中时第 1 帧就能出结果**。阈值取大了（比如 30）会让每次启动白等好几秒。

切到 `jsQR` 后需要**重建画布**，因为上下文创建参数不同（`willReadFrequently`）无法对已有画布生效：

```js
_switchToJsQr() { this._detector = null; this._workCanvas = null; this._workCtx = null; }
```

`jsQR` 调用时开启反色尝试，兼容深底浅码：

```js
jsQR(imageData.data, size, size, { inversionAttempts: "attemptBoth" });
```

---

## 6. 所见即所扫：视觉与解码口径一致

如果只放大解码采样区、不放大画面，用户会看到「框里明明有码但扫不到」。所以两者必须同口径：

```js
// 画面：> 1x 才加 transform（见下）
videoStyle() { return this.zoomValue <= 1 ? {} : { transform: `scale(${zoom})` }; }

// 引导框：随倍率同步收缩
frameStyle() {
  const ratio = this.frameRatioPct / Math.max(this.zoomValue, 1);
  return { width: `${ratio}%`, paddingBottom: `${ratio}%` };
}
```

**为什么 1x 时必须返回空样式？** 只要声明了 `transform`（哪怕是 `scale(1)`），浏览器就会把 `video` 提升为合成层，按 CSS 像素栅格化后再放大到物理像素——在 2x/3x DPR 的手机上，画面会肉眼可见地发虚。所以只有真正需要变焦时才启用 `transform`。

同理，`.qr-video` 上刻意不写 `transition`。

---

## 7. 双指缩放

```js
onPinchMove(event) {
  if (event.touches.length !== 2 || !this._pinchStartDistance) return;
  event.preventDefault();                       // 仅双指时阻止页面滚动
  if (now - this._lastPinchAt < 100) return;    // 节流
  this.applyZoom(this._pinchStartZoom * (distance / this._pinchStartDistance));
}
```

要点：

- **记录手势起始倍率**（`_pinchStartZoom`），用「当前间距 / 起始间距」做比例，而不是累加增量——避免累计误差导致手感发飘；
- 只在双指时 `preventDefault()`，单指滑动照常滚动页面；
- 100ms 节流，防止每帧都触发重绘。

---

## 8. 变焦记忆

同一批资产标签的尺寸与拍摄距离通常一致，所以把倍率存进 `localStorage`：

```js
const ZOOM_STORAGE_KEY = "qr-scanner.zoom";
```

`localStorage` 在隐私模式/受限环境可能抛异常，因此读写都包 `try/catch` 并静默降级。恢复时需要 **clamp 到当前区间**，否则用户改了 `zoomMax` 之后，旧的 8x 会越界。

---

## 9. 生命周期与资源释放

```js
async beforeDestroy() {
  await this.stop(); // 必须 await：否则组件销毁后摄像头指示灯可能仍亮着
}
```

`stop()` 的顺序很重要：

1. 先 `_decoding = false` + `cancelAnimationFrame`——**否则释放过程中仍有帧在跑**；
2. 再逐条 `track.stop()` 并置 `video.srcObject = null`；
3. 最后复位 `torchSupported` / `torchOn`（摄像头关了，灯控状态就失效了）。

> 若放在 `<keep-alive>` 中，`beforeDestroy` 不会触发，需在 `deactivated` 手动 `stop()`。

---

## 10. 拍照回退

非安全上下文、或摄像头被占用时，与其让用户卡死，不如直接引导拍照：

```vue
<input ref="photoInput" type="file" accept="image/*" capture="environment" @change="onPhotoChange" />
```

`capture="environment"` 在移动端会直接调起后置相机。拿到文件后：

```js
img.onload → canvas 等比缩放到 <= 1600px → getImageData → jsQR(..., 'attemptBoth')
```

图片统一走 `jsQR`（原生 `BarcodeDetector` 虽然也能吃 `ImageBitmap`，但兼容性差异大，不如统一）。

---

## 11. 错误映射

浏览器抛出的 `getUserMedia` 异常对用户毫无意义，统一翻译成可读文案 + 稳定 `code`：

| 原始 | code | 文案 |
| --- | --- | --- |
| 无 `getUserMedia` / `isSecureContext === false` | `INSECURE_CONTEXT` | 请使用 HTTPS 或 localhost 访问 |
| `NotAllowedError` / 含 `Permission` | `PERMISSION_DENIED` | 权限被拒绝，请在浏览器设置中允许 |
| `NotFoundError` | `NOT_FOUND` | 未检测到可用摄像头 |
| `NotReadableError` / 含 `in use` | `NOT_READABLE` | 摄像头被其他应用占用 |
| `SecurityError` / 含 `secure` | `INSECURE_CONTEXT` | 同上 |
| 其他 | `UNKNOWN` | 摄像头暂不可用，请稍后重试 |

组件只 `$emit('error')`，**不弹任何 UI** —— 提示方式交给使用方决定。

---

## 12. 调试手段

现场（尤其手机端着二维码对着设备）排查时，console 很难看，所以内置两层：

1. **浮层日志**：`?debug=1` 或 `:debug="true"`，在取景画面上实时滚动最近 4 条；
2. **`log` 事件**：所有日志同时以事件抛出，可上报到你的日志系统。

打印内容包括：采集分辨率、摄像头上限、实际采集、解码器类型、变焦区间/变化、解码异常、识别结果——基本覆盖了「为什么扫不出来」的全部可能。

---

## 13. 踩坑清单

| 坑 | 现象 | 处理 |
| --- | --- | --- |
| 不声明分辨率 | 画面偏糊，远处小码认不出 | 显式 `ideal: 1920×1080` |
| `getUserMedia` 在 HTTP 下 | 直接抛错，用户一脸懵 | 预检 `isSecureContext` 并给出明确文案 |
| 固定间隔解码 | 有效帧率低，晃一下漏码 | rAF + 忙碌互斥 |
| 只判 API 存在 | 某些安卓「永远扫不出来」 | 连续 N 帧无结果即切换解码器 |
| `scale(1)` 也提升合成层 | 高 DPR 屏幕画面发虚 | 1x 时返回空 style |
| 画布每帧重建 | GC 抖动、帧率不稳 | 复用画布，仅尺寸变化时重建 |
| 忘记 `willReadFrequently` | `jsQR` 路径卡顿 | 按解码器选择上下文参数 |
| 销毁不 `await stop()` | 摄像头指示灯常亮 | `beforeDestroy` 中 await |
| 变焦 < 1x | 采样区越界、黑边 | 统一 `Math.max(zoom, 1)` |
| 手势累加增量 | 缩放发飘、漂移 | 用「起始倍率 × 间距比」 |

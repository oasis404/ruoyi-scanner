# 常见问题 · FAQ

## 一、摄像头

### Q1. 提示「请使用 HTTPS 或 localhost 访问」，摄像头打不开

浏览器的硬性安全策略：`getUserMedia` 只在**安全上下文**中可用。

| 访问方式 | 可用 |
| --- | --- |
| `https://your-domain` | ✅ |
| `http://localhost` / `http://127.0.0.1` | ✅ |
| `http://192.168.x.x`（局域网 IP） | ❌ |

**解决**：

- 开发阶段：用 `localhost` 访问，或给本地起 HTTPS（如 `mkcert` 自签证书）；
- 移动端联调：必须 HTTPS，或用内网穿透（ngrok / frp）拿到一个 https 域名；
- 微信 / 企业微信内置浏览器同样遵循该规则。

> 组件在检测到该情况时会自动打开「拍照识别」，至少保证功能可用。

### Q2. 提示「摄像头权限被拒绝」

用户点了「拒绝」，或系统/浏览器层面禁用了摄像头。浏览器通常**不会再弹第二次**，需要在地址栏左侧的站点设置里手动允许，然后刷新页面重新 `start()`。

### Q3. 提示「摄像头被其他应用占用」

设备上已有程序占用摄像头（相机、会议软件、另一个浏览器标签页）。关闭后重试。

### Q4. 前后摄像头都不行

组件会自动先试 `facingMode` 指定的朝向，再试另一个。两者都失败才会抛 `error`。可结合调试浮层确认失败原因。

---

## 二、识别效果

### Q5. 画面很糊

先看调试浮层的「采集分辨率」：

| 情况 | 原因 | 处理 |
| --- | --- | --- |
| 只有 640×480 | 内核没接受 1920×1080 请求 | 检查 `idealWidth/idealHeight` 是否被覆盖；换较新的浏览器内核 |
| 已是 1920×1080 仍糊 | 摄像头本身分辨率上限，或对焦未完成 | 调整拍摄距离，等待对焦稳定 |
| 变焦后变糊 | 数字变焦的固有代价 | 见 Q7 |

### Q6. 二维码在框里却扫不出来

按顺序排查：

1. **调大变焦**——这是最有效的手段；
2. 看浮层「解码器」：显示 `jsQR` 说明退回纯 JS，速度会慢一些，但更兼容；
3. 避免反光、油污、褶皱，保持光线充足；
4. 确认二维码本身没有被裁切/变形；
5. 若浮层显示识别到了但业务没反应，检查 `@decoded` 是否绑定正确。

### Q7. 变焦到最大反而不清晰？

数字变焦是「裁剪 + 放大」：倍率越高，采样区越小，送检图像的**原始像素**越少。当采样区小到需要放大到 320px 下限时，画质已经靠插值撑着了。

建议：变焦在 **1.5x ~ 3x** 之间通常最佳；再大只适合二维码非常远的场景。

### Q8. 变焦最小是 0.9x，但画面没有任何变化？

设计如此。纯前端裁剪**无法看到比原始画面更广**的区域，低于 1x 一律按 1x 处理，避免采样区超出视频画面产生黑边。`zoomMin = 0.9` 只是为了留一点调节余量。

### Q9. 闪光灯按钮不出现

由 `track.getCapabilities().torch` 决定，仅移动端部分设备支持；桌面摄像头基本都没有，属正常。

---

## 三、集成与使用

### Q10. `@decoded` 触发多次？

若 `stopOnDecoded` 为 `false`，同一二维码会在连续多帧里命中，触发多次。两种处理：

```js
// 方案 A：扫完即停（默认）
<QrScanner :stop-on-decoded="true" @decoded="onDecoded" />

// 方案 B：连续扫描 + 自己按时间窗口去重
<QrScanner :stop-on-decoded="false" @decoded="onEach" />
```

```js
onEach({ text }) {
  const now = Date.now();
  if (this._last === text && now - this._lastAt < 3000) return; // 3 秒内同一码忽略
  this._last = text;
  this._lastAt = now;
  // 业务处理
}
```

### Q11. 页面切走再回来，摄像头还亮着

组件在 `beforeDestroy` 会释放摄像头。但如果组件被 `<keep-alive>` 缓存，`beforeDestroy` 不会触发，需要在页面级处理：

```js
deactivated() { this.$refs.scanner.stop(); }
```

### Q12. 想自定义 UI 样式？

组件用的是原生标签 + `scoped` 样式，直接改 `QrScanner.vue` 的 `<template>` 与 `<style>` 即可——**`methods` 部分可以原样保留**。

若需要浅色/深色主题，覆盖这些类即可：`.qr-btn`、`.qr-frame`、`.qr-scanline`、`.qr-tip`、`.qr-zoom`。

### Q13. 打包报错 / 提示 `NO_DECODER`

说明 `jsqr` 没有被正确引入：

```bash
npm install jsqr --save
```

确认 `QrScanner.vue` 顶部的 `import jsQR from "jsqr";` 未被 tree-shaking 掉（`jsqr` 是 UMD 包，正常打包为函数）。若使用 Vite / webpack5 遇到 ESM 互操作问题，可试：

```js
import jsQR from "jsqr/dist/jsQR.js";
```

---

## 四、性能

### Q14. 扫码时手机发热 / 卡顿

可调项：

| 目标 | 做法 |
| --- | --- |
| 降低单帧耗时 | 调小 `idealWidth/idealHeight`（如 1280×720），或降低送检边长上限（改源码里的 `DECODE_MAX_PX`） |
| 降低整体占用 | 非取景状态下务必 `stop()`，不要让摄像头常驻 |
| 减少无用解码 | 用 `stopOnDecoded` 或业务侧及时停扫 |

### Q15. 强光/暗光下识别率差

优先用闪光灯（`showTorch`）；若设备不支持 torch，只能靠调整环境光线或拍摄角度。

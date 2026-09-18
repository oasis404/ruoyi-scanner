# ruoyi-scanner

> Vue 2 二维码扫码组件：原生 `getUserMedia` 取流 + 双解码器（`BarcodeDetector` → `jsQR` 自动降级）+ 纯前端数字变焦 + 拍照回退。零 UI 框架依赖。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./vue-qr-scanner/LICENSE)
![Vue](https://img.shields.io/badge/Vue-2.x-42b883.svg)

## 特性

| 特性 | 说明 |
| --- | --- |
| 自定义取流 | 显式请求 1080p，避免内核退回 640×480 导致画面偏糊 |
| 双解码器 | 优先原生 `BarcodeDetector`，失效自动降级到 `jsQR` |
| 失效探测 | 原生解码器连续 3 帧无结果即判定「存在但不可用」并切换 |
| 数字变焦 | 0.9x ~ 5x，纯前端裁剪放大，不依赖设备 `zoom` 能力 |
| 双指缩放 | 手势捏合调节，带节流与倍率记忆（localStorage） |
| 闪光灯 | 设备支持时自动显示开关（`torch` 能力探测） |
| 拍照回退 | 无法取流时用 `capture` 调起相机，`jsQR` 识别图片 |
| 调试浮层 | URL 加 `?debug=1`，实时显示分辨率 / 解码器 / 变焦 / 识别结果 |

## 快速开始

只需一个依赖：

    npm install jsqr --save

把 `vue-qr-scanner/src/QrScanner.vue` 复制到你的组件目录：

    <template>
      <QrScanner @decoded="onDecoded" />
    </template>

    <script>
    import QrScanner from "@/components/QrScanner.vue";

    export default {
      components: { QrScanner },
      methods: {
        onDecoded({ text, source }) {
          // source: 'camera' 摄像头识别 | 'photo' 拍照识别
          console.log(text, source);
        },
      },
    };
    </script>

> 注意：摄像头要求 **HTTPS 或 localhost**（浏览器安全上下文限制），否则会自动降级为拍照识别。

## 目录结构

    vue-qr-scanner/
    ├── README.md                 # 组件完整说明（Props / Events / Methods）
    ├── LICENSE
    ├── CONTRIBUTING.md
    ├── CHANGELOG.md
    ├── docs/
    │   ├── IMPLEMENTATION.md     # 核心写法详解
    │   └── FAQ.md                # 常见问题排查
    ├── src/
    │   ├── QrScanner.vue         # 组件本体（唯一核心文件）
    │   └── index.js
    └── examples/
        └── BasicUsage.vue

## 文档

- 完整说明（Props / Events / Methods / 示例）：[vue-qr-scanner/README.md](./vue-qr-scanner/README.md)
- 核心实现思路：[vue-qr-scanner/docs/IMPLEMENTATION.md](./vue-qr-scanner/docs/IMPLEMENTATION.md)
- 常见问题排查：[vue-qr-scanner/docs/FAQ.md](./vue-qr-scanner/docs/FAQ.md)
- 使用示例：[vue-qr-scanner/examples/BasicUsage.vue](./vue-qr-scanner/examples/BasicUsage.vue)
- 贡献指南：[vue-qr-scanner/CONTRIBUTING.md](./vue-qr-scanner/CONTRIBUTING.md)

## License

[MIT](./vue-qr-scanner/LICENSE) © 2026 ruoyi-scanner contributors

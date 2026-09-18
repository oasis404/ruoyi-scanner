# 更新日志 · Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)，
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [Unreleased]

## [1.0.0] - 2026-09-18

### Added

- 核心组件 `QrScanner.vue`：`getUserMedia` 取流 + 解码循环 + 事件对外
- 双解码器：原生 `BarcodeDetector` 优先，失效自动降级 `jsQR`
- 失效探测：原生解码器连续 3 帧无结果即判定不可用并切换
- 纯前端数字变焦（0.9x ~ 5x，`props` 可配），不依赖设备 `zoom` 能力
- 双指捏合缩放（带节流）与倍率本地记忆（`localStorage`）
- 闪光灯能力探测与开关
- 拍照识别回退（`capture` 文件输入 + `jsQR` 解码图片）
- 调试浮层（`:debug` / `?debug=1`）与 `log` 事件
- 识别成功震动反馈（可关闭）
- 可配置引导框比例、采集分辨率、变焦区间、是否识别后停止等
- 统一错误事件 `error`，含稳定 `code` 与可读 `message`
- 文档：README（API/示例/注意事项）、`docs/IMPLEMENTATION.md`（实现详解）、`docs/FAQ.md`
- 示例页面 `examples/BasicUsage.vue`

### Notes

- 组件零 UI 框架依赖，唯一第三方依赖为 `jsqr`
- 生产使用必须为 HTTPS 或 localhost（浏览器安全上下文要求）

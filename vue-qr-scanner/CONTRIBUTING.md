# 贡献指南 · Contributing

感谢你愿意参与 `vue-qr-scanner`！这是一个专注「移动端网页扫码」的轻量组件，欢迎 Issue 与 PR。

---

## 我能做什么

| 类型 | 举例 |
| --- | --- |
| 🐛 Bug 修复 | 某机型取流失败、解码器切换异常、变焦越界 |
| ✨ 特性 | 多码识别、扫码框可配置、自定义渲染 slot |
| 📱 兼容性 | 新的浏览器内核适配、iOS/安卓差异处理 |
| 📝 文档 | 补充 FAQ、完善实现说明 |
| ⚡ 性能 | 降低单帧耗时、减少内存抖动 |

---

## 提交 Issue

请提供：

1. **环境**：设备型号 / 系统 / 浏览器（或内置内核，如企业微信 X.X）；是否 HTTPS；
2. **现象**：期望 vs 实际；
3. **调试浮层**：在 URL 后加 `?debug=1`，把浮层内容截图贴上（含采集分辨率与解码器类型）；
4. **控制台报错**：浏览器 Console 的完整堆栈。

---

## 提交 Pull Request

1. Fork 并基于 `main` 建分支：`fix/ios-video-not-playing`、`feat/multi-code`；
2. 改动后请自测：
   - 移动端（或 Chrome DevTools 设备模拟 + 摄像头）走通「取流 → 识别 → 释放」；
   - 桌面端验证「拍照识别」回退可用；
   - `?debug=1` 下无异常日志。
3. PR 描述里说明：**动机 / 改动点 / 验证方式 / 对识别率与性能的影响**。

### 代码约定

- 保持 **零 UI 框架依赖**（不要引入 Element UI / Vuetify 等）；
- 保持**依赖面最小**（目前仅 `jsqr`，新增依赖需在 PR 中说明理由）；
- 关键取舍请写注释说明「为什么」，而不是「做了什么」；
- 所有面向用户的错误一律通过 `$emit('error', { code, message })` 抛出，**不要在组件内弹 UI**；
- 新增/调整 props、events 时同步更新 `README.md` 的 API 表格。

---

## 提交信息规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
fix(camera): iOS 上 video 元素缺少 playsinline 导致无法播放
feat(zoom): 支持通过 props 关闭变焦滑杆
docs(readme): 补充 jsqr 打包异常的排查方式
```

---

## 自测清单

- [ ] 摄像头正常取流，解码循环启动
- [ ] 识别成功后 `decoded` 事件携带正确的 `text` 与 `source`
- [ ] 关闭 / 销毁组件后摄像头指示灯熄灭
- [ ] 非 HTTPS 环境能给出 `INSECURE_CONTEXT` 并回退到拍照识别
- [ ] 变焦 0.9x ~ 上限之间无黑边、无异常
- [ ] `README.md` 的 API 表格与实际实现一致

---

再次感谢你的贡献！🎉

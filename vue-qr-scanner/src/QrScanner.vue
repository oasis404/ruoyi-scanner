<template>
  <div class="qr-scanner">
    <!-- 未启动：入口按钮 -->
    <div v-if="!active" class="qr-entry">
      <button type="button" class="qr-btn qr-btn--primary" @click="start">
        {{ startText }}
      </button>
    </div>

    <!-- 取景区 -->
    <div v-if="active" class="qr-camera">
      <div
        class="qr-stage"
        :style="{ paddingBottom: containerRatio + '%' }"
        @touchstart="onPinchStart"
        @touchmove="onPinchMove"
        @touchend="onPinchEnd"
      >
        <video
          ref="video"
          class="qr-video"
          :style="videoStyle"
          playsinline
          webkit-playsinline
          muted
          autoplay
        ></video>

        <!-- 半透明遮罩 + 引导框：框随变焦同步缩放，框内必定落在解码采样区内 -->
        <div class="qr-mask">
          <div class="qr-frame" :style="frameStyle">
            <span class="qr-corner qr-corner--tl"></span>
            <span class="qr-corner qr-corner--tr"></span>
            <span class="qr-corner qr-corner--bl"></span>
            <span class="qr-corner qr-corner--br"></span>
            <div class="qr-scanline"></div>
          </div>
        </div>

        <!-- 实时调试浮层 -->
        <div v-if="debugEnabled" class="qr-debug">
          <div v-for="(log, i) in recentLogs" :key="i" class="qr-debug__item">{{ log }}</div>
        </div>
      </div>

      <p class="qr-tip">{{ tipText }}</p>

      <!-- 数字变焦：纯前端裁剪放大，不依赖设备 zoom 能力 -->
      <div v-if="showZoom" class="qr-zoom">
        <span class="qr-zoom__icon">−</span>
        <input
          class="qr-zoom__range"
          type="range"
          :min="zoomMin"
          :max="zoomMax"
          :step="zoomStep"
          :value="zoomValue"
          @input="onZoomRangeInput"
        />
        <span class="qr-zoom__icon">＋</span>
        <span class="qr-zoom__value">{{ zoomValue.toFixed(1) }}x</span>
      </div>

      <div class="qr-actions">
        <button v-if="showTorch && torchSupported" type="button" class="qr-btn" @click="toggleTorch">
          {{ torchOn ? '关闭闪光灯' : '开启闪光灯' }}
        </button>
        <button v-if="photoFallback" type="button" class="qr-btn" @click="pickPhoto">
          拍照识别
        </button>
        <button type="button" class="qr-btn qr-btn--danger" @click="stop">关闭</button>
      </div>

    </div>

    <!-- 拍照回退入口：与取景状态无关，保证非安全上下文 / 摄像头不可用时也能识别 -->
    <input
      ref="photoInput"
      class="qr-file"
      type="file"
      accept="image/*"
      capture="environment"
      @change="onPhotoChange"
    />
  </div>
</template>

<script>
import jsQR from "jsqr";

/** 引导框边长占「解码采样区」的比例 */
const FRAME_RATIO = 0.65;

/** 期望采集分辨率：不声明时内核会退回 640×480，远处小码基本认不出来 */
const IDEAL_WIDTH = 1920;
const IDEAL_HEIGHT = 1080;

/** 送解码的图像边长区间：过小识别不到，过大浪费 CPU */
const DECODE_MIN_PX = 320;
const DECODE_MAX_PX = 800;

/** 原生解码器连续无结果的容忍帧数：超过即判定其失效并切到 jsQR */
const DETECTOR_MAX_MISSES = 3;

/** 双指手势触发缩放的最小间隔（毫秒） */
const PINCH_THROTTLE_MS = 100;

/** 扫码成功的震动时长（毫秒） */
const VIBRATE_MS = 60;

export default {
  name: "QrScanner",

  props: {
    /** 挂载后自动开启摄像头 */
    autoStart: { type: Boolean, default: false },
    /** 摄像头朝向：environment（后置）/ user（前置） */
    facingMode: { type: String, default: "environment" },
    /** 入口按钮文案 */
    startText: { type: String, default: "扫描二维码" },
    /** 取景提示文案 */
    tipText: { type: String, default: "将二维码放入框内，即可自动扫描" },
    /** 期望采集分辨率（内核会自动协商到最接近的档位） */
    idealWidth: { type: Number, default: IDEAL_WIDTH },
    idealHeight: { type: Number, default: IDEAL_HEIGHT },
    /** 引导框边长占采样区的比例（0~1） */
    frameRatio: { type: Number, default: FRAME_RATIO },
    /** 变焦区间；低于 1x 时画面不再收缩，按 1x 处理 */
    zoomMin: { type: Number, default: 0.9 },
    zoomMax: { type: Number, default: 5 },
    zoomStep: { type: Number, default: 0.1 },
    /** 记住上次使用的变焦倍率（localStorage） */
    rememberZoom: { type: Boolean, default: true },
    zoomStorageKey: { type: String, default: "qr-scanner.zoom" },
    /** 是否渲染变焦滑杆 */
    showZoom: { type: Boolean, default: true },
    /** 是否允许使用闪光灯（仍需设备支持） */
    showTorch: { type: Boolean, default: true },
    /** 环境不支持摄像头时，提供「拍照识别」回退 */
    photoFallback: { type: Boolean, default: true },
    /** 调试浮层；也可通过 URL 参数 ?debug=1 打开 */
    debug: { type: Boolean, default: false },
    /** 识别成功时震动反馈（需设备支持） */
    vibrate: { type: Boolean, default: true },
    /** 识别成功后是否自动停止取流 */
    stopOnDecoded: { type: Boolean, default: true },
  },

  data() {
    return {
      /** 是否处于取景状态 */
      active: false,
      /** 最近一次识别结果 */
      lastResult: "",

      /** 摄像头资源 */
      stream: null,
      videoTrack: null,

      /** 取景容器高宽比（%）与引导框占宽（%），取流后按实际分辨率计算 */
      containerRatio: 75,
      frameRatioPct: FRAME_RATIO * 100,

      /** 变焦 */
      zoomValue: this.zoomMin,
      zoomMinValue: this.zoomMin,
      zoomMaxValue: this.zoomMax,

      /** 闪光灯 */
      torchSupported: false,
      torchOn: false,

      /** 调试 */
      debugEnabled: false,
      debugLogs: [],
    };
  },

  computed: {
    /** 引导框尺寸：与解码采样区同口径，随变焦收缩 */
    frameStyle() {
      const ratio = this.frameRatioPct / Math.max(this.zoomValue, 1);
      return { width: `${ratio}%`, paddingBottom: `${ratio}%` };
    },
    /**
     * 画面视觉缩放：与解码采样区保持一致，做到「所见即所扫」。
     *
     * 1x 及以下必须返回空样式：只要声明了 transform（哪怕 scale(1)），
     * 浏览器就会把 video 提升为合成层并按 CSS 像素栅格化，高 DPR 设备上会明显发虚。
     */
    videoStyle() {
      if (this.zoomValue <= 1) {
        return {};
      }
      return { transform: `scale(${this.zoomValue})` };
    },
    recentLogs() {
      return this.debugLogs.slice(-4);
    },
  },

  created() {
    this.debugEnabled = this.debug || this._isDebugByUrl();
  },

  async beforeDestroy() {
    // 必须等待摄像头真正释放，否则组件销毁后指示灯可能仍亮着
    await this.stop();
  },

  mounted() {
    if (this.autoStart) {
      this.start();
    }
  },

  methods: {
    /* ==================== 对外方法 ==================== */

    /**
     * 开启摄像头并启动解码循环。
     * @returns {Promise<boolean>} 是否成功进入取景状态
     */
    async start() {
      if (this.active) {
        return true;
      }
      this.debugLogs = [];
      this.lastResult = "";
      this.addLog("启动扫码");

      if (!this._canUseUserMedia()) {
        this.addLog("当前环境不支持 getUserMedia");
        // 安全上下文缺失时给出明确原因，并回退到拍照识别
        this.$emit("error", {
          code: "INSECURE_CONTEXT",
          message: "当前环境无法调用摄像头，请使用 HTTPS 或 localhost 地址访问",
        });
        if (this.photoFallback) {
          this.pickPhoto();
        }
        return false;
      }

      this.active = true;
      await this.$nextTick();

      const modes = this.facingMode === "user" ? ["user", "environment"] : ["environment", "user"];
      let lastErr = null;

      for (let i = 0; i < modes.length; i++) {
        try {
          this.addLog(`尝试摄像头 (${modes[i]})...`);
          await this._openCamera(modes[i]);
          this.addLog(`摄像头 (${modes[i]}) 启动成功`);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          this.addLog(`摄像头 (${modes[i]}) 启动失败: ${err.message || err}`);
          await this._releaseStream();
        }
      }

      if (lastErr) {
        this._handleCameraError(lastErr);
        return false;
      }

      this._initTorchCapability();
      await this._initDecoder();
      this._resetZoom();
      this._startDecodeLoop();

      this.$emit("start");
      return true;
    },

    /** 停止取流并释放摄像头 */
    async stop() {
      // 先停解码循环，避免释放过程中仍有帧在跑
      this._decoding = false;
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      await this._releaseStream();
      if (this.active) {
        this.addLog("摄像头已关闭");
      }
      this.active = false;
      // 摄像头关闭后闪光灯状态失效，复位以免下次启动残留
      this.torchSupported = false;
      this.torchOn = false;
      this.$emit("stopped");
    },

    /** 设置变焦倍率（会被夹到 [zoomMin, zoomMax]） */
    setZoom(value) {
      this.applyZoom(value);
    },

    /** 切换闪光灯常亮补光 */
    async toggleTorch() {
      if (!this.videoTrack) {
        return;
      }
      const next = !this.torchOn;
      try {
        await this.videoTrack.applyConstraints({ advanced: [{ torch: next }] });
        this.torchOn = next;
        this.addLog(`闪光灯已${next ? "开启" : "关闭"}`);
        this.$emit("torch-change", next);
      } catch (e) {
        this.addLog(`闪光灯切换失败: ${e.message || e}`);
        this.torchSupported = false;
        this.torchOn = false;
        this.$emit("error", { code: "TORCH_UNSUPPORTED", message: "当前设备不支持闪光灯控制" });
      }
    },

    /** 打开系统拍照 / 相册选择 */
    pickPhoto() {
      const input = this.$refs.photoInput;
      if (input) {
        input.click();
      }
    },

    /**
     * 从图片文件中识别二维码（拍照回退 / 手动识别）。
     *
     * @param {File|Blob} file 图片文件
     * @returns {Promise<string|null>} 识别结果，未识别到返回 null
     */
    async scanImage(file) {
      const text = await this._decodeImageFile(file);
      if (text) {
        this.$emit("decoded", { text, source: "photo" });
      } else {
        this.$emit("error", { code: "PHOTO_DECODE_FAILED", message: "未识别到二维码，请确保图片清晰且二维码完整可见" });
      }
      return text;
    },

    /* ==================== 摄像头 ==================== */

    /** 检测环境是否支持 getUserMedia */
    _canUseUserMedia() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.addLog("navigator.mediaDevices.getUserMedia 不存在");
        return false;
      }
      // isSecureContext === false 表示非 HTTPS 且非 localhost，getUserMedia 必被拒绝
      if (window.isSecureContext === false) {
        this.addLog("非安全上下文 (HTTP)");
        return false;
      }
      this.addLog("环境支持 getUserMedia");
      return true;
    },

    /** 打开指定朝向的摄像头并绑定到 video */
    async _openCamera(facingMode) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode,
          width: { ideal: this.idealWidth },
          height: { ideal: this.idealHeight },
        },
      });

      const video = this.$refs.video;
      if (!video) {
        stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
        throw new Error("视频元素未就绪");
      }

      this.stream = stream;
      this.videoTrack = stream.getVideoTracks()[0] || null;
      video.srcObject = stream;

      try {
        // iOS 需要 muted + playsinline 才允许自动播放
        await video.play();
      } catch (e) {
        this.addLog(`视频播放异常（不影响取流）: ${e.message || e}`);
      }

      await this._waitForVideoReady(video);
    },

    /** 等待 video 就绪，并按真实分辨率校正取景比例 */
    _waitForVideoReady(video) {
      const apply = () => {
        const vw = video.videoWidth || 0;
        const vh = video.videoHeight || 0;
        if (!vw || !vh) {
          return false;
        }
        // 容器与视频同比例，画面完整显示、不做裁切
        this.containerRatio = (vh / vw) * 100;
        // 采样区是画面中心正方形，把它的短边换算到容器宽度上
        this.frameRatioPct = this.frameRatio * (Math.min(vw, vh) / vw) * 100;
        this.addLog(`采集分辨率 ${vw}x${vh}，引导框占宽 ${this.frameRatioPct.toFixed(1)}%`);
        return true;
      };

      if (apply()) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const done = () => {
          video.removeEventListener("loadedmetadata", done);
          apply();
          resolve();
        };
        video.addEventListener("loadedmetadata", done);
        // 兜底：部分内核不派发 loadedmetadata
        setTimeout(done, 2000);
      });
    },

    /** 释放摄像头流 */
    async _releaseStream() {
      if (this.stream) {
        this.stream.getTracks().forEach((track) => {
          try { track.stop(); } catch (e) {}
        });
        this.stream = null;
      }
      const video = this.$refs.video;
      if (video) {
        video.srcObject = null;
      }
      this.videoTrack = null;
    },

    /** 统一处理摄像头启动异常，转成可读的 error 事件 */
    _handleCameraError(err) {
      this._releaseStream();
      this.active = false;
      const name = (err && err.name) || "";
      const fullMsg = (err && (err.toString ? err.toString() : err.message)) || String(err || "");
      this.addLog(`摄像头启动失败 [${name}]: ${fullMsg}`);

      let code = "UNKNOWN";
      let message = "摄像头暂不可用，请稍后重试";
      if (name === "NotAllowedError" || fullMsg.indexOf("Permission") !== -1) {
        code = "PERMISSION_DENIED";
        message = "摄像头权限被拒绝，请在浏览器设置中允许访问摄像头后重试";
      } else if (name === "NotFoundError" || fullMsg.indexOf("NotFoundError") !== -1) {
        code = "NOT_FOUND";
        message = "未检测到可用摄像头";
      } else if (name === "NotReadableError" || fullMsg.indexOf("NotReadableError") !== -1 || fullMsg.indexOf("in use") !== -1) {
        code = "NOT_READABLE";
        message = "摄像头被其他应用占用，请关闭后重试";
      } else if (name === "SecurityError" || fullMsg.indexOf("SecurityError") !== -1 || fullMsg.indexOf("secure") !== -1) {
        code = "INSECURE_CONTEXT";
        message = "当前页面为 HTTP，摄像头不可用，请使用 HTTPS 或 localhost 地址访问";
      }
      this.$emit("error", { code, message });
    },

    /* ==================== 闪光灯 ==================== */

    _initTorchCapability() {
      this.torchSupported = false;
      this.torchOn = false;
      const track = this.videoTrack;
      if (!track || typeof track.getCapabilities !== "function") {
        return;
      }
      try {
        const caps = track.getCapabilities() || {};
        if (caps.torch) {
          this.torchSupported = true;
          this.addLog("设备支持闪光灯");
        }
      } catch (e) {
        this.addLog(`读取摄像头能力失败: ${e.message || e}`);
      }
    },

    /* ==================== 解码 ==================== */

    /**
     * 初始化解码器：优先原生 BarcodeDetector，缺失或失效时回退 jsQR。
     */
    async _initDecoder() {
      this._detector = null;
      this._decoderBroken = false;
      this._detectorMisses = 0;
      this._workCanvas = null;
      this._workCtx = null;
      this._jsqrReady = typeof jsQR === "function";
      if (!this._jsqrReady) {
        this.addLog("jsQR 未正确加载");
      }

      if (typeof window.BarcodeDetector === "function") {
        try {
          if (typeof window.BarcodeDetector.getSupportedFormats === "function") {
            const formats = await window.BarcodeDetector.getSupportedFormats();
            if (Array.isArray(formats) && formats.indexOf("qr_code") !== -1) {
              this._detector = new window.BarcodeDetector({ formats: ["qr_code"] });
            }
          } else {
            this._detector = new window.BarcodeDetector({ formats: ["qr_code"] });
          }
          if (this._detector) {
            this.addLog("解码器: 原生 BarcodeDetector");
          }
        } catch (e) {
          this._detector = null;
          this.addLog(`BarcodeDetector 初始化失败: ${e.message || e}`);
        }
      }

      if (!this._detector) {
        this.addLog(this._jsqrReady ? "解码器: jsQR" : "解码器: 无可用解码器");
      }
      if (!this._detector && !this._jsqrReady) {
        this.$emit("error", { code: "NO_DECODER", message: "二维码解码组件不可用，请刷新页面重试" });
      }
    },

    /**
     * 启动解码循环。
     *
     * 用 requestAnimationFrame 驱动、以「上一帧未解完就跳过」的方式节流：
     * 帧率由解码速度决定，不做额外等待，尽可能接近实时。
     */
    _startDecodeLoop() {
      this._decoding = true;
      this._decodingBusy = false;

      const loop = () => {
        if (!this._decoding) {
          return;
        }
        if (!this._decodingBusy) {
          this._decodingBusy = true;
          this._decodeFrame()
            .catch((e) => this.addLog(`解码异常: ${e.message || e}`))
            .then(() => {
              this._decodingBusy = false;
            });
        }
        this._rafId = requestAnimationFrame(loop);
      };
      loop();
    },

    /**
     * 取一帧并解码。
     *
     * 核心思路：把画面中心按变焦倍率裁出一块正方形送解码，
     * 二维码在图像中的相对占比随倍率提升，解码命中率随之提高。
     * 裁剪是纯前端行为，不依赖设备的 zoom 约束，因此在企业微信等
     * 不报告 zoom 能力的内核里同样有效。
     */
    async _decodeFrame() {
      const video = this.$refs.video;
      // readyState < 2 (HAVE_CURRENT_DATA) 时画面尚未就绪
      if (!video || video.readyState < 2) {
        return;
      }
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) {
        return;
      }

      // 采样区：画面中心正方形，边长随变焦收缩；低于 1x 按 1x 处理
      const side = Math.min(vw, vh) / Math.max(this.zoomValue, 1);
      const sx = (vw - side) / 2;
      const sy = (vh - side) / 2;

      let out = Math.round(side);
      if (out > DECODE_MAX_PX) {
        out = DECODE_MAX_PX;
      } else if (out < DECODE_MIN_PX) {
        // 仅在高倍变焦导致采样区过小时放大，保证解码器有足够像素
        out = DECODE_MIN_PX;
      }

      this._ensureWorkCanvas(out);
      this._workCtx.drawImage(video, sx, sy, side, side, 0, 0, out, out);

      const text = await this._detectFromCanvas(out);
      if (text && this._decoding) {
        this._onDecoded(text);
      }
    },

    /** 复用工作画布 */
    _ensureWorkCanvas(size) {
      if (!this._workCanvas) {
        this._workCanvas = document.createElement("canvas");
        // jsQR 需要每帧 getImageData，走软件后备存储更快；
        // 原生解码器直接读画布，保持默认（GPU）更快。
        this._workCtx = this._detector
          ? this._workCanvas.getContext("2d")
          : this._workCanvas.getContext("2d", { willReadFrequently: true });
      }
      if (this._workCanvas.width !== size || this._workCanvas.height !== size) {
        this._workCanvas.width = size;
        this._workCanvas.height = size;
      }
    },

    /**
     * 从工作画布中解出二维码内容。
     * @param {number} size 画布边长
     * @returns {Promise<string|null>}
     */
    async _detectFromCanvas(size) {
      // 原生解码器：运行时报错、或连续多帧返回空（存在但失效的实现），都判定不可用
      if (this._detector && !this._decoderBroken) {
        try {
          const codes = await this._detector.detect(this._workCanvas);
          if (codes && codes.length > 0 && codes[0].rawValue) {
            this._detectorMisses = 0;
            return codes[0].rawValue;
          }
          this._detectorMisses += 1;
          if (this._detectorMisses >= DETECTOR_MAX_MISSES) {
            this._switchToJsQr(`BarcodeDetector 连续 ${DETECTOR_MAX_MISSES} 帧无结果`);
          }
          return null;
        } catch (e) {
          this._switchToJsQr(`BarcodeDetector 运行异常: ${e.message || e}`);
        }
      }

      if (!this._jsqrReady) {
        return null;
      }
      try {
        const imageData = this._workCtx.getImageData(0, 0, size, size);
        // attemptBoth：同时尝试正片与反色，兼容深底浅码的标签
        const result = jsQR(imageData.data, size, size, { inversionAttempts: "attemptBoth" });
        return result ? result.data : null;
      } catch (e) {
        this.addLog(`jsQR 解码异常: ${e.message || e}`);
        return null;
      }
    },

    /** 切到 jsQR：画布需重建以匹配 getImageData 的最优上下文配置 */
    _switchToJsQr(reason) {
      this._decoderBroken = true;
      this._detector = null;
      this._detectorMisses = 0;
      this._workCanvas = null;
      this._workCtx = null;
      this.addLog(`${reason}，切换 jsQR`);
    },

    /** 解码命中 */
    _onDecoded(text) {
      this.lastResult = text;
      if (this.vibrate) {
        this._vibrate();
      }
      this.addLog(`识别成功: ${text}`);
      if (this.stopOnDecoded) {
        this.stop();
      }
      this.$emit("decoded", { text, source: "camera" });
    },

    /** 震动反馈，设备不支持时静默跳过 */
    _vibrate() {
      if (typeof navigator.vibrate === "function") {
        try {
          navigator.vibrate(VIBRATE_MS);
        } catch (e) {
          // 部分内核声明了 vibrate 但调用即抛异常
        }
      }
    },

    /** 图片文件 → 二维码文本（拍照回退） */
    _decodeImageFile(file) {
      return new Promise((resolve) => {
        // 原生解码器无法直接处理 File，图片统一交给 jsQR
        const jsqrReady = typeof jsQR === "function";
        if (!file || !jsqrReady) {
          if (!jsqrReady) {
            this.addLog("jsQR 不可用，无法识别图片");
          }
          resolve(null);
          return;
        }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          try {
            const maxSize = 1600;
            const ratio = Math.min(maxSize / Math.max(img.width, img.height, 1), 1);
            const w = Math.max(1, Math.round(img.width * ratio));
            const h = Math.max(1, Math.round(img.height * ratio));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, w, h);
            const data = ctx.getImageData(0, 0, w, h);
            const result = jsQR(data.data, w, h, { inversionAttempts: "attemptBoth" });
            resolve(result ? result.data : null);
          } catch (e) {
            this.addLog(`图片识别异常: ${e.message || e}`);
            resolve(null);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          this.addLog("图片加载失败");
          resolve(null);
        };
        img.src = url;
      });
    },

    /** 文件选择回调 */
    async onPhotoChange(e) {
      const file = e.target.files && e.target.files[0];
      try {
        if (file) {
          await this.scanImage(file);
        }
      } finally {
        if (this.$refs.photoInput) {
          this.$refs.photoInput.value = "";
        }
      }
    },

    /* ==================== 变焦 & 手势 ==================== */

    /**
     * 应用数字变焦。
     *
     * 只调整采样区与画面缩放，不触碰 MediaStreamTrack 约束，
     * 因此不依赖设备上报的 zoom 能力，所有环境均可生效。
     */
    applyZoom(value) {
      const next = this._clampZoom(Number(value) || this.zoomMinValue);
      if (next === this.zoomValue) {
        return;
      }
      this.zoomValue = next;
      if (this.rememberZoom) {
        this._saveZoom(next);
      }
      this.addLog(`变焦 ${next.toFixed(1)}x`);
      this.$emit("zoom-change", next);
    },

    onZoomRangeInput(e) {
      this.applyZoom(parseFloat(e.target.value));
    },

    /** 双指起始 */
    onPinchStart(event) {
      if (!event.touches || event.touches.length !== 2) {
        return;
      }
      this._pinchStartDistance = this._touchDistance(event.touches);
      this._pinchStartZoom = this.zoomValue;
    },

    /** 双指移动 */
    onPinchMove(event) {
      if (!event.touches || event.touches.length !== 2 || !this._pinchStartDistance) {
        return;
      }
      // 仅双指时阻止页面滚动，单指滑动不受影响
      event.preventDefault();

      const now = Date.now();
      if (now - (this._lastPinchAt || 0) < PINCH_THROTTLE_MS) {
        return;
      }
      this._lastPinchAt = now;

      const distance = this._touchDistance(event.touches);
      this.applyZoom(this._pinchStartZoom * (distance / this._pinchStartDistance));
    },

    onPinchEnd() {
      this._pinchStartDistance = 0;
    },

    _touchDistance(touches) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    },

    _clampZoom(value) {
      return Math.min(Math.max(value, this.zoomMinValue), this.zoomMaxValue);
    },

    /** 复位变焦区间并恢复上次倍率 */
    _resetZoom() {
      this.zoomMinValue = this.zoomMin;
      this.zoomMaxValue = this.zoomMax;

      const remembered = this.rememberZoom ? this._loadZoom() : null;
      this.zoomValue = remembered ? this._clampZoom(remembered) : this.zoomMinValue;
      if (remembered) {
        this.addLog(`恢复上次变焦 ${this.zoomValue.toFixed(1)}x`);
      }
      this.addLog(`变焦区间 ${this.zoomMinValue}x ~ ${this.zoomMaxValue}x`);
    },

    _loadZoom() {
      try {
        const raw = window.localStorage.getItem(this.zoomStorageKey);
        const value = parseFloat(raw);
        return Number.isFinite(value) && value > 0 ? value : null;
      } catch (e) {
        // 隐私模式等场景下 localStorage 可能不可用
        return null;
      }
    },

    _saveZoom(value) {
      try {
        window.localStorage.setItem(this.zoomStorageKey, String(value));
      } catch (e) {
        // 写入失败不影响主流程
      }
    },

    /* ==================== 调试 ==================== */

    /** 解析 URL 调试开关 ?debug=1（同时兼容 history 与 hash 模式） */
    _isDebugByUrl() {
      try {
        const raw = `${window.location.search || ""}&${window.location.hash || ""}`;
        return /[?&]debug=(1|true|yes)/i.test(raw);
      } catch (e) {
        return false;
      }
    },

    /** 追加调试日志（同时以 log 事件抛出，便于外部收集） */
    addLog(msg) {
      const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
      this.debugLogs.push(line);
      this.$emit("log", line);
    },
  },
};
</script>

<style scoped>
.qr-scanner {
  width: 100%;
}

/* ---------- 入口 ---------- */
.qr-entry {
  display: flex;
  justify-content: center;
  padding: 4px 0;
}

/* ---------- 取景区 ---------- */
.qr-camera {
  width: 100%;
  max-width: 500px;
  margin: 0 auto;
}

/*
  取景容器：高度由 containerRatio（视频原始高宽比）以 padding 撑开，
  画面完整呈现、不做裁切。
*/
.qr-stage {
  position: relative;
  width: 100%;
  height: 0;
  margin-bottom: 15px;
  border-radius: 8px;
  overflow: hidden;
  background: #000;
}

/*
  视频画面：缩放与解码采样区同口径，做到「所见即所扫」。
  刻意不加 transition：任何合成层提升都会让画面在高 DPR 屏幕上发虚。
*/
.qr-video {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ---------- 遮罩与引导框 ---------- */
.qr-mask {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

/* 尺寸由 frameStyle 动态给出（随变焦倍率收缩） */
.qr-frame {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  transition: width 0.15s ease-out, padding-bottom 0.15s ease-out;
}

.qr-corner {
  position: absolute;
  width: 18px;
  height: 18px;
  border-color: #00c853;
  border-style: solid;
}
.qr-corner--tl { top: 0; left: 0; border-width: 3px 0 0 3px; border-radius: 4px 0 0 0; }
.qr-corner--tr { top: 0; right: 0; border-width: 3px 3px 0 0; border-radius: 0 4px 0 0; }
.qr-corner--bl { bottom: 0; left: 0; border-width: 0 0 3px 3px; border-radius: 0 0 0 4px; }
.qr-corner--br { bottom: 0; right: 0; border-width: 0 3px 3px 0; border-radius: 0 0 4px 0; }

.qr-scanline {
  position: absolute;
  top: 0;
  left: 8px;
  right: 8px;
  height: 2px;
  background: linear-gradient(90deg, transparent, #00c853, transparent);
  box-shadow: 0 0 8px #00c853;
  animation: qr-scan-move 2s ease-in-out infinite;
}
@keyframes qr-scan-move {
  0%   { top: 0; }
  50%  { top: calc(100% - 2px); }
  100% { top: 0; }
}

/* ---------- 调试浮层 ---------- */
.qr-debug {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

.qr-debug__item {
  color: #0f0;
  font-family: "Courier New", Courier, monospace;
  font-size: 11px;
  line-height: 1.5;
  text-align: left;
  word-break: break-all;
}

/* ---------- 提示 ---------- */
.qr-tip {
  margin: 0 0 12px;
  text-align: center;
  color: #909399;
  font-size: 13px;
}

/* ---------- 变焦滑杆 ---------- */
.qr-zoom {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  margin-bottom: 10px;
  color: #909399;
  font-size: 16px;
}

.qr-zoom__range {
  flex: 1;
  min-width: 0;
  height: 4px;
  margin: 0;
  border-radius: 2px;
  background: #dcdfe6;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}
.qr-zoom__range::-webkit-slider-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #409eff;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}
.qr-zoom__range::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: #409eff;
  cursor: pointer;
}

.qr-zoom__icon {
  user-select: none;
}

.qr-zoom__value {
  min-width: 42px;
  font-size: 13px;
  text-align: right;
}

/* ---------- 操作按钮 ---------- */
.qr-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.qr-btn {
  padding: 8px 16px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.qr-btn:hover {
  border-color: #c6e2ff;
  background: #ecf5ff;
  color: #409eff;
}

.qr-btn--primary {
  border-color: #409eff;
  background: #409eff;
  color: #fff;
}
.qr-btn--primary:hover {
  border-color: #66b1ff;
  background: #66b1ff;
  color: #fff;
}

.qr-btn--danger {
  border-color: #f56c6c;
  background: #f56c6c;
  color: #fff;
}
.qr-btn--danger:hover {
  border-color: #f78989;
  background: #f78989;
  color: #fff;
}

.qr-file {
  display: none;
}
</style>

<template>
  <div class="demo">
    <h3>扫码结果</h3>
    <p class="demo__result">{{ result || "（等待扫描）" }}</p>
    <p v-if="errorMessage" class="demo__error">{{ errorMessage }}</p>

    <QrScanner
      ref="scanner"
      :auto-start="autoStart"
      :show-zoom="true"
      :show-torch="true"
      :photo-fallback="true"
      :debug="debug"
      @start="onStart"
      @stopped="onStopped"
      @decoded="onDecoded"
      @error="onError"
      @zoom-change="onZoomChange"
    />

    <div class="demo__toolbar">
      <label><input v-model="autoStart" type="checkbox" /> 自动开启</label>
      <label><input v-model="debug" type="checkbox" /> 调试浮层</label>
      <button type="button" @click="scanAgain">重新扫描</button>
    </div>

    <pre v-if="logs.length" class="demo__logs">{{ logs.join("\n") }}</pre>
  </div>
</template>

<script>
import QrScanner from "@/components/QrScanner.vue";

export default {
  name: "QrScannerDemo",

  components: { QrScanner },

  data() {
    return {
      result: "",
      errorMessage: "",
      autoStart: true,
      debug: false,
      logs: [],
    };
  },

  methods: {
    onStart() {
      this.errorMessage = "";
    },

    onStopped() {
      this.logs.push("摄像头已关闭");
    },

    /**
     * 识别成功回调
     * @param {{ text: string, source: 'camera'|'photo' }} payload
     */
    onDecoded({ text, source }) {
      this.result = text;
      this.logs.push(`识别成功(${source}): ${text}`);
      // 这里可以继续做业务请求，例如：
      // this.$api.queryAsset(text).then(...)
    },

    /**
     * 错误回调
     * @param {{ code: string, message: string }} payload
     */
    onError({ code, message }) {
      this.errorMessage = `[${code}] ${message}`;
      this.logs.push(this.errorMessage);
    },

    onZoomChange(value) {
      this.logs.push(`变焦: ${value.toFixed(1)}x`);
    },

    /** 重新扫描：清空结果并再次开启摄像头 */
    scanAgain() {
      this.result = "";
      this.errorMessage = "";
      this.$refs.scanner.start();
    },
  },
};
</script>

<style scoped>
.demo {
  max-width: 560px;
  margin: 0 auto;
  padding: 16px;
  text-align: center;
}

.demo__result {
  font-size: 18px;
  font-weight: bold;
  color: #303133;
  word-break: break-all;
}

.demo__error {
  color: #f56c6c;
}

.demo__toolbar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
  color: #606266;
  font-size: 13px;
}

.demo__logs {
  margin-top: 16px;
  max-height: 200px;
  overflow: auto;
  padding: 10px;
  border-radius: 6px;
  background: #1e1e1e;
  color: #0f0;
  font-size: 12px;
  text-align: left;
}
</style>

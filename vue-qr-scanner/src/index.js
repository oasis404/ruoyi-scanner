import QrScanner from "./QrScanner.vue";

/**
 * 支持两种引入方式：
 *
 * 1) 全局注册
 *    import QrScanner from "vue-qr-scanner";
 *    Vue.use(QrScanner);
 *
 * 2) 局部注册
 *    import { QrScanner } from "vue-qr-scanner";
 *    export default { components: { QrScanner } };
 */
QrScanner.install = function install(Vue) {
  Vue.component(QrScanner.name, QrScanner);
};

export default QrScanner;
export { QrScanner };

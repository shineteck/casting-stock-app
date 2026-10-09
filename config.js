// スプレッドシート連携の設定
// apiUrl: Apps Script を「ウェブアプリ」としてデプロイした URL（https://script.google.com/macros/s/…/exec）
// ※ 合言葉はここには書きません（ページは誰でも見られるため）。各端末の初回起動時に入力します。
window.STK_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbxqr6EpR9c01dfTv2FqneA27RptZe_yvSgG9bKwZVEbAcKL5EuzolD1jomn-JpNuOGbdg/exec?token=qgmy-epr8-xpwb",
  pollSeconds: 30   // 他の人の入力を取り込む間隔（秒）
};

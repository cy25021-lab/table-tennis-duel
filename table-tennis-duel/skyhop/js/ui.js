// =====================================================
//  ui.js ― 画面の表示（タイマー・進み具合・結果画面など）
// =====================================================

// 秒を「01:23.45」の形にする
function formatTime(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100); // 1/100秒
  const pad = n => String(n).padStart(2, "0");
  return pad(min) + ":" + pad(sec) + "." + pad(cs);
}

const UI = {
  el: {},          // HTMLの要素をまとめて入れておく
  toastTimer: null,
  startZ: 0,
  goalZ: 0,

  init(startZ, goalZ, checkpointZs) {
    const ids = [
      "timer", "progressFill", "progressPlayer", "progressMarks", "cpCount", "fallCount",
      "countdown", "toast", "startScreen", "titleBest", "resultScreen",
      "resultTime", "resultFalls", "resultBest", "newRecord", "mouseHint", "rank", "rankList",
    ];
    ids.forEach(id => { this.el[id] = document.getElementById(id); });
    this.startZ = startZ;
    this.goalZ = goalZ;

    // 進み具合バーにチェックポイントの印をつける
    checkpointZs.forEach(z => {
      const mark = document.createElement("div");
      mark.className = "progress-mark";
      mark.style.left = (this.ratio(z) * 100) + "%";
      this.el.progressMarks.appendChild(mark);
    });
  },

  // コースのどこまで進んだか（0 = スタート, 1 = ゴール）
  ratio(z) {
    const r = (this.startZ - z) / (this.startZ - this.goalZ);
    return Math.max(0, Math.min(1, r));
  },

  setTime(seconds) {
    this.el.timer.textContent = formatTime(seconds);
  },

  setProgress(z) {
    const percent = this.ratio(z) * 100;
    this.el.progressFill.style.width = percent + "%";
    this.el.progressPlayer.style.left = percent + "%";
  },

  setCheckpoint(count, total) {
    this.el.cpCount.textContent = count + " / " + total;
  },

  setRank(rank, total) {
    this.el.rank.textContent = rank + " / " + total;
  },

  // 結果画面の順位表
  setRanking(racers) {
    const rows = racers.map((r, i) => {
      const time = r.finished ? formatTime(r.finishTime) : "走行中…";
      const cls = r.isHuman ? ' class="me"' : "";
      return "<li" + cls + "><span class=\"pos\">" + (i + 1) + "</span><span class=\"name\">" +
        r.name + "</span><span class=\"time\">" + time + "</span></li>";
    });
    this.el.rankList.innerHTML = rows.join("");
  },

  setFalls(count) {
    this.el.fallCount.textContent = count;
  },

  setMouseHint(visible) {
    this.el.mouseHint.classList.toggle("hidden", !visible);
  },

  // カウントダウンの大きな数字
  showCount(text) {
    const el = this.el.countdown;
    el.textContent = text;
    el.classList.remove("show");
    void el.offsetWidth; // アニメーションを最初から再生するためのおまじない
    el.classList.add("show");
  },

  // 画面の真ん中に文字を少しだけ出す
  toast(text, color) {
    const el = this.el.toast;
    el.textContent = text;
    el.style.color = color;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
  },

  hideStart() {
    this.el.startScreen.classList.add("hidden");
  },

  setTitleBest(best) {
    this.el.titleBest.textContent = best ? "ベストタイム " + formatTime(best) : "";
  },

  showResults(time, falls, best, isNewRecord) {
    this.el.resultTime.textContent = formatTime(time);
    this.el.resultFalls.textContent = falls + " 回";
    this.el.resultBest.textContent = formatTime(best);
    this.el.newRecord.classList.toggle("hidden", !isNewRecord);
    this.el.resultScreen.classList.remove("hidden");
  },

  hideResults() {
    this.el.resultScreen.classList.add("hidden");
  },
};

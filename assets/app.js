/* =========================================================
   经营罗盘 · 保本点速算器
   纯前端计算，无依赖，无网络请求。
   ========================================================= */

(function () {
  "use strict";

  var form = document.getElementById("calc-form");
  if (!form) return; // 首页不需要计算逻辑

  var FIELDS = {
    fixed: "月固定成本",
    price: "平均客单价",
    foodRate: "食材成本率",
    otherRate: "其他变动成本率",
    targetProfit: "目标利润",
    days: "月营业天数"
  };

  var SAMPLE = {
    fixed: 120000,
    price: 45,
    foodRate: 38,
    otherRate: 8,
    targetProfit: 20000,
    days: 30
  };

  var STORAGE_KEY = "jylp-inputs-v1";
  var chartDrawn = false;

  var els = {
    receipt: document.getElementById("receipt"),
    error: document.getElementById("form-error"),
    chart: document.getElementById("profit-chart"),
    chartNote: document.getElementById("chart-note"),
    chartCaption: document.getElementById("chart-caption"),
    table: document.querySelector("#sensitivity-table tbody"),
    targetBe: document.getElementById("target-be"),
    targetBeMeta: document.getElementById("target-be-meta"),
    targetProfit: document.getElementById("target-profit"),
    targetProfitMeta: document.getElementById("target-profit-meta"),
    targetStretch: document.getElementById("target-stretch"),
    targetStretchMeta: document.getElementById("target-stretch-meta"),
    printBtn: document.getElementById("print-btn"),
    loadSample: document.getElementById("load-sample"),
    resetForm: document.getElementById("reset-form"),
    status: document.getElementById("live-status")
  };

  var statusTimer = null;

  function announce(text) {
    if (!els.status) return;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      els.status.textContent = text;
    }, 450);
  }

  var nf0 = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

  function money(v) {
    return "¥" + nf0.format(Math.round(v));
  }

  function wan(v) {
    if (Math.abs(v) >= 10000) {
      var w = v / 10000;
      return (Math.abs(w) >= 10 ? nf0.format(w) : nf1.format(w)) + "万";
    }
    return nf0.format(Math.round(v));
  }

  function pct(v) {
    return nf1.format(v * 100) + "%";
  }

  function people(v) {
    return nf0.format(Math.ceil(v)) + " 人";
  }

  function readInputs() {
    var out = {};
    Object.keys(FIELDS).forEach(function (key) {
      var input = document.getElementById(key);
      out[key] = input.value.trim() === "" ? NaN : Number(input.value);
    });
    return out;
  }

  function validate(v) {
    var problems = [];
    var invalid = {};

    Object.keys(FIELDS).forEach(function (key) {
      if (!isFinite(v[key])) {
        problems.push("请把「" + FIELDS[key] + "」填上一个数字。");
        invalid[key] = true;
      }
    });

    if (isFinite(v.fixed) && v.fixed < 0) {
      problems.push("月固定成本不能是负数。");
      invalid.fixed = true;
    }
    if (isFinite(v.price) && v.price <= 0) {
      problems.push("平均客单价要大于 0。");
      invalid.price = true;
    }
    if (isFinite(v.foodRate) && (v.foodRate < 0 || v.foodRate > 100)) {
      problems.push("食材成本率应在 0–100% 之间。");
      invalid.foodRate = true;
    }
    if (isFinite(v.otherRate) && (v.otherRate < 0 || v.otherRate > 100)) {
      problems.push("其他变动成本率应在 0–100% 之间。");
      invalid.otherRate = true;
    }
    if (isFinite(v.targetProfit) && v.targetProfit < 0) {
      problems.push("目标利润不能是负数。");
      invalid.targetProfit = true;
    }
    if (isFinite(v.days) && (v.days < 1 || v.days > 31)) {
      problems.push("月营业天数应在 1–31 天之间。");
      invalid.days = true;
    }

    if (
      isFinite(v.foodRate) &&
      isFinite(v.otherRate) &&
      v.foodRate + v.otherRate >= 100 &&
      !invalid.foodRate &&
      !invalid.otherRate
    ) {
      problems.push("两项变动成本率加起来已达到或超过 100%，无论卖多少都覆盖不了固定成本。请先核对口径。");
      invalid.foodRate = true;
      invalid.otherRate = true;
    }

    return { problems: problems, invalid: invalid };
  }

  function compute(v) {
    var food = v.foodRate / 100;
    var other = v.otherRate / 100;
    var margin = 1 - food - other;
    var breakEven = margin > 0 ? v.fixed / margin : Infinity;
    var profitRevenue = margin > 0 ? (v.fixed + v.targetProfit) / margin : Infinity;
    var stretchRevenue = margin > 0 ? (v.fixed + v.targetProfit * 1.5) / margin : Infinity;

    return {
      margin: margin,
      breakEven: breakEven,
      breakEvenCustomers: breakEven / v.price,
      breakEvenDaily: breakEven / v.days,
      breakEvenDailyCustomers: breakEven / v.days / v.price,
      profitRevenue: profitRevenue,
      profitDaily: profitRevenue / v.days,
      profitCustomers: profitRevenue / v.price,
      stretchRevenue: stretchRevenue,
      stretchDaily: stretchRevenue / v.days,
      stretchCustomers: stretchRevenue / v.price,
      safety: profitRevenue > 0 ? (profitRevenue - breakEven) / profitRevenue : 0
    };
  }

  function stampFor(margin) {
    if (margin >= 0.5) return "可开";
    if (margin >= 0.4) return "算细";
    return "慎开";
  }

  function receiptHeader(meta) {
    return (
      '<div class="receipt-head">' +
        '<div class="receipt-brand">经营罗盘<span>单店保本单</span></div>' +
        '<div class="receipt-meta">' + meta + "</div>" +
      "</div>" +
      '<div class="receipt-rule" aria-hidden="true"></div>'
    );
  }

  function renderReceipt(v, r) {
    var stamp = stampFor(r.margin);

    els.receipt.innerHTML =
      receiptHeader("本地测算 · 实时单") +
      '<dl class="receipt-lines">' +
        "<div><dt>月固定成本</dt><dd>" + money(v.fixed) + "</dd></div>" +
        "<div><dt>平均客单价</dt><dd>" + money(v.price) + "</dd></div>" +
        "<div><dt>食材成本率</dt><dd>" + pct(v.foodRate / 100) + "</dd></div>" +
        "<div><dt>其他变动成本率</dt><dd>" + pct(v.otherRate / 100) + "</dd></div>" +
        "<div><dt>目标利润</dt><dd>" + money(v.targetProfit) + "</dd></div>" +
      "</dl>" +
      '<div class="receipt-rule" aria-hidden="true"></div>' +
      '<div class="receipt-hero">' +
        '<span class="receipt-label">月保本营业额</span>' +
        '<strong class="receipt-big">' + money(r.breakEven) + "</strong>" +
        '<span class="receipt-note">每天至少卖 ' + money(r.breakEvenDaily) +
          " · 约 " + nf0.format(Math.ceil(r.breakEvenDailyCustomers)) + " 位客人</span>" +
      "</div>" +
      '<div class="receipt-rule" aria-hidden="true"></div>' +
      '<dl class="receipt-lines">' +
        "<div><dt>边际贡献率</dt><dd>" + pct(r.margin) + "</dd></div>" +
        "<div><dt>月保本客数</dt><dd>" + people(r.breakEvenCustomers) + "</dd></div>" +
        "<div><dt>安全边际</dt><dd>" + pct(r.safety) + "</dd></div>" +
      "</dl>" +
      '<div class="receipt-rule" aria-hidden="true"></div>' +
      '<p class="receipt-foot">先保本，再谈增长。<br>数据只在本地计算。</p>' +
      '<span class="stamp" aria-hidden="true">' + stamp + "</span>";

    els.receipt.setAttribute(
      "aria-label",
      "单店保本单：月保本营业额 " + money(r.breakEven) +
      "，每天约 " + money(r.breakEvenDaily) +
      "，边际贡献率 " + pct(r.margin)
    );

    announce(
      "月保本营业额 " + money(r.breakEven) +
      "，每天约 " + money(r.breakEvenDaily) +
      "，边际贡献率 " + pct(r.margin)
    );
  }

  function renderReceiptError(problems) {
    els.receipt.innerHTML =
      receiptHeader("待核对") +
      '<div class="receipt-empty">这份小票还差几个数：<br>' +
      problems.slice(0, 3).map(function (p) { return "· " + p; }).join("<br>") +
      "</div>";
    els.receipt.setAttribute("aria-label", "输入有误，尚未生成保本单");
  }

  function renderTargets(v, r) {
    els.targetBe.textContent = money(r.breakEven);
    els.targetBeMeta.textContent =
      "日均 " + money(r.breakEvenDaily) + " · 约 " +
      nf0.format(Math.ceil(r.breakEvenDailyCustomers)) + " 位客人/天";

    els.targetProfit.textContent = money(r.profitRevenue);
    els.targetProfitMeta.textContent =
      "日均 " + money(r.profitDaily) + " · 目标利润 " + money(v.targetProfit);

    els.targetStretch.textContent = money(r.stretchRevenue);
    els.targetStretchMeta.textContent =
      "日均 " + money(r.stretchDaily) + " · 利润目标再提高 50%";
  }

  function clearTargets() {
    els.targetBe.textContent = "—";
    els.targetBeMeta.textContent = "每月不亏的营业额";
    els.targetProfit.textContent = "—";
    els.targetProfitMeta.textContent = "固定成本 + 目标利润";
    els.targetStretch.textContent = "—";
    els.targetStretchMeta.textContent = "利润目标再提高 50%";
  }

  function renderSensitivity(v, r) {
    var deltas = [-5, -2, 0, 2, 5];
    var rows = deltas.map(function (d) {
      var foodRate = v.foodRate + d;
      var margin = 1 - foodRate / 100 - v.otherRate / 100;
      var valid = foodRate >= 0 && foodRate < 100 && margin > 0;
      var be = valid ? v.fixed / margin : Infinity;
      var diff = be - r.breakEven;
      var diffText = "基准";

      if (valid && d !== 0) {
        diffText = (diff >= 0 ? "+" : "−") + money(Math.abs(diff));
      } else if (!valid) {
        diffText = "无法保本";
      }

      var diffClass = "";
      if (valid && d !== 0) diffClass = diff > 0 ? "delta-up" : "delta-down";

      return (
        '<tr' + (d === 0 ? ' class="is-base"' : "") + ">" +
          "<td>" + (d > 0 ? "+" : "") + d + " 个点 · " + nf1.format(foodRate) + "%</td>" +
          "<td>" + (valid ? pct(margin) : "—") + "</td>" +
          "<td>" + (valid ? money(be) : "—") + "</td>" +
          '<td class="' + diffClass + '">' + diffText + "</td>" +
        "</tr>"
      );
    });
    els.table.innerHTML = rows.join("");
  }

  function svgEl(tag, attrs, text) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) {
      node.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function niceMax(v) {
    if (!isFinite(v) || v <= 0) return 1;
    var pow = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / pow;
    var mult = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 :
      n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 7.5 ? 7.5 : 10;
    return mult * pow;
  }

  function renderChart(v, r) {
    var svg = els.chart;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    if (!isFinite(r.breakEven) || r.margin <= 0) {
      els.chartNote.textContent = "变动成本率过高，无法计算保本点";
      els.chartCaption.textContent = "请先调低变动成本率，让边际贡献率大于 0。";
      return;
    }

    var W = 720, H = 320;
    var m = { top: 26, right: 26, bottom: 46, left: 64 };
    var iw = W - m.left - m.right;
    var ih = H - m.top - m.bottom;

    var xMax = niceMax(Math.max(r.profitRevenue, r.breakEven) * 1.6);
    var yMinRaw = -v.fixed;
    var yMaxRaw = xMax * r.margin - v.fixed;
    var yPad = (yMaxRaw - yMinRaw) * 0.08;
    var yMin = yMinRaw - yPad;
    var yMax = yMaxRaw + yPad;

    function x(vv) { return m.left + (vv / xMax) * iw; }
    function y(vv) { return m.top + (1 - (vv - yMin) / (yMax - yMin)) * ih; }

    var g = svgEl("g");

    // 横向网格与利润刻度
    var yTicks = 4;
    for (var i = 0; i <= yTicks; i++) {
      var yv = yMin + (yMax - yMin) * (i / yTicks);
      var yy = y(yv);
      g.appendChild(svgEl("line", {
        x1: m.left, y1: yy, x2: W - m.right, y2: yy,
        stroke: "#e6e4dc", "stroke-width": 1
      }));
      g.appendChild(svgEl("text", {
        x: m.left - 10, y: yy + 4, "text-anchor": "end"
      }, wan(yv)));
    }

    // 纵向网格与营业额刻度
    for (var j = 0; j <= 4; j++) {
      var xv = xMax * (j / 4);
      var xx = x(xv);
      g.appendChild(svgEl("line", {
        x1: xx, y1: m.top, x2: xx, y2: H - m.bottom,
        stroke: j === 0 ? "#c3c1b7" : "#efeee8", "stroke-width": 1
      }));
      g.appendChild(svgEl("text", {
        x: xx, y: H - m.bottom + 22, "text-anchor": "middle"
      }, wan(xv)));
    }

    // 零利润线
    g.appendChild(svgEl("line", {
      x1: m.left, y1: y(0), x2: W - m.right, y2: y(0),
      stroke: "#c3c1b7", "stroke-width": 1.2, "stroke-dasharray": "5 5"
    }));
    g.appendChild(svgEl("text", {
      x: m.left - 10, y: y(0) + 4, "text-anchor": "end", fill: "#8b8d92"
    }, "0"));

    // 利润线：利润 = 营业额 × 边际贡献率 − 固定成本
    var x0 = 0;
    var x1 = xMax;
    var profitLine = svgEl("line", {
      x1: x(x0), y1: y(x0 * r.margin - v.fixed),
      x2: x(x1), y2: y(x1 * r.margin - v.fixed),
      stroke: "#17181a", "stroke-width": 2.5, "stroke-linecap": "round"
    });
    if (!chartDrawn) profitLine.setAttribute("class", "chart-line");
    g.appendChild(profitLine);

    // 保本点（金额写进图注，图上只留短标注，避免与直线重叠）
    var beX = x(r.breakEven);
    g.appendChild(svgEl("circle", {
      cx: beX, cy: y(0), r: 6, fill: "#c33a2e", stroke: "#ffffff", "stroke-width": 2.5
    }));
    g.appendChild(svgEl("text", {
      x: Math.min(Math.max(beX, m.left + 26), W - m.right - 26),
      y: Math.max(y(0) - 24, m.top + 14),
      "text-anchor": "middle", fill: "#c33a2e", "font-weight": "700"
    }, "保本"));

    // 目标利润点（与保本点重合时不重复标注）
    if (r.profitRevenue <= xMax && v.targetProfit > 0) {
      var tx = x(r.profitRevenue);
      var ty = y(v.targetProfit);
      g.appendChild(svgEl("circle", {
        cx: tx, cy: ty, r: 4.5, fill: "#17181a", stroke: "#ffffff", "stroke-width": 2
      }));
      g.appendChild(svgEl("text", {
        x: Math.min(Math.max(tx, m.left + 26), W - m.right - 26),
        y: Math.max(ty - 24, m.top + 14),
        "text-anchor": "middle", fill: "#17181a", "font-weight": "700"
      }, "目标"));
    }

    // 轴标注
    g.appendChild(svgEl("text", {
      x: W - m.right, y: H - 8, "text-anchor": "end", fill: "#8b8d92"
    }, "月营业额 →"));
    g.appendChild(svgEl("text", {
      x: m.left, y: 14, "text-anchor": "start", fill: "#8b8d92"
    }, "月利润"));

    svg.appendChild(g);
    svg.setAttribute(
      "aria-label",
      "营业额与利润关系：月保本营业额 " + money(r.breakEven) +
      "，目标利润点 " + money(r.profitRevenue)
    );

    els.chartNote.textContent = "红点为保本点，黑点为目标利润点";
    els.chartCaption.textContent =
      "保本 " + money(r.breakEven) + "；目标利润点 " + money(r.profitRevenue) +
      "。每多卖 100 元，留下 " + money(100 * r.margin) +
      " 去覆盖固定成本；越过保本点后，这部分全部变成利润。";

    chartDrawn = true;
  }

  function clearChart() {
    var svg = els.chart;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    els.chartNote.textContent = "等待有效输入";
    els.chartCaption.textContent = "填完六项数字后，这里会画出营业额与利润的关系。";
  }

  function applyInvalid(invalid) {
    Object.keys(FIELDS).forEach(function (key) {
      var input = document.getElementById(key);
      if (invalid[key]) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    });
  }

  function save(v) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch (e) {
      /* 隐私模式下忽略 */
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function setInputs(values) {
    Object.keys(FIELDS).forEach(function (key) {
      var input = document.getElementById(key);
      if (isFinite(values[key])) input.value = values[key];
    });
  }

  function update() {
    var v = readInputs();
    var check = validate(v);
    var valid = check.problems.length === 0;

    applyInvalid(check.invalid);

    if (!valid) {
      els.error.hidden = false;
      els.error.textContent = check.problems.join(" ");
      els.printBtn.disabled = true;
      renderReceiptError(check.problems);
      clearTargets();
      els.table.innerHTML = "";
      clearChart();
      save(v);
      return;
    }

    var r = compute(v);
    if (r.margin <= 0) {
      els.error.hidden = false;
      els.error.textContent = "变动成本率合计超过 100%，无论卖多少都覆盖不了固定成本。";
      els.printBtn.disabled = true;
      renderReceiptError(["变动成本率合计超过 100%，无法保本。"]);
      clearTargets();
      els.table.innerHTML = "";
      clearChart();
      save(v);
      return;
    }

    els.error.hidden = true;
    els.printBtn.disabled = false;
    renderReceipt(v, r);
    renderTargets(v, r);
    renderSensitivity(v, r);
    renderChart(v, r);
    save(v);
  }

  function init() {
    var saved = load();
    setInputs(saved || SAMPLE);
    update();

    form.addEventListener("input", update);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      update();
    });

    els.loadSample.addEventListener("click", function () {
      setInputs(SAMPLE);
      update();
    });

    els.resetForm.addEventListener("click", function () {
      setInputs(SAMPLE);
      update();
    });

    els.printBtn.addEventListener("click", function () {
      window.print();
    });
  }

  init();
})();

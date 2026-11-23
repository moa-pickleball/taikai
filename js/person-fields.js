// 1人分の入力欄（氏名・生年月日・DUPR など）。申込みフォーム（page-index.js）と管理画面のメンバー変更（page-admin.js）で共通
// p は欄の名前の頭（'p1' / 'p2' など）。scope は、その欄を含む要素（form など）
(function (root) {
  'use strict';

  var FIELD_ORDER = ['name', 'kana', 'phone', 'email', 'birth', 'club', 'dupr', 'duprId'];

  // ---- DOMを使わない部分（テストあり）----

  // 年・月・日の3つの文字から 'YYYY-MM-DD' を作る。数字でなければ birth は空で error に理由を入れる（実在する日付かの確認は Rules 側）
  function composeBirth(y, m, d) {
    y = String(y == null ? '' : y).normalize('NFKC').trim();
    m = String(m == null ? '' : m).normalize('NFKC').trim();
    d = String(d == null ? '' : d).normalize('NFKC').trim();
    if (/^\d{4}$/.test(y) && /^\d{1,2}$/.test(m) && /^\d{1,2}$/.test(d)) {
      return { birth: y + '-' + (m.length < 2 ? '0' : '') + m + '-' + (d.length < 2 ? '0' : '') + d, error: '' };
    }
    return { birth: '', error: '生年月日は西暦で、年・月・日をすべて数字で入力してください' };
  }

  // 「持っている（yes）／持っていない（none）」と入力文字から、送る dupr と duprId を作る（未選択は空）
  function composeDupr(mode, num, id) {
    if (mode === 'none') return { dupr: root.Rules.DUPR_NONE, duprId: '' };
    if (mode === 'yes') return { dupr: String(num == null ? '' : num).trim(), duprId: String(id == null ? '' : id).trim() };
    return { dupr: '', duprId: '' };
  }

  function fieldKey(f) { return /^b[ymd]$/.test(f) ? 'birth' : f; }

  // 欄の並び順（'p1.name' のような名前を、画面の上から順に並べるための数）
  function fieldOrder(f) { var i = FIELD_ORDER.indexOf(f); return i < 0 ? 99 : i; }

  root.PersonFields = {
    composeBirth: composeBirth, composeDupr: composeDupr, fieldKey: fieldKey, fieldOrder: fieldOrder
  };
  if (!root.document) return;   // テスト用（node）

  var doc = root.document;
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }

  // ---- 欄を描く ----
  function html(p, title, rep) {
    var ac = function (v) { return rep ? ' autocomplete="' + v + '"' : ' autocomplete="off"'; };
    var h = function (f) { return ' data-p="' + p + '" data-f="' + f + '"'; };
    function err(f) { return '<p class="err" data-err="' + p + '.' + f + '"></p>'; }
    return '<fieldset data-dupr="" id="fs-' + p + '"><legend>' + title + '</legend><div class="fgrid">' +
      '<div class="field"><label for="' + p + '-name">氏名<span class="req">必須</span></label><input type="text" id="' + p + '-name"' + h('name') + ac('name') + '>' + err('name') + '</div>' +
      '<div class="field"><label for="' + p + '-kana">フリガナ<span class="req">必須</span></label><input type="text" id="' + p + '-kana"' + h('kana') + ' autocomplete="off">' + err('kana') + '</div>' +
      '<div class="field"><label for="' + p + '-phone">電話番号<span class="req">必須</span></label><input type="tel" inputmode="tel" id="' + p + '-phone"' + h('phone') + ac('tel') + '>' + (rep ? '<p class="hint">当日の緊急連絡にだけ使います。</p>' : '') + err('phone') + '</div>' +
      '<div class="field"><label for="' + p + '-email">メールアドレス<span class="req">必須</span></label><input type="email" inputmode="email" id="' + p + '-email"' + h('email') + ac('email') + '>' + (rep ? '<p class="hint">受付完了のお知らせを送ります。</p>' : '') + err('email') + '</div>' +
      '<div class="field" role="group" aria-labelledby="' + p + '-bl"><div class="lbl" id="' + p + '-bl">生年月日（西暦）<span class="req">必須</span></div><div class="ymd">' +
      '<input class="y" type="text" inputmode="numeric" maxlength="4" aria-label="年" placeholder="1985"' + h('by') + ac('bday-year') + '><span>年</span>' +
      '<input class="md" type="text" inputmode="numeric" maxlength="2" aria-label="月" placeholder="4"' + h('bm') + ac('bday-month') + '><span>月</span>' +
      '<input class="md" type="text" inputmode="numeric" maxlength="2" aria-label="日" placeholder="1"' + h('bd') + ac('bday-day') + '><span>日</span></div>' +
      (rep ? '<p class="hint">Age 40+ など年齢区分の確認に使います。</p>' : '') + err('birth') + '</div>' +
      '<div class="field"><label for="' + p + '-club">所属サークル<span class="req">必須</span></label><input type="text" id="' + p + '-club"' + h('club') + ' autocomplete="off"><p class="hint">ない場合は「フリー」と入力してください。</p>' + err('club') + '</div>' +
      '<div class="field dupr" role="group" aria-labelledby="' + p + '-dl"><div class="lbl" id="' + p + '-dl">DUPR<span class="req">必須</span></div>' +
      '<div class="seg"><label><input type="radio" name="dupr-' + p + '" value="yes"><span>持っている</span></label><label><input type="radio" name="dupr-' + p + '" value="none"><span>持っていない（なし）</span></label></div>' +
      '<div class="dupr-num"><input type="text" inputmode="decimal" aria-label="DUPRの数字" placeholder="例：3.45" autocomplete="off"' + h('dupr') + '></div>' +
      '<p class="hint">DUPR ＝ ピックルボールの実力レーティング（数字）です。ダブルスの数字を入力してください。</p>' + err('dupr') + '</div>' +
      '<div class="field dupr-id"><label for="' + p + '-duprId">DUPR ID<span class="opt">任意</span></label><input type="text" id="' + p + '-duprId" placeholder="例：ABC123" autocomplete="off"' + h('duprId') + '><p class="hint">DUPRアプリに表示される、あなた専用のIDです。</p>' + err('duprId') + '</div>' +
      '</div></fieldset>';
  }

  // 「持っている／持っていない」で、数字とDUPR IDの欄を出し入れする
  function bind(scope) {
    scope.querySelectorAll('.seg input[name^="dupr-"]').forEach(function (r) {
      r.addEventListener('change', function () { r.closest('fieldset').dataset.dupr = r.value; });
    });
  }

  function fv(scope, p, f) { var el = $('[data-p="' + p + '"][data-f="' + f + '"]', scope); return el ? el.value : ''; }

  // 欄の値を、サーバーに送る Person の形にする。生年月日が組み立てられないときは birthErr に理由を入れる
  function read(scope, p) {
    var b = composeBirth(fv(scope, p, 'by'), fv(scope, p, 'bm'), fv(scope, p, 'bd'));
    var mode = $('input[name="dupr-' + p + '"]:checked', scope);
    var d = composeDupr(mode ? mode.value : '', fv(scope, p, 'dupr'), fv(scope, p, 'duprId'));
    return {
      person: {
        name: fv(scope, p, 'name').trim(), kana: fv(scope, p, 'kana').trim(), phone: fv(scope, p, 'phone').trim(), email: fv(scope, p, 'email').trim(),
        birth: b.birth, club: fv(scope, p, 'club').trim(), dupr: d.dupr, duprId: d.duprId
      },
      birthErr: b.error
    };
  }

  // 'p1.name' のような欄の名前から、入力欄（複数のこともある）を返す。この共通部分に無い名前は空の配列
  function inputsFor(scope, field) {
    var m = /^([^.]+)\.(.+)$/.exec(field);
    if (!m) return [];
    var p = m[1], f = m[2];
    if (f === 'birth') return ['by', 'bm', 'bd'].map(function (k) { return $('[data-p="' + p + '"][data-f="' + k + '"]', scope); });
    if (f === 'dupr') {
      var mode = $('input[name="dupr-' + p + '"]:checked', scope);
      return mode ? [$('[data-p="' + p + '"][data-f="dupr"]', scope)] : [$('input[name="dupr-' + p + '"]', scope)];
    }
    return [$('[data-p="' + p + '"][data-f="' + f + '"]', scope)];
  }

  // 入力欄のエラー表示を消す（この共通部分の欄だけ。それ以外は何もしない）
  function clearErr(scope, el) {
    el.classList.remove('invalid');
    var p = el.getAttribute('data-p');
    if (!p) return;
    var slot = $('[data-err="' + p + '.' + fieldKey(el.getAttribute('data-f')) + '"]', scope);
    if (slot) slot.textContent = '';
  }

  function clearAll(scope, alertEl) {
    scope.querySelectorAll('.err').forEach(function (e) { e.textContent = ''; });
    scope.querySelectorAll('.invalid').forEach(function (e) { e.classList.remove('invalid'); });
    if (alertEl) alertEl.textContent = '';
  }

  // errors: [{field, message}]。表示できなかったものは alertEl（赤い帯）に出す。extra(field) は、共通部分以外の欄の入力欄を返す
  function showErrors(scope, errors, alertEl, extra) {
    var first = null, stray = [];
    errors.forEach(function (e) {
      var slot = $('[data-err="' + e.field + '"]', scope);
      var els = (extra && extra(e.field) || inputsFor(scope, e.field)).filter(Boolean);
      if (!slot || !els.length) { stray.push(e.message); return; }
      if (!slot.textContent) slot.textContent = e.message;
      els.forEach(function (el) { el.classList.add('invalid'); });
      if (!first) first = els[0];
    });
    if (stray.length) alertEl.textContent = stray.join(' ');
    if (first) { first.focus(); first.scrollIntoView({ block: 'center' }); }
    else if (stray.length) alertEl.scrollIntoView({ block: 'center' });
  }

  var PF = root.PersonFields;
  PF.html = html; PF.bind = bind; PF.read = read; PF.inputsFor = inputsFor;
  PF.clearErr = clearErr; PF.clearAll = clearAll; PF.showErrors = showErrors;
})(this);

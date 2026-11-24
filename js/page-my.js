// 確認・キャンセル画面（my.html の #app に描く）。リンクは  my.html#t=<合言葉>
(function (root) {
  'use strict';

  // #t=... から合言葉を取り出す（URLエンコードされていても読む。なければ空文字）
  function parseToken(hash) {
    var parts = String(hash || '').replace(/^#/, '').split('&');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].slice(0, 2) !== 't=') continue;
      try { return decodeURIComponent(parts[i].slice(2)); } catch (e) { return ''; }
    }
    return '';
  }
  root.MyToken = { parse: parseToken };
  if (!root.document) return;   // テスト用（node）

  var CFG = root.CONFIG || {};
  var doc = root.document;
  var app = doc.getElementById('app');
  var BUSY_TEXT = '混雑しています。そのままお待ちください（入力し直しは不要です）';
  var BAD_LINK = 'リンクが正しくありません。メールのリンクをもう一度開いてください';
  var token = parseToken(root.location.hash);
  var api = null;
  var sending = false;
  var opener = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel) { return doc.querySelector(sel); }

  function message(title, text, retry) {
    $('#v-my').innerHTML = '<h1>' + esc(title) + '</h1><p>' + esc(text) + '</p>' +
      (retry ? '<button class="btn" type="button" id="retry">もう一度読み込む</button>' : '');
    if (retry) $('#retry').addEventListener('click', function () { root.location.reload(); });
  }

  // 状態ごとの表示。ボタンを出すのは「確定」「キャンセル待ち」だけ
  function chip(status) {
    var cls = status === '確定' ? 'ok' : status === 'キャンセル待ち' ? 'wait' : 'gray';
    return '<span class="chip ' + cls + '">' + esc(status) + '</span>';
  }
  function explain(e) {
    if (e.status === 'キャンセル待ち') return '<p>空きが出たら、順番に自動で「確定」になり、メールでお知らせします。まだ確定ではないのでご注意ください。</p>';
    if (e.status === 'キャンセル') return '<p class="muted">この申し込みはキャンセル済みです。</p>';
    if (e.status === '取消（他で確定）') return '<p class="muted">「取消（他で確定）」は、同じ人が別のカテゴリで先に確定したため、こちらを取り消した状態です。</p>';
    return '';
  }
  function person(p) { return esc(p && p.name) + (p && p.club ? '（' + esc(p.club) + '）' : ''); }

  // note: { ok: true|false, text } 画面の上に出す短い知らせ
  function render(e, note) {
    var active = e.status === '確定' || e.status === 'キャンセル待ち';
    var pos = e.status === 'キャンセル待ち' && e.position ? ' ' + esc(e.position) + '番目です' : '';
    $('#v-my').innerHTML =
      (note ? '<div class="' + (note.ok ? 'banner open' : 'warn') + '" role="status" id="note">' + esc(note.text) + '</div>' : '') +
      '<h1>申し込み内容の確認</h1>' +
      '<p>状態：' + chip(e.status) + pos + '</p>' +
      explain(e) +
      '<dl class="sum"><dt>受付番号</dt><dd>' + esc(e.no) + '</dd>' +
      '<dt>カテゴリ</dt><dd>' + esc(e.categoryName) + '</dd>' +
      '<dt>代表者</dt><dd>' + person(e.p1) + '</dd>' +
      '<dt>ペア</dt><dd>' + person(e.p2) + '</dd></dl>' +
      (active ? '<h2>キャンセルする</h2><p class="muted">キャンセルすると元に戻せません。</p>' +
        '<button class="btn danger" type="button" id="open-cancel">この申し込みをキャンセルする</button>' : '');
    var b = $('#open-cancel');
    if (b) b.addEventListener('click', openDialog);
    if (note) root.scrollTo(0, 0);
  }

  // ---- 確認ダイアログ ----
  function openDialog() {
    opener = doc.activeElement;
    $('#confirm').hidden = false;
    $('#confirm .dialog').focus();
  }
  function closeDialog() {
    if (sending) return;
    $('#confirm').hidden = true;
    if (opener && opener.focus) opener.focus();
  }
  function onKey(ev) {
    var box = $('#confirm');
    if (box.hidden) return;
    if (ev.key === 'Escape') { closeDialog(); return; }
    if (ev.key !== 'Tab') return;
    // フォーカスをダイアログの中に閉じ込める
    var els = Array.prototype.filter.call(box.querySelectorAll('button'), function (b) { return !b.disabled; });
    if (!els.length) { ev.preventDefault(); return; }
    var first = els[0], last = els[els.length - 1], cur = doc.activeElement;
    var inside = els.indexOf(cur) >= 0;
    if (!inside) { ev.preventDefault(); (ev.shiftKey ? last : first).focus(); }
    else if (ev.shiftKey && cur === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && cur === last) { ev.preventDefault(); first.focus(); }
  }

  function setSending(on, busy) {
    sending = on;
    $('#do-cancel').disabled = on;
    $('#back').disabled = on;
    $('#do-cancel').textContent = on ? '送信中…' : 'キャンセルする';
    $('#busy').hidden = !on || !busy;
  }

  function onCancel() {
    if (sending) return;
    setSending(true);
    api.post({ action: 'cancel', token: token }, { onRetry: function () { setSending(true, true); } }).then(function (res) {
      setSending(false);
      $('#confirm').hidden = true;
      var ok = !!(res && res.ok);
      var text = ok ? 'キャンセルしました' : ((res && res.message) || 'キャンセルできませんでした。');
      load({ ok: ok, text: text });
    }, function (err) {
      setSending(false);
      $('#confirm').hidden = true;
      // 送信は届いたのに返事だけ失われたかもしれないので、取り直して今の状態を見せる
      load({ ok: false, text: 'キャンセルできたか確認できませんでした。下の状態を確認してください' });
    });
  }

  function load(note) {
    return api.post({ action: 'my', token: token }).then(function (res) {
      if (res && res.ok && res.entry) { render(res.entry, note); return; }
      if (res && res.code === 'notFound') { message('確認できません', BAD_LINK, false); return; }
      throw new Error('bad');
    }).catch(function () {
      message('読み込めませんでした', '申し込み内容を読み込めませんでした。通信状況を確認して、もう一度お試しください。', true);
    });
  }

  function init() {
    app.innerHTML =
      '<section class="frame" id="v-my"><p class="muted">読み込み中…</p></section>' +
      '<div class="overlay" id="confirm" hidden role="dialog" aria-modal="true" aria-labelledby="confirm-t"><div class="dialog" tabindex="-1">' +
      '<p style="font-weight:700;margin:0 0 4px" id="confirm-t">本当にキャンセルしますか？</p>' +
      '<p class="muted">キャンセルすると元に戻せません。キャンセル待ちの方が繰り上がります</p>' +
      '<div class="btn-row"><button class="btn sub" type="button" id="back">やめる</button>' +
      '<button class="btn" style="background:var(--ng)" type="button" id="do-cancel">キャンセルする</button></div></div></div>' +
      '<div class="overlay" id="busy" hidden role="status"><div class="dialog"><div class="spin"></div>' +
      '<p style="font-weight:700;font-size:18px;margin:0">' + BUSY_TEXT + '</p>' +
      '<p class="muted">画面を閉じたり、もう一度ボタンを押したりしなくて大丈夫です。</p></div></div>';
    $('#back').addEventListener('click', closeDialog);
    $('#do-cancel').addEventListener('click', onCancel);
    doc.addEventListener('keydown', onKey);
    if (!CFG.API_URL) {
      message('ただいま準備中です', 'エントリーのしくみの設定がまだ終わっていないため、このページは使えません。運営にお問い合わせください。', false);
      return;
    }
    if (!token) { message('確認できません', BAD_LINK, false); return; }
    api = root.ApiClient.create({
      url: CFG.API_URL,
      fetch: function (u, o) { return root.fetch(u, o); },
      sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
      random: Math.random
    });
    load(null);
  }

  init();
})(this);

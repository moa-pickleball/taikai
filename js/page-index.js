// 大会ページ・申し込みフォーム・完了画面（index.html の #app に描く）
(function (root) {
  'use strict';

  // 送信ボタンの直上に出す、送る前の見直し用の1行（2026-11-27 指示 T4。確認の画面は作らない）
  // 「ミックスダブルス（午前）／山田 太郎・佐藤 花子」。まだ入っていない所は「（〜 未入力）」
  function sendSummaryParts(cat, p1Name, p2Name) {
    function nm(v, who) { v = String(v == null ? '' : v).trim(); return v || '（' + who + 'の氏名 未入力）'; }
    return [cat ? cat.name + (cat.session ? '（' + cat.session + '）' : '') : '（カテゴリ 未選択）', nm(p1Name, '代表者'), nm(p2Name, 'ペア')];
  }
  function sendSummaryText(cat, p1Name, p2Name) {
    var a = sendSummaryParts(cat, p1Name, p2Name);
    return a[0] + '／' + a[1] + '・' + a[2];
  }
  root.IndexData = { sendSummaryText: sendSummaryText, sendSummaryParts: sendSummaryParts };
  if (!root.document) return;   // テスト用（node）

  var CFG = root.CONFIG || {};
  var doc = root.document;
  var app = doc.getElementById('app');
  var BUSY_TEXT = '混雑しています。そのままお待ちください（入力し直しは不要です）';
  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  var data = null;            // 公開情報（tournament, categories, notices）
  var offset = 0;             // サーバー時刻 − 端末の時刻（ミリ秒）。往復がいちばん短かった測定を使う
  var bestRtt = Infinity;
  var synced = {};            // 受付開始の前の時計合わせ（60・30・10秒前）を済ませた印
  var lastPhases = '';
  var refreshing = false, lastRefreshAt = 0;
  var sending = false;
  var lastAttempt = null;     // 通信が最後まで通らなかった送信（同じ内容なら requestId を使い回す）
  var api = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function yen(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円'; }

  // ---- 日時（日本時間の文字列をそのまま読む）----
  function parts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(iso || ''));
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] || '', mi: m[5] || '', wd: WEEK[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] };
  }
  function dateText(iso) { var p = parts(iso); return p ? p.y + '年' + p.mo + '月' + p.d + '日(' + p.wd + ')' : ''; }
  function openText(iso) { var p = parts(iso); return p ? dateText(iso) + ' ' + p.h + ':' + p.mi : ''; }

  function serverNow() { return Date.now() + offset; }
  // t0＝送った時刻、t1＝返事が届いた時刻（端末の時計）。サーバー時刻は往復の真ん中で測ったとみなす
  function setOffset(serverTime, t0, t1) {
    var t = Date.parse(serverTime);
    if (isNaN(t)) return;
    var rtt = t1 - t0;
    if (rtt <= bestRtt) { bestRtt = rtt; offset = t - (t0 + t1) / 2; }
  }
  function fetchPublic() {
    var t0 = Date.now();
    return api.getPublic().then(function (res) { res._t = [t0, Date.now()]; return res; });
  }
  // 受付の段階は、端末で計算する（公開情報は最大10秒キャッシュされるので、返ってきた phase は使わない）
  function phaseOf(c) {
    var t = serverNow(), o = Date.parse(c.opensAt), x = Date.parse(c.closesAt);
    if (isNaN(o) || isNaN(x)) return 'closed';
    return t < o ? 'before' : t >= x ? 'closed' : 'open';
  }
  function isFull(c) { return c.remaining <= 0; }

  // ---- 大会ページ ----
  function summary() {
    var cs = data.categories, open = [], before = [], full = false, i;
    for (i = 0; i < cs.length; i++) {
      var ph = phaseOf(cs[i]);
      if (ph === 'open') { open.push(cs[i]); if (isFull(cs[i])) full = true; }
      else if (ph === 'before') before.push(cs[i]);
    }
    return { open: open, before: before, full: full };
  }
  function nextOpen(before) {
    var best = null;
    before.forEach(function (c) { var t = Date.parse(c.opensAt); if (!isNaN(t) && (best === null || t < best.t)) best = { t: t, iso: c.opensAt }; });
    return best;
  }
  function countdownText(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d > 0 ? 'あと ' + d + '日 ' + p(h) + '時間 ' + p(m) + '分' : 'あと ' + p(h) + '時間 ' + p(m) + '分 ' + p(s % 60) + '秒';
  }

  function icon(name) { return root.ChipIcon ? root.ChipIcon.svg(name) : ''; }   // 札のアイコン（D2。chip-icon.js）
  function catHtml(c) {
    var ph = phaseOf(c), chip, bar = '', sub = esc(c.session) + '・定員' + c.capacity + '組';
    if (ph === 'before') { chip = '<span class="chip gray">' + icon('clock') + '受付前</span>'; sub += '・' + esc(openText(c.opensAt)) + ' 開始'; }
    else if (ph === 'closed') chip = '<span class="chip gray">' + icon('x') + '受付終了</span>';
    else if (isFull(c)) chip = '<span class="chip wait">' + icon('queue') + '満枠・キャンセル待ち ' + c.waitlist + '組</span>';
    else chip = '<span class="chip ok">' + icon('check') + '残り ' + c.remaining + '組</span>';
    if (ph !== 'before') {
      var pct = c.capacity > 0 ? Math.min(100, Math.round(c.confirmed / c.capacity * 100)) : 100;
      // バーだけだと残りが分からないので、数字も添える（2026-11-27 UI/UX レビュー9。ops-system fc3f444 と同じ）
      bar = '<div class="bar"><i' + (isFull(c) ? ' class="full"' : '') + ' style="width:' + pct + '%"></i></div>' +
        '<div class="bar-n">' + c.confirmed + ' / ' + c.capacity + '組</div>';
    }
    return '<div class="cat"><div class="cat-head"><div><div class="cat-name">' + esc(c.name) + '</div><div class="cat-sub">' + sub + '</div></div>' + chip + '</div>' + bar + '</div>';
  }

  function renderEvent() {
    var t = data.tournament, s = summary(), next = nextOpen(s.before), banner, note = '', btn, i;
    if (s.open.length) {
      banner = s.full
        ? '<div class="banner wait">一部のカテゴリは定員に達しました。<br>キャンセル待ちとして受付中です</div>'
        : '<div class="banner open">受付中です</div>';
      if (s.full) note = '<p class="muted note">キャンセル待ちは、空きが出た順に自動で繰り上がり、メールでお知らせします。</p>';
      // 「キャンセル待ちを含む」は2行目に分けて小さく出す（1行に詰めると、スマホで「含／む）」と変な所で切れるため）
      btn = s.full
        ? function (id, cls) { return '<button class="btn btn-2l js-go' + cls + '" type="button" id="' + id + '"><span>エントリーする</span><span class="btn-note">（キャンセル待ちを含む）</span></button>'; }
        : function (id, cls) { return '<button class="btn js-go' + cls + '" type="button" id="' + id + '">エントリーする</button>'; };
    } else if (next) {
      banner = '<div class="banner before"><div>受付開始まで（' + esc(openText(next.iso)) + ' 開始）</div><div class="count" id="count">' + countdownText(next.t - serverNow()) + '</div></div>';
      btn = function (id, cls) { return '<span class="btn disabled' + cls + '" id="' + id + '" aria-disabled="true">受付開始までお待ちください</span>'; };
    } else {
      banner = '<div class="banner closed">受付は終了しました</div>';
      btn = function (id, cls) { return '<span class="btn disabled' + cls + '" id="' + id + '" aria-disabled="true">受付は終了しました</span>'; };
    }
    // 主ボタンは同じ作り方で2つ出す（2026-11-27 指示 T1）：スマホではバナーの直下（go-top）にも置き、カテゴリを全部スクロールしなくても押せるようにする。
    // PC（960px 以上）では上のボタンを隠し、右の列の下のボタン（go）だけ。受付前も押せないボタンを同じ位置に出し、開始と同時に位置がずれないようにする
    var btnTop = btn('go-top', ' btn-top'), btnMain = btn('go', ' btn-main');
    var notices = '';
    if (data.notices && data.notices.length) {
      notices = '<ul class="notices">' + data.notices.map(function (n) {
        return '<li><b>' + esc(n.title) + '</b>' + esc(n.body) + '</li>';
      }).join('') + '</ul>';
    }
    var cats = '';
    for (i = 0; i < data.categories.length; i++) cats += catHtml(data.categories[i]);
    $('#event-body').innerHTML =
      // 大会名の見出しに、ポスター（ようこそ画面）の斜めの帯と点を薄く敷く（2026-11-27 指示 D1。飾りはここ1か所だけ。CSS だけで、絵は読み込まない）
      '<div class="ev-hero"><h1>' + esc(t.name) + '</h1><p class="muted">主催：' + esc(CFG.ORGANIZER || '') + '</p></div>' +
      '<div class="event-grid"><ul class="meta"><li>日時：' + esc(dateText(t.date)) + '</li>' +
      (t.venue ? '<li>会場：' + esc(t.venue) + '</li>' : '') +
      '<li>参加費：' + yen(t.fee) + '／組（当日、現金でお支払いください）</li></ul>' +
      notices + banner + btnTop + '<div class="cats"><h2>カテゴリと' + (s.open.length ? '残り枠' : '定員') + '</h2>' + cats + '</div>' + note + btnMain + '</div>';
    [].forEach.call(doc.querySelectorAll('#event-body .js-go'), function (go) { go.addEventListener('click', showForm); });
    lastPhases = phasesSig();
  }

  function phasesSig() {
    return data.categories.map(function (c) { return c.id + ':' + phaseOf(c) + ':' + c.remaining + ':' + c.waitlist; }).join(',');
  }

  // ---- 申し込みフォーム ----
  var PF = root.PersonFields;

  function buildForm() {
    $('#v-form').innerHTML =
      '<button class="btn link" type="button" id="back">← 大会ページに戻る</button>' +
      '<h1>エントリー</h1><p class="muted" id="form-sub"></p>' +
      '<form id="entry-form" novalidate>' +
      '<div class="field pc-half"><label for="cat">出場カテゴリ<span class="req">必須</span></label><select id="cat"></select><p class="hint" id="cat-hint"></p><p class="err" data-err="categoryId"></p></div>' +
      PF.html('p1', '代表者（あなた）', true) + PF.html('p2', 'ペア（パートナー）', false) +
      '<p class="muted" id="fee-note"></p>' +
      '<div class="alert" id="form-alert" role="alert"></div>' +
      '<p class="send-sum pc-center" id="send-sum"><span class="send-sum-l">この内容で送ります</span><span id="send-sum-t"></span></p>' +
      '<button class="btn pc-center" type="submit" id="send">この内容でエントリーする</button>' +
      '</form>';
    $('#back').addEventListener('click', showEvent);
    $('#entry-form').addEventListener('submit', onSubmit);
    $('#cat').addEventListener('change', function () { updateCatHint(); updateSendSum(); });
    ['#p1-name', '#p2-name'].forEach(function (sel) { $(sel).addEventListener('input', updateSendSum); });
    PF.bind($('#entry-form'));
    // 所属サークルの入力候補（既にエントリーのあるサークル名。入力した文字に合うものだけ出す）
    ['#p1-club', '#p2-club'].forEach(function (sel) {
      root.ClubSuggest.attach($(sel), function () { return data.clubs; });
    });
    doc.querySelectorAll('#entry-form input, #entry-form select').forEach(function (el) {
      el.addEventListener('input', function () { clearErr(el); });
    });
  }

  function clearErr(el) {
    if (el.id === 'cat') {
      el.classList.remove('invalid');
      var slot = $('[data-err="categoryId"]');
      if (slot) slot.textContent = '';
    } else PF.clearErr($('#entry-form'), el);
  }

  function updateForm() {
    var t = data.tournament, sel = $('#cat'), prev = sel.value, s = summary();
    $('#form-sub').innerHTML = esc(t.name) + '　／　<span style="color:var(--ng)">必須</span>の項目は必ず入力してください';
    $('#fee-note').textContent = '参加費は' + yen(t.fee) + '／組です。当日、受付で現金でお支払いください。';
    var gone = prev && !s.open.some(function (c) { return c.id === prev; }) ? findCat(prev) : null;
    sel.innerHTML = (gone ? '<option value="' + esc(gone.id) + '" disabled>' + esc(gone.name) + '（受付終了）</option>' : '') + s.open.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) + '（' + esc(c.session) + '・' + (isFull(c) ? '満枠：キャンセル待ち' : '残り' + c.remaining + '組') + '）</option>';
    }).join('');
    if (prev) sel.value = prev;                 // 選んだカテゴリが終わっていても、勝手に別のカテゴリへ替えない
    else if (sel.options.length) sel.selectedIndex = 0;
    updateCatHint();
    updateSendSum();
  }
  function updateSendSum() {
    // 1つずつ途中で折り返さない（名前が「山田 太／郎」と切れないように）。区切りの「／」「・」でだけ改行
    var a = sendSummaryParts(findCat($('#cat').value), $('#p1-name').value, $('#p2-name').value);
    $('#send-sum-t').innerHTML = '<span class="nw">' + esc(a[0]) + '</span>／<span class="nw">' + esc(a[1]) + '</span>・<span class="nw">' + esc(a[2]) + '</span>';
  }
  function updateCatHint() {
    var c = findCat($('#cat').value);
    $('#cat-hint').textContent = c && isFull(c) ? 'このカテゴリは定員に達しています。キャンセル待ちとして受け付けます。' : '';
  }
  function findCat(id) {
    for (var i = 0; i < data.categories.length; i++) if (data.categories[i].id === id) return data.categories[i];
    return null;
  }

  // フォームの値を、サーバーに送る形にする。生年月日の組み立てで間違いがあれば birthErr に入れる
  function collect() {
    var input = { categoryId: $('#cat').value }, birthErr = {};
    ['p1', 'p2'].forEach(function (p) {
      var r = PF.read($('#entry-form'), p);
      if (r.birthErr) birthErr[p] = r.birthErr;
      input[p] = r.person;
    });
    return { input: input, birthErr: birthErr };
  }

  function clearAllErrors() { PF.clearAll($('#entry-form'), $('#form-alert')); }

  // errors: [{field, message}]。表示できなかったものは上の赤い帯に出す
  function showErrors(errors) {
    PF.showErrors($('#entry-form'), errors, $('#form-alert'), function (field) {
      return field === 'categoryId' ? [$('#cat')] : null;
    });
  }

  function validate(collected) {
    var cat = findCat(collected.input.categoryId) || {};
    var catErr = !cat.id ? '出場カテゴリを選んでください' : phaseOf(cat) !== 'open' ? 'このカテゴリの受付は終了しています。別のカテゴリを選んでください' : '';
    var errors = root.Rules.validateEntryInput(collected.input, cat, data.tournament.date).filter(function (e) {
      return !(/^(p[12])\.birth$/.test(e.field) && collected.birthErr[e.field.slice(0, 2)]);
    });
    if (catErr) errors.unshift({ field: 'categoryId', message: catErr });
    ['p1', 'p2'].forEach(function (p) { if (collected.birthErr[p]) errors.push({ field: p + '.birth', message: collected.birthErr[p] }); });
    // 画面の並び順に直す
    errors.sort(function (a, b) { return rank(a.field) - rank(b.field); });
    function rank(f) { return f === 'categoryId' ? 0 : (f.charAt(1) === '1' ? 1 : 2) * 100 + fieldOrder(f.slice(3)); }
    function fieldOrder(f) { return PF.fieldOrder(f); }
    return errors;
  }

  function newRequestId() {
    var c = root.crypto;
    if (c && typeof c.randomUUID === 'function') { try { return c.randomUUID(); } catch (e) { /* 次へ */ } }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
  }

  function setSending(on, label) {
    sending = on;
    var b = $('#send');
    b.disabled = on;
    b.textContent = on ? (label || '送信中…') : 'この内容でエントリーする';
    $('#busy').hidden = !on || label !== 'busy';
  }

  function onSubmit(ev) {
    ev.preventDefault();
    if (sending) return;
    clearAllErrors();
    var collected = collect(), errors = validate(collected);
    if (errors.length) { showErrors(errors); return; }
    var body = { action: 'submit', categoryId: collected.input.categoryId, p1: collected.input.p1, p2: collected.input.p2 };
    var sig = JSON.stringify(body);
    // 通信が通らず終わった送信を、同じ内容でもう一度押したときは、同じ requestId で送る（二重に申し込まないため）
    body.requestId = lastAttempt && lastAttempt.sig === sig ? lastAttempt.id : newRequestId();
    lastAttempt = { sig: sig, id: body.requestId };
    setSending(true);
    api.post(body, { onRetry: function () { setSending(true, 'busy'); } }).then(function (res) {
      setSending(false);
      onResult(res, collected);
    }, function (err) {
      setSending(false);
      $('#form-alert').textContent = err && err.message ? err.message : '送信できませんでした。もう一度「送信」を押してください（入力はそのまま残っています）';
      $('#form-alert').scrollIntoView({ block: 'center' });
    });
  }

  function onResult(res, collected) {
    lastAttempt = null;
    if (res && res.ok) { showDone(res, collected.input); return; }
    if (res && res.code === 'invalid' && res.errors && res.errors.length) { showErrors(res.errors); return; }
    var msg = (res && res.message) || '送信できませんでした。入力内容はそのまま残っています。';
    $('#form-alert').textContent = msg + '（入力はそのまま残っています）';
    $('#form-alert').scrollIntoView({ block: 'center' });
    // 受付の状況が変わっていそうなときは、最新の情報を取り直す
    if (res && (res.code === 'before' || res.code === 'closed' || res.code === 'unknownCategory')) refresh(true);
  }

  // ---- 完了画面 ----
  function showDone(res, input) {
    var cat = findCat(input.categoryId), wait = res.status === 'キャンセル待ち';
    var site = String(CFG.SITE_URL || '').replace(/\/+$/, '');
    var link = site + '/my.html#t=' + encodeURIComponent(res.token);
    var head = wait
      ? '<div class="big-status wait"><div class="t">キャンセル待ちで受け付けました</div>' + (res.position ? '<div class="t">' + res.position + '番目です</div>' : '') + '</div>'
      : '<div class="big-status ok"><div class="t">エントリーが確定しました</div><div>ご応募ありがとうございます</div></div>';
    $('#v-done').innerHTML = head +
      '<p class="muted" style="text-align:center;margin:0">受付番号</p><div class="no">' + esc(res.no) + '</div>' +
      '<dl class="sum"><dt>カテゴリ</dt><dd>' + esc(cat ? cat.name + '（' + cat.session + '）' : '') + '</dd>' +
      '<dt>ペア</dt><dd>' + esc(input.p1.name) + ' ／ ' + esc(input.p2.name) + '</dd>' +
      (wait ? '<dt>状態</dt><dd><span class="chip wait">' + icon('queue') + 'キャンセル待ち</span></dd>'
            : '<dt>参加費</dt><dd>' + yen(data.tournament.fee) + '／組（当日、現金）</dd>') + '</dl>' +
      // 送り先を出し、打ち間違いにその場で気づけるようにする（T3）。入力されたものをそのまま出す
      (input.p1.email ? '<p class="mail-to">お知らせは <b>' + esc(input.p1.email) + '</b> に送ります。</p>' : '') +
      (wait ? '<p>空きが出たら、順番に自動で「確定」になり、メールでお知らせします。まだ確定ではないのでご注意ください。</p>' : '') +
      '<h2>確認用リンク</h2><div class="linkbox"><input type="text" readonly id="my-link" aria-label="確認用リンク" value="' + esc(link) + '"><button class="btn sub" type="button" id="copy">リンクをコピー</button></div>' +
      '<p class="muted" id="copy-msg" role="status"></p>' +
      '<div class="warn"><b>このリンクは保存してください。</b>' + (wait ? '順番の確認やキャンセルは、このリンクから行います。' : '申し込み内容の確認やキャンセルは、このリンクから行います。メールにも送りました。') + '</div>';
    $('#copy').addEventListener('click', copyLink);
    show('v-done');
    root.scrollTo(0, 0);
  }

  function copyLink() {
    var box = $('#my-link'), msg = $('#copy-msg');
    function select() { box.focus(); box.select(); try { box.setSelectionRange(0, box.value.length); } catch (e) { /* 無視 */ } }
    function fallback() {
      select();
      var ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      msg.textContent = ok ? 'コピーしました' : 'コピーできませんでした。リンクを選択した状態にしたので、長押しなどで手動でコピーしてください';
    }
    var nav = root.navigator;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      nav.clipboard.writeText(box.value).then(function () { msg.textContent = 'コピーしました'; }, fallback);
    } else fallback();
  }

  // ---- 画面の切り替え・読み込み ----
  function show(id) {
    ['v-event', 'v-form', 'v-done', 'v-message'].forEach(function (v) { $('#' + v).hidden = v !== id; });
  }
  function showEvent() { show('v-event'); root.scrollTo(0, 0); }
  function showForm() { updateForm(); show('v-form'); root.scrollTo(0, 0); }
  function message(title, text, retry) {
    $('#v-message').innerHTML = '<h1>' + esc(title) + '</h1><p>' + esc(text) + '</p>' + (retry ? '<button class="btn" type="button" id="retry">もう一度読み込む</button>' : '');
    show('v-message');
    if (retry) $('#retry').addEventListener('click', function () { location.reload(); });
  }

  function apply(res) {
    setOffset(res.serverTime, res._t[0], res._t[1]);
    data = { tournament: res.tournament, categories: res.categories || [], notices: res.notices || [], clubs: res.clubs || [] };
    renderEvent();
    if (!$('#entry-form')) buildForm();
    updateForm();
    if (!$('#v-form').hidden && !summary().open.length) showEvent();
  }

  function refresh(force) {
    var now = Date.now();
    if (refreshing || (!force && now - lastRefreshAt < 3000)) return Promise.resolve();
    refreshing = true; lastRefreshAt = now;
    return fetchPublic().then(function (res) {
      refreshing = false;
      if (res && res.ok) apply(res);
    }, function () { refreshing = false; });
  }

  // 受付開始の60・30・10秒前に、公開情報を取り直して時計を合わせる（人ごとに少しずらす）
  function syncBeforeOpen(next) {
    var left = next.t - serverNow();
    [60, 30, 10].forEach(function (sec) {
      var key = next.iso + ':' + sec;
      if (!synced[key]) synced[key] = { at: sec * 1000 - Math.random() * 3000, done: false };
      if (!synced[key].done && left <= synced[key].at) { synced[key].done = true; refresh(true); }
    });
  }

  function tick() {
    if (!data) return;
    var sig = phasesSig();
    if (sig !== lastPhases) {
      var wasBefore = lastPhases.indexOf(':before:') >= 0;
      var s = summary();
      // 画面を作り直す（フォームは作り直さないので、入力は消えない）
      renderEvent();
      if (!$('#v-form').hidden) updateForm();
      if (wasBefore && s.open.length) refresh(true);
      return;
    }
    var s2 = summary(), next = nextOpen(s2.before), el = $('#count');
    if (next) syncBeforeOpen(next);
    if (el && next) el.textContent = countdownText(next.t - serverNow());
  }

  function init() {
    app.innerHTML =
      '<section class="frame" id="v-event" hidden><div id="event-body"></div></section>' +
      '<section class="frame" id="v-form" hidden></section>' +
      '<section class="frame" id="v-done" hidden></section>' +
      '<section class="frame" id="v-message"></section>' +
      '<div class="overlay" id="busy" hidden role="status"><div class="dialog"><div class="spin"></div>' +
      '<p style="font-weight:700;font-size:18px;margin:0">' + BUSY_TEXT + '</p>' +
      '<p class="muted">画面を閉じたり、もう一度ボタンを押したりしなくて大丈夫です。</p></div></div>';
    if (!CFG.API_URL) {
      message('ただいま準備中です', 'エントリーのしくみの設定がまだ終わっていないため、このページは使えません。運営にお問い合わせください。', false);
      return;
    }
    // 読み込み中は、文字だけでなくカードの形の灰色の見本（スケルトン）を出す（2026-11-27 指示 D3）。index.html の最初の表示と同じ形
    $('#v-message').innerHTML = '<div class="skel" role="status" aria-busy="true"><span class="sk-sr">大会の情報を読み込んでいます</span>' +
      '<div class="sk sk-h"></div><div class="sk sk-l" style="width:45%"></div><div class="sk sk-l" style="width:70%"></div><div class="sk sk-l" style="width:60%"></div>' +
      '<div class="sk sk-b"></div><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div>';
    show('v-message');
    api = root.ApiClient.create({
      url: CFG.API_URL,
      fetch: function (u, o) { return root.fetch(u, o); },
      sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
      random: Math.random
    });
    fetchPublic().then(function (res) {
      if (!res || !res.ok) throw new Error('bad');
      apply(res);
      show('v-event');
      setInterval(tick, 1000);
    }).catch(function () {
      message('読み込めませんでした', '大会の情報を読み込めませんでした。通信状況を確認して、もう一度お試しください。', true);
    });
  }

  init();
})(this);

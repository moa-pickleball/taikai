// 受付サーバー（Apps Script）との通信。混雑・通信エラーのときは自動でやり直す
(function (root) {
  'use strict';

  var MAX_TRIES = 20;
  var GIVE_UP = '混雑のため送信できませんでした。少し時間をおいて、もう一度「送信」を押してください（入力はそのまま残っています）';

  function create(deps) {
    function getPublic() {
      return deps.fetch(deps.url + '?action=public', { method: 'GET' }).then(function (res) { return res.json(); });
    }

    // body（requestId を含む）は、やり直しても変えない
    function post(body, opts) {
      var payload = JSON.stringify(body);
      var onRetry = opts && opts.onRetry;
      // retryOnNetworkError:false …通信エラー・JSONでない返事は、やり直さず err.code==='network' で終える（届いたか分からない書き込み用。busy は届いていないので、これまで通りやり直す）
      var noNetRetry = !!opts && opts.retryOnNetworkError === false;
      var tries = 0;
      function attempt() {
        tries++;
        return deps.fetch(deps.url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: payload
        }).then(function (res) { return res.json(); }).then(
          function (json) { return json && json.busy === true ? { retry: true } : { value: json }; },
          function () { return { retry: true, net: true }; }
        ).then(function (r) {
          if (!r.retry) return r.value;
          if (r.net && noNetRetry) { var e = new Error('通信の結果が分かりません。'); e.code = 'network'; throw e; }
          if (tries >= MAX_TRIES) throw new Error(GIVE_UP);
          if (onRetry) onRetry(tries);
          return deps.sleep(1000 + deps.random() * 2000).then(attempt);
        });
      }
      return attempt();
    }

    return { getPublic: getPublic, post: post };
  }

  root.ApiClient = { create: create };
})(this);

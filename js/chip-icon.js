// 状態の札（chip）に添える小さな線のアイコン（2026-11-27 指示 D2）。色だけに頼らず、形でも状態が分かるように
// アイコンは飾りなので aria-hidden。意味は今まで通り札の文字で伝える。絵文字は使わない
(function (root) {
  'use strict';
  var P = {
    check: '<path d="M3.5 8.5l3 3 6-7"/>',                                         // 受付中（残りあり）・確定
    clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2.2 1.6"/>',          // 受付前
    queue: '<path d="M3 4.5h10M3 8h7M3 11.5h4"/>',                                 // 満枠・キャンセル待ち（列に並ぶ）
    x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'                                    // 受付終了・キャンセル
  };
  function svg(name) {
    if (!P[name]) return '';
    return '<svg class="chip-i" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + P[name] + '</svg>';
  }
  root.ChipIcon = { svg: svg };
})(this);

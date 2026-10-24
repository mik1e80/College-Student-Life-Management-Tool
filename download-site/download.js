(async function () {
  'use strict';
  var ua = navigator.userAgent;
  document.getElementById('browser-hint').hidden = !/MicroMessenger|QQ\//i.test(ua);
  document.getElementById('ios-hint').hidden = !/iPhone|iPad|iPod/i.test(ua);
  try {
    var response = await fetch('release.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('metadata unavailable');
    var release = await response.json();
    if (!release.verified || !/^[a-f0-9]{64}$/.test(release.sha256)) throw new Error('invalid metadata');
    document.getElementById('release-meta').textContent = release.version + ' · ' + (release.bytes / 1024 / 1024).toFixed(2) + ' MB · Android ' + release.minAndroid + ' 及以上';
    document.getElementById('sha256').textContent = 'SHA-256：' + release.sha256;
  } catch (_) {
    document.getElementById('status').textContent = '暂时未读到版本信息，请确认此下载页已完整部署。';
    document.getElementById('sha256').textContent = '校验信息暂不可用，请稍后重试。';
  }
}());

'use strict';

// ==================== PRUEBA VISUAL INMEDIATA ====================
(function() {
  var msg = document.createElement('div');
  msg.id = 'renderer-status';
  msg.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ff0000;color:#fff;padding:20px;text-align:center;font-size:18px;font-weight:bold;z-index:99999;';
  msg.innerHTML = '✅ RENDERER.JS CARGADO - ' + new Date().toLocaleTimeString();
  if (document.body) {
    document.body.appendChild(msg);
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      document.body.appendChild(msg);
    });
  }
  console.log('[PRUEBA] ✓ Renderer.js está ejecutándose');
})();

// ==================== PRUEBA INMEDIATA ====================
(function() {
  var testDiv = document.createElement('div');
  testDiv.id = 'app-status';
  testDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#f0b90b;color:#000;padding:40px;font-size:28px;font-weight:bold;z-index:99999;border-radius:15px;box-shadow:0 0 100px rgba(240,185,11,0.8);text-align:center;';
  testDiv.innerHTML = '✅ APP FUNCIONANDO<br><span style="font-size:16px">Esperando datos de Binance...</span><br><span style="font-size:12px">Alt+D = Debug | Alt+Shift+D = DevTools</span>';
  if (document.body) {
    document.body.appendChild(testDiv);
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      document.body.appendChild(testDiv);
    });

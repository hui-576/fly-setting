/* 本地内联 Lucide 图标(离线)。仅取原型所需子集。
   用法: icon('map') 返回 <svg> 字符串; iconify(root) 替换 [data-icon] 占位。 */
(function (global) {
  'use strict';
  var P = 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"';
  var PATHS = {
    map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15"/><path d="M15 6v15"/>',
    layers: '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
    'zoom-in': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
    'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>',
    locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    box: '<path d="M21 8V6a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 6v12a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 18z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    'rotate-3d': '<path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 2v6l4-2"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    'trash-2': '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.6-.8L9.5 4H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2z"/>',
    'file-plus': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 12v6M9 15h6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    'map-pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    crosshair: '<circle cx="12" cy="12" r="9"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    shapes: '<path d="M8.3 10a.7.7 0 0 1-.6-1l3.7-6.3a.7.7 0 0 1 1.2 0l3.7 6.3a.7.7 0 0 1-.6 1z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
    play: '<path d="M6 3l14 9-14 9z"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/>',
    'alert-triangle': '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    loader: '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.2 16.2l2.9 2.9M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.2 7.8l2.9-2.9"/>',
    filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M9.9 5A11 11 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 4-.7"/><path d="M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    signal: '<path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16"/>',
    radio: '<circle cx="12" cy="12" r="2"/><path d="M4.9 19.1a10 10 0 0 1 0-14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    mountain: '<path d="m8 3 4 8 5-5 5 15H2z"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/>',
    route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h5a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h5"/>',
    'refresh-cw': '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    archive: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    'panel-left': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    'panel-right': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
    bug: '<path d="M8 2l1.5 1.5M16 2l-1.5 1.5"/><path d="M9 7.5A4 4 0 0 1 15 7.5"/><rect x="7" y="8" width="10" height="10" rx="5"/><path d="M12 18v3M7 12H3M21 12h-4M6 16l-2.5 2M18 16l2.5 2M6 8 3.5 6M18 8l2.5-2"/>',
    minus: '<path d="M5 12h14"/>',
    move: '<path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
    ruler: '<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z"/><path d="m14.5 4 2 2M11 7.5l2 2M7.5 11l2 2M4 14.5l2 2"/>'
  };
  function icon(name, cls) {
    var body = PATHS[name] || PATHS.info;
    return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" ' + P +
      ' width="16" height="16" aria-hidden="true">' + body + '</svg>';
  }
  function iconify(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
      if (el.dataset.done) return;
      el.innerHTML = icon(el.getAttribute('data-icon'), el.getAttribute('data-icon-cls') || '');
      el.dataset.done = '1';
    });
  }
  global.LucideMini = { icon: icon, iconify: iconify };
})(window);

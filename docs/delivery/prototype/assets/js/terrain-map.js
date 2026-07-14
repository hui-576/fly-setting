/* ============================================================================
 * terrain-map.js — 卫星底图 + 本地三维地形视距引擎
 * ----------------------------------------------------------------------------
 * 俯视模式加载真实 Esri 卫星影像；候选点可达性与 30km 覆盖仍由本地
 * 高程场和 LOS 射线遮挡算法计算，三维模式用于呈现这一分析层。
 *   - 对外暴露的接口刻意贴近 Mars3D 用法(pickHeight / addGraphic /
 *     flyTo / setViewMode 等), README 说明如何替换为真实 Mars3D。
 *
 * 坐标系: 使用经纬度(WGS84 近似)。内部把可视范围映射到 canvas 像素。
 *   height(lng,lat) -> 地形海拔(米), 由多个高斯山体 + 河谷 + 噪声合成,
 *   并可叠加 DSM 地表障碍(建筑/植被)。
 * ==========================================================================*/
(function (global) {
  'use strict';

  // ---- 高程场定义(江夏丘陵-湖泊风格: 低平原 + 数座真实山丘 + 梁子湖水域) ----
  // 山丘布置在任务点之间, 使部分视距在低档位被遮挡、高档位放行, 形成真实的
  // "最低升空高度"与混合覆盖结果。amp(米) 为相对平原的抬升, sigma(度) 为范围。
  // 每个山体: {lng,lat,amp(米),sigma(度)}
  var PEAKS = [
    { lng: 114.243, lat: 30.421, amp: 322, sigma: 0.020 }, // 八分山
    { lng: 114.305, lat: 30.412, amp: 268, sigma: 0.017 }, // 龙泉山
    { lng: 114.332, lat: 30.399, amp: 196, sigma: 0.013 }, // 中部矮岭(遮挡前指与东岸)
    { lng: 114.286, lat: 30.372, amp: 234, sigma: 0.016 }, // 西南丘
    { lng: 114.208, lat: 30.352, amp: 388, sigma: 0.026 }, // 郑店西高地
    { lng: 114.360, lat: 30.360, amp: 150, sigma: 0.012 }, // 五里界岗地
    { lng: 114.150, lat: 30.300, amp: 300, sigma: 0.030 }  // 法泗西南山
  ];
  // 水域下切: 梁子湖 / 汤逊湖 一线(降低高程, 视觉呈水面)
  var RIVER = [
    { lng: 114.286, lat: 30.433 }, { lng: 114.320, lat: 30.400 },
    { lng: 114.352, lat: 30.378 }, { lng: 114.390, lat: 30.352 },
    { lng: 114.430, lat: 30.330 }
  ];

  function baseHeight(lng, lat) {
    var h = 32; // 江夏平原基准海拔(米)
    for (var i = 0; i < PEAKS.length; i++) {
      var p = PEAKS[i];
      var dx = (lng - p.lng), dy = (lat - p.lat);
      var d2 = (dx * dx + dy * dy) / (2 * p.sigma * p.sigma);
      h += p.amp * Math.exp(-d2);
    }
    // 湖面下切
    var rd = riverDist(lng, lat);
    h -= 34 * Math.exp(-(rd * rd) / (2 * 0.018 * 0.018));
    // 程序化细节(确定性噪声, 保证每次一致)
    h += 26 * fbm(lng * 9.5, lat * 9.5);
    return Math.max(14, h);
  }

  function riverDist(lng, lat) {
    var best = 1e9;
    for (var i = 0; i < RIVER.length - 1; i++) {
      best = Math.min(best, segDist(lng, lat, RIVER[i], RIVER[i + 1]));
    }
    return best;
  }
  function segDist(px, py, a, b) {
    var vx = b.lng - a.lng, vy = b.lat - a.lat;
    var wx = px - a.lng, wy = py - a.lat;
    var t = (vx || vy) ? (wx * vx + wy * vy) / (vx * vx + vy * vy) : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = a.lng + t * vx, cy = a.lat + t * vy;
    return Math.hypot(px - cx, py - cy);
  }
  // 确定性伪噪声
  function hash(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }
  function noise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash(xi, yi), b = hash(xi + 1, yi);
    var c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y) {
    var t = 0, amp = 0.5, f = 1;
    for (var i = 0; i < 4; i++) { t += amp * (noise(x * f, y * f) * 2 - 1); f *= 2; amp *= 0.5; }
    return t;
  }

  // ---- DSM 地表障碍(建筑群/林地): 局部抬升 -------------------------------
  var OBSTACLES = [
    { lng: 114.354, lat: 30.421, r: 0.016, h: 62 },  // 藏龙岛科技园高楼群
    { lng: 114.325, lat: 30.391, r: 0.012, h: 34 },  // 江夏大道沿线建筑
    { lng: 114.298, lat: 30.416, r: 0.020, h: 28 },  // 龙泉山林地
    { lng: 114.318, lat: 30.406, r: 0.010, h: 40 },  // 前指附近楼宇
    { lng: 114.307, lat: 30.374, r: 0.014, h: 22 }   // 沿湖村植被
  ];
  function surfaceAdd(lng, lat) {
    var add = 0;
    for (var i = 0; i < OBSTACLES.length; i++) {
      var o = OBSTACLES[i];
      var d = Math.hypot(lng - o.lng, lat - o.lat);
      if (d < o.r) add = Math.max(add, o.h * (1 - d / o.r));
    }
    return add;
  }

  // ============================ TerrainMap ==================================
  function TerrainMap(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    opts = opts || {};
    // 视图: 中心经纬度 + 每像素度数(zoom) + 视角模式
    this.center = { lng: 114.312, lat: 30.398 };  // 武汉江夏, 与任务点一致
    this.degPerPx = 0.00028;         // 缩放(江夏城区尺度)
    this.mode = 'top';               // '3d' | 'top'
    this.dataMode = 'DSM';           // 'DTM' | 'DSM'
    this.layers = { imagery: true, terrain: true, obstacle: true, roads: true, markers: true, coverage: true, legend: true };
    this._tiles = {};
    this.graphics = [];              // 覆盖层图元
    this.coverage = null;            // 30km 覆盖栅格
    this.drawPoly = null;            // 正在/已绘制多边形 [{lng,lat}]
    this.roadCorridor = null;        // 道路缓冲候选范围
    this.hover = null;
    this._listeners = {};
    this._dpr = Math.min(2, global.devicePixelRatio || 1);
    this._raf = null;
    this._loaded = false;
    this._bindInput();
    this.resize();
  }

  TerrainMap.prototype.on = function (ev, fn) {
    (this._listeners[ev] = this._listeners[ev] || []).push(fn); return this;
  };
  TerrainMap.prototype._emit = function (ev, arg) {
    (this._listeners[ev] || []).forEach(function (f) { f(arg); });
  };

  // ---- 地形查询(对外, 类 Mars3D pickHeight) -----------------------------
  TerrainMap.prototype.terrainHeight = function (lng, lat) { return baseHeight(lng, lat); };
  TerrainMap.prototype.surfaceHeight = function (lng, lat) {
    return baseHeight(lng, lat) + surfaceAdd(lng, lat);
  };
  // 依据当前遮挡模式返回用于 LOS 的地表高
  TerrainMap.prototype.sampleHeight = function (lng, lat, mode) {
    var m = mode || this.dataMode;
    return m === 'DSM' ? this.surfaceHeight(lng, lat) : this.terrainHeight(lng, lat);
  };

  // ---- 坐标 <-> 像素 -----------------------------------------------------
  TerrainMap.prototype.lngLatToPx = function (lng, lat) {
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    var x = w / 2 + (lng - this.center.lng) / this.degPerPx;
    var y = h / 2 - (lat - this.center.lat) / (this.degPerPx * 0.8);
    if (this.mode === '3d') {
      // 简单斜俯视投影: 上部压缩, 产生纵深
      var ny = (y - h / 2) / (h / 2);        // -1..1
      var persp = 1 + ny * 0.35;
      x = w / 2 + (x - w / 2) * persp;
      y = h * 0.30 + (y) * 0.62;
    }
    return { x: x, y: y };
  };
  TerrainMap.prototype.pxToLngLat = function (x, y) {
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    var yy = y, xx = x;
    if (this.mode === '3d') {
      yy = (y - h * 0.30) / 0.62;
      var ny = (yy - h / 2) / (h / 2);
      var persp = 1 + ny * 0.35;
      xx = w / 2 + (x - w / 2) / persp;
    }
    var lng = this.center.lng + (xx - w / 2) * this.degPerPx;
    var lat = this.center.lat - (yy - h / 2) * this.degPerPx * 0.8;
    return { lng: lng, lat: lat };
  };

  // ---- 视距分析(核心): P1 天线 -> P2 接收, 判断地形是否遮挡 ----------------
  // 返回 { clear:Boolean, clearance:米(最小余隙, 负=被挡) }
  TerrainMap.prototype.lineOfSight = function (a, b, opts) {
    opts = opts || {};
    var k = opts.k || (4 / 3);
    var mode = opts.mode || this.dataMode;
    var R = 6371000 * k;                 // 有效地球半径
    var steps = opts.steps || 90;
    var h1 = this.sampleHeight(a.lng, a.lat, mode) + (a.agl || 0);
    var h2 = this.sampleHeight(b.lng, b.lat, mode) + (b.agl || 0);
    var totalKm = geoKm(a, b);
    var minClear = Infinity;
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var lng = a.lng + (b.lng - a.lng) * t;
      var lat = a.lat + (b.lat - a.lat) * t;
      var ground = this.sampleHeight(lng, lat, mode);
      // 视线在该点的直线高度
      var sight = h1 + (h2 - h1) * t;
      // 地球曲率下沉(米): d1*d2/(2R)
      var d1 = totalKm * 1000 * t, d2 = totalKm * 1000 * (1 - t);
      var bulge = (d1 * d2) / (2 * R);
      var clearance = sight - (ground + bulge);
      if (clearance < minClear) minClear = clearance;
    }
    return { clear: minClear >= 0, clearance: minClear, distKm: totalKm };
  };

  // 给定候选点与一组任务点, 找到"可达"所需的最低高度(逐档爬升)
  // 返回 { partialH, fullH, reached:[idx], missed:[idx] }
  TerrainMap.prototype.solveCandidate = function (site, tasks, params) {
    var tiers = params.tiers || [0, 50, 100, 150, 200, 250];
    var k = params.k, mode = params.mode;
    var per = tasks.map(function () { return { minH: null }; });
    for (var ti = 0; ti < tiers.length; ti++) {
      for (var j = 0; j < tasks.length; j++) {
        if (per[j].minH != null) continue;
        var los = this.lineOfSight(
          { lng: site.lng, lat: site.lat, agl: tiers[ti] },
          { lng: tasks[j].lng, lat: tasks[j].lat, agl: tasks[j].agl },
          { k: k, mode: mode }
        );
        if (los.clear) per[j].minH = tiers[ti];
      }
    }
    var reached = [], missed = [], maxH = 0;
    per.forEach(function (p, j) {
      if (p.minH != null) { reached.push(j); maxH = Math.max(maxH, p.minH); }
      else missed.push(j);
    });
    var full = missed.length === 0 ? maxH : null;
    // 部分覆盖高度: 达成至少一个任务点的最低高度
    var partial = null;
    var reachHeights = reached.map(function (j) { return per[j].minH; });
    if (reachHeights.length) partial = Math.min.apply(null, reachHeights);
    return { partialH: partial, fullH: full, reached: reached, missed: missed, perTask: per };
  };

  // ---- 30km 连续覆盖栅格(接收端在网格上, 判断能否与升空点通信) -----------
  TerrainMap.prototype.computeCoverage = function (site, params, gridN) {
    gridN = gridN || 46;
    var rangeDeg = 0.30;              // ~30km 边长半径(粗略)
    var cells = [];
    for (var iy = 0; iy < gridN; iy++) {
      for (var ix = 0; ix < gridN; ix++) {
        var lng = site.lng - rangeDeg + (ix / (gridN - 1)) * rangeDeg * 2;
        var lat = site.lat - rangeDeg + (iy / (gridN - 1)) * rangeDeg * 2;
        var dKm = geoKm(site, { lng: lng, lat: lat });
        if (dKm > 30) continue;
        var los = this.lineOfSight(
          { lng: site.lng, lat: site.lat, agl: params.droneH },
          { lng: lng, lat: lat, agl: params.rxH },
          { k: params.k, mode: params.mode, steps: 60 }
        );
        cells.push({ lng: lng, lat: lat, ok: los.clear });
      }
    }
    var okN = cells.filter(function (c) { return c.ok; }).length;
    this.coverage = { site: site, cells: cells, gridN: gridN, rangeDeg: rangeDeg,
      areaKm2: +(okN / cells.length * Math.PI * 30 * 30).toFixed(0), params: params };
    this.render();
    return this.coverage;
  };
  TerrainMap.prototype.clearCoverage = function () { this.coverage = null; this.render(); };

  // ---- 图元管理(类 Mars3D graphicLayer) ---------------------------------
  TerrainMap.prototype.addGraphic = function (g) { this.graphics.push(g); this.render(); return g; };
  TerrainMap.prototype.clearGraphics = function (type) {
    this.graphics = type ? this.graphics.filter(function (g) { return g.type !== type; }) : [];
    this.render();
  };
  TerrainMap.prototype.setGraphics = function (arr) { this.graphics = arr.slice(); this.render(); };

  // ---- 视图控制 ----------------------------------------------------------
  TerrainMap.prototype.setViewMode = function (m) { this.mode = m; this.render(); };
  TerrainMap.prototype.setDataMode = function (m) { this.dataMode = m; this.render(); };
  TerrainMap.prototype.zoom = function (factor) {
    this.degPerPx = Math.max(0.00012, Math.min(0.004, this.degPerPx * factor));
    this.render();
  };
  TerrainMap.prototype.flyTo = function (lng, lat) {
    this.center = { lng: lng, lat: lat }; this.render();
  };
  TerrainMap.prototype.toggleLayer = function (name, on) {
    this.layers[name] = (on == null) ? !this.layers[name] : on; this.render();
  };

  // ---- 输入交互 ----------------------------------------------------------
  TerrainMap.prototype._bindInput = function () {
    var self = this, c = this.canvas, dragging = false, last = null;
    c.addEventListener('mousedown', function (e) {
      dragging = true; last = { x: e.clientX, y: e.clientY }; c.style.cursor = 'grabbing';
    });
    global.addEventListener('mouseup', function () { dragging = false; c.style.cursor = ''; });
    global.addEventListener('mousemove', function (e) {
      if (!dragging || !last) return;
      var dx = e.clientX - last.x, dy = e.clientY - last.y;
      self.center.lng -= dx * self.degPerPx;
      self.center.lat += dy * self.degPerPx * 0.8;
      last = { x: e.clientX, y: e.clientY };
      self.render();
    });
    c.addEventListener('mousemove', function (e) {
      var r = c.getBoundingClientRect();
      self.hover = self.pxToLngLat(e.clientX - r.left, e.clientY - r.top);
      self._emit('hover', self.hover);
      if (self._pickMode) self.render();
    });
    c.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.zoom(e.deltaY > 0 ? 1.12 : 0.89);
    }, { passive: false });
    c.addEventListener('click', function (e) {
      if (dragging) return;
      var r = c.getBoundingClientRect();
      var ll = self.pxToLngLat(e.clientX - r.left, e.clientY - r.top);
      self._emit('click', ll);
    });
  };
  TerrainMap.prototype.setPickCursor = function (on) {
    this._pickMode = on; this.canvas.style.cursor = on ? 'crosshair' : '';
  };

  // ---- 渲染 --------------------------------------------------------------
  TerrainMap.prototype.resize = function () {
    var c = this.canvas, dpr = this._dpr;
    var w = c.clientWidth, h = c.clientHeight;
    c.width = Math.max(1, w * dpr); c.height = Math.max(1, h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  };
  TerrainMap.prototype.setLoaded = function (v) { this._loaded = v; this.render(); };

  TerrainMap.prototype.render = function () {
    if (this._raf) return;
    var self = this;
    this._raf = requestAnimationFrame(function () { self._raf = null; self._draw(); });
  };

  function hgtColor(h, shade) {
    // 高程配色: 深绿(低) -> 黄绿 -> 棕(高) -> 近白(峰), 冷静专业
    var t = Math.max(0, Math.min(1, (h - 20) / 400));
    var stops = [
      [46, 92, 74], [82, 120, 78], [138, 150, 96],
      [168, 150, 112], [150, 128, 104], [206, 206, 200]
    ];
    var seg = t * (stops.length - 1);
    var i = Math.floor(seg), f = seg - i;
    var a = stops[i], b = stops[Math.min(stops.length - 1, i + 1)];
    var r = a[0] + (b[0] - a[0]) * f, g = a[1] + (b[1] - a[1]) * f, bl = a[2] + (b[2] - a[2]) * f;
    var s = 0.72 + shade * 0.4;
    return 'rgb(' + (r * s | 0) + ',' + (g * s | 0) + ',' + (bl * s | 0) + ')';
  }

  function tileXY(lng, lat, zoom) {
    var n = Math.pow(2, zoom), rad = Math.PI / 180;
    var clipped = Math.max(-85.0511, Math.min(85.0511, lat));
    return {
      x: (lng + 180) / 360 * n,
      y: (1 - Math.asinh(Math.tan(clipped * rad)) / Math.PI) / 2 * n
    };
  }

  function tileLngLat(x, y, zoom) {
    var n = Math.pow(2, zoom), lng = x / n * 360 - 180;
    var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    return { lng: lng, lat: lat };
  }

  TerrainMap.prototype._draw = function () {
    var ctx = this.ctx, w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!this._loaded) { this._drawLoading(ctx, w, h); return; }

    if (this.mode === 'top' && this.layers.imagery) {
      this._drawBasemap(ctx, w, h);
    } else if (this.layers.terrain) {
      // 地形栅格(下采样以保证性能)
      var step = 12;
      var cols = Math.ceil(w / step), rows = Math.ceil(h / step);
      for (var iy = 0; iy < rows; iy++) {
        for (var ix = 0; ix < cols; ix++) {
          var px = ix * step, py = iy * step;
          var ll = this.pxToLngLat(px + step / 2, py + step / 2);
          var hh = this.layers.obstacle && this.dataMode === 'DSM'
            ? this.surfaceHeight(ll.lng, ll.lat) : this.terrainHeight(ll.lng, ll.lat);
          // 山体阴影: East-West 高程梯度
          var hx = this.terrainHeight(ll.lng + this.degPerPx * step, ll.lat);
          var shade = Math.max(-0.5, Math.min(0.6, (hh - hx) / 26));
          ctx.fillStyle = hgtColor(hh, shade);
          ctx.fillRect(px, py, step + 1, step + 1);
        }
      }
    }

    // 河流
    this._drawRiver(ctx);
    // 道路走廊(升空限制模式一)
    if (this.layers.roads && this.roadCorridor) this._drawCorridor(ctx);
    // 30km 覆盖栅格
    if (this.layers.coverage && this.coverage) this._drawCoverage(ctx);
    // 绘制多边形(升空限制模式二)
    if (this.drawPoly) this._drawPolygon(ctx);
    // 覆盖图元(候选点/任务点由 app 以 graphics 传入)
    if (this.layers.markers) this._drawGraphics(ctx);
    if (this.mode === '3d') this._drawGrat(ctx, w, h);
  };

  TerrainMap.prototype._drawBasemap = function (ctx, w, h) {
    var zoom = Math.max(3, Math.min(18, Math.round(Math.log(360 / (this.degPerPx * 256)) / Math.LN2)));
    var topLeft = this.pxToLngLat(0, 0), bottomRight = this.pxToLngLat(w, h);
    var min = tileXY(topLeft.lng, topLeft.lat, zoom), max = tileXY(bottomRight.lng, bottomRight.lat, zoom);
    var minX = Math.floor(Math.min(min.x, max.x)), maxX = Math.floor(Math.max(min.x, max.x));
    var minY = Math.floor(Math.min(min.y, max.y)), maxY = Math.floor(Math.max(min.y, max.y));
    var tileCount = Math.pow(2, zoom);
    ctx.fillStyle = '#d8e3dd'; ctx.fillRect(0, 0, w, h);
    for (var y = minY; y <= maxY; y++) {
      if (y < 0 || y >= tileCount) continue;
      for (var x = minX; x <= maxX; x++) {
        var wrapX = ((x % tileCount) + tileCount) % tileCount;
        var key = zoom + '/' + wrapX + '/' + y;
        var tile = this._getTile(key, zoom, wrapX, y);
        var northWest = tileLngLat(wrapX, y, zoom), southEast = tileLngLat(wrapX + 1, y + 1, zoom);
        var a = this.lngLatToPx(northWest.lng, northWest.lat), b = this.lngLatToPx(southEast.lng, southEast.lat);
        var width = b.x - a.x, height = b.y - a.y;
        if (tile.loaded) ctx.drawImage(tile.image, a.x, a.y, width, height);
        else {
          ctx.fillStyle = ((x + y) % 2 ? '#d4ddd7' : '#c8d4cd');
          ctx.fillRect(a.x, a.y, width + 1, height + 1);
        }
      }
    }
  };

  TerrainMap.prototype._getTile = function (key, zoom, x, y) {
    var cached = this._tiles[key];
    if (cached) return cached;
    cached = this._tiles[key] = { image: null, loaded: false, offlinePrototype: true };
    return cached;
  };

  TerrainMap.prototype._drawLoading = function (ctx, w, h) {
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(148,163,184,.9)';
    ctx.font = '13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    var msg = this._loadFail ? '地图图层加载失败 — 点击“重试”' : '正在加载地形与影像图层…';
    ctx.fillText(msg, w / 2, h / 2);
    if (!this._loadFail) {
      var t = (Date.now() % 1400) / 1400;
      ctx.strokeStyle = 'rgba(59,130,246,.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(w / 2, h / 2 - 34, 16, t * 6.28, t * 6.28 + 4.4); ctx.stroke();
      this.render();
    }
  };

  TerrainMap.prototype._drawGrat = function (ctx, w, h) {
    ctx.strokeStyle = 'rgba(15,23,42,.06)'; ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(15,23,42,.45)'; ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    var tl = this.pxToLngLat(0, 0), br = this.pxToLngLat(w, h);
    var stepLng = niceStep((br.lng - tl.lng) / 6);
    for (var lng = Math.ceil(tl.lng / stepLng) * stepLng; lng < br.lng; lng += stepLng) {
      var p = this.lngLatToPx(lng, this.center.lat);
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, h); ctx.stroke();
      ctx.fillText(lng.toFixed(2) + '°E', p.x + 3, h - 6);
    }
    var stepLat = niceStep((tl.lat - br.lat) / 5);
    for (var lat = Math.ceil(br.lat / stepLat) * stepLat; lat < tl.lat; lat += stepLat) {
      var q = this.lngLatToPx(this.center.lng, lat);
      ctx.beginPath(); ctx.moveTo(0, q.y); ctx.lineTo(w, q.y); ctx.stroke();
      ctx.fillText(lat.toFixed(2) + '°N', 4, q.y - 4);
    }
  };

  TerrainMap.prototype._drawRiver = function (ctx) {
    ctx.strokeStyle = 'rgba(56,120,170,.55)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath();
    for (var i = 0; i < RIVER.length; i++) {
      var p = this.lngLatToPx(RIVER[i].lng, RIVER[i].lat);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    }
    ctx.stroke();
  };

  TerrainMap.prototype._drawCorridor = function (ctx) {
    var pts = this.roadCorridor;
    ctx.strokeStyle = 'rgba(37,99,235,.9)'; ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(37,99,235,.10)';
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var p = this.lngLatToPx(pts[i].lng, pts[i].lat);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  };

  TerrainMap.prototype._drawPolygon = function (ctx) {
    var pts = this.drawPoly;
    if (!pts.length) return;
    ctx.fillStyle = 'rgba(37,99,235,.12)';
    ctx.strokeStyle = 'rgba(37,99,235,.95)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var p = this.lngLatToPx(pts[i].lng, pts[i].lat);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    }
    if (pts.length > 2) ctx.closePath();
    ctx.fill(); ctx.stroke();
    // 顶点
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2563eb';
    for (var j = 0; j < pts.length; j++) {
      var q = this.lngLatToPx(pts[j].lng, pts[j].lat);
      ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, 6.28); ctx.fill(); ctx.stroke();
    }
  };

  TerrainMap.prototype._drawCoverage = function (ctx) {
    var cov = this.coverage, cells = cov.cells;
    var sz = 9;
    ctx.globalAlpha = (this.coverageAlpha == null ? 0.55 : this.coverageAlpha);
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var p = this.lngLatToPx(c.lng, c.lat);
      ctx.fillStyle = c.ok ? 'rgba(22,163,74,.9)' : 'rgba(220,38,38,.85)';
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    // 30km 环
    var edge = this.lngLatToPx(cov.site.lng, cov.site.lat + cov.rangeDeg);
    var mid = this.lngLatToPx(cov.site.lng, cov.site.lat);
    ctx.strokeStyle = 'rgba(15,23,42,.5)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mid.x, mid.y, Math.abs(mid.y - edge.y), 0, 6.28); ctx.stroke();
    ctx.setLineDash([]);
  };

  TerrainMap.prototype._drawGraphics = function (ctx) {
    for (var i = 0; i < this.graphics.length; i++) {
      var g = this.graphics[i];
      var p = this.lngLatToPx(g.lng, g.lat);
      if (g.type === 'task') this._pin(ctx, p, g, '#2563eb');
      else if (g.type === 'candidate') {
        var col = g.grade === 'full' ? '#16a34a' : '#f59e0b';
        this._diamond(ctx, p, col, g.selected);
      }
    }
  };

  TerrainMap.prototype._pin = function (ctx, p, g, col) {
    ctx.save();
    ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.bezierCurveTo(p.x - 9, p.y - 11, p.x - 8, p.y - 22, p.x, p.y - 22);
    ctx.bezierCurveTo(p.x + 8, p.y - 22, p.x + 9, p.y - 11, p.x, p.y);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y - 15, 3.4, 0, 6.28); ctx.fill();
    if (g.label) {
      ctx.fillStyle = 'rgba(15,23,42,.9)'; ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      var tw = ctx.measureText(g.label).width;
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fillRect(p.x - tw / 2 - 4, p.y + 2, tw + 8, 14);
      ctx.fillStyle = 'rgba(15,23,42,.9)';
      ctx.fillText(g.label, p.x, p.y + 13);
    }
    ctx.restore();
  };

  TerrainMap.prototype._diamond = function (ctx, p, col, selected) {
    ctx.save();
    var r = selected ? 9 : 6;
    if (selected) {
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, 6.28); ctx.stroke();
    }
    ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y);
    ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  };

  // ---- 工具函数 ----------------------------------------------------------
  function geoKm(a, b) {
    var R = 6371, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    var la1 = a.lat * toR, la2 = b.lat * toR;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function niceStep(v) {
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }

  global.TerrainMap = TerrainMap;
  global.GeoUtil = { km: geoKm };
})(window);

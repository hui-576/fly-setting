(function (global) {
  'use strict';

  var icon = function (name) { return global.LucideMini.icon(name); };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char];
    });
  }

  function renderTasks(state) {
    var active = state.tasks.filter(function (task) { return !task.deleted; });
    var deleted = state.tasks.filter(function (task) { return task.deleted; });
    el('taskList').innerHTML = active.map(function (task) {
      var selected = task.id === state.currentTaskId ? ' sel' : '';
      var status = task.archived ? 'archived' : 'active';
      var statusText = task.archived ? '已归档' : task.version;
      return '<div class="list-item' + selected + '" data-task-id="' + task.id + '">' +
        '<span class="li-ic">' + icon(task.archived ? 'archive' : 'folder') + '</span>' +
        '<div class="li-main"><div class="li-title">' + escapeHtml(task.name) + '</div>' +
        '<div class="li-sub">' + escapeHtml(task.note) + ' · ' + task.modified + '</div></div>' +
        '<span class="tag ' + status + '">' + statusText + '</span>' +
        '<div class="li-actions"><button class="iconbtn" data-task-copy="' + task.id + '" title="复制任务">' + icon('copy') + '</button>' +
        '<button class="iconbtn" data-task-delete="' + task.id + '" title="移至回收站">' + icon('trash') + '</button></div></div>';
    }).join('');
    el('trashList').innerHTML = deleted.map(function (task) {
      return '<div class="list-item" data-task-id="' + task.id + '"><span class="li-ic">' + icon('trash') + '</span>' +
        '<div class="li-main"><div class="li-title">' + escapeHtml(task.name) + '</div>' +
        '<div class="li-sub">' + escapeHtml(task.note) + '</div></div>' +
        '<button class="btn sm" data-task-restore="' + task.id + '">恢复</button></div>';
    }).join('');
    el('trashCount').textContent = deleted.length;
    var current = state.tasks.find(function (task) { return task.id === state.currentTaskId; }) || active[0];
    if (current) {
      el('topTaskName').textContent = current.name;
      el('topTaskVer').textContent = current.version;
    }
  }

  function renderPoints(state) {
    el('pointList').innerHTML = state.points.map(function (point) {
      return '<div class="list-item" data-point-id="' + point.id + '"><span class="li-ic">' + icon('map-pin') + '</span>' +
        '<div class="li-main"><div class="li-title">' + escapeHtml(point.name) + '</div>' +
        '<div class="li-sub mono">' + point.lon.toFixed(5) + ', ' + point.lat.toFixed(5) + ' · 天线 ' + point.antenna.toFixed(1) + 'm</div></div>' +
        '<div class="li-actions"><button class="iconbtn" data-point-delete="' + point.id + '" title="删除任务点">' + icon('trash') + '</button></div></div>';
    }).join('');
    el('pointCount').textContent = state.points.length + ' / 50';
    el('tabPointsBadge').textContent = state.points.length;
    el('pointEmptyHint').style.display = state.points.length ? 'none' : 'flex';
  }

  function renderMapGraphics(state, map) {
    var graphics = state.points.map(function (point) {
      return { type: 'task', id: point.id, lng: point.lon, lat: point.lat, label: point.name };
    });
    state.results.forEach(function (candidate) {
      graphics.push({
        type: 'candidate', id: candidate.id, lng: candidate.lng, lat: candidate.lat,
        grade: candidate.grade, selected: candidate.id === state.selectedCandidateId
      });
    });
    map.setGraphics(graphics);
  }

  function showEmptyInspector() {
    el('inspTitle').textContent = '方案结果';
    el('inspSub').textContent = '等待生成升空方案';
    el('inspIcon').innerHTML = icon('signal');
    el('inspBody').innerHTML = '<div class="empty-inspector">' + icon('route') +
      '<p>完成任务点、分析条件和升空范围后，点击“生成升空方案”。推荐位置与最低高度将在这里显示。</p></div>';
  }

  function showPointInspector(point, map) {
    var terrain = map.terrainHeight(point.lon, point.lat);
    var surface = map.surfaceHeight(point.lon, point.lat);
    el('inspTitle').textContent = point.name;
    el('inspSub').textContent = '任务点 · ' + point.id;
    el('inspIcon').innerHTML = icon('map-pin');
    el('inspBody').innerHTML = '<div class="stat-grid"><div class="stat"><div class="s-lbl">地形高程</div><div class="s-val">' + terrain.toFixed(1) + '<small> m</small></div></div>' +
      '<div class="stat"><div class="s-lbl">地表高程</div><div class="s-val">' + surface.toFixed(1) + '<small> m</small></div></div></div>' +
      kv('经度', point.lon.toFixed(6) + '°') + kv('纬度', point.lat.toFixed(6) + '°') +
      '<div class="field" style="margin-top:12px"><label>接收天线离地高度</label><input type="number" id="inspPointAntenna" min="0" max="500" step="0.1" value="' + point.antenna + '"></div>' +
      '<button class="btn primary block" data-action="update-point" data-point-id="' + point.id + '">' + icon('save') + '更新任务点</button>';
  }

  function showResults(state) {
    el('inspTitle').textContent = '候选点结果';
    el('inspSub').textContent = state.results.length + ' 个满足阈值';
    el('inspIcon').innerHTML = icon('signal');
    if (!state.results.length) {
      el('inspBody').innerHTML = '<div class="notice warn">' + icon('alert-triangle') + '<div><div class="n-title">暂无可用候选点</div>调整高度档位、覆盖阈值或候选范围后重新计算。</div></div>';
      return;
    }
    var fullCount = state.results.filter(function (item) { return item.grade === 'full'; }).length;
    el('inspBody').innerHTML = '<div class="stat-grid"><div class="stat ok"><div class="s-lbl">全覆盖</div><div class="s-val">' + fullCount + '</div></div>' +
      '<div class="stat warn"><div class="s-lbl">部分覆盖</div><div class="s-val">' + (state.results.length - fullCount) + '</div></div></div>' +
      '<div class="filter-bar"><span class="fl-lbl">按最低高度排序</span><span class="tag active">阈值 &gt; ' + state.params.threshold + '%</span></div>' +
      state.results.slice(0, 60).map(candidateItem).join('');
  }

  function candidateItem(candidate) {
    return '<div class="cand-item" data-candidate-id="' + candidate.id + '"><span class="cm ' + candidate.grade + '"></span>' +
      '<div class="ci-main"><div class="ci-name">' + candidate.id + ' · ' + (candidate.grade === 'full' ? '100% 可达' : '部分覆盖') + '</div>' +
      '<div class="ci-sub">' + candidate.lng.toFixed(5) + ', ' + candidate.lat.toFixed(5) + '</div></div>' +
      '<div class="ci-h"><div class="hv">' + candidate.height + 'm</div><div class="hl">最低升空高度</div></div></div>';
  }

  function showCandidate(candidate, state, map) {
    var terrain = map.terrainHeight(candidate.lng, candidate.lat);
    var badges = state.points.map(function (point, index) {
      var covered = candidate.perTask[index].minH != null && candidate.perTask[index].minH <= candidate.height;
      return '<span class="pt-badge ' + (covered ? 'covered' : 'uncovered') + '"><span class="d"></span>' + escapeHtml(point.name) + '</span>';
    }).join('');
    el('inspTitle').textContent = candidate.id;
    el('inspSub').textContent = candidate.grade === 'full' ? '100% 任务点可达' : '部分覆盖候选点';
    el('inspIcon').innerHTML = icon('signal');
    el('inspBody').innerHTML = '<div class="stat-grid"><div class="stat ' + (candidate.grade === 'full' ? 'ok' : 'warn') + '"><div class="s-lbl">最低升空高度</div><div class="s-val">' + candidate.height + '<small> m</small></div></div>' +
      '<div class="stat"><div class="s-lbl">任务点覆盖</div><div class="s-val">' + candidate.reached + '<small> / ' + state.points.length + '</small></div></div></div>' +
      kv('经度', candidate.lng.toFixed(6) + '°') + kv('纬度', candidate.lat.toFixed(6) + '°') + kv('地形高程', terrain.toFixed(1) + ' m') +
      '<div class="subhead">任务点可达性</div><div>' + badges + '</div>' +
      '<button class="btn primary block" style="margin-top:12px" data-action="coverage" data-candidate-id="' + candidate.id + '">' + icon('layers') + '计算 30km 连续覆盖</button>';
  }

  function showCoverage(candidate, coverage) {
    el('inspTitle').textContent = candidate.id + ' · 连续覆盖';
    el('inspSub').textContent = '30km 覆盖栅格分析';
    el('inspBody').innerHTML = '<div class="coverage-summary"><div class="cs"><div class="l">升空高度</div><div class="v">' + candidate.height + 'm</div></div>' +
      '<div class="cs"><div class="l">接收高度</div><div class="v">' + coverage.params.rxH + 'm</div></div>' +
      '<div class="cs"><div class="l">可通信面积</div><div class="v">' + coverage.areaKm2 + 'km²</div></div>' +
      '<div class="cs"><div class="l">遮挡模式</div><div class="v">' + coverage.params.mode + '</div></div></div>' +
      '<div class="notice info">' + icon('info') + '<div><div class="n-title">覆盖图已叠加到地图</div>绿色表示满足视距，红色表示被地形或地表障碍遮挡。</div></div>';
  }

  function kv(key, value) {
    return '<div class="kv"><span class="k">' + key + '</span><span class="v mono">' + value + '</span></div>';
  }

  function modal(options) {
    el('modalMount').innerHTML = '<div class="overlay" id="activeOverlay"><div class="modal"><div class="modal-head"><span class="m-ic ' + (options.tone || 'accent') + '">' + icon(options.icon || 'info') + '</span>' +
      '<h3>' + escapeHtml(options.title) + '</h3><button class="iconbtn" data-modal-close>' + icon('x') + '</button></div>' +
      '<div class="modal-body">' + options.body + '</div><div class="modal-foot"><button class="btn" data-modal-close>取消</button>' +
      '<button class="btn ' + (options.confirmClass || 'primary') + '" id="modalConfirm">' + escapeHtml(options.confirmText || '确认') + '</button></div></div></div>';
  }

  function closeModal() {
    el('modalMount').innerHTML = '';
  }

  function toast(message, tone) {
    var node = document.createElement('div');
    node.className = 'toast ' + (tone || '');
    node.innerHTML = icon(tone === 'danger' ? 'alert-circle' : tone === 'warn' ? 'alert-triangle' : 'check-circle') + '<span>' + escapeHtml(message) + '</span>';
    el('toastStack').appendChild(node);
    setTimeout(function () { node.remove(); }, 2800);
  }

  function renderLayers() {
    var labels = { imagery: '真实卫星影像', terrain: '三维地形阴影', obstacle: 'DSM 障碍', roads: '道路与水系', markers: '任务点与候选点', coverage: '连续覆盖栅格' };
    el('layerRows').innerHTML = Object.keys(labels).map(function (key) {
      return '<div class="kv"><span class="k">' + labels[key] + '</span><button class="btn sm" data-layer="' + key + '" data-on="true">显示</button></div>';
    }).join('');
  }

  function renderDebug() {
    var states = [['normal', '正常就绪'], ['empty', '空任务点'], ['failed', '图层失败'], ['results', '示例结果']];
    el('debugGrid').innerHTML = states.map(function (item) {
      return '<button class="dbg-btn" data-debug="' + item[0] + '">' + item[1] + '</button>';
    }).join('');
  }

  global.PlannerUI = {
    renderTasks: renderTasks, renderPoints: renderPoints,
    renderMapGraphics: renderMapGraphics, showEmptyInspector: showEmptyInspector,
    showPointInspector: showPointInspector, showResults: showResults,
    showCandidate: showCandidate, showCoverage: showCoverage,
    modal: modal, closeModal: closeModal, toast: toast,
    renderLayers: renderLayers, renderDebug: renderDebug
  };
})(window);

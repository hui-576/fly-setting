(function (global) {
  'use strict';

  var state = global.PlannerState.create();
  var ui = global.PlannerUI;
  var map;
  var addMode = false;
  var drawMode = false;
  var timers = [];

  function el(id) {
    return document.getElementById(id);
  }

  function markDirty() {
    state.dirty = true;
    el('saveText').textContent = '有未保存更改';
    el('chipSave').classList.add('warn');
  }

  function syncAll() {
    ui.renderTasks(state);
    ui.renderPoints(state);
    ui.renderMapGraphics(state, map);
    updateEstimate();
    global.PlannerWorkflow.update(state);
    global.LucideMini.iconify(document);
    global.PlannerA11y.apply();
  }

  function boot() {
    global.LucideMini.iconify(document);
    map = new global.TerrainMap(el('mapCanvas'));
    map.flyTo(global.AppData.MAP_CENTER.lon, global.AppData.MAP_CENTER.lat);
    map.setDataMode(state.params.mode);
    el('mapWrap').classList.add('satellite-mode');
    bindEvents();
    global.PlannerA11y.init({
      hasModal: function () { return el('modalMount').children.length > 0; },
      closeModal: ui.closeModal,
      hasMapMode: function () { return addMode || drawMode; },
      stopMapMode: stopModes
    });
    bindMap();
    hydrateControls();
    ui.renderLayers();
    ui.renderDebug();
    syncAll();
    global.PlannerLayout.syncMobile();
    ui.showEmptyInspector();
    runBootSequence();
  }

  function runBootSequence() {
    var steps = ['校验本地数据包', '初始化地形高程场', '加载任务与参数', '视距引擎就绪'];
    el('bootLog').innerHTML = '';
    steps.forEach(function (label, index) {
      timers.push(setTimeout(function () {
        el('bootLog').innerHTML += '<div>' + (index < steps.length - 1 ? '·' : '✓') + ' ' + label + '</div>';
        el('bootBar').style.width = ((index + 1) / steps.length * 100) + '%';
        if (index === steps.length - 1) {
          map.setLoaded(true);
          timers.push(setTimeout(function () { el('mapLoading').classList.add('hidden'); }, 120));
        }
      }, 60 + index * 70));
    });
  }

  function hydrateControls() {
    el('partialTh').value = state.params.threshold;
    el('partialThVal').textContent = state.params.threshold + '%';
    el('kFactor').value = state.params.k;
    el('kFactorNum').value = state.params.k;
    el('rxHeight').value = state.params.rxH;
    el('rxHeightNum').value = state.params.rxH;
    el('roadBuf').value = state.roadBuffer;
    el('roadStep').value = state.roadStep;
    el('roadBufVal').textContent = state.roadBuffer + 'm';
    el('roadStepVal').textContent = state.roadStep + 'm';
    Array.from(el('segDataMode').children).forEach(function (button) {
      button.classList.toggle('active', button.dataset.v === state.params.mode);
    });
    Array.from(el('tierPills').children).forEach(function (button) {
      button.classList.toggle('active', state.params.tiers.indexOf(Number(button.dataset.v)) >= 0);
    });
  }

  function bindEvents() {
    document.addEventListener('click', handleClick);
    bindRange('partialTh', function (value) {
      state.params.threshold = Number(value); el('partialThVal').textContent = value + '%';
    });
    bindPaired('kFactor', 'kFactorNum', function (value) { state.params.k = Number(value); });
    bindPaired('rxHeight', 'rxHeightNum', function (value) { state.params.rxH = Number(value); });
    bindRange('roadBuf', function (value) {
      state.roadBuffer = Number(value); el('roadBufVal').textContent = value + 'm'; updateEstimate();
    });
    bindRange('roadStep', function (value) {
      state.roadStep = Number(value); el('roadStepVal').textContent = value + 'm'; updateEstimate();
    });
    global.addEventListener('resize', function () { map.resize(); global.PlannerLayout.syncMobile(); });
  }

  function bindRange(id, change) {
    el(id).addEventListener('input', function (event) {
      change(event.target.value); markDirty();
    });
  }

  function bindPaired(rangeId, numberId, change) {
    [rangeId, numberId].forEach(function (id) {
      el(id).addEventListener('input', function (event) {
        var value = event.target.value;
        el(rangeId).value = value; el(numberId).value = value;
        change(value); markDirty();
      });
    });
  }

  function bindMap() {
    map.on('hover', function (point) {
      el('coordReadout').textContent = point.lng.toFixed(6) + '°E  ' + point.lat.toFixed(6) + '°N  高程 ' + map.sampleHeight(point.lng, point.lat).toFixed(1) + 'm';
    });
    map.on('click', function (point) {
      if (addMode) return addPointAt(point);
      if (drawMode) return addPolygonVertex(point);
      selectNearest(point);
    });
  }

  function handleClick(event) {
    var tab = event.target.closest('[data-tab]');
    if (tab) return switchTab(tab.dataset.tab);
    var action = event.target.closest('[data-action]');
    if (action) return handleAction(action);
    if (event.target.closest('[data-modal-close]')) return ui.closeModal();
    var task = event.target.closest('[data-task-id]');
    if (task && !event.target.closest('button')) return selectTask(task.dataset.taskId);
    var point = event.target.closest('[data-point-id]');
    if (point && !event.target.closest('button')) return inspectPoint(point.dataset.pointId);
    var candidate = event.target.closest('[data-candidate-id]');
    if (candidate) return inspectCandidate(candidate.dataset.candidateId);
    routeButton(event);
  }


  function routeButton(event) {
    var button = event.target.closest('button');
    if (!button) return;
    var routes = {
      btnSave: save, btnNewTask: newTask, btnToggleTrash: toggleTrash,
      btnImportPoints: importPoints, btnAddPoint: toggleAddMode,
      addHintDone: stopModes, btnBuildRoad: buildRoad,
      btnDrawStart: startDrawing, btnDrawUndo: undoDrawing,
      btnDrawClear: clearDrawing, btnDrawDone: finishDrawing,
      drawHintDone: finishDrawing, drawHintCancel: stopModes,
      btnCalculate: runAnalysis, flowRun: runAnalysis, flowRunPrimary: runAnalysis, flowResults: showResultPanel,
      sbCancel: cancelAnalysis, sbRestart: runAnalysis,
      mZoomIn: function () { map.zoom(0.82); }, mZoomOut: function () { map.zoom(1.18); },
      mLocate: locate, mMode3d: function () { setView('3d'); }, mModeTop: function () { setView('top'); },
      mLayers: toggleLayers, mDraw: startDrawing, mClear: clearMap,
      legendTgl: toggleLegend, handleLeft: toggleLeft, handleRight: toggleRight,
      inspClose: toggleRight, debugFab: toggleDebug, debugClose: toggleDebug,
      btnSettings: showSettings, mapToastBtn: retryMap
    };
    if (routes[button.id]) return routes[button.id]();
    if (button.dataset.taskCopy) copyTask(button.dataset.taskCopy);
    if (button.dataset.taskDelete) deleteTask(button.dataset.taskDelete);
    if (button.dataset.taskRestore) restoreTask(button.dataset.taskRestore);
    if (button.dataset.pointDelete) deletePoint(button.dataset.pointDelete);
    if (button.dataset.debug) setDebugState(button.dataset.debug);
    if (button.dataset.layer) toggleLayer(button.dataset.layer, button.dataset.on !== 'true');
    if (button.closest('#segDataMode')) setDataMode(button.dataset.v);
    if (button.closest('#segZoneMode')) setZoneMode(button.dataset.v);
    if (button.closest('#tierPills')) toggleTier(Number(button.dataset.v), button);
  }

  function switchTab(name) {
    document.querySelectorAll('[data-tab]').forEach(function (node) { node.classList.toggle('active', node.dataset.tab === name); });
    document.querySelectorAll('[data-pane]').forEach(function (node) { node.classList.toggle('active', node.dataset.pane === name); });
    global.PlannerWorkflow.setStep({ points: 1, params: 2, zone: 3 }[name] || 1);
  }

  function save() {
    global.PlannerState.save(state);
    el('saveText').textContent = '已保存';
    el('chipSave').classList.remove('warn');
    ui.toast('任务与参数已保存', 'ok');
  }

  function newTask() {
    ui.modal({ title: '新建规划任务', icon: 'file-plus', confirmText: '创建任务', body: '<div class="field"><label>任务名称</label><input id="newTaskName" type="text" value="新建视距规划任务"></div><div class="field"><label>任务说明</label><textarea id="newTaskNote">现场通信保障候选点规划</textarea></div>' });
    el('modalConfirm').onclick = function () {
      var id = 'T-' + String(Date.now()).slice(-4);
      state.tasks.unshift({ id: id, name: el('newTaskName').value.trim() || '未命名任务', note: el('newTaskNote').value.trim(), status: 'active', version: 'v1', modified: nowText(), archived: false, deleted: false });
      state.currentTaskId = id; ui.closeModal(); markDirty(); syncAll();
    };
  }

  function selectTask(id) {
    state.currentTaskId = id; markDirty(); ui.renderTasks(state);
  }

  function copyTask(id) {
    var source = state.tasks.find(function (task) { return task.id === id; });
    var copy = Object.assign({}, source, { id: 'T-' + String(Date.now()).slice(-4), name: source.name + '（副本）', version: 'v1', modified: nowText(), archived: false, deleted: false });
    state.tasks.unshift(copy); state.currentTaskId = copy.id; markDirty(); ui.renderTasks(state); ui.toast('已创建任务副本', 'ok');
  }

  function deleteTask(id) {
    var task = state.tasks.find(function (item) { return item.id === id; });
    if (!task) return;
    task.deleted = true; task.status = 'deleted'; markDirty(); ui.renderTasks(state); ui.toast('任务已移至回收站', 'warn');
  }

  function restoreTask(id) {
    var task = state.tasks.find(function (item) { return item.id === id; });
    task.deleted = false; task.status = 'active'; markDirty(); ui.renderTasks(state); ui.toast('任务已恢复', 'ok');
  }

  function toggleTrash() {
    el('trashList').classList.toggle('hidden');
  }

  function importPoints() {
    var existing = state.points.map(function (point) { return point.name; });
    var additions = global.AppData.IMPORT_POOL.filter(function (point) { return existing.indexOf(point.name) < 0; }).slice(0, 3);
    additions.forEach(function (point, index) {
      state.points.push(Object.assign({ id: 'P' + (state.points.length + index + 1) }, point));
    });
    markDirty(); syncAll(); ui.toast('已导入 ' + additions.length + ' 个任务点', additions.length ? 'ok' : 'warn');
  }

  function toggleAddMode() {
    addMode = !addMode; drawMode = false; updateModeHints();
  }

  function addPointAt(point) {
    if (state.points.length >= 50) return ui.toast('任务点已达到 50 个上限', 'danger');
    var next = state.points.length + 1;
    state.points.push({ id: 'P' + next, name: '临时任务点 ' + next, lon: point.lng, lat: point.lat, antenna: 1.5 });
    markDirty(); syncAll(); inspectPoint('P' + next);
  }

  function inspectPoint(id) {
    var point = state.points.find(function (item) { return item.id === id; });
    if (!point) return;
    map.flyTo(point.lon, point.lat); ui.showPointInspector(point, map); global.LucideMini.iconify(el('inspBody'));
  }

  function deletePoint(id) {
    state.points = state.points.filter(function (point) { return point.id !== id; });
    markDirty(); syncAll(); ui.showEmptyInspector();
  }

  function handleAction(node) {
    if (node.dataset.action === 'update-point') {
      var point = state.points.find(function (item) { return item.id === node.dataset.pointId; });
      point.antenna = Math.max(0, Math.min(500, Number(el('inspPointAntenna').value) || 0));
      markDirty(); syncAll(); inspectPoint(point.id); ui.toast('任务点参数已更新', 'ok');
    }
    if (node.dataset.action === 'coverage') runCoverage(node.dataset.candidateId);
  }

  function setDataMode(mode) {
    state.params.mode = mode; map.setDataMode(mode); hydrateControls(); markDirty();
    el('dataModeHint').textContent = mode === 'DSM' ? 'DSM 计入建筑与植被等地表障碍，结果更保守。' : 'DTM 仅使用裸地高程，适合快速评估地形遮挡。';
  }

  function toggleTier(value, button) {
    var index = state.params.tiers.indexOf(value);
    if (index >= 0 && state.params.tiers.length === 1) return ui.toast('至少保留一个高度档位', 'warn');
    if (index >= 0) state.params.tiers.splice(index, 1); else state.params.tiers.push(value);
    state.params.tiers.sort(function (a, b) { return a - b; }); button.classList.toggle('active'); markDirty();
  }

  function setZoneMode(mode) {
    state.zoneMode = mode;
    Array.from(el('segZoneMode').children).forEach(function (button) { button.classList.toggle('active', button.dataset.v === mode); });
    el('zoneRoad').style.display = mode === 'road' ? '' : 'none';
    el('zonePolygon').style.display = mode === 'polygon' ? '' : 'none';
    markDirty(); updateEstimate();
  }

  function buildRoad() {
    setZoneMode('road');
    var line = global.AppData.ROAD_CENTERLINE;
    var offset = state.roadBuffer / 85000;
    var upper = line.map(function (point) { return { lng: point.lon, lat: point.lat + offset }; });
    var lower = line.slice().reverse().map(function (point) { return { lng: point.lon, lat: point.lat - offset }; });
    map.roadCorridor = upper.concat(lower);
    global.PlannerState.buildCandidates(state); map.render(); updateEstimate(); markDirty();
    ui.toast('道路候选范围已生成', 'ok');
  }

  function startDrawing() {
    setZoneMode('polygon'); drawMode = true; addMode = false;
    if (!state.polygon.length) state.polygon = [];
    map.drawPoly = state.polygon; updateModeHints();
  }

  function addPolygonVertex(point) {
    state.polygon.push(point); map.drawPoly = state.polygon; map.render();
    el('btnDrawUndo').disabled = false; el('btnDrawClear').disabled = false;
    el('btnDrawDone').disabled = state.polygon.length < 3; markDirty(); updateEstimate();
  }

  function undoDrawing() {
    state.polygon.pop(); map.render();
    el('btnDrawDone').disabled = state.polygon.length < 3;
    el('btnDrawUndo').disabled = !state.polygon.length; updateEstimate();
  }

  function clearDrawing() {
    state.polygon = []; map.drawPoly = state.polygon; map.render();
    el('btnDrawDone').disabled = true; el('btnDrawUndo').disabled = true; el('btnDrawClear').disabled = true;
    updateEstimate(); markDirty();
  }

  function finishDrawing() {
    if (state.polygon.length < 3) return ui.toast('至少需要 3 个顶点才能闭合多边形', 'warn');
    stopModes(); global.PlannerState.buildCandidates(state); updateEstimate(); ui.toast('多边形候选范围已生成', 'ok');
  }

  function stopModes() {
    addMode = false; drawMode = false; map.setPickCursor(false); updateModeHints();
  }

  function updateModeHints() {
    el('addHint').classList.toggle('hidden', !addMode); el('addPointHint').style.display = addMode ? 'flex' : 'none';
    el('drawHint').classList.toggle('hidden', !drawMode); map.setPickCursor(addMode || drawMode);
  }

  function updateEstimate() {
    var estimate = state.candidates.length || (state.zoneMode === 'road' ? Math.round(8200 / state.roadStep) : state.polygon.length < 3 ? 0 : Math.round(3800 / state.roadStep));
    el('estCandidates').textContent = estimate ? estimate.toLocaleString() : '—';
    el('estUnique').textContent = estimate ? Math.min(estimate, 160).toLocaleString() : '—';
    el('sbCandCount').textContent = state.candidates.length;
  }

  function validateAnalysis() {
    if (!state.points.length) return ['points', '请先设置至少 1 个通信任务点。'];
    if (!state.params.tiers.length) return ['params', '请至少启用 1 个无人机高度档位。'];
    if (state.zoneMode === 'polygon' && state.polygon.length < 3) return ['zone', '请先完成可升空范围多边形。'];
    return null;
  }

  function runAnalysis() {
    var issue = validateAnalysis();
    if (issue) { ui.toast(issue[1], 'warn'); return switchTab(issue[0]); }
    el('paramError').style.display = 'none';
    if (!state.candidates.length) global.PlannerState.buildCandidates(state);
    state.running = true; state.cancelled = false; global.PlannerWorkflow.progress(8, '准备候选点', '阶段 1 / 3');
    timers.push(setTimeout(function () {
      if (state.cancelled) return finishCancelled();
      global.PlannerWorkflow.progress(38, '地形视距求解', '阶段 2 / 3');
      timers.push(setTimeout(function () {
        global.PlannerState.analyze(state, map);
        if (state.cancelled) return finishCancelled();
        global.PlannerWorkflow.progress(88, '整理候选结果', '阶段 3 / 3');
        timers.push(setTimeout(finishAnalysis, 260));
      }, 120));
    }, 260));
  }

  function finishAnalysis() {
    state.running = false; global.PlannerWorkflow.finish(state.results.length);
    ui.renderMapGraphics(state, map); ui.showResults(state); global.LucideMini.iconify(el('inspBody'));
    ui.toast('计算完成，得到 ' + state.results.length + ' 个候选点', state.results.length ? 'ok' : 'warn');
  }

  function cancelAnalysis() {
    state.cancelled = true; state.running = false; timers.forEach(clearTimeout); timers = []; finishCancelled();
  }

  function finishCancelled() {
    global.PlannerWorkflow.cancel();
    ui.toast('已取消本次计算', 'warn');
  }

  function showResultPanel() {
    ui.showResults(state); global.LucideMini.iconify(el('inspBody'));
    if (el('body').classList.contains('right-collapsed')) toggleRight();
  }

  function inspectCandidate(id) {
    var candidate = state.results.find(function (item) { return item.id === id; });
    if (!candidate) return;
    state.selectedCandidateId = id; map.flyTo(candidate.lng, candidate.lat); ui.renderMapGraphics(state, map);
    ui.showCandidate(candidate, state, map); global.LucideMini.iconify(el('inspBody'));
  }

  function runCoverage(id) {
    var candidate = state.results.find(function (item) { return item.id === id; });
    var coverage = map.computeCoverage(candidate, { droneH: candidate.height, rxH: state.params.rxH, k: state.params.k, mode: state.params.mode }, 34);
    ui.showCoverage(candidate, coverage); global.LucideMini.iconify(el('inspBody'));
  }

  function selectNearest(point) {
    var items = state.points.map(function (item) { return { kind: 'point', id: item.id, lng: item.lon, lat: item.lat }; })
      .concat(state.results.map(function (item) { return { kind: 'candidate', id: item.id, lng: item.lng, lat: item.lat }; }));
    items.sort(function (a, b) { return global.GeoUtil.km(point, a) - global.GeoUtil.km(point, b); });
    if (!items.length || global.GeoUtil.km(point, items[0]) > 1.2) return ui.showEmptyInspector();
    if (items[0].kind === 'point') inspectPoint(items[0].id); else inspectCandidate(items[0].id);
  }

  function setView(mode) {
    map.setViewMode(mode); el('mMode3d').classList.toggle('active', mode === '3d'); el('mModeTop').classList.toggle('active', mode === 'top');
    el('mapWrap').classList.toggle('satellite-mode', mode === 'top');
  }

  function locate() { map.flyTo(global.AppData.MAP_CENTER.lon, global.AppData.MAP_CENTER.lat); }
  function toggleLayers() { el('layerPop').classList.toggle('hidden'); }
  function toggleLegend() { el('legend').classList.toggle('map-collapsed'); }
  function toggleLeft() { global.PlannerLayout.toggleLeft(function () { map.resize(); }); }
  function toggleRight() { global.PlannerLayout.toggleRight(function () { map.resize(); }); }
  function toggleDebug() { el('debugPanel').classList.toggle('open'); el('debugFab').classList.toggle('hidden'); }

  function clearMap() {
    map.clearCoverage(); state.results = []; state.selectedCandidateId = null; ui.renderMapGraphics(state, map); ui.showEmptyInspector();
    el('sbResultCount').textContent = '—'; el('sbStatusText').textContent = '已清除结果';
  }

  function toggleLayer(name, on) {
    map.toggleLayer(name, on); var button = document.querySelector('[data-layer="' + name + '"]');
    button.dataset.on = String(on); button.textContent = on ? '显示' : '隐藏';
  }

  function setDebugState(name) {
    if (name === 'failed') {
      el('mapToast').classList.remove('hidden'); map.setLoaded(false);
    } else if (name === 'empty') {
      state.points = []; syncAll(); ui.showEmptyInspector();
    } else if (name === 'results') {
      if (!state.points.length) state.points = JSON.parse(JSON.stringify(global.AppData.TASK_POINTS));
      buildRoad(); runAnalysis();
    } else {
      el('mapToast').classList.add('hidden'); map.setLoaded(true); syncAll();
    }
  }

  function retryMap() {
    el('mapToast').classList.add('hidden'); map.setLoaded(true); ui.toast('本地地形图层已恢复', 'ok');
  }

  function showSettings() {
    ui.modal({ title: '原型运行设置', icon: 'settings', confirmText: '应用', body: '<div class="field"><label>地图数据源</label><input readonly value="本地程序化地形 + DSM 障碍层"></div><label class="inline-lbl"><input type="checkbox" id="reduceMotion"> 减少界面动效</label><p style="margin-top:10px">所有任务、任务点与参数保存在当前浏览器本地，不会上传。</p>' });
    el('reduceMotion').checked = document.body.classList.contains('reduce-motion');
    el('modalConfirm').onclick = function () { document.body.classList.toggle('reduce-motion', el('reduceMotion').checked); ui.closeModal(); ui.toast('设置已应用', 'ok'); };
  }

  function nowText() {
    var date = new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  boot();
})(window);

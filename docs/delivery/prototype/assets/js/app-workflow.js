(function (global) {
  'use strict';

  function el(id) {
    return document.getElementById(id);
  }

  function setStep(step) {
    document.querySelectorAll('[data-flow-step]').forEach(function (button) {
      var number = Number(button.dataset.flowStep);
      button.classList.toggle('active', number === step);
      button.setAttribute('aria-current', number === step ? 'step' : 'false');
    });
  }

  function update(state) {
    var hasZone = state.candidates.length > 0 || state.polygon.length >= 3;
    el('flowPointMeta').textContent = state.points.length + ' 个通信目标';
    el('flowZoneMeta').textContent = hasZone ? (state.candidates.length || '已圈定') + ' 个候选位置' : '等待划定';
    el('flowResultMeta').textContent = state.results.length ? state.results.length + ' 个可用方案' : '等待计算';
    el('flowResults').disabled = !state.results.length;
    markDone(1, state.points.length > 0);
    markDone(2, true);
    markDone(3, hasZone);
    markDone(5, state.results.length > 0);
  }

  function markDone(step, done) {
    var button = document.querySelector('[data-flow-step="' + step + '"]');
    if (button) button.classList.toggle('done', done);
  }

  function progress(percent, label, phase) {
    setStep(4);
    el('flowRunMeta').textContent = label + ' · ' + percent + '%';
    el('flowRunPrimary').disabled = true;
    el('flowRunPrimary').querySelector('span:last-child').textContent = '正在生成方案';
    el('sbProgress').classList.remove('hidden'); el('sbCancel').classList.remove('hidden');
    el('sbStageName').textContent = label; el('sbBar').style.width = percent + '%'; el('sbPct').textContent = percent + '%';
    el('sbEta').textContent = percent < 80 ? '剩余 < 1 分钟' : '即将完成'; el('sbPhaseInfo').textContent = phase; el('sbStatusText').textContent = '计算中';
  }

  function finish(count) {
    el('sbProgress').classList.add('hidden'); el('sbCancel').classList.add('hidden');
    el('sbResultCount').textContent = count; el('sbStatusText').textContent = '计算完成'; el('sbPhaseInfo').textContent = '视距分析完成';
    el('flowRunMeta').textContent = '计算完成'; el('flowResultMeta').textContent = count + ' 个可用方案';
    el('flowRunPrimary').disabled = false; el('flowRunPrimary').querySelector('span:last-child').textContent = '重新生成方案';
    el('flowResults').disabled = false; markDone(4, true); markDone(5, true); setStep(5);
  }

  function cancel() {
    el('sbProgress').classList.add('hidden'); el('sbCancel').classList.add('hidden');
    el('sbStatusText').textContent = '计算已取消'; el('sbPhaseInfo').textContent = '';
    el('flowRunMeta').textContent = '计算已取消'; el('flowRunPrimary').disabled = false;
    el('flowRunPrimary').querySelector('span:last-child').textContent = '生成升空方案';
  }

  global.PlannerWorkflow = { setStep: setStep, update: update, progress: progress, finish: finish, cancel: cancel };
})(window);

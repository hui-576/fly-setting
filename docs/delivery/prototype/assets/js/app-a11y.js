(function (global) {
  'use strict';

  function apply() {
    document.querySelectorAll('button[title]').forEach(function (button) {
      if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', button.title);
    });
    document.querySelectorAll('.list-item[data-task-id], .list-item[data-point-id], .cand-item[data-candidate-id]').forEach(function (row) {
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
    });
  }

  function init(callbacks) {
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (callbacks.hasModal()) return callbacks.closeModal();
        if (callbacks.hasMapMode()) return callbacks.stopMapMode();
      }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var active = document.activeElement;
      var selector = '.list-item[data-task-id], .list-item[data-point-id], .cand-item[data-candidate-id]';
      var row = active && active.closest(selector);
      if (!row || event.target.closest('button')) return;
      event.preventDefault();
      row.click();
    });
    apply();
  }

  global.PlannerA11y = { apply: apply, init: init };
})(window);

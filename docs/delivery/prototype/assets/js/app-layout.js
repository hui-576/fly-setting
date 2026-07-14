(function (global) {
  'use strict';

  function toggleLeft(onResize) {
    var body = document.getElementById('body');
    if (global.innerWidth <= 760) body.classList.add('right-collapsed');
    body.classList.toggle('left-collapsed');
    setTimeout(onResize, 180);
  }

  function toggleRight(onResize) {
    var body = document.getElementById('body');
    if (global.innerWidth <= 760) body.classList.add('left-collapsed');
    body.classList.toggle('right-collapsed');
    setTimeout(onResize, 180);
  }

  function syncMobile() {
    if (global.innerWidth <= 760) document.getElementById('body').classList.add('left-collapsed', 'right-collapsed');
  }

  global.PlannerLayout = { toggleLeft: toggleLeft, toggleRight: toggleRight, syncMobile: syncMobile };
})(window);

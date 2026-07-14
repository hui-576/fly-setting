(function (global) {
  'use strict';

  var STORAGE_KEY = 'los-planner-state-v1';
  var DEFAULT_PARAMS = {
    mode: 'DSM', threshold: 70, k: 1.33, rxH: 1.5,
    tiers: [0, 50, 100, 150, 200, 250]
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadSaved() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  function createState() {
    var saved = loadSaved() || {};
    return {
      tasks: saved.tasks || clone(global.AppData.TASKS),
      points: saved.points || clone(global.AppData.TASK_POINTS),
      currentTaskId: saved.currentTaskId || 'T-2087',
      params: Object.assign({}, DEFAULT_PARAMS, saved.params || {}),
      zoneMode: saved.zoneMode || 'road',
      roadBuffer: saved.roadBuffer || 40,
      roadStep: saved.roadStep || 25,
      polygon: saved.polygon || [],
      candidates: [], results: [], selectedCandidateId: null,
      running: false, cancelled: false, dirty: false
    };
  }

  function save(state) {
    var payload = {
      tasks: state.tasks, points: state.points,
      currentTaskId: state.currentTaskId, params: state.params,
      zoneMode: state.zoneMode, roadBuffer: state.roadBuffer,
      roadStep: state.roadStep, polygon: state.polygon
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    state.dirty = false;
  }

  function roadCandidates(stepMeters) {
    var line = global.AppData.ROAD_CENTERLINE;
    var points = [];
    var stepKm = Math.max(0.01, stepMeters / 1000);
    for (var i = 0; i < line.length - 1; i++) {
      var a = line[i], b = line[i + 1];
      var segmentKm = global.GeoUtil.km(
        { lng: a.lon, lat: a.lat }, { lng: b.lon, lat: b.lat }
      );
      var count = Math.max(1, Math.ceil(segmentKm / stepKm));
      for (var j = 0; j < count; j++) {
        var t = j / count;
        points.push({
          lng: a.lon + (b.lon - a.lon) * t,
          lat: a.lat + (b.lat - a.lat) * t
        });
      }
    }
    var last = line[line.length - 1];
    points.push({ lng: last.lon, lat: last.lat });
    return thin(points, 140);
  }

  function polygonCandidates(polygon, stepMeters) {
    if (polygon.length < 3) return [];
    var lngs = polygon.map(function (point) { return point.lng; });
    var lats = polygon.map(function (point) { return point.lat; });
    var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var degreeStep = Math.max(0.0012, stepMeters / 86000);
    var points = [];
    for (var lat = minLat; lat <= maxLat; lat += degreeStep) {
      for (var lng = minLng; lng <= maxLng; lng += degreeStep) {
        if (inside({ lng: lng, lat: lat }, polygon)) points.push({ lng: lng, lat: lat });
      }
    }
    return thin(points, 160);
  }

  function inside(point, polygon) {
    var hit = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var a = polygon[i], b = polygon[j];
      var cross = ((a.lat > point.lat) !== (b.lat > point.lat)) &&
        (point.lng < (b.lng - a.lng) * (point.lat - a.lat) / (b.lat - a.lat) + a.lng);
      if (cross) hit = !hit;
    }
    return hit;
  }

  function thin(points, max) {
    if (points.length <= max) return points;
    var stride = points.length / max;
    return Array.from({ length: max }, function (_, index) {
      return points[Math.floor(index * stride)];
    });
  }

  function buildCandidates(state) {
    var raw = state.zoneMode === 'polygon'
      ? polygonCandidates(state.polygon, state.roadStep)
      : roadCandidates(state.roadStep);
    state.candidates = raw.map(function (point, index) {
      return { id: 'C' + String(index + 1).padStart(3, '0'), lng: point.lng, lat: point.lat };
    });
    state.results = [];
    state.dirty = true;
    return state.candidates;
  }

  function analyzeCandidate(map, candidate, points, params) {
    var tasks = points.map(function (point) {
      return { lng: point.lon, lat: point.lat, agl: point.antenna };
    });
    var solved = map.solveCandidate(candidate, tasks, params);
    var best = null;
    params.tiers.forEach(function (tier) {
      var reached = solved.perTask.filter(function (item) {
        return item.minH != null && item.minH <= tier;
      }).length;
      var ratio = tasks.length ? reached / tasks.length : 0;
      var grade = reached === tasks.length ? 'full' : ratio * 100 > params.threshold ? 'partial' : null;
      if (!best && grade) best = { height: tier, reached: reached, ratio: ratio, grade: grade };
    });
    if (!best) return null;
    return Object.assign({}, candidate, best, { perTask: solved.perTask });
  }

  function analyze(state, map, progress) {
    var results = [];
    for (var i = 0; i < state.candidates.length; i++) {
      if (state.cancelled) break;
      var result = analyzeCandidate(map, state.candidates[i], state.points, state.params);
      if (result) results.push(result);
      if (progress) progress(i + 1, state.candidates.length);
    }
    state.results = results.sort(function (a, b) {
      return a.height - b.height || b.ratio - a.ratio;
    });
    return state.results;
  }

  global.PlannerState = {
    create: createState, save: save,
    buildCandidates: buildCandidates, analyze: analyze
  };
})(window);

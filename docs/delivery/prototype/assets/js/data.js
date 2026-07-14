/* 本地模拟数据层 —— 无后端。全部数据在内存中,持久化到 localStorage。
   坐标使用湖北省真实范围(约 108.3–116.1°E, 29.0–33.3°N),武汉城市圈一带。 */
(function (global) {
  'use strict';

  // 地图中心:武汉市江夏区一带,系留无人机现场规划的典型场景
  var MAP_CENTER = { lon: 114.312, lat: 30.398 };

  // 任务库示例。status: active|archived|deleted
  var TASKS = [
    {
      id: 'T-2087', name: '江夏应急通信保障演练', status: 'active',
      version: 'v4', modified: '2026-07-14 09:42', archived: false, deleted: false,
      note: '梁子湖沿岸多任务点视距规划'
    },
    {
      id: 'T-2071', name: '光谷高架线路巡检中继', status: 'active',
      version: 'v2', modified: '2026-07-11 16:18', archived: false, deleted: false,
      note: '道路中心线候选升空点'
    },
    {
      id: 'T-2064', name: '汛期蔡甸沉湖片区值守', status: 'archived',
      version: 'v7', modified: '2026-06-28 08:05', archived: true, deleted: false,
      note: '归档只读,汛期指挥部复核版本'
    },
    {
      id: 'T-2055', name: '黄陂木兰山林区搜救预案', status: 'active',
      version: 'v1', modified: '2026-06-20 14:33', archived: false, deleted: false,
      note: '复杂地形遮挡,DSM 模式'
    },
    {
      id: 'T-2049', name: '旧·东西湖测试任务(废弃)', status: 'deleted',
      version: 'v3', modified: '2026-06-05 10:11', archived: false, deleted: true,
      note: '已删除,位于回收站'
    }
  ];

  // 当前任务的任务点(天线离地高度 m)。湖北真实格式坐标。
  var TASK_POINTS = [
    { id: 'P1', name: '前指挥所', lon: 114.3186, lat: 30.4055, antenna: 6.0 },
    { id: 'P2', name: '梁子湖东岸观测点', lon: 114.3402, lat: 30.3821, antenna: 3.0 },
    { id: 'P3', name: '龙泉山中继塔', lon: 114.2977, lat: 30.4162, antenna: 25.0 },
    { id: 'P4', name: '江夏大道路口卡点', lon: 114.3251, lat: 30.3907, antenna: 1.5 },
    { id: 'P5', name: '沿湖村临时驻点', lon: 114.3068, lat: 30.3744, antenna: 2.0 }
  ];

  // 批量导入模拟池(点击"模拟批量导入"时追加)
  var IMPORT_POOL = [
    { name: '藏龙岛科技园顶楼', lon: 114.3540, lat: 30.4210, antenna: 40.0 },
    { name: '五里界集镇水塔', lon: 114.3705, lat: 30.3588, antenna: 30.0 },
    { name: '汤逊湖大桥北墩', lon: 114.2860, lat: 30.4330, antenna: 12.0 },
    { name: '郑店物流园门岗', lon: 114.2712, lat: 30.3502, antenna: 4.5 },
    { name: '法泗方家咀泵站', lon: 114.2405, lat: 30.3126, antenna: 8.0 },
    { name: '安山湿地瞭望台', lon: 114.2233, lat: 30.2954, antenna: 18.0 }
  ];

  // 道路中心线候选范围(模式一)—— 一段折线,沿此生成候选点
  var ROAD_CENTERLINE = [
    { lon: 114.2830, lat: 30.3720 }, { lon: 114.2990, lat: 30.3805 },
    { lon: 114.3120, lat: 30.3910 }, { lon: 114.3255, lat: 30.3990 },
    { lon: 114.3380, lat: 30.4075 }, { lon: 114.3520, lat: 30.4140 }
  ];

  // 原型地图配置仅描述生产接入目标；实际开发必须使用真实 Mars3D。
  var MARS3D_CONFIG = {
    engine: 'mars3d',                 // 强制:仅 Mars3D,不切换其它引擎
    cesiumBase: 'assets/vendor/mars3d-cesium/',
    scene: { center: MAP_CENTER, pitch: -45, heading: 0, height: 12000 },
    terrain: { local: 'assets/vendor/terrain/', enabled: true },
    imagery: {
      provider: 'offline-prototype-grid',
      url: null,
      enabled: false
    },
    note: '本文件中的程序化底图仅用于交互原型，禁止进入生产实现。'
  };

  global.AppData = {
    MAP_CENTER: MAP_CENTER,
    TASKS: TASKS,
    TASK_POINTS: TASK_POINTS,
    IMPORT_POOL: IMPORT_POOL,
    ROAD_CENTERLINE: ROAD_CENTERLINE,
    MARS3D_CONFIG: MARS3D_CONFIG
  };
})(window);

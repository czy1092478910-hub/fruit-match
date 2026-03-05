/**
 * 关卡配置：10 关递增难度
 * 每关：rows, cols, 图标种类数, 初始时间(秒), 消除加时(秒)
 */
const LEVELS = [
  { rows: 8,  cols: 8,  types: 6,  time: 120, bonusTime: 3 },  // Lv1
  { rows: 8,  cols: 10, types: 7,  time: 110, bonusTime: 3 },  // Lv2
  { rows: 10, cols: 10, types: 8,  time: 100, bonusTime: 2 },  // Lv3
  { rows: 10, cols: 12, types: 9,  time: 95,  bonusTime: 2 },  // Lv4
  { rows: 12, cols: 12, types: 10, time: 90,  bonusTime: 2 },  // Lv5
  { rows: 12, cols: 14, types: 11, time: 85, bonusTime: 2 },  // Lv6
  { rows: 14, cols: 14, types: 12, time: 80, bonusTime: 1 },  // Lv7
  { rows: 14, cols: 16, types: 13, time: 75, bonusTime: 1 },  // Lv8
  { rows: 16, cols: 16, types: 14, time: 70, bonusTime: 1 },  // Lv9
  { rows: 16, cols: 18, types: 15, time: 65, bonusTime: 1 },  // Lv10
];

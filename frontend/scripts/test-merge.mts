/* Node 端验证：import('fake-indexeddb/auto') 注入 IndexedDB，再用 vite 无关的 esbuild/tsx 跑源码 */
import 'fake-indexeddb/auto';
import assert from 'node:assert';
import { db, setMeta } from '../src/utils/db';
import { buildBackup, parseBackup, restoreBackup } from '../src/utils/export';
import { buildMergePlan, applyMerge } from '../src/utils/merge';
import type { StageKey } from '../src/types/sync';

async function reset() {
  await db.delete();
  // Dexie 实例被 delete 后需重新打开同一单例
  await db.open();
}

const stageTables: StageKey[] = ['boards', 'chambers', 'lacquers', 'stringings'];
async function counts() {
  return {
    boards: await db.boards.count(),
    chambers: await db.chambers.count(),
    lacquers: await db.lacquers.count(),
    stringings: await db.stringings.count(),
    changes: await db.changes.count(),
    history: await db.mergeHistory.count(),
  };
}

// ---------- 场景 1：旧备份（无任何同步字段、无 changes）可整库导入 ----------
await reset();
const oldBackup = JSON.stringify({
  app: 'gbguqin',
  schemaVersion: 2,
  exportedAt: '2026-09-01T00:00:00.000Z',
  boards: [{ id: 'old-board-1', boardNo: 'MB-9001', guqinNo: 'Q-9001', part: '面板', species: '桐木', dryYears: 6, thicknessMm: 30, grain: '直纹', defect: '无', receivedAt: '2026-08-01T00:00:00.000Z' }],
  chambers: [],
  lacquers: [],
  stringings: [],
});
const restored = await restoreBackup(oldBackup);
assert.equal(restored.boards, 1, '旧备份整库导入 1 条板材');
assert.equal(await db.changes.count(), 1, '旧备份整库恢复时补建 1 条摘要流水');
const oldRow: any = await db.boards.get('old-board-1');
assert.equal(oldRow.rev, 1, '旧记录补齐 rev=1');
assert.ok(oldRow.summary.includes('无变更摘要'), '旧记录补齐摘要占位');

// ---------- 场景 2：按琴号对账 ----------
// 本机：Q-9001 板材（旧数据 rev1），Q-9002 槽腹双方各自修改冲突，Q-9003 髹漆只对端改，Q-9004 上弦只本机改
await db.chambers.put({
  id: 'chamber-local-1', guqinNo: 'Q-9002', nayinThickness: 16, longchiThickness: 14, fengzhaoThickness: 15,
  chamberDepth: 26, postPos: '天柱中', poolSize: '200×22', carvedAt: '2026-09-01T00:00:00.000Z', carver: '周砚秋',
  rev: 3, updatedAt: '2026-09-20T00:00:00.000Z', summary: '本机三改纳音 14→16', deviceId: 'pad-local',
});
await db.stringings.put({
  id: 'stringing-local-1', guqinNo: 'Q-9004', stringType: '丝弦', nut: '红木雁足', stringGap: 17,
  sanNote: '本机评语', anNote: '', fanNote: '', nineVirtues: '', defects: ['无'],
  strungAt: '2026-09-10T00:00:00.000Z', operator: '甲', noteVersions: [],
  rev: 2, updatedAt: '2026-09-21T00:00:00.000Z', summary: '本机改上弦', deviceId: 'pad-local',
});
await db.changes.bulkPut([
  { id: 'chamber-local-1', stage: 'chambers', guqinNo: 'Q-9002', lastRev: 3, lastAt: '2026-09-20T00:00:00.000Z', lastSummary: '本机三改纳音 14→16', deviceId: 'pad-local', history: [{ rev: 2, at: '2026-09-10T00:00:00.000Z', summary: '本机二改', deviceId: 'pad-local' }] },
  { id: 'stringing-local-1', stage: 'stringings', guqinNo: 'Q-9004', lastRev: 2, lastAt: '2026-09-21T00:00:00.000Z', lastSummary: '本机改上弦', deviceId: 'pad-local', history: [] },
]);

// 对端备份
const incoming = {
  app: 'gbguqin',
  schemaVersion: 3,
  exportedAt: '2026-10-01T00:00:00.000Z',
  deviceId: 'pad-B',
  boards: [
    // Q-9001 同内容：keep
    oldRow,
    // 新板材：insert
    { id: 'b-new', boardNo: 'MB-9100', guqinNo: 'Q-9100', part: '底板', species: '梓木', dryYears: 5, thicknessMm: 18, grain: '直纹', defect: '无', receivedAt: '2026-09-25T00:00:00.000Z', rev: 1, updatedAt: '2026-09-25T00:00:00.000Z', summary: '对端新登记底板', deviceId: 'pad-B' },
    // 演示样例 id 且本机没有：block-demo（不注入）
    { id: 'board-001', boardNo: 'MB-2501', guqinNo: 'Q-2501', part: '面板', species: '桐木', dryYears: 8, thicknessMm: 32, grain: '直纹', defect: '无', receivedAt: '2026-01-01T00:00:00.000Z', rev: 9, updatedAt: '2026-09-25T00:00:00.000Z', summary: '对端样例', deviceId: 'pad-B', demo: true },
  ],
  chambers: [
    // Q-9002 两边都改（都 rev3）：冲突
    { id: 'chamber-remote-1', guqinNo: 'Q-9002', nayinThickness: 18, longchiThickness: 14, fengzhaoThickness: 15, chamberDepth: 26, postPos: '天柱中', poolSize: '200×22', carvedAt: '2026-09-01T00:00:00.000Z', carver: '周砚秋', rev: 3, updatedAt: '2026-09-22T00:00:00.000Z', summary: '对端改纳音到18', deviceId: 'pad-B' },
  ],
  lacquers: [
    // Q-9003 本机没有：insert；Q-9001 本机没有对应阶段记录，也 insert
    { id: 'l-1', guqinNo: 'Q-9003', seq: 1, mixRatio: '1:1', curingTemp: 24, curingHumidity: 78, polishGrit: 240, layerThickness: 0.12, totalThickness: 0, appliedAt: '2026-09-15T00:00:00.000Z', operator: '乙', rev: 1, updatedAt: '2026-09-15T00:00:00.000Z', summary: '对端髹漆第一遍', deviceId: 'pad-B' },
    { id: 'l-2', guqinNo: 'Q-9003', seq: 2, mixRatio: '1:1.5', curingTemp: 25, curingHumidity: 80, polishGrit: 400, layerThickness: 0.1, totalThickness: 0, appliedAt: '2026-09-20T00:00:00.000Z', operator: '乙', rev: 1, updatedAt: '2026-09-20T00:00:00.000Z', summary: '对端髹漆第二遍', deviceId: 'pad-B' },
  ],
  stringings: [],
  changes: [
    { id: 'chamber-remote-1', stage: 'chambers', guqinNo: 'Q-9002', lastRev: 3, lastAt: '2026-09-22T00:00:00.000Z', lastSummary: '对端改纳音到18', deviceId: 'pad-B', history: [] },
    { id: 'l-1', stage: 'lacquers', guqinNo: 'Q-9003', lastRev: 1, lastAt: '2026-09-15T00:00:00.000Z', lastSummary: '对端髹漆第一遍', deviceId: 'pad-B', history: [] },
    { id: 'l-2', stage: 'lacquers', guqinNo: 'Q-9003', lastRev: 1, lastAt: '2026-09-20T00:00:00.000Z', lastSummary: '对端髹漆第二遍', deviceId: 'pad-B', history: [] },
    { id: 'b-new', stage: 'boards', guqinNo: 'Q-9100', lastRev: 1, lastAt: '2026-09-25T00:00:00.000Z', lastSummary: '对端新登记底板', deviceId: 'pad-B', history: [] },
  ],
  mergeHistory: [
    { id: 'mhist-old', stage: 'chambers', guqinNo: 'Q-7000', matchKey: 'Q-7000', createdAt: '2026-08-01T00:00:00.000Z', winnerSide: 'incoming', localSummary: 'x', incomingSummary: 'y' },
  ],
};

const plan = await buildMergePlan(JSON.stringify(incoming));
assert.equal(plan.conflicts.length, 1, '恰好 1 处冲突（Q-9002 槽腹）');
assert.equal(plan.conflicts[0].guqinNo, 'Q-9002');
assert.equal(plan.stats.boards.inserted, 1, '板材新增 1（样例被拦截不算新增）');
assert.equal(plan.stats.boards.demoBlocked, 1, '演示样例被拦截 1');
assert.equal(plan.stats.boards.kept, 1, 'Q-9001 相同保留本机');
assert.equal(plan.stats.lacquers.inserted, 2, '髹漆新增 2 遍');
assert.equal(plan.stats.stringings.kept, 1, 'Q-9004 上弦只本机改，保留');

// 未全部选择就 apply 应报错
await assert.rejects(
  () => applyMerge(plan, { boards: {}, chambers: {}, lacquers: {}, stringings: {} }),
  /仍有冲突未选择/,
);

// 操作员选对端 → 本机版转入历史
const outcome = await applyMerge(plan, {
  boards: {},
  chambers: { 'Q-9002': 'incoming' },
  lacquers: {},
  stringings: {},
});
assert.equal(outcome.stats.chambers.conflictWon, 1);
assert.equal(outcome.stats.chambers.toHistory, 1);

const c = await counts();
assert.equal(c.boards, 2, '板材 2 条（样例未注入）');
assert.equal(c.chambers, 1, '槽腹仍 1 条（对端覆盖本机，旧 id 删除）');
assert.equal(c.lacquers, 2, '髹漆 2 遍');
assert.equal(c.stringings, 1, '上弦保留本机 1 条');
assert.equal(c.history, 2, '历史：对端带入 1 + 本次冲突转入 1');

const chamberAfter: any = await db.chambers.where('guqinNo').equals('Q-9002').first();
assert.equal(chamberAfter.id, 'chamber-remote-1', '获胜的是对端记录 id');
assert.equal(chamberAfter.nayinThickness, 18);
const chamberChanges: any = await db.changes.get('chamber-remote-1');
assert.equal(chamberChanges.lastSummary, '对端改纳音到18');
assert.ok(chamberChanges.history.some((h: any) => h.summary.includes('纳音')), '对端获胜时并入本机摘要历史');

// 髹漆累计厚度已重算
const l1: any = await db.lacquers.get('l-1');
const l2: any = await db.lacquers.get('l-2');
assert.equal(l1.totalThickness, 0.12);
assert.equal(Number(l2.totalThickness.toFixed(3)), 0.22, '第二遍累计 0.22');

// 历史条目内容完整，供后补
const newHistory = await db.mergeHistory.where('createdAt').above('2026-10-01T00:00:00.000Z').first();
assert.ok(newHistory, '存在新转入的历史');
assert.equal(newHistory!.winnerSide, 'incoming');
assert.ok((newHistory!.local as any).nayinThickness === 16, '历史中保留本机版本');
assert.ok((newHistory!.incoming as any).nayinThickness === 18, '历史中保留对端版本');

// 演示样例确实没注入
assert.equal(await db.boards.get('board-001'), undefined, '演示样例不得通过合并写入');

// keep-local 时摘要流水的最近一条仍是本机的
assert.ok(oldRow.rev === 1);
const keptChanges: any = await db.changes.get('old-board-1');
assert.ok(keptChanges, '相同记录也有摘要流水');
assert.ok(String(keptChanges.lastSummary).includes('无变更摘要'), 'keep-local 时最近摘要不被对端顶掉');

// ---------- 场景 3：正式记录不能被演示样例改写 ----------
await reset();
await db.boards.put({
  id: 'board-001', boardNo: 'MB-FORMAL', guqinNo: 'Q-2501', part: '面板', species: '杉木', dryYears: 20,
  thicknessMm: 40, grain: '直纹', defect: '无', receivedAt: '2026-01-01T00:00:00.000Z',
  rev: 5, updatedAt: '2026-09-25T00:00:00.000Z', summary: '正式记录五改', deviceId: 'pad-local',
  demo: false,
});
const demoBackup = JSON.stringify({
  app: 'gbguqin', schemaVersion: 3, exportedAt: '2026-10-01T00:00:00.000Z', deviceId: 'pad-demo',
  boards: [{ id: 'board-001', boardNo: 'MB-DEMO', guqinNo: 'Q-2501', part: '面板', species: '桐木', dryYears: 1, thicknessMm: 10, grain: '直纹', defect: '无', receivedAt: '2026-01-01T00:00:00.000Z', rev: 99, updatedAt: '2026-10-02T00:00:00.000Z', summary: '演示样例改', demo: true }],
  chambers: [], lacquers: [], stringings: [], changes: [], mergeHistory: [],
});
const plan3 = await buildMergePlan(demoBackup);
assert.equal(plan3.stats.boards.demoBlocked, 1, '正式记录拦截高修订号样例');
assert.equal(plan3.conflicts.length, 0, '不算冲突，直接保护');
await applyMerge(plan3, { boards: {}, chambers: {}, lacquers: {}, stringings: {} });
const protectedRow: any = await db.boards.get('board-001');
assert.equal(protectedRow.boardNo, 'MB-FORMAL', '正式记录未被演示样例改写');
assert.equal(protectedRow.thicknessMm, 40);

// ---------- 场景 4：本机是未改样例、对端是正式记录 → 正式接管 ----------
await reset();
await db.boards.put({
  id: 'board-001', boardNo: 'MB-2501', guqinNo: 'Q-2501', part: '面板', species: '桐木', dryYears: 8,
  thicknessMm: 32, grain: '直纹', defect: '无', receivedAt: '2026-01-01T00:00:00.000Z',
  rev: 1, updatedAt: '2026-01-01T00:00:00.000Z', summary: '演示样例初始数据', demo: true,
});
const formalBackup = JSON.stringify({
  app: 'gbguqin', schemaVersion: 3, exportedAt: new Date().toISOString(), deviceId: 'pad-B',
  boards: [{ id: 'board-formal-x', boardNo: 'MB-FORMAL-X', guqinNo: 'Q-2501', part: '面板', species: '杉木', dryYears: 10, thicknessMm: 33, grain: '水波纹', defect: '无', receivedAt: '2026-02-01T00:00:00.000Z', rev: 2, updatedAt: '2026-09-01T00:00:00.000Z', summary: '对端转正式记录', deviceId: 'pad-B' }],
  chambers: [], lacquers: [], stringings: [], changes: [
    { id: 'board-formal-x', stage: 'boards', guqinNo: 'Q-2501', lastRev: 2, lastAt: '2026-09-01T00:00:00.000Z', lastSummary: '对端转正式记录', deviceId: 'pad-B', history: [] },
  ], mergeHistory: [],
});
const plan4 = await buildMergePlan(formalBackup);
assert.equal(plan4.stats.boards.updated, 1, '正式记录接管样例');
await applyMerge(plan4, { boards: {}, chambers: {}, lacquers: {}, stringings: {} });
const taken: any = await db.boards.where('guqinNo').equals('Q-2501').first();
assert.equal(taken.id, 'board-formal-x', '样例被正式记录替换');
assert.equal(taken.demo, undefined, '接管后不带 demo 标记');

// ---------- 场景 5：导出时随四个阶段保存变更摘要 ----------
const backup = await buildBackup();
assert.equal(backup.app, 'gbguqin');
assert.ok(backup.deviceId.startsWith('pad-'), '导出含本机设备号');
assert.ok(Array.isArray(backup.changes), '导出含变更摘要表');
assert.ok(Array.isArray(backup.mergeHistory), '导出含后补历史表');
assert.equal(backup.boards.length, 1);
// 自描述校验
assert.doesNotThrow(() => parseBackup(JSON.stringify(backup)));

// meta 可读写冒烟
await setMeta('k', 'v');
assert.equal((await db.meta.get('k'))?.value, 'v');

console.log('全部合并场景断言通过 ✅', await counts());
process.exit(0);

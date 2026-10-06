/* 验证老用户浏览器（v2 schema 数据）升级到 v3：回填同步元信息 + changes 表 + demo 标记 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import assert from 'node:assert';

const DB_NAME = 'gbguqin-db';

// 1) 用裸 Dexie 建一个 v2 结构的老库，写入无同步字段的旧数据
const oldDb = new Dexie(DB_NAME);
oldDb.version(1).stores({
  boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
  chambers: 'id, guqinNo, postPos, carvedAt',
  lacquers: 'id, guqinNo, seq, appliedAt',
  stringings: 'id, guqinNo, stringType, strungAt',
  meta: 'key',
});
oldDb.version(2).stores({
  boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
  chambers: 'id, guqinNo, postPos, carvedAt',
  lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt',
  stringings: 'id, guqinNo, stringType, strungAt',
  meta: 'key',
});
await oldDb.table('boards').bulkPut([
  { id: 'board-001', boardNo: 'MB-2501', guqinNo: 'Q-2501', part: '面板', species: '桐木', dryYears: 8, thicknessMm: 32, grain: '直纹', defect: '无', receivedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'board-real-1', boardNo: 'MB-8001', guqinNo: 'Q-8001', part: '底板', species: '梓木', dryYears: 6, thicknessMm: 18, grain: '直纹', defect: '无', receivedAt: '2026-02-01T00:00:00.000Z' },
]);
await oldDb.table('chambers').put({
  id: 'chamber-001', guqinNo: 'Q-2501', nayinThickness: 16, longchiThickness: 14, fengzhaoThickness: 15,
  chamberDepth: 26, postPos: '天柱中', poolSize: '200×22', carvedAt: '2026-03-01T00:00:00.000Z', carver: '周砚秋',
});
await oldDb.close();

// 2) 用应用代码打开同一库，自动跑 v3 升级
const { db } = await import('../src/utils/db');
await db.open();

const seedBoard: any = await db.boards.get('board-001');
assert.equal(seedBoard.rev, 1, '旧板材回填 rev=1');
assert.ok(String(seedBoard.summary).includes('无变更摘要'), '旧板材回填摘要占位');
assert.equal(seedBoard.updatedAt, '2026-01-01T00:00:00.000Z', 'updatedAt 回退到入库时间');
assert.equal(seedBoard.demo, true, '内置示例 id 自动标 demo');

const realBoard: any = await db.boards.get('board-real-1');
assert.equal(realBoard.demo, undefined, '正式记录不标 demo');

const changeSeed = await db.changes.get('board-001');
assert.ok(changeSeed, 'changes 表为旧记录建立摘要流水');
assert.equal(changeSeed!.stage, 'boards');
assert.equal(changeSeed!.guqinNo, 'Q-2501');

const changeChamber = await db.changes.get('chamber-001');
assert.equal(changeChamber!.stage, 'chambers');

const allChanges = await db.changes.count();
assert.equal(allChanges, 3, '两张板材 + 一条槽腹，共 3 条摘要流水');
const mergeHistoryCount = await db.mergeHistory.count();
assert.equal(mergeHistoryCount, 0, 'mergeHistory 为空但表已建立');

console.log('v2 → v3 升级验证通过 ✅');
process.exit(0);

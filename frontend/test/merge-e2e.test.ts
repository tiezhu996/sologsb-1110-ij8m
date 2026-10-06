import 'fake-indexeddb/auto';
import assert from 'node:assert';
import { db } from '../src/utils/db';
import { setMeta } from '../src/utils/db';
import { getDevice } from '../src/utils/device';
import { buildReconcilePlan, applyMergePlan, loadLocalState } from '../src/utils/merge';
import type { BackupPayload } from '../src/utils/export';
import type { ChangeEntry, DeviceInfo } from '../src/types/changes';
import type { WoodBoard } from '../src/types/wood-board';
import type { LacquerLayer } from '../types/lacquer-layer';

async function resetDb() {
  await db.delete();
  await db.open();
}

let counter = 0;
function chg(dev: DeviceInfo, patch: Partial<ChangeEntry> & Pick<ChangeEntry, 'stage' | 'guqinNo' | 'recordId' | 'action' | 'summary'>): ChangeEntry {
  counter += 1;
  return {
    id: `${dev.deviceId}-chg-${counter}`,
    snapshots: patch.snapshots ?? [],
    changedAt: new Date(Date.now() + counter).toISOString(),
    operator: dev.deviceName,
    deviceId: dev.deviceId,
    seq: counter,
    status: 'pending',
    ...patch,
  };
}

const devA: DeviceInfo = { deviceId: 'dev-A', deviceName: '平板甲', createdAt: '' };
const devB: DeviceInfo = { deviceId: 'dev-B', deviceName: '平板乙', createdAt: '' };

const boardRow = (p: Partial<WoodBoard> & Pick<WoodBoard, 'id' | 'guqinNo'>): WoodBoard => ({
  boardNo: 'MB-1', part: '面板', species: '桐木', dryYears: 5, thicknessMm: 30,
  grain: '直纹', defect: '无', receivedAt: '2026-09-01', ...p,
});
const layerRow = (p: Partial<LacquerLayer> & Pick<LacquerLayer, 'id' | 'guqinNo' | 'seq'>): LacquerLayer => ({
  mixRatio: '1:1', curingTemp: 24, curingHumidity: 78, polishGrit: 320,
  layerThickness: 0.1, totalThickness: 0, appliedAt: '2026-09-20', operator: '林听雪', ...p,
});

// 场景 A：两边都改板材——本机胜出，对端摘要转入历史，本机行保留
{
  await resetDb();
  await setMeta('device', JSON.stringify(devA));
  const localRow = boardRow({ id: 'b1', guqinNo: 'Q-1', thicknessMm: 32 });
  await db.boards.put(localRow);
  await db.changes.bulkPut([chg(devA, { stage: 'board', guqinNo: 'Q-1', recordId: 'b1', action: 'update', summary: '本机改32', snapshots: [localRow], seq: 1 })]);

  const incomingRow = boardRow({ id: 'b1', guqinNo: 'Q-1', thicknessMm: 28 });
  const payload: BackupPayload = {
    app: 'gbguqin', schemaVersion: 3, exportedAt: new Date().toISOString(), device: devB,
    boards: [incomingRow], chambers: [], lacquers: [], stringings: [],
    changes: [chg(devB, { stage: 'board', guqinNo: 'Q-1', recordId: 'b1', action: 'update', summary: '对端改28', snapshots: [incomingRow], seq: 1 })],
  };

  const device = await getDevice();
  const state = await loadLocalState(device);
  const plan = buildReconcilePlan({ ...state, localDevice: device, payload });
  const item = plan.groups[0].items[0];
  assert.equal(item.kind, 'both');
  item.resolution = 'local';
  const result = await applyMergePlan(plan, payload);

  const after = await db.boards.get('b1');
  assert.equal(after?.thicknessMm, 32, '本机胜出应保留本机行');
  const history = await db.history.toArray();
  assert.equal(history.length, 1, '未选的对端改动应转入历史');
  assert.equal(history[0].summary, '对端改28');
  assert.equal(history[0].adoptedAt, undefined);
  const localEntry = await db.changes.get('dev-A-chg-1');
  assert.equal(localEntry?.status, 'accepted');
  assert.equal(result.conflictUnits, 1);
  console.log('✓ 场景A 两边冲突选本机：本机行保留，对端摘要入历史待后补做');
}

// 场景 B：对端胜出——写入对端行；本机独有行被移入历史并从业务表删除
{
  await resetDb();
  await setMeta('device', JSON.stringify(devA));
  await db.boards.bulkPut([
    boardRow({ id: 'b1', guqinNo: 'Q-1', thicknessMm: 32 }),
    boardRow({ id: 'b2', guqinNo: 'Q-1', boardNo: 'MB-2', thicknessMm: 30 }), // 本机独有新建
  ]);
  const localB1 = boardRow({ id: 'b1', guqinNo: 'Q-1', thicknessMm: 32 });
  const localB2 = boardRow({ id: 'b2', guqinNo: 'Q-1', boardNo: 'MB-2', thicknessMm: 30 });
  await db.changes.bulkPut([
    chg(devA, { stage: 'board', guqinNo: 'Q-1', recordId: 'b1', action: 'update', summary: '本机改', seq: 1, snapshots: [localB1] }),
    chg(devA, { stage: 'board', guqinNo: 'Q-1', recordId: 'b2', action: 'create', summary: '本机新建', seq: 2, snapshots: [localB2] }),
  ]);
  const incomingRow = boardRow({ id: 'b1', guqinNo: 'Q-1', thicknessMm: 28 });
  const payload: BackupPayload = {
    app: 'gbguqin', schemaVersion: 3, exportedAt: new Date().toISOString(), device: devB,
    boards: [incomingRow], chambers: [], lacquers: [], stringings: [],
    changes: [chg(devB, { stage: 'board', guqinNo: 'Q-1', recordId: 'b1', action: 'update', summary: '对端改', seq: 1 })],
  };
  const device = await getDevice();
  const state = await loadLocalState(device);
  const plan = buildReconcilePlan({ ...state, localDevice: device, payload });
  plan.groups[0].items[0].resolution = 'incoming';
  await applyMergePlan(plan, payload);

  const afterB1 = await db.boards.get('b1');
  assert.equal(afterB1?.thicknessMm, 28);
  assert.equal(await db.boards.get('b2'), undefined, '本机独有行应从业务表移除');
  const history = await db.history.toArray();
  const summaries = history.map((h) => h.summary);
  assert.ok(summaries.includes('本机改'), '本机改动入历史');
  assert.ok(summaries.includes('本机新建'), '本机独有新建入历史');

  // 后补做：取回采用本机独有行
  const histB2 = history.find((h) => h.recordId === 'b2')!;
  const { useHistoryStore } = await import('../src/stores/historyStore');
  const { setActivePinia, createPinia } = await import('pinia');
  setActivePinia(createPinia());
  const historyStore = useHistoryStore();
  await historyStore.hydrate();
  await historyStore.adopt(histB2.id);
  const reborn = await db.boards.get('b2');
  assert.equal(reborn?.thicknessMm, 30);
  const histAfter = await db.history.get(histB2.id);
  assert.ok(histAfter?.adoptedAt, '采用后历史条目标记 adoptedAt');
  console.log('✓ 场景B 对端胜出：覆盖现行行，本机独有内容入历史并可取回采用');
}

// 场景 C：正式记录不被演示样例改写
{
  await resetDb();
  await setMeta('device', JSON.stringify(devA));
  await db.boards.put(boardRow({ id: 'b1', guqinNo: 'Q-1', thicknessMm: 32 })); // 正式记录（无 isDemo）
  const demoRow = boardRow({ id: 'b1', guqinNo: 'Q-1', thicknessMm: 18, isDemo: true });
  const payload: BackupPayload = {
    app: 'gbguqin', schemaVersion: 3, exportedAt: new Date().toISOString(), device: devB,
    boards: [demoRow], chambers: [], lacquers: [], stringings: [], changes: undefined,
  };
  const device = await getDevice();
  const state = await loadLocalState(device);
  const plan = buildReconcilePlan({ ...state, localDevice: device, payload });
  // 旧备份降级：同 id 差异为 both
  plan.groups[0].items[0].resolution = 'incoming';
  const result = await applyMergePlan(plan, payload);
  const after = await db.boards.get('b1');
  assert.equal(after?.thicknessMm, 32, '正式记录不得被演示样例覆盖');
  assert.equal(result.demoSkipped.length, 1);
  console.log('✓ 场景C 正式记录不被演示样例改写（拦截计数正确）');
}

// 场景 D：对端删除重放 + 髹漆累计厚度重算
{
  await resetDb();
  await setMeta('device', JSON.stringify(devA));
  const l1 = layerRow({ id: 'l1', guqinNo: 'Q-5', seq: 1, layerThickness: 0.1, totalThickness: 0.1 });
  const l2 = layerRow({ id: 'l2', guqinNo: 'Q-5', seq: 2, layerThickness: 0.1, totalThickness: 0.2 });
  const l3 = layerRow({ id: 'l3', guqinNo: 'Q-5', seq: 3, layerThickness: 0.1, totalThickness: 0.3 });
  await db.lacquers.bulkPut([l1, l2, l3]);
  await db.boards.put(boardRow({ id: 'bX', guqinNo: 'Q-5', thicknessMm: 30 }));
  const payload: BackupPayload = {
    app: 'gbguqin', schemaVersion: 3, exportedAt: new Date().toISOString(), device: devB,
    boards: [],
    chambers: [],
    lacquers: [
      layerRow({ id: 'l1', guqinNo: 'Q-5', seq: 1, layerThickness: 0.1, totalThickness: 0.1 }),
      layerRow({ id: 'l2', guqinNo: 'Q-5', seq: 2, layerThickness: 0.12, totalThickness: 0.22 }),
    ],
    stringings: [],
    changes: [
      chg(devB, { stage: 'lacquer', guqinNo: 'Q-5', recordId: 'l3', action: 'delete', summary: '删除第三遍', snapshots: [l3], seq: 1 }),
      chg(devB, { stage: 'lacquer', guqinNo: 'Q-5', recordId: 'l2', action: 'update', summary: '第二遍改厚', snapshots: [l2], seq: 2 }),
    ],
  };
  const device = await getDevice();
  const state = await loadLocalState(device);
  const plan = buildReconcilePlan({ ...state, localDevice: device, payload });
  assert.equal(plan.groups[0].items[0].kind, 'incomingOnly', '本机未改髹漆，应直接接受对端');
  const result = await applyMergePlan(plan, payload);
  const rows = await db.lacquers.where('guqinNo').equals('Q-5').toArray();
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === 'l3'), undefined, '对端删除应重放');
  const l2after = rows.find((r) => r.id === 'l2')!;
  assert.equal(l2after.layerThickness, 0.12);
  assert.equal(l2after.totalThickness, 0.22, '累计厚度应按对端现行值重算/落库');
  assert.equal(result.replayedDeletes, 1);
  const bX = await db.boards.get('bX');
  assert.ok(bX, '未对账阶段的数据不受影响');
  console.log('✓ 场景D 对端删除重放、髹漆累计厚度正确、其他阶段不受影响');
}

// 场景 E：同一备份二次合并为空（水位）
{
  await resetDb();
  await setMeta('device', JSON.stringify(devA));
  const incomingRow = boardRow({ id: 'b9', guqinNo: 'Q-9', thicknessMm: 29 });
  const payload: BackupPayload = {
    app: 'gbguqin', schemaVersion: 3, exportedAt: new Date().toISOString(), device: devB,
    boards: [incomingRow], chambers: [], lacquers: [], stringings: [],
    changes: [chg(devB, { stage: 'board', guqinNo: 'Q-9', recordId: 'b9', action: 'create', summary: '新增', seq: 1, snapshots: [incomingRow] })],
  };
  const device = await getDevice();
  let state = await loadLocalState(device);
  let plan = buildReconcilePlan({ ...state, localDevice: device, payload });
  assert.equal(plan.groups.length, 1);
  await applyMergePlan(plan, payload);
  state = await loadLocalState(device);
  plan = buildReconcilePlan({ ...state, localDevice: device, payload });
  assert.equal(plan.groups.length, 0, '重复导入同一备份不应再次对账');
  console.log('✓ 场景E 设备水位使重复导入同一备份不再产生对账单元');
}

console.log('\n全部端到端合并断言通过');

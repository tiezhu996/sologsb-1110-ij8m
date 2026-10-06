import assert from 'node:assert';
import { buildReconcilePlan, type TableSet } from '../src/utils/merge';
import type { BackupPayload } from '../src/utils/export';
import type { ChangeEntry, DeviceInfo } from '../src/types/changes';
import type { WoodBoard } from '../src/types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { Stringing } from '../types/stringing';

const devA: DeviceInfo = { deviceId: 'dev-A', deviceName: '平板甲', createdAt: '2026-09-01' };
const devB: DeviceInfo = { deviceId: 'dev-B', deviceName: '平板乙', createdAt: '2026-09-01' };

let seqA = 0;
let seqB = 0;
function chg(dev: DeviceInfo, patch: Partial<ChangeEntry> & Pick<ChangeEntry, 'stage' | 'guqinNo' | 'recordId' | 'action' | 'summary'>): ChangeEntry {
  const seq = dev.deviceId === 'dev-A' ? ++seqA : ++seqB;
  return {
    id: `${dev.deviceId}-${seq}`,
    snapshots: [],
    changedAt: new Date(2026, 9, seq).toISOString(),
    operator: dev.deviceName,
    deviceId: dev.deviceId,
    seq,
    status: 'pending',
    ...patch,
  };
}

const board = (p: Partial<WoodBoard> & Pick<WoodBoard, 'id' | 'guqinNo'>): WoodBoard => ({
  boardNo: 'MB-1', part: '面板', species: '桐木', dryYears: 5, thicknessMm: 30,
  grain: '直纹', defect: '无', receivedAt: '2026-09-01',
  ...p,
});
const chamber = (p: Partial<SoundChamber> & Pick<SoundChamber, 'id' | 'guqinNo'>): SoundChamber => ({
  nayinThickness: 15, longchiThickness: 13, fengzhaoThickness: 14, chamberDepth: 25,
  postPos: '天柱中', poolSize: '200×22', carvedAt: '2026-09-05', carver: '周砚秋',
  ...p,
});
const stringing = (p: Partial<Stringing> & Pick<Stringing, 'id' | 'guqinNo'>): Stringing => ({
  stringType: '丝弦', nut: '红木', stringGap: 17, sanNote: '', anNote: '', fanNote: '',
  nineVirtues: '', defects: ['无'], strungAt: '2026-09-10', operator: '周砚秋', noteVersions: [],
  ...p,
});

const localTables: TableSet = {
  boards: [board({ id: 'b1', guqinNo: 'Q-1', thicknessMm: 30 })],
  chambers: [chamber({ id: 'c1', guqinNo: 'Q-1' })],
  lacquers: [],
  stringings: [stringing({ id: 's1', guqinNo: 'Q-2' })],
};

function payload(over: Partial<BackupPayload>): BackupPayload {
  return {
    app: 'gbguqin', schemaVersion: 3, exportedAt: '2026-10-05T00:00:00Z',
    device: devB, boards: [], chambers: [], lacquers: [], stringings: [], changes: [],
    ...over,
  };
}

// 场景 1：三个单元——本机独改（Q-1 板材）、对端独改（Q-1 槽腹）、两边都改（Q-2 上弦）
{
  const localChanges = [
    chg(devA, { stage: 'board', guqinNo: 'Q-1', recordId: 'b1', action: 'update', summary: '本机改板材' }),
    chg(devA, { stage: 'stringing', guqinNo: 'Q-2', recordId: 's1', action: 'update', summary: '本机改评语' }),
  ];
  const incomingChanges = [
    chg(devB, { stage: 'chamber', guqinNo: 'Q-1', recordId: 'c1', action: 'update', summary: '对端改槽腹' }),
    chg(devB, { stage: 'stringing', guqinNo: 'Q-2', recordId: 's1', action: 'update', summary: '对端改评语' }),
  ];
  const p = payload({
    changes: incomingChanges,
    boards: localTables.boards,
    chambers: localTables.chambers,
    stringings: localTables.stringings,
  });
  const plan = buildReconcilePlan({ localTables, localChanges, localDevice: devA, payload: p, watermarks: {} });
  const flat = plan.groups.flatMap((g) => g.items.map((i) => ({ g: g.guqinNo, ...i })));
  const by = (g: string, s: string) => flat.find((f) => f.g === g && f.stage === s)!;

  assert.equal(plan.legacy, false);
  assert.equal(by('Q-1', 'board').kind, 'localOnly');
  assert.equal(by('Q-1', 'board').resolution, 'local');
  assert.equal(by('Q-1', 'chamber').kind, 'incomingOnly');
  assert.equal(by('Q-1', 'chamber').resolution, 'incoming');
  assert.equal(by('Q-2', 'stringing').kind, 'both');
  assert.equal(by('Q-2', 'stringing').resolution, null);
  assert.equal(by('Q-2', 'stringing').local!.entries.length, 1);
  assert.equal(by('Q-2', 'stringing').incoming!.entries.length, 1);
  console.log('✓ 场景1 单机独改/对端独改/两边冲突的归类与默认处置正确');
}

// 场景 2：水位过滤——对端 seq <= 水位的旧变更不再产生对账单元
{
  const incomingChanges = [
    chg(devB, { stage: 'chamber', guqinNo: 'Q-9', recordId: 'c9', action: 'create', summary: '旧变更' }),
  ];
  const p = payload({ changes: incomingChanges });
  const plan = buildReconcilePlan({
    localTables: { boards: [], chambers: [], lacquers: [], stringings: [] },
    localChanges: [], localDevice: devA, payload: p,
    watermarks: { 'dev-B': { seq: 100, at: '2026-10-01' } },
  });
  assert.equal(plan.groups.length, 0);
  console.log('✓ 场景2 设备水位过滤已合并备份，无重复对账');
}

// 场景 3：旧备份（无 changes）降级——新增直接接受，同 id 不一致并列
{
  const p = payload({
    changes: undefined,
    schemaVersion: 1,
    boards: [
      board({ id: 'b1', guqinNo: 'Q-1', thicknessMm: 31 }), // 与本机不一致
      board({ id: 'b9', guqinNo: 'Q-9', thicknessMm: 28 }), // 对端新增
    ],
    chambers: [chamber({ id: 'c1', guqinNo: 'Q-1' })], // 与本机一致
  });
  const plan = buildReconcilePlan({ localTables, localChanges: [], localDevice: devA, payload: p, watermarks: {} });
  assert.equal(plan.legacy, true);
  const flat = plan.groups.flatMap((g) => g.items.map((i) => ({ g: g.guqinNo, ...i })));
  const conflict = flat.find((f) => f.stage === 'board' && f.g === 'Q-1')!;
  const added = flat.find((f) => f.stage === 'board' && f.g === 'Q-9')!;
  assert.equal(conflict.kind, 'both');
  assert.equal(conflict.resolution, null);
  assert.equal(added.kind, 'incomingOnly');
  assert.equal(added.resolution, 'incoming');
  assert.ok(!flat.some((f) => f.stage === 'chamber'), '一致的行不应产生对账单元');
  console.log('✓ 场景3 旧备份降级：差异行并列、新增直接接受、一致行跳过');
}

// 场景 4：本机回灌自己的备份不产生任何单元
{
  const p = payload({ device: devA, changes: [chg(devA, { stage: 'board', guqinNo: 'Q-1', recordId: 'b1', action: 'update', summary: '本机' })] });
  const plan = buildReconcilePlan({ localTables, localChanges: [], localDevice: devA, payload: p, watermarks: {} });
  assert.equal(plan.groups.length, 0);
  console.log('✓ 场景4 导入本机自己的备份不产生对账单元');
}

console.log('\n全部对账计划断言通过');

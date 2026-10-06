import { db, getMeta, setMeta } from './db';
import { uid } from './id';
import { toPlain } from './plain';
import { cumulativeThickness } from './layer';
import { fullSummary } from './summary';
import { stageTable } from './stage-table';
import type { DeviceInfo } from './device';
import type { WoodBoard } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';
import type {
  ChangeEntry,
  DeferredRecord,
  ReconcileGroup,
  ReconcileItem,
  StageKey,
} from '../types/changes';
import type { BackupPayload } from './export';

/** 四张业务表的行集合 */
export interface TableSet {
  boards: WoodBoard[];
  chambers: SoundChamber[];
  lacquers: LacquerLayer[];
  stringings: Stringing[];
}

const STAGE_TABLE: Record<StageKey, keyof TableSet> = {
  board: 'boards',
  chamber: 'chambers',
  lacquer: 'lacquers',
  stringing: 'stringings',
};

const STAGES: StageKey[] = ['board', 'chamber', 'lacquer', 'stringing'];

export interface ReconcilePlan {
  groups: ReconcileGroup[];
  /** 备份来自旧版本（无变更摘要台账），按行差异降级对账 */
  legacy: boolean;
  incomingDevice: DeviceInfo | null;
  exportedAt?: string;
  /** 对端待对账的变更条数（摘要模式） */
  incomingChangeCount: number;
}

export interface MergeResult {
  /** 完成对账的单元数（直接接受 + 冲突选择） */
  acceptedUnits: number;
  /** 两边都改过、由操作员选择的单元数 */
  conflictUnits: number;
  /** 转入历史的未选变更条数 */
  deferredCount: number;
  /** 正式记录被演示样例拦截的条数 */
  demoSkipped: Array<{ stage: StageKey; guqinNo: string; recordId: string }>;
  /** 同步过来的删除动作数 */
  replayedDeletes: number;
}

type Watermarks = Record<string, { seq: number; at: string }>;

async function getWatermarks(): Promise<Watermarks> {
  const raw = await getMeta('merge-watermarks');
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Watermarks;
  } catch {
    return {};
  }
}

function rowsOfStage(tables: TableSet, stage: StageKey, guqinNo: string): unknown[] {
  return (tables[STAGE_TABLE[stage]] as Array<{ guqinNo: string }>).filter((r) => r.guqinNo === guqinNo);
}

function rowId(row: unknown): string {
  return (row as { id?: string }).id ?? '';
}

/** 忽略 isDemo 差异后的稳定序列化，用于判断行内容是否一致（旧备份降级对账） */
function stableRow(row: unknown): string {
  const clone = { ...(row as Record<string, unknown>) } as Record<string, unknown>;
  delete clone.isDemo;
  return JSON.stringify(clone, Object.keys(clone).sort());
}

function rowsEqual(a: unknown, b: unknown): boolean {
  return stableRow(a) === stableRow(b);
}

function rowDate(stage: StageKey, row: unknown): string {
  const r = row as Record<string, string | undefined>;
  return r.receivedAt ?? r.carvedAt ?? r.appliedAt ?? r.strungAt ?? new Date(0).toISOString();
}

/** 旧备份没有变更摘要，按差异行合成临时条目（仅用于本次对账展示） */
function makeSynthetic(
  stage: StageKey,
  deviceId: string,
  deviceName: string,
  row: unknown,
  action: ChangeEntry['action'],
  changedAt: string,
): ChangeEntry {
  return {
    id: `synthetic-${stage}-${rowId(row)}-${action}`,
    stage,
    guqinNo: (row as { guqinNo?: string }).guqinNo ?? '',
    recordId: rowId(row),
    action,
    summary: fullSummary(action, stage, [row]),
    snapshots: [row],
    changedAt,
    operator: deviceName,
    deviceId,
    seq: 0,
    status: 'pending',
  };
}

function groupItems(items: ReconcileItem[]): ReconcileGroup[] {
  const map = new Map<string, ReconcileItem[]>();
  for (const item of items) {
    const list = map.get(item.guqinNo) ?? [];
    list.push(item);
    map.set(item.guqinNo, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'zh-Hans-CN'))
    .map(([guqinNo, list]) => ({
      guqinNo,
      items: STAGES.filter((s) => list.some((i) => i.stage === s)).map((s) => list.find((i) => i.stage === s)!),
    }));
}

/** 并列展示时同一边的摘要：最新的在前 */
function sortSide(entries: ChangeEntry[]): ChangeEntry[] {
  return [...entries].sort((a, b) => (a.changedAt < b.changedAt ? 1 : -1));
}

function tablesFromPayload(payload: BackupPayload): TableSet {
  return {
    boards: (payload.boards ?? []) as WoodBoard[],
    chambers: (payload.chambers ?? []) as SoundChamber[],
    lacquers: (payload.lacquers ?? []) as LacquerLayer[],
    stringings: (payload.stringings ?? []) as Stringing[],
  };
}

/**
 * 按琴号 × 阶段构建对账计划：
 * - 只在一边改过（localOnly / incomingOnly）：直接接受
 * - 两边都改过（both）：并列摘要，resolution 留待操作员选择
 * - 旧备份没有 changes 字段：按业务行差异降级生成对账单元
 */
export function buildReconcilePlan(params: {
  localTables: TableSet;
  localChanges: ChangeEntry[];
  localDevice: DeviceInfo;
  payload: BackupPayload;
  watermarks: Watermarks;
}): ReconcilePlan {
  const { localTables, localChanges, localDevice, payload, watermarks } = params;
  const incomingDevice = payload.device ?? null;
  const legacy = !Array.isArray(payload.changes);

  if (legacy) {
    return {
      groups: buildLegacyPlan(localTables, tablesFromPayload(payload), localDevice, incomingDevice),
      legacy: true,
      incomingDevice,
      exportedAt: payload.exportedAt,
      incomingChangeCount: 0,
    };
  }

  const wm = incomingDevice ? watermarks[incomingDevice.deviceId]?.seq ?? 0 : 0;
  const incomingChanges = (payload.changes ?? []).filter(
    (e) =>
      e.deviceId !== localDevice.deviceId &&
      e.status !== 'deferred' &&
      !(incomingDevice && e.deviceId === incomingDevice.deviceId && e.seq <= wm),
  );

  const units = new Map<string, ReconcileItem>();
  const keyOf = (guqinNo: string, stage: StageKey) => `${guqinNo}::${stage}`;
  const ensure = (guqinNo: string, stage: StageKey): ReconcileItem => {
    const key = keyOf(guqinNo, stage);
    let item = units.get(key);
    if (!item) {
      item = { guqinNo, stage, kind: 'localOnly', local: null, incoming: null, resolution: null };
      units.set(key, item);
    }
    return item;
  };

  for (const entry of localChanges.filter((e) => e.status === 'pending')) {
    const item = ensure(entry.guqinNo, entry.stage);
    item.local = {
      deviceId: localDevice.deviceId,
      entries: sortSide([...(item.local?.entries ?? []), entry]),
    };
  }

  for (const entry of incomingChanges) {
    const item = ensure(entry.guqinNo, entry.stage);
    item.incoming = {
      deviceId: entry.deviceId,
      exportedAt: payload.exportedAt,
      entries: sortSide([...(item.incoming?.entries ?? []), entry]),
    };
  }

  const items = Array.from(units.values()).map((item): ReconcileItem => {
    const kind: ReconcileItem['kind'] =
      item.local && item.incoming ? 'both' : item.incoming ? 'incomingOnly' : 'localOnly';
    const resolution: ReconcileItem['resolution'] =
      kind === 'both' ? null : kind === 'incomingOnly' ? 'incoming' : 'local';
    return { ...item, kind, resolution };
  });

  return {
    groups: groupItems(items),
    legacy: false,
    incomingDevice,
    exportedAt: payload.exportedAt,
    incomingChangeCount: incomingChanges.length,
  };
}

/** 旧备份降级对账：按主键比对行；对端新增直接接受，同行两边不一致并列给操作员选择 */
function buildLegacyPlan(
  localTables: TableSet,
  incomingTables: TableSet,
  localDevice: DeviceInfo,
  incomingDevice: DeviceInfo | null,
): ReconcileGroup[] {
  const remoteId = incomingDevice?.deviceId ?? 'legacy-backup';
  const remoteName = incomingDevice?.deviceName ?? '旧备份';
  const items: ReconcileItem[] = [];

  for (const stage of STAGES) {
    const localAll = localTables[STAGE_TABLE[stage]] as unknown[];
    const incomingAll = incomingTables[STAGE_TABLE[stage]] as unknown[];
    const localById = new Map(localAll.map((r) => [rowId(r), r]));

    for (const incomingRow of incomingAll) {
      const guqinNo = (incomingRow as { guqinNo?: string }).guqinNo ?? '';
      const localRow = localById.get(rowId(incomingRow));
      if (localRow && rowsEqual(localRow, incomingRow)) continue;

      const incomingEntry = makeSynthetic(
        stage,
        remoteId,
        remoteName,
        incomingRow,
        localRow ? 'update' : 'create',
        rowDate(stage, incomingRow),
      );
      const localEntry = localRow
        ? makeSynthetic(stage, localDevice.deviceId, localDevice.deviceName, localRow, 'update', rowDate(stage, localRow))
        : null;

      items.push({
        guqinNo,
        stage,
        kind: localEntry ? 'both' : 'incomingOnly',
        local: localEntry ? { deviceId: localDevice.deviceId, entries: [localEntry] } : null,
        incoming: { deviceId: remoteId, entries: [incomingEntry] },
        resolution: localEntry ? null : 'incoming',
      });
    }
  }

  return groupItems(items);
}

function deleteEntryIds(side: ReconcileItem['incoming']): Set<string> {
  return new Set((side?.entries ?? []).filter((e) => e.action === 'delete').map((e) => e.recordId));
}

function toHistoryRows(entries: ChangeEntry[], deferredAt: string): DeferredRecord[] {
  return entries.map((entry) => ({
    id: uid('hist'),
    stage: entry.stage,
    guqinNo: entry.guqinNo,
    recordId: entry.recordId,
    deviceId: entry.deviceId,
    summary: entry.summary,
    action: entry.action,
    snapshots: entry.snapshots,
    changedAt: entry.changedAt,
    deferredAt,
  }));
}

/** 读取本机当前四表、待对账变更与设备水位 */
export async function loadLocalState(localDevice: DeviceInfo): Promise<{
  localTables: TableSet;
  localChanges: ChangeEntry[];
  watermarks: Watermarks;
}> {
  const [boards, chambers, lacquers, stringings, localChanges, watermarks] = await Promise.all([
    db.boards.toArray(),
    db.chambers.toArray(),
    db.lacquers.toArray(),
    db.stringings.toArray(),
    db.changes.toArray(),
    getWatermarks(),
  ]);
  return {
    localTables: { boards, chambers, lacquers, stringings },
    localChanges,
    watermarks,
  };
}

/**
 * 执行合并计划。前提：所有 kind=both 的单元都已由操作员选择 resolution。
 * - incomingOnly / 对端胜出：写入对端现行行、重放对端删除；本机独有行转入历史
 * - localOnly / 本机胜出：保留本机；对端改动转入历史后补做
 */
export async function applyMergePlan(plan: ReconcilePlan, payload: BackupPayload): Promise<MergeResult> {
  for (const group of plan.groups) {
    for (const item of group.items) {
      if (item.kind === 'both' && item.resolution !== 'local' && item.resolution !== 'incoming') {
        throw new Error(`琴号 ${item.guqinNo} 的${item.stage}阶段仍有冲突未选择`);
      }
    }
  }

  const result: MergeResult = {
    acceptedUnits: 0,
    conflictUnits: 0,
    deferredCount: 0,
    demoSkipped: [],
    replayedDeletes: 0,
  };
  const now = new Date().toISOString();
  const incomingTables = tablesFromPayload(payload);
  const localTables: TableSet = {
    boards: await db.boards.toArray(),
    chambers: await db.chambers.toArray(),
    lacquers: await db.lacquers.toArray(),
    stringings: await db.stringings.toArray(),
  };

  const deferred: DeferredRecord[] = [];
  const localEntryStatus = new Map<string, 'accepted' | 'deferred'>();
  const touchedLacquerGuqin = new Set<string>();
  const historySeen = new Set<string>();

  /** 正式记录不被演示样例改写：对端行 isDemo 且本机同 id 为正式记录时拦截 */
  const guardDemo = (stage: StageKey, incomingRow: { id: string; guqinNo: string; isDemo?: boolean }): boolean => {
    if (!incomingRow.isDemo) return true;
    const localRow = (localTables[STAGE_TABLE[stage]] as unknown[]).find((r) => rowId(r) === incomingRow.id) as
      | { isDemo?: boolean }
      | undefined;
    if (localRow && !localRow.isDemo) {
      result.demoSkipped.push({ stage, guqinNo: incomingRow.guqinNo, recordId: incomingRow.id });
      return false;
    }
    return true;
  };

  const collectDeferred = (entries: ChangeEntry[]) => {
    for (const entry of entries) {
      const dedupeKey = `${entry.recordId}::${entry.action}::${entry.changedAt}::${entry.summary}`;
      if (historySeen.has(dedupeKey)) continue;
      historySeen.add(dedupeKey);
      deferred.push(...toHistoryRows([entry], now));
    }
  };

  await db.transaction(
    'rw',
    [db.boards, db.chambers, db.lacquers, db.stringings, db.changes, db.history, db.meta],
    async () => {
      for (const group of plan.groups) {
        for (const item of group.items) {
          const { stage, guqinNo } = item;
          const localRows = rowsOfStage(localTables, stage, guqinNo) as Array<Record<string, unknown>>;
          const incomingRows = rowsOfStage(incomingTables, stage, guqinNo) as Array<Record<string, unknown>>;
          const incomingIds = new Set(incomingRows.map((r) => String(r.id)));
          const incomingDeleteIds = deleteEntryIds(item.incoming);

          if (item.kind === 'localOnly') {
            item.local?.entries.forEach((e) => localEntryStatus.set(e.id, 'accepted'));
            result.acceptedUnits += 1;
            continue;
          }

          if (item.kind === 'incomingOnly' || (item.kind === 'both' && item.resolution === 'incoming')) {
            // 接受对端：写入对端该琴该阶段的现行行（演示样例不得改写正式记录）
            for (const row of incomingRows) {
              if (guardDemo(stage, row as never)) {
                await stageTable(stage).put(toPlain(row));
                if (stage === 'lacquer') touchedLacquerGuqin.add(String(row.guqinNo ?? ''));
              }
            }
            // 对端已删除的共享记录，在本机同步删除（本机已无该行则无需处理）
            for (const id of incomingDeleteIds) {
              if (localRows.some((r) => String(r.id) === id)) {
                await stageTable(stage).delete(id);
                result.replayedDeletes += 1;
                if (stage === 'lacquer') touchedLacquerGuqin.add(guqinNo);
              }
            }
            if (item.kind === 'both') {
              // 对端胜出：本机在该琴该阶段被丢弃的每条内容都要进历史——
              // 以实际删除的本机行为准（更新的共享行 + 本机独有行），避免同一摘要漏记
              const localEntryById = new Map(item.local?.entries.map((e) => [e.recordId, e]) ?? []);
              for (const row of localRows) {
                const id = String(row.id);
                const entry =
                  localEntryById.get(id) ??
                  makeSynthetic(stage, 'local', '本机', row, incomingIds.has(id) ? 'update' : 'create', rowDate(stage, row));
                if (incomingDeleteIds.has(id)) continue; // 对端也已删除，两边意图一致，不入历史
                collectDeferred([entry]);
                if (!incomingIds.has(id)) {
                  await stageTable(stage).delete(id);
                  if (stage === 'lacquer') touchedLacquerGuqin.add(guqinNo);
                }
              }
              item.incoming?.entries.forEach((e) => localEntryStatus.set(e.id, 'accepted'));
              result.conflictUnits += 1;
            }
            result.acceptedUnits += 1;
            continue;
          }

          if (item.kind === 'both' && item.resolution === 'local') {
            // 本机胜出：对端改动转入历史后补做
            if (item.incoming) collectDeferred(item.incoming.entries);
            item.local?.entries.forEach((e) => localEntryStatus.set(e.id, 'accepted'));
            result.acceptedUnits += 1;
            result.conflictUnits += 1;
          }
        }
      }

      for (const hist of deferred) {
        await db.history.put(toPlain(hist));
        result.deferredCount += 1;
      }

      // 标记本机台账条目的最终状态（旧备份合成条目的 id 不在台账中，跳过）
      for (const [id, status] of localEntryStatus) {
        if (id.startsWith('synthetic-')) continue;
        const entry = await db.changes.get(id);
        if (entry) await db.changes.put(toPlain({ ...entry, status }));
      }

      // 髹漆：受影响琴号按遍次重算累计厚度
      for (const guqinNo of touchedLacquerGuqin) {
        const layers = (await db.lacquers.where('guqinNo').equals(guqinNo).toArray()) as LacquerLayer[];
        for (const layer of layers) {
          const total = cumulativeThickness(layers, layer.seq);
          if (total !== layer.totalThickness) {
            await db.lacquers.put(toPlain({ ...layer, totalThickness: total }));
          }
        }
      }

      // 记录对端设备水位：重复导入同一备份不会再产生对账单元
      if (plan.incomingDevice && !plan.legacy) {
        const watermarks = await getWatermarks();
        const maxSeq = (payload.changes ?? [])
          .filter((e) => e.deviceId === plan.incomingDevice!.deviceId)
          .reduce((max, e) => Math.max(max, e.seq), watermarks[plan.incomingDevice.deviceId]?.seq ?? 0);
        watermarks[plan.incomingDevice.deviceId] = { seq: maxSeq, at: now };
        await setMeta('merge-watermarks', JSON.stringify(watermarks));
      }
    },
  );

  return result;
}

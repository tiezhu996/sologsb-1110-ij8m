import { db, getDeviceId, SCHEMA_VERSION } from './db';
import { normalizeSyncRow, STAGE_DATE_FIELD } from './sync';
import type { WoodBoard } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';
import type { ChangeEntry, MergeHistoryItem, StageKey } from '../types/sync';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  /** 导出该备份的平板设备号（对账时标注变更来源） */
  deviceId: string;
  boards: unknown[];
  chambers: unknown[];
  lacquers: unknown[];
  stringings: unknown[];
  /** 四个工序阶段随记录一起导出的变更摘要流水 */
  changes: ChangeEntry[];
  /** 冲突时未选、转入历史后补做的记录 */
  mergeHistory: MergeHistoryItem[];
}

/** 汇总全部本地表为 JSON 备份（含四个工序阶段的变更摘要） */
export async function buildBackup(): Promise<BackupPayload> {
  const [boards, chambers, lacquers, stringings, changes, mergeHistory, deviceId] = await Promise.all([
    db.boards.toArray(),
    db.chambers.toArray(),
    db.lacquers.toArray(),
    db.stringings.toArray(),
    db.changes.toArray(),
    db.mergeHistory.toArray(),
    getDeviceId(),
  ]);
  return {
    app: 'gbguqin',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    deviceId,
    boards,
    chambers,
    lacquers,
    stringings,
    changes,
    mergeHistory,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（工序档案打印用） */
export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: Array<{ key: keyof T; title: string }>,
): void {
  const header = columns.map((c) => `"${c.title}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `\ufeff${header}\n${body}`, 'text/csv');
}

/**
 * 整库恢复：清空四张工序表后整体写入（会覆盖本机数据，仅用于换机/故障恢复）。
 * 两台平板回坊对账请改用 merge.ts 的按琴号合并，不要用本函数。
 * 兼容旧备份：没有 changes / mergeHistory / 同步元信息的 v1/v2 文件也能导入。
 */
export async function restoreBackup(text: string): Promise<{ boards: number; chambers: number; lacquers: number; stringings: number }> {
  const payload = parseBackup(text);
  const counts = {
    boards: payload.boards.length,
    chambers: payload.chambers.length,
    lacquers: payload.lacquers.length,
    stringings: payload.stringings.length,
  };
  await db.transaction(
    'rw',
    [db.boards, db.chambers, db.lacquers, db.stringings, db.changes, db.mergeHistory],
    async () => {
      await Promise.all([
        db.boards.clear(),
        db.chambers.clear(),
        db.lacquers.clear(),
        db.stringings.clear(),
        db.changes.clear(),
        db.mergeHistory.clear(),
      ]);
      if (payload.boards.length) await db.boards.bulkPut((payload.boards as object[]).map((r) => normalizeSyncRow('boards', r)) as unknown as WoodBoard[]);
      if (payload.chambers.length) await db.chambers.bulkPut((payload.chambers as object[]).map((r) => normalizeSyncRow('chambers', r)) as unknown as SoundChamber[]);
      if (payload.lacquers.length) await db.lacquers.bulkPut((payload.lacquers as object[]).map((r) => normalizeSyncRow('lacquers', r)) as unknown as LacquerLayer[]);
      if (payload.stringings.length) await db.stringings.bulkPut((payload.stringings as object[]).map((r) => normalizeSyncRow('stringings', r)) as unknown as Stringing[]);
      if (payload.changes.length) await db.changes.bulkPut(payload.changes);
      if (payload.mergeHistory.length) await db.mergeHistory.bulkPut(payload.mergeHistory);

      // 旧备份没有 changes 表：为导入的旧记录补建「无摘要」流水，保持后续可对账
      if (!payload.changes.length) {
        const legacyStages: Array<{ stage: StageKey; rows: unknown[] }> = [
          { stage: 'boards', rows: payload.boards },
          { stage: 'chambers', rows: payload.chambers },
          { stage: 'lacquers', rows: payload.lacquers },
          { stage: 'stringings', rows: payload.stringings },
        ];
        const legacyChanges: ChangeEntry[] = legacyStages.flatMap(({ stage, rows }) =>
          (rows as object[]).map((raw) => {
            const row = normalizeSyncRow(stage, raw) as unknown as Record<string, unknown>;
            return {
              id: String(row.id),
              stage,
              guqinNo: String(row.guqinNo ?? ''),
              lastRev: (row.rev as number) ?? 1,
              lastAt: String(row.updatedAt ?? row[STAGE_DATE_FIELD[stage]] ?? new Date(0).toISOString()),
              lastSummary: String(row.summary ?? '旧备份记录（无变更摘要）'),
              history: [],
            };
          }),
        );
        if (legacyChanges.length) await db.changes.bulkPut(legacyChanges);
      }
    },
  );
  return counts;
}

/** 解析并校验备份文件；旧备份（无摘要/无设备号）归一化为空集合，保持兼容 */
export function parseBackup(text: string): BackupPayload {
  const payload = JSON.parse(text) as Partial<BackupPayload>;
  if (!payload || payload.app !== 'gbguqin') {
    throw new Error('备份文件格式不匹配（缺少 app=gbguqin 标记）');
  }
  return {
    app: 'gbguqin',
    schemaVersion: typeof payload.schemaVersion === 'number' ? payload.schemaVersion : 1,
    exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt : new Date(0).toISOString(),
    deviceId: typeof payload.deviceId === 'string' ? payload.deviceId : 'unknown-pad',
    boards: Array.isArray(payload.boards) ? payload.boards : [],
    chambers: Array.isArray(payload.chambers) ? payload.chambers : [],
    lacquers: Array.isArray(payload.lacquers) ? payload.lacquers : [],
    stringings: Array.isArray(payload.stringings) ? payload.stringings : [],
    changes: Array.isArray(payload.changes) ? (payload.changes as ChangeEntry[]) : [],
    mergeHistory: Array.isArray(payload.mergeHistory) ? (payload.mergeHistory as MergeHistoryItem[]) : [],
  };
}

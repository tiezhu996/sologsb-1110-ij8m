import { db, SCHEMA_VERSION } from './db';
import { getDevice } from './device';
import type { ChangeEntry, DeviceInfo } from '../types/changes';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  /** 导出设备（两台平板各自的对账身份） */
  device?: DeviceInfo;
  boards: unknown[];
  chambers: unknown[];
  lacquers: unknown[];
  stringings: unknown[];
  /**
   * 变更摘要台账：四个工序阶段的增删改都在此留痕，随备份导出供按琴号对账。
   * 旧版本备份没有此字段，合并时按行差异降级对账。
   */
  changes?: ChangeEntry[];
  /** 本机历史（未选内容），仅作留档；对账只认 changes 与现行行 */
  history?: unknown[];
}

/** 汇总全部本地表与变更摘要台账为 JSON 备份（回坊后按琴号对账合并） */
export async function buildBackup(): Promise<BackupPayload> {
  const [boards, chambers, lacquers, stringings, changes, history, device] = await Promise.all([
    db.boards.toArray(),
    db.chambers.toArray(),
    db.lacquers.toArray(),
    db.stringings.toArray(),
    db.changes.toArray(),
    db.history.toArray(),
    getDevice(),
  ]);
  return {
    app: 'gbguqin',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    device,
    boards,
    chambers,
    lacquers,
    stringings,
    changes,
    history,
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
  downloadText(filename, `﻿${header}\n${body}`, 'text/csv');
}

/** 解析对端平板导出的备份文件；兼容没有变更摘要的旧备份 */
export function parseBackup(text: string): BackupPayload {
  let payload: Partial<BackupPayload>;
  try {
    payload = JSON.parse(text) as Partial<BackupPayload>;
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }
  if (!payload || payload.app !== 'gbguqin') {
    throw new Error('备份文件格式不匹配（缺少 app=gbguqin 标记）');
  }
  return {
    app: 'gbguqin',
    schemaVersion: typeof payload.schemaVersion === 'number' ? payload.schemaVersion : 0,
    exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt : new Date(0).toISOString(),
    device: payload.device,
    boards: Array.isArray(payload.boards) ? payload.boards : [],
    chambers: Array.isArray(payload.chambers) ? payload.chambers : [],
    lacquers: Array.isArray(payload.lacquers) ? payload.lacquers : [],
    stringings: Array.isArray(payload.stringings) ? payload.stringings : [],
    changes: Array.isArray(payload.changes) ? (payload.changes as ChangeEntry[]) : undefined,
    history: Array.isArray(payload.history) ? payload.history : [],
  };
}

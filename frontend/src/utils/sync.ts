import { db, isSeedDemoId } from './db';
import type { ChangeEntry, StageKey, SyncMeta } from '../types/sync';

/** 每条记录保留的摘要历史上限（倒序） */
const HISTORY_LIMIT = 30;

/** 各工序阶段参与摘要对比的字段与中文名（未列出的字段不进摘要） */
export const STAGE_FIELDS: Record<StageKey, Array<{ key: string; label: string }>> = {
  boards: [
    { key: 'boardNo', label: '板材号' },
    { key: 'guqinNo', label: '琴号' },
    { key: 'part', label: '部位' },
    { key: 'species', label: '树种' },
    { key: 'dryYears', label: '阴干年限' },
    { key: 'thicknessMm', label: '厚度(mm)' },
    { key: 'grain', label: '木纹' },
    { key: 'defect', label: '缺陷' },
    { key: 'receivedAt', label: '入库时间' },
    { key: 'remark', label: '备注' },
  ],
  chambers: [
    { key: 'nayinThickness', label: '纳音厚度(mm)' },
    { key: 'longchiThickness', label: '龙池厚度(mm)' },
    { key: 'fengzhaoThickness', label: '凤沼厚度(mm)' },
    { key: 'chamberDepth', label: '槽腹深度(mm)' },
    { key: 'postPos', label: '天地柱' },
    { key: 'poolSize', label: '龙池凤沼尺寸' },
    { key: 'carvedAt', label: '掏膛日期' },
    { key: 'carver', label: '掏膛人' },
    { key: 'remark', label: '备注' },
  ],
  lacquers: [
    { key: 'seq', label: '遍次' },
    { key: 'mixRatio', label: '灰胎配比' },
    { key: 'curingTemp', label: '荫房温度(℃)' },
    { key: 'curingHumidity', label: '荫房湿度(%)' },
    { key: 'polishGrit', label: '打磨目数' },
    { key: 'layerThickness', label: '本遍厚度(mm)' },
    { key: 'appliedAt', label: '施工日期' },
    { key: 'operator', label: '髹漆人' },
    { key: 'remark', label: '备注' },
  ],
  stringings: [
    { key: 'stringType', label: '弦材质' },
    { key: 'nut', label: '雁足绒扣' },
    { key: 'stringGap', label: '弦距(mm)' },
    { key: 'sanNote', label: '散音评语' },
    { key: 'anNote', label: '按音评语' },
    { key: 'fanNote', label: '泛音评语' },
    { key: 'nineVirtues', label: '九德简述' },
    { key: 'defects', label: '缺陷标记' },
    { key: 'strungAt', label: '上弦日期' },
    { key: 'operator', label: '上弦人' },
  ],
};

/** 阶段默认日期字段：旧数据没有 updatedAt 时用它兜底 */
export const STAGE_DATE_FIELD: Record<StageKey, string> = {
  boards: 'receivedAt',
  chambers: 'carvedAt',
  lacquers: 'appliedAt',
  stringings: 'strungAt',
};

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '空';
  if (Array.isArray(value)) return value.length ? value.join('、') : '空';
  return String(value);
}

/** 对比前后两条记录，生成「字段：旧 → 新」形式的变更摘要；无实质变化返回 null */
export function diffSummary(stage: StageKey, prev: Record<string, unknown>, next: Record<string, unknown>): string | null {
  const segments: string[] = [];
  for (const { key, label } of STAGE_FIELDS[stage]) {
    const before = formatValue(prev[key]);
    const after = formatValue(next[key]);
    if (before !== after) {
      segments.push(`${label}：${before} → ${after}`);
    }
  }
  return segments.length ? segments.join('；') : null;
}

/** 新建记录的摘要（列举关键字段） */
export function createSummary(stage: StageKey, row: Record<string, unknown>): string {
  const picked: string[] = [];
  const prefer: Record<StageKey, string[]> = {
    boards: ['part', 'boardNo', 'species', 'thicknessMm', 'defect'],
    chambers: ['nayinThickness', 'longchiThickness', 'fengzhaoThickness', 'chamberDepth', 'postPos', 'carver'],
    lacquers: ['seq', 'mixRatio', 'layerThickness', 'curingTemp', 'curingHumidity', 'operator'],
    stringings: ['stringType', 'nut', 'stringGap', 'defects', 'operator'],
  };
  const labelOf = new Map(STAGE_FIELDS[stage].map((f) => [f.key, f.label]));
  for (const key of prefer[stage]) {
    const value = row[key];
    if (value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      picked.push(`${labelOf.get(key)}：${formatValue(value)}`);
    }
  }
  return `新建记录（${picked.join('；') || '无字段'}）`;
}

/**
 * 给业务记录盖上同步元信息（修订号 +1、时间、摘要、设备号），返回新 rev。
 * 调用方在 db.put 之前调用。
 */
export function stampChange<T extends SyncMeta>(
  row: T,
  prev: SyncMeta | undefined,
  summary: string,
  deviceId: string,
): number {
  const rev = (prev?.rev ?? 0) + 1;
  row.rev = rev;
  row.updatedAt = new Date().toISOString();
  row.summary = summary;
  row.deviceId = deviceId;
  return rev;
}

/** 追加一条变更摘要流水（不同阶段、历次修改都保留） */
export async function recordChange(args: {
  stage: StageKey;
  id: string;
  guqinNo: string;
  rev: number;
  summary: string;
  deviceId: string;
  at?: string;
}): Promise<void> {
  const at = args.at ?? new Date().toISOString();
  const existed = await db.changes.get(args.id);
  const entry: ChangeEntry = existed
    ? {
        ...existed,
        lastRev: args.rev,
        lastAt: at,
        lastSummary: args.summary,
        deviceId: args.deviceId,
        history: [{ rev: existed.lastRev, at: existed.lastAt, summary: existed.lastSummary, deviceId: existed.deviceId }, ...existed.history].slice(0, HISTORY_LIMIT),
      }
    : {
        id: args.id,
        stage: args.stage,
        guqinNo: args.guqinNo,
        lastRev: args.rev,
        lastAt: at,
        lastSummary: args.summary,
        deviceId: args.deviceId,
        history: [],
      };
  await db.changes.put(entry);
}

/** 兼容旧备份：补齐缺失的同步元信息（rev 从 1 起，时间回退到阶段日期字段） */
export function normalizeSyncRow<T extends object>(stage: StageKey, row: T): T & SyncMeta {
  const meta = row as T & SyncMeta;
  if (typeof meta.rev !== 'number' || Number.isNaN(meta.rev)) {
    meta.rev = 1;
  }
  if (!meta.updatedAt) {
    const fallback = (row as Record<string, unknown>)[STAGE_DATE_FIELD[stage]];
    meta.updatedAt = typeof fallback === 'string' ? fallback : new Date(0).toISOString();
  }
  if (!meta.summary) {
    meta.summary = '旧备份记录（无变更摘要）';
  }
  if (meta.demo === undefined && isSeedDemoId(stage, String((row as Record<string, unknown>).id))) {
    meta.demo = true;
  }
  return meta;
}

/** 合并界面使用：把一条记录拆成「字段名 / 值」的展示项 */
export interface RowViewItem {
  label: string;
  value: string;
}

export function viewRow(stage: StageKey, row: Record<string, unknown>): RowViewItem[] {
  return STAGE_FIELDS[stage].map(({ key, label }) => {
    const value = row[key];
    const text = Array.isArray(value) ? (value.length ? value.join('、') : '空') : value === undefined || value === null || value === '' ? '空' : String(value);
    return { label, value: text };
  });
}

/** 合并界面使用：两边业务字段逐项对比，标出不同的行 */
export function diffRows(stage: StageKey, local: Record<string, unknown>, incoming: Record<string, unknown>): Array<RowViewItem & { changed: boolean }> {
  return STAGE_FIELDS[stage].map(({ key, label }) => {
    const lv = local[key];
    const iv = incoming[key];
    const norm = (v: unknown) => (Array.isArray(v) ? v.join('、') : v === undefined || v === null ? '' : String(v));
    return { label, value: '', changed: norm(lv) !== norm(iv) };
  });
}

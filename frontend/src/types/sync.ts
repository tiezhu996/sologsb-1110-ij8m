/** 四个工序阶段（导出对账时各自保存变更摘要） */
export type StageKey = 'boards' | 'chambers' | 'lacquers' | 'stringings';

export const STAGE_KEYS: StageKey[] = ['boards', 'chambers', 'lacquers', 'stringings'];

export const STAGE_LABELS: Record<StageKey, string> = {
  boards: '板材',
  chambers: '槽腹',
  lacquers: '髹漆',
  stringings: '上弦',
};

/**
 * 同步元信息：每条工序记录都附带。
 * 旧备份（v1/v2 导出）没有这些字段，合并时按「未改过」归一化处理，保持兼容。
 */
export interface SyncMeta {
  /** 修订号：本设备每保存一次 +1，合并取较大者；相等且内容不同则并列冲突 */
  rev?: number;
  /** 最近一次修改时间 ISO */
  updatedAt?: string;
  /** 最近一次修改的人工可读变更摘要 */
  summary?: string;
  /** 最近一次修改所在设备号 */
  deviceId?: string;
  /** 演示样例标记：样例数据永远不能覆盖正式记录 */
  demo?: boolean;
}

/** 单条记录的变更摘要流水（不同阶段的历次修改都保留） */
export interface ChangeEntry {
  /** = 业务记录 id */
  id: string;
  stage: StageKey;
  guqinNo: string;
  /** 最近修订号 */
  lastRev: number;
  /** 最近修改时间 ISO */
  lastAt: string;
  /** 最近修改摘要 */
  lastSummary: string;
  /** 最近修改所在设备号 */
  deviceId?: string;
  /** 历史摘要（倒序，最新在前） */
  history: Array<{
    rev: number;
    at: string;
    summary: string;
    deviceId?: string;
  }>;
}

/** 合并时未被选中（转入历史后补做）的一边 */
export interface MergeHistoryItem {
  /** 独立流水 id */
  id: string;
  stage: StageKey;
  guqinNo: string;
  /** 对账键（板材=琴号+部位；髹漆=琴号+遍次；其余=琴号） */
  matchKey: string;
  /** 并入时间 ISO */
  createdAt: string;
  /** 操作员选择继续使用的一边 */
  winnerSide: 'local' | 'incoming';
  local?: Record<string, unknown>;
  incoming?: Record<string, unknown>;
  localSummary?: string;
  localAt?: string;
  incomingSummary?: string;
  incomingAt?: string;
  /** 是否已补做（转入正式记录） */
  redone?: boolean;
  redoneAt?: string;
}

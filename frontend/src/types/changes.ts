/** 四个工序阶段（与四个 Pinia store / 四张业务表一一对应） */
export type { DeviceInfo } from '../utils/device';

export type StageKey = 'board' | 'chamber' | 'lacquer' | 'stringing';

/** 变更动作 */
export type ChangeAction = 'create' | 'update' | 'delete';

/** 变更条目在台账中的状态 */
export type ChangeStatus = 'pending' | 'accepted' | 'deferred';

/** 各阶段的中文展示名 */
export const STAGE_LABELS: Record<StageKey, string> = {
  board: '板材',
  chamber: '槽腹',
  lacquer: '髹漆',
  stringing: '上弦',
};

/** 阶段展示顺序（对账界面分组用） */
export const STAGE_ORDER: StageKey[] = ['board', 'chamber', 'lacquer', 'stringing'];

export const ACTION_LABELS: Record<ChangeAction, string> = {
  create: '新增',
  update: '修改',
  delete: '删除',
};

/**
 * 一次工序变更的摘要台账。
 * 导出备份时随四个工序阶段一并保存；另一台平板据此按琴号对账。
 */
export interface ChangeEntry {
  /** 台账条目 id */
  id: string;
  /** 工序阶段 */
  stage: StageKey;
  /** 琴号（对账主键） */
  guqinNo: string;
  /** 业务记录 id（删除/修改后仍可凭它定位） */
  recordId: string;
  action: ChangeAction;
  /** 一句话变更摘要，并列展示时给操作员看 */
  summary: string;
  /**
   * 变更后的整行快照（delete 时为删除前快照）。
   * 髹漆阶段同一琴号可能一次涉及多遍，按遍次升序存放。
   */
  snapshots: unknown[];
  /** 执行变更的时间 ISO */
  changedAt: string;
  /** 操作员 */
  operator: string;
  /** 产生该变更的设备标识 */
  deviceId: string;
  /** 变更序号：同一设备单调递增，用于同一边多条变更排序与水位过滤 */
  seq: number;
  status: ChangeStatus;
}

/** 并列冲突中某一边的变更集 */
export interface ChangeSide {
  deviceId: string;
  exportedAt?: string;
  entries: ChangeEntry[];
}

/** 按琴号 + 阶段对账后的处置方式 */
export type ReconcileKind = 'localOnly' | 'incomingOnly' | 'both';

/** 一个（琴号 × 阶段）对账单元 */
export interface ReconcileItem {
  guqinNo: string;
  stage: StageKey;
  kind: ReconcileKind;
  local: ChangeSide | null;
  incoming: ChangeSide | null;
  /** 操作员选择：继续使用哪一边（both 时必选） */
  resolution: 'local' | 'incoming' | null;
}

/** 对账分组（按琴号聚合四个阶段） */
export interface ReconcileGroup {
  guqinNo: string;
  items: ReconcileItem[];
}

/** 转入历史的未选变更（后补做时可整份取回采用） */
export interface DeferredRecord {
  /** 历史条目 id（hist- 前缀） */
  id: string;
  stage: StageKey;
  guqinNo: string;
  recordId: string;
  /** 来源设备 */
  deviceId: string;
  /** 对应的变更摘要 */
  summary: string;
  action: ChangeAction;
  /** 变更快照（与 ChangeEntry.snapshots 同构） */
  snapshots: unknown[];
  /** 原始变更时间 ISO */
  changedAt: string;
  /** 转入历史的时间 ISO */
  deferredAt: string;
  /** 操作员备注（后补做说明） */
  note?: string;
  /** 取回采用时间 ISO；已采用的条目不再出现在待办中 */
  adoptedAt?: string;
}

import { db } from './db';
import { uid } from './id';
import { toPlain } from './plain';
import { parseBackup, type BackupPayload } from './export';
import { cumulativeThickness } from './layer';
import { normalizeSyncRow, STAGE_FIELDS } from './sync';
import type { ChangeEntry, MergeHistoryItem, StageKey, SyncMeta } from '../types/sync';

type Row = Record<string, unknown> & SyncMeta;

/** 对账键：板材=琴号+部位；髹漆=琴号+遍次；槽腹/上弦=琴号 */
export function matchKeyOf(stage: StageKey, row: Record<string, unknown>): string {
  const guqinNo = String(row.guqinNo ?? '').trim();
  if (stage === 'boards') return `${guqinNo}|${String(row.part ?? '')}`;
  if (stage === 'lacquers') return `${guqinNo}|#${Number(row.seq) || 0}`;
  return guqinNo;
}

/** 两边都改过、需要操作员二选一的并列冲突 */
export interface StageConflict {
  stage: StageKey;
  matchKey: string;
  guqinNo: string;
  local: Row;
  incoming: Row;
}

export interface MergeStats {
  /** 本机没有、直接收入的新记录 */
  inserted: number;
  /** 仅对端改过，自动接受 */
  updated: number;
  /** 仅本机改过（或内容相同），自动保留本机 */
  kept: number;
  /** 并列冲突总数（等待操作员选择） */
  conflicts: number;
  /** 被演示样例拦截、未写入的条数 */
  demoBlocked: number;
}

export interface MergePlan {
  payload: BackupPayload;
  incomingDeviceId: string;
  conflicts: StageConflict[];
  /** 每个阶段、每条对账键的自动判定 */
  decisions: Record<
    StageKey,
    Map<
      string,
      { action: 'insert' | 'take-incoming' | 'keep-local' | 'block-demo' | 'conflict'; local?: Row; incoming?: Row }
    >
  >;
  stats: Record<StageKey, MergeStats>;
}

const EMPTY_STATS = (): MergeStats => ({ inserted: 0, updated: 0, kept: 0, conflicts: 0, demoBlocked: 0 });

/** 仅比较业务字段（id / rev / 摘要等同步元信息不参与） */
function businessEqual(stage: StageKey, a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return STAGE_FIELDS[stage].every(({ key }) => String(a[key] ?? '') === String(b[key] ?? ''));
}

/** 解析对端备份并与本机按琴号对账，生成合并预案（不写库；冲突留给操作员选择） */
export async function buildMergePlan(text: string): Promise<MergePlan> {
  const payload = parseBackup(text);
  const incomingRows: Record<StageKey, Row[]> = {
    boards: (payload.boards as object[]).map((r) => normalizeSyncRow('boards', r) as unknown as Row),
    chambers: (payload.chambers as object[]).map((r) => normalizeSyncRow('chambers', r) as unknown as Row),
    lacquers: (payload.lacquers as object[]).map((r) => normalizeSyncRow('lacquers', r) as unknown as Row),
    stringings: (payload.stringings as object[]).map((r) => normalizeSyncRow('stringings', r) as unknown as Row),
  };
  const localRows: Record<StageKey, Row[]> = {
    boards: ((await db.boards.toArray()) as object[]).map((r) => normalizeSyncRow('boards', r) as unknown as Row),
    chambers: ((await db.chambers.toArray()) as object[]).map((r) => normalizeSyncRow('chambers', r) as unknown as Row),
    lacquers: ((await db.lacquers.toArray()) as object[]).map((r) => normalizeSyncRow('lacquers', r) as unknown as Row),
    stringings: ((await db.stringings.toArray()) as object[]).map((r) => normalizeSyncRow('stringings', r) as unknown as Row),
  };

  const decisions = {
    boards: new Map(),
    chambers: new Map(),
    lacquers: new Map(),
    stringings: new Map(),
  } as MergePlan['decisions'];
  const conflicts: StageConflict[] = [];
  const stats: Record<StageKey, MergeStats> = {
    boards: EMPTY_STATS(),
    chambers: EMPTY_STATS(),
    lacquers: EMPTY_STATS(),
    stringings: EMPTY_STATS(),
  };

  (Object.keys(stats) as StageKey[]).forEach((stage) => {
    const localByKey = new Map(localRows[stage].map((r) => [matchKeyOf(stage, r), r]));
    const inByKey = new Map(incomingRows[stage].map((r) => [matchKeyOf(stage, r), r]));

    for (const [key, incoming] of inByKey) {
      const local = localByKey.get(key);
      if (!local) {
        // 演示样例不通过合并注入正式档案
        if (incoming.demo) {
          decisions[stage].set(key, { action: 'block-demo', incoming });
          stats[stage].demoBlocked += 1;
        } else {
          decisions[stage].set(key, { action: 'insert', incoming });
          stats[stage].inserted += 1;
        }
        continue;
      }

      if (businessEqual(stage, local, incoming)) {
        decisions[stage].set(key, { action: 'keep-local', local, incoming });
        stats[stage].kept += 1;
        continue;
      }

      // 正式记录不能被演示样例改写
      if (incoming.demo && !local.demo) {
        decisions[stage].set(key, { action: 'block-demo', local, incoming });
        stats[stage].demoBlocked += 1;
        continue;
      }

      // 对端是正式记录、本机还是未改的演示样例：正式覆盖样例
      if (!incoming.demo && local.demo) {
        decisions[stage].set(key, { action: 'take-incoming', local, incoming });
        stats[stage].updated += 1;
        continue;
      }

      const localRev = local.rev ?? 1;
      const inRev = incoming.rev ?? 1;
      if (inRev > localRev) {
        // 只有对端在共同版本之后改过 → 直接接受
        decisions[stage].set(key, { action: 'take-incoming', local, incoming });
        stats[stage].updated += 1;
      } else if (localRev > inRev) {
        // 只有本机改过 → 保留本机
        decisions[stage].set(key, { action: 'keep-local', local, incoming });
        stats[stage].kept += 1;
      } else {
        // 同修订号、内容不同：两边都改过 → 并列展示，由操作员选择
        decisions[stage].set(key, { action: 'conflict', local, incoming });
        stats[stage].conflicts += 1;
        conflicts.push({ stage, matchKey: key, guqinNo: String(incoming.guqinNo ?? local.guqinNo ?? ''), local, incoming });
      }
    }

    // 本机有、对端没有的键不做处理（保留本机），计入对账统计
    for (const [key, local] of localByKey) {
      if (!inByKey.has(key)) {
        decisions[stage].set(key, { action: 'keep-local', local });
        stats[stage].kept += 1;
      }
    }
  });

  return { payload, incomingDeviceId: payload.deviceId, conflicts, decisions, stats };
}

export interface MergeOutcome {
  stats: Record<StageKey, { inserted: number; updated: number; conflictWon: number; toHistory: number; demoBlocked: number }>;
  historyIds: string[];
}

/** 冲突操作员选择：matchKey → 继续使用哪一边；未选一边转入历史后补做 */
export type ConflictChoices = Record<StageKey, Record<string, 'local' | 'incoming'>>;

const TABLE_OF: Record<StageKey, 'boards' | 'chambers' | 'lacquers' | 'stringings'> = {
  boards: 'boards',
  chambers: 'chambers',
  lacquers: 'lacquers',
  stringings: 'stringings',
};

/**
 * 合并两边的摘要流水：以 lastRev 较大者为主；同 rev 时以 prefer 指定的一边为主，
 * 历史取两边并集去重（不同阶段的历次摘要都保留）。
 */
function mergeChangeEntry(
  local: ChangeEntry | undefined,
  incoming: ChangeEntry | undefined,
  prefer: 'local' | 'incoming' = 'incoming',
): ChangeEntry | undefined {
  if (!local && !incoming) return undefined;
  if (!local) return incoming;
  if (!incoming) return local;
  let base: ChangeEntry;
  let other: ChangeEntry;
  if (incoming.lastRev === local.lastRev) {
    [base, other] = prefer === 'incoming' ? [incoming, local] : [local, incoming];
  } else if (incoming.lastRev > local.lastRev) {
    [base, other] = [incoming, local];
  } else {
    [base, other] = [local, incoming];
  }
  const otherTail = { rev: other.lastRev, at: other.lastAt, summary: other.lastSummary, deviceId: other.deviceId };
  const seen = new Set<string>();
  const history = [...base.history, otherTail, ...other.history]
    .filter((h) => {
      const tag = `${h.rev}@${h.at}`;
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    })
    .sort((a, b) => (a.rev === b.rev ? b.at.localeCompare(a.at) : b.rev - a.rev))
    .slice(0, 50);
  return {
    ...base,
    stage: base.stage ?? other.stage,
    guqinNo: base.guqinNo || other.guqinNo,
    history,
  };
}

/** 按预案与操作员选择落库合并 */
export async function applyMerge(plan: MergePlan, choices: ConflictChoices): Promise<MergeOutcome> {
  const changeByIncomingId = new Map<string, ChangeEntry>(plan.payload.changes.map((c) => [c.id, c]));
  const historyIds: string[] = [];
  const outcome: MergeOutcome['stats'] = {
    boards: { inserted: 0, updated: 0, conflictWon: 0, toHistory: 0, demoBlocked: 0 },
    chambers: { inserted: 0, updated: 0, conflictWon: 0, toHistory: 0, demoBlocked: 0 },
    lacquers: { inserted: 0, updated: 0, conflictWon: 0, toHistory: 0, demoBlocked: 0 },
    stringings: { inserted: 0, updated: 0, conflictWon: 0, toHistory: 0, demoBlocked: 0 },
  };
  /** 髹漆合并后需要重算累计厚度的琴号 */
  const lacquerGuqinNos = new Set<string>();

  await db.transaction(
    'rw',
    [db.boards, db.chambers, db.lacquers, db.stringings, db.changes, db.mergeHistory],
    async () => {
      for (const stage of ['boards', 'chambers', 'lacquers', 'stringings'] as StageKey[]) {
        const table = db[TABLE_OF[stage]];
        for (const [key, decision] of plan.decisions[stage]) {
          if (decision.action === 'keep-local') {
            // 业务记录保留本机；摘要流水也以本机为「最近一条」，只并入对端的历史条目
            if (decision.local && decision.incoming) {
              const localEntry = await db.changes.get(decision.local.id as string);
              const merged = mergeChangeEntry(localEntry, changeByIncomingId.get(decision.incoming.id as string), 'local');
              if (merged && merged !== localEntry) {
                await db.changes.put(toPlain({ ...merged, id: decision.local.id as string }));
              }
            }
            continue;
          }
          if (decision.action === 'block-demo') {
            outcome[stage].demoBlocked += 1;
            continue;
          }
          if (decision.action === 'insert') {
            const incoming = decision.incoming!;
            await table.put(toPlain(incoming) as never);
            const entry = changeByIncomingId.get(incoming.id as string);
            if (entry) await db.changes.put(toPlain(entry));
            outcome[stage].inserted += 1;
            if (stage === 'lacquers') lacquerGuqinNos.add(String(incoming.guqinNo));
            continue;
          }
          if (decision.action === 'take-incoming') {
            const { local, incoming } = decision as { local: Row; incoming: Row };
            await writeWinner(stage, local, incoming, changeByIncomingId);
            outcome[stage].updated += 1;
            if (stage === 'lacquers') lacquerGuqinNos.add(String(incoming.guqinNo));
            continue;
          }
          if (decision.action === 'conflict') {
            const { local, incoming } = decision as { local: Row; incoming: Row };
            const side = choices[stage]?.[key];
            if (!side) {
              throw new Error(`仍有冲突未选择：${stage} ${key}`);
            }
            const winner = side === 'incoming' ? incoming : local;
            await writeWinner(stage, local, incoming, changeByIncomingId, side);
            const historyId = await pushToHistory(stage, key, String(winner.guqinNo ?? ''), side, local, incoming, plan.incomingDeviceId);
            historyIds.push(historyId);
            outcome[stage].conflictWon += 1;
            outcome[stage].toHistory += 1;
            if (stage === 'lacquers') {
              lacquerGuqinNos.add(String(local.guqinNo));
              lacquerGuqinNos.add(String(incoming.guqinNo));
            }
          }
        }
      }

      // 带入对端「后补做」流水（按 id 并集，本机已有的不覆盖）
      for (const item of plan.payload.mergeHistory) {
        const existed = await db.mergeHistory.get(item.id);
        if (!existed) await db.mergeHistory.put(toPlain(item));
      }

      // 髹漆：按琴号重算累计厚度
      for (const guqinNo of lacquerGuqinNos) {
        const layers = await db.lacquers.where('guqinNo').equals(guqinNo).toArray();
        for (const layer of layers) {
          layer.totalThickness = cumulativeThickness(layers, layer.seq);
          await db.lacquers.put(toPlain(layer));
        }
      }
    },
  );

  return { stats: outcome, historyIds };
}

/** 写入冲突/自动接受中获胜的一边；若与本机记录 id 不同，先删掉旧 id */
async function writeWinner(
  stage: StageKey,
  local: Row,
  incoming: Row,
  incomingChanges: Map<string, ChangeEntry>,
  side: 'local' | 'incoming' = 'incoming',
): Promise<void> {
  const table = db[TABLE_OF[stage]];
  const localId = local.id as string;
  const incomingEntry = incomingChanges.get(incoming.id as string);
  const localEntry = await db.changes.get(localId);

  if (side === 'incoming') {
    if (localId !== (incoming.id as string)) {
      await table.delete(localId);
      await db.changes.delete(localId);
    }
    await table.put(toPlain(incoming) as never);
    const merged = mergeChangeEntry(localEntry, incomingEntry, 'incoming');
    if (merged) await db.changes.put(toPlain({ ...merged, id: incoming.id as string }));
  } else {
    // 本机记录原样保留，只把对端的摘要历史并进来（最新摘要仍为本机的）
    const merged = mergeChangeEntry(localEntry, incomingEntry, 'local');
    if (merged) await db.changes.put(toPlain(merged));
  }
}

/** 未选中的一边转入历史，供操作员日后补做 */
async function pushToHistory(
  stage: StageKey,
  matchKey: string,
  guqinNo: string,
  winnerSide: 'local' | 'incoming',
  local: Row,
  incoming: Row,
  incomingDeviceId: string,
): Promise<string> {
  const item: MergeHistoryItem = {
    id: uid('mhist'),
    stage,
    guqinNo,
    matchKey,
    createdAt: new Date().toISOString(),
    winnerSide,
    local: toPlain(local),
    incoming: toPlain(incoming),
    localSummary: local.summary,
    localAt: local.updatedAt,
    incomingSummary: incoming.summary,
    incomingAt: incoming.updatedAt,
  };
  // 对端设备号只在对端条目未自带时兜底
  if (!item.incoming?.deviceId && incomingDeviceId) {
    (item.incoming as Record<string, unknown>).deviceId = incomingDeviceId;
  }
  await db.mergeHistory.put(item);
  return item.id;
}

/** 标记一条历史已补做完成 */
export async function markHistoryRedone(id: string): Promise<void> {
  const item = await db.mergeHistory.get(id);
  if (!item || item.redone) return;
  await db.mergeHistory.put({ ...item, redone: true, redoneAt: new Date().toISOString() });
}

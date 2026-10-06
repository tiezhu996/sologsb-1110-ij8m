import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { getDevice } from '../utils/device';
import { fullSummary } from '../utils/summary';
import type { ChangeAction, ChangeEntry, StageKey } from '../types/changes';

interface ChangeState {
  entries: ChangeEntry[];
  hydrated: boolean;
}

/**
 * 变更摘要台账：四个工序阶段的每次增删改在此留痕。
 * 导出备份时随阶段数据一并保存，供另一台平板按琴号对账。
 */
export const useChangeStore = defineStore('change', {
  state: (): ChangeState => ({ entries: [], hydrated: false }),

  getters: {
    pendingEntries(state): ChangeEntry[] {
      return state.entries.filter((e) => e.status === 'pending');
    },
    /** 尚未对账的变更，按琴号 → 阶段分组 */
    pendingByGuqin(state): Map<string, Map<StageKey, ChangeEntry[]>> {
      const map = new Map<string, Map<StageKey, ChangeEntry[]>>();
      for (const entry of state.entries.filter((e) => e.status === 'pending')) {
        let byStage = map.get(entry.guqinNo);
        if (!byStage) {
          byStage = new Map();
          map.set(entry.guqinNo, byStage);
        }
        const list = byStage.get(entry.stage) ?? [];
        list.push(entry);
        byStage.set(entry.stage, list);
      }
      return map;
    },
  },

  actions: {
    async hydrate() {
      this.entries = await db.changes.orderBy('changedAt').toArray();
      this.hydrated = true;
    },

    /**
     * 登记一次变更。
     * @param stage 工序阶段
     * @param recordId 业务记录 id
     * @param action 新增/修改/删除
     * @param guqinNo 琴号（删除时无法从快照以外取得，需显式传入；默认取快照）
     * @param snapshots 变更后的整行快照（删除时为删除前快照），髹漆可多条
     * @param operator 操作员
     */
    async log(params: {
      stage: StageKey;
      recordId: string;
      action: ChangeAction;
      guqinNo?: string;
      snapshots: unknown[];
      operator?: string;
    }): Promise<ChangeEntry> {
      const device = await getDevice();
      const snapshots = toPlain(params.snapshots.filter(Boolean));
      const guqinNo = params.guqinNo ?? snapshots.map((s) => guqinNoFromSnapshot(params.stage, s)).find(Boolean) ?? '';
      const seq = this.entries.filter((e) => e.deviceId === device.deviceId).reduce((max, e) => Math.max(max, e.seq), 0) + 1;
      const entry: ChangeEntry = {
        id: uid('chg'),
        stage: params.stage,
        guqinNo,
        recordId: params.recordId,
        action: params.action,
        summary: fullSummary(params.action, params.stage, snapshots),
        snapshots,
        changedAt: new Date().toISOString(),
        operator: params.operator?.trim() || device.deviceName,
        deviceId: device.deviceId,
        seq,
        status: 'pending',
      };
      await db.changes.put(toPlain(entry));
      this.entries = [...this.entries, entry];
      return entry;
    },

    /** 批量标记状态（合并完成后标记 accepted / deferred） */
    async markStatus(ids: string[], status: ChangeEntry['status']) {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const targets = this.entries.filter((e) => idSet.has(e.id));
      for (const entry of targets) {
        await db.changes.put(toPlain({ ...entry, status }));
      }
      this.entries = this.entries.map((e) => (idSet.has(e.id) ? { ...e, status } : e));
    },

    async removeEntry(id: string) {
      await db.changes.delete(id);
      this.entries = this.entries.filter((e) => e.id !== id);
    },
  },
});

function guqinNoFromSnapshot(stage: StageKey, snapshot: unknown): string {
  const row = snapshot as { guqinNo?: unknown };
  return typeof row.guqinNo === 'string' ? row.guqinNo : '';
}

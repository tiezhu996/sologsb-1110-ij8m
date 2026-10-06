import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { toPlain } from '../utils/plain';
import { cumulativeThickness } from '../utils/layer';
import { stageTable } from '../utils/stage-table';
import type { DeferredRecord, StageKey } from '../types/changes';
import type { LacquerLayer } from '../types/lacquer-layer';

interface HistoryState {
  records: DeferredRecord[];
  hydrated: boolean;
}

/** 冲突中未选内容的历史台账：转入历史后补做，可整份取回采用 */
export const useHistoryStore = defineStore('history', {
  state: (): HistoryState => ({ records: [], hydrated: false }),

  getters: {
    /** 待后补做（尚未取回采用） */
    pending(state): DeferredRecord[] {
      return state.records
        .filter((r) => !r.adoptedAt)
        .sort((a, b) => (a.deferredAt < b.deferredAt ? 1 : -1));
    },
    adopted(state): DeferredRecord[] {
      return state.records
        .filter((r) => r.adoptedAt)
        .sort((a, b) => ((a.adoptedAt ?? '') < (b.adoptedAt ?? '') ? 1 : -1));
    },
    pendingCount(): number {
      return this.pending.length;
    },
    pendingOf(state) {
      return (guqinNo: string, stage?: StageKey): DeferredRecord[] =>
        state.records.filter(
          (r) => !r.adoptedAt && r.guqinNo === guqinNo && (stage === undefined || r.stage === stage),
        );
    },
  },

  actions: {
    async hydrate() {
      this.records = await db.history.orderBy('deferredAt').toArray();
      this.hydrated = true;
    },

    /**
     * 取回采用：把历史快照作为新的正式记录写回业务表。
     * 髹漆阶段重排遍次并重算累计厚度；删除类条目仅标记采用（操作员确认已补删）。
     */
    async adopt(id: string): Promise<{ stage: StageKey; guqinNo: string }> {
      const record = this.records.find((r) => r.id === id);
      if (!record) throw new Error('历史条目不存在');
      if (record.adoptedAt) return { stage: record.stage, guqinNo: record.guqinNo };

      const stage = record.stage;
      const table = stageTable(stage);

      await db.transaction('rw', table, db.history, async () => {
        if (record.action !== 'delete' && record.snapshots.length > 0) {
          if (record.stage === 'lacquer') {
            const imported = record.snapshots as LacquerLayer[];
            const existing = (await db.lacquers.where('guqinNo').equals(record.guqinNo).toArray()) as LacquerLayer[];
            const baseSeq = existing.reduce((max, l) => Math.max(max, l.seq), 0);
            const merged = [
              ...existing,
              ...imported.map((l, index) => ({ ...l, seq: baseSeq + index + 1 })),
            ].map((l) => ({ ...l, totalThickness: 0 }));
            for (const layer of merged) {
              await db.lacquers.put(toPlain({ ...layer, totalThickness: cumulativeThickness(merged, layer.seq) }));
            }
          } else {
            for (const snapshot of record.snapshots) {
              await table.put(toPlain({ ...(snapshot as object), isDemo: false }));
            }
          }
        }
        await db.history.put(toPlain({ ...record, adoptedAt: new Date().toISOString() }));
      });

      this.records = this.records.map((r) =>
        r.id === id ? { ...r, adoptedAt: new Date().toISOString() } : r,
      );
      return { stage: record.stage, guqinNo: record.guqinNo };
    },

    /** 后补做完成但不采用原数据：仅登记备注并标记采用 */
    async markDone(id: string, note?: string) {
      const record = this.records.find((r) => r.id === id);
      if (!record || record.adoptedAt) return;
      const next = { ...record, note: note?.trim() || record.note, adoptedAt: new Date().toISOString() };
      await db.history.put(toPlain(next));
      this.records = this.records.map((r) => (r.id === id ? next : r));
    },

    async remove(id: string) {
      await db.history.delete(id);
      this.records = this.records.filter((r) => r.id !== id);
    },
  },
});

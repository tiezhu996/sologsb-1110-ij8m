import Dexie, { type Table } from 'dexie';
import type { WoodBoard } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';
import type { ChangeEntry, MergeHistoryItem, StageKey } from '../types/sync';
import { uid } from './id';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbguqin-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class GuqinDB extends Dexie {
  boards!: Table<WoodBoard, string>;
  chambers!: Table<SoundChamber, string>;
  lacquers!: Table<LacquerLayer, string>;
  stringings!: Table<Stringing, string>;
  changes!: Table<ChangeEntry, string>;
  mergeHistory!: Table<MergeHistoryItem, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
      chambers: 'id, guqinNo, postPos, carvedAt',
      lacquers: 'id, guqinNo, seq, appliedAt',
      stringings: 'id, guqinNo, stringType, strungAt',
      meta: 'key',
    });

    // v2：髹漆表增加 (guqinNo+seq) 复合索引，便于按遍次排序查询；并回填历史 layerThickness。
    // 升级前请在顶栏「导出备份」导出 JSON。
    this.version(2)
      .stores({
        boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
        chambers: 'id, guqinNo, postPos, carvedAt',
        lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt',
        stringings: 'id, guqinNo, stringType, strungAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('lacquers')
          .toCollection()
          .modify((row: LacquerLayer) => {
            if (!row.layerThickness && row.totalThickness) {
              row.layerThickness = row.totalThickness;
            }
          });
      });

    // v3：离线对账合并。changes 按「记录 id」保存变更摘要流水；mergeHistory 保存
    // 冲突时操作员未选、转入历史后补做的另一边。同时为旧记录回填同步元信息，
    // 并把内置示例 id（board-001…）标记为演示样例，防止日后被样例备份改写正式记录。
    this.version(3)
      .stores({
        boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
        chambers: 'id, guqinNo, postPos, carvedAt',
        lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt',
        stringings: 'id, guqinNo, stringType, strungAt',
        changes: 'id, stage, guqinNo, lastAt',
        mergeHistory: 'id, stage, guqinNo, createdAt, redone',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const stageTables: Array<{ stage: StageKey; tableName: string; atField: string }> = [
          { stage: 'boards', tableName: 'boards', atField: 'receivedAt' },
          { stage: 'chambers', tableName: 'chambers', atField: 'carvedAt' },
          { stage: 'lacquers', tableName: 'lacquers', atField: 'appliedAt' },
          { stage: 'stringings', tableName: 'stringings', atField: 'strungAt' },
        ];
        // 四张表并行 modify，收集需要补建的摘要条目；全部完成后再一次写入 changes
        const collected = await Promise.all(
          stageTables.map(async ({ stage, tableName, atField }) => {
            const entries: unknown[] = [];
            await tx
              .table(tableName)
              .toCollection()
              .modify((row: Record<string, unknown>) => {
                if (typeof row.rev !== 'number') {
                  row.rev = 1;
                  row.updatedAt = typeof row[atField] === 'string' ? row[atField] : new Date().toISOString();
                  row.summary = '旧版记录（升级前无变更摘要）';
                  entries.push({
                    id: String(row.id),
                    stage,
                    guqinNo: String(row.guqinNo ?? ''),
                    lastRev: 1,
                    lastAt: String(row.updatedAt),
                    lastSummary: '旧版记录（升级前无变更摘要）',
                    history: [],
                  });
                }
                if (row.demo === undefined && isSeedDemoId(stage, String(row.id))) {
                  row.demo = true;
                }
              });
            return entries;
          }),
        );
        const changeEntries = collected.flat();
        if (changeEntries.length) {
          await tx.table('changes').bulkPut(changeEntries as never[]);
        }
      });
  }
}

export const db = new GuqinDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

/** 内置示例记录 id 形如 board-001 / chamber-002 / layer-010 / stringing-003 / tv-001 */
const DEMO_ID_RE: Record<StageKey, RegExp> = {
  boards: /^board-\d{3}$/,
  chambers: /^chamber-\d{3}$/,
  lacquers: /^layer-\d{3}$/,
  stringings: /^stringing-\d{3}$/,
};

export function isSeedDemoId(stage: StageKey, id: string): boolean {
  return DEMO_ID_RE[stage].test(id);
}

/** 本设备编号（导出/摘要里标注变更来自哪台平板），首次使用时生成并持久化 */
export async function getDeviceId(): Promise<string> {
  const existed = await getMeta('deviceId');
  if (existed) return existed;
  const value = `pad-${uid('dev').slice(-6)}`;
  await setMeta('deviceId', value);
  return value;
}

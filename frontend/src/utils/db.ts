import Dexie, { type Table } from 'dexie';
import type { WoodBoard } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';
import type { ChangeEntry, DeferredRecord } from '../types/changes';
import { SEED_RECORD_IDS } from './seed';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbguqin-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class GuqinDB extends Dexie {
  boards!: Table<WoodBoard, string>;
  chambers!: Table<SoundChamber, string>;
  lacquers!: Table<LacquerLayer, string>;
  stringings!: Table<Stringing, string>;
  /** 变更摘要台账（离线对账依据） */
  changes!: Table<ChangeEntry, string>;
  /** 冲突中未选内容（转入历史，供后补做取回） */
  history!: Table<DeferredRecord, string>;
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

    // v3：离线对账——新增变更摘要台账与历史表；给首批演示样例补打 isDemo 标记，
    // 使正式记录在合并/导入时不会被演示样例改写。
    this.version(3)
      .stores({
        boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt, isDemo',
        chambers: 'id, guqinNo, postPos, carvedAt, isDemo',
        lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt, isDemo',
        stringings: 'id, guqinNo, stringType, strungAt, isDemo',
        changes: 'id, stage, guqinNo, recordId, status, changedAt, seq, deviceId',
        history: 'id, stage, guqinNo, deferredAt, adoptedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        for (const tableName of ['boards', 'chambers', 'lacquers', 'stringings'] as const) {
          const seedIds = SEED_RECORD_IDS[tableName];
          await tx
            .table(tableName)
            .toCollection()
            .modify((row: { id?: string; isDemo?: boolean }) => {
              if (row.id && seedIds.has(row.id) && row.isDemo === undefined) {
                row.isDemo = true;
              }
            });
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

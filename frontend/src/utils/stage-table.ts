import type { Table } from 'dexie';
import { db } from './db';
import type { StageKey } from '../types/changes';

/** 工序阶段对应的业务表（以 unknown 行视图使用，调用方自行保证行结构） */
export function stageTable(stage: StageKey): Table<Record<string, unknown>, string> {
  switch (stage) {
    case 'board':
      return db.boards as unknown as Table<Record<string, unknown>, string>;
    case 'chamber':
      return db.chambers as unknown as Table<Record<string, unknown>, string>;
    case 'lacquer':
      return db.lacquers as unknown as Table<Record<string, unknown>, string>;
    case 'stringing':
      return db.stringings as unknown as Table<Record<string, unknown>, string>;
  }
}

/**
 * 脱去 Vue reactive/ref 的 Proxy 外壳后再写入 IndexedDB。
 * IndexedDB 的 structuredClone 无法克隆 Proxy，直接写 Pinia state 中的数组/对象会抛
 * DataCloneError（表现为保存静默失败 + 1 条 console error），因此所有落库记录先经此函数。
 */
export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 批量脱代理 */
export function toPlainList<T>(values: T[]): T[] {
  return toPlain(values);
}

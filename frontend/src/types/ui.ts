/** 通用筛选字段描述（FilterBar 使用） */
export interface FilterField {
  key: string;
  label: string;
  options: string[];
  width?: number;
}

/** 工序时间线条目（ProcessTimeline 使用） */
export interface TimelineEvent {
  label: string;
  at: string;
  text: string;
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
}

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import WorkshopBoard from '../pages/WorkshopBoard.vue';
import BoardList from '../pages/BoardList.vue';
import ChamberEditor from '../pages/ChamberEditor.vue';
import LacquerLedger from '../pages/LacquerLedger.vue';
import StringingLog from '../pages/StringingLog.vue';

/** 全部路由：琴坯进度 + 板材 / 槽腹 / 髹漆 / 上弦 */
export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'workshop', component: WorkshopBoard, meta: { title: '琴坯进度' } },
  { path: '/boards', name: 'boards', component: BoardList, meta: { title: '板材登记与配对' } },
  { path: '/chambers', name: 'chambers', component: ChamberEditor, meta: { title: '槽腹尺寸记录' } },
  { path: '/lacquer', name: 'lacquer', component: LacquerLedger, meta: { title: '灰胎髹漆遍次' } },
  { path: '/stringing', name: 'stringing', component: StringingLog, meta: { title: '上弦与音色评价' } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../pages/NotFound.vue'), meta: { title: '页面不存在' } },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.afterEach((to) => {
  const title = (to.meta?.title as string) ?? '';
  document.title = title ? `${title} · 古琴斫制工序记录台` : '古琴斫制工序记录台';
});

export default router;

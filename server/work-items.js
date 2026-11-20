/**
 * 通用工作项类型描述层（ADR-008 场景适配层 · P3 E2 起步版）。
 *
 * 核心机制护栏（②§8.1 / 路线图 P3 工项 7，审查清单）：
 *   权限阶梯、审核权威（最大 review id）、交接验证（actor==接收者/时间序/preparedEventId
 *   去重）、scope fail-closed、审计事件 payload 白名单、采纳/有效跟踪——
 *   全部在核心层（store.js / api.js）实现一次，从不委托给本文件的类型对象。
 *   本层只声明：类型标签、状态词表、场景字段词表、UI 术语。
 *   新增类型时不得在这些机制里加类型分支；若确需分支，即 ADR-008 重评条件命中，开新 ADR。
 *
 * 「换行业还成立吗」边界测试：本对象里没有任何字段属于某个行业——
 * support_ticket 的词表属于客服/IT 支持场景，挂在 support_ticket 名下，不在通用层。
 */

export const WORK_ITEM_TYPES = Object.freeze({
  support_ticket: {
    id: 'support_ticket',
    /** UI 永远渲染中文类型标签，不裸露 work_item_type / WorkItem 词。 */
    label: '工单',
    /** support_ticket 场景状态机（DB CHECK 冻结，本词表是它的成文描述）。 */
    statusVocab: ['open', 'in_progress', 'resolved', 'reopened', 'escalated'],
    /** 场景专用字段词表（ADR-008：category/urgency 属于适配层，不属于核心层）。 */
    fieldVocab: {
      category: ['网络与 VPN', '账号与权限', '邮箱与协作', '打印与设备', '软件与授权', '其他'],
      urgency: ['紧急', '高', '中', '低'],
    },
  },
  /** 第二类型（E4 验证，②§8.3「新产品试点准备」）：跨职能组织任务。
   *  状态值枚举与 support_ticket 相同（CHECK 冻结的核心不变量）；显示语义由类型标签承载。
   *  跨类型父子（support_ticket 子项挂在 pilot_prep 父项下）正是本次验证的零复制目标。 */
  pilot_prep: {
    id: 'pilot_prep',
    label: '试点准备任务',
    statusVocab: ['open', 'in_progress', 'resolved', 'reopened', 'escalated'],
    fieldVocab: {
      category: ['试点协调', '物料与场地', '数据与授权', '演练与培训', '其他'],
      urgency: ['紧急', '高', '中', '低'],
    },
  },
});

export const DEFAULT_WORK_ITEM_TYPE = 'support_ticket';

export function getWorkItemType(id) {
  return WORK_ITEM_TYPES[id] || null;
}

export function isValidWorkItemType(id) {
  return Boolean(WORK_ITEM_TYPES[id]);
}

/** 类型视图：返回给前端的形状（不含内部实现字段）。 */
export function workItemTypeView(id) {
  const spec = WORK_ITEM_TYPES[id];
  if (!spec) return null;
  return { id: spec.id, label: spec.label, statusVocab: spec.statusVocab, fieldVocab: spec.fieldVocab };
}

export function allWorkItemTypeViews() {
  return Object.values(WORK_ITEM_TYPES).map((spec) => workItemTypeView(spec.id));
}

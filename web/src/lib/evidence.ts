/**
 * 依据字段的人话映射。
 *
 * 服务端发过来的 `evidence` 是**模型实际引用过的字段路径**（`items[0].amount`
 * 这种），它由 `expense-context.ts` 从给模型的 JSON 里遍历出来，
 * 不在这个集合里的引用会被判为幻觉并剔除。也就是说：它的价值在「可核对」，
 * 但 `items[0].name` 这串东西报销人看不懂 —— 内部协议不该出现在界面正文里。
 *
 * 所以这里只做一件事：路径 → 人话。原路径仍然保留在返回值里，
 * 放进悬停层 —— 想让技术评审顺着字段去核对的场景还在，只是不占正文。
 */

/** `items` 这一层的说法。单拎出来，是因为它既在词表里又要在下面单独判一次。 */
const ITEMS_LABEL = '费用明细';

/** 表头 / 审批 / 合计层的字段。键与 `expense-context.ts` 里 record 的键一一对应。 */
const HEADER_LABEL: Record<string, string> = {
  code: '单号',
  title: '事由',
  applicant: '申请人',
  department: '部门',
  category: '费用类型',
  amount: '金额',
  status: '状态',
  submittedAt: '提交时间',
  decidedAt: '审批时间',
  approverName: '审批人',
  approvalNote: '审批意见',
  rejectReason: '驳回原因',
  items: ITEMS_LABEL,
};

/** 明细行内字段。 */
const ITEM_LABEL: Record<string, string> = {
  name: '名称',
  category: '类型',
  amount: '金额',
  spentOn: '日期',
  note: '备注',
};

export interface FieldLabel {
  /** 界面正文用的人话。 */
  label: string;
  /** 原始路径。悬停层展示，用于核对。 */
  raw: string;
  /** 是否翻译成功。false 时 label 等于原路径 —— 说明后端加了新字段，这边还没跟上。 */
  known: boolean;
}

/** `items[2].amount` → `{ label: '明细第 3 项 · 金额', raw: 'items[2].amount' }` */
export function describeField(path: string): FieldLabel {
  if (path === 'items') {
    return { label: ITEMS_LABEL, raw: path, known: true };
  }

  const item = /^items\[(\d+)\](?:\.(\w+))?$/.exec(path);
  if (item) {
    const ordinal = Number(item[1]) + 1;
    const leaf = item[2];

    if (!leaf) {
      return { label: `明细第 ${ordinal} 项`, raw: path, known: true };
    }
    // 明细里出现未知叶子字段时，宁可显示 `第 3 项 · foo` 也不要整条丢成英文。
    const leafLabel = ITEM_LABEL[leaf];
    return {
      label: `明细第 ${ordinal} 项 · ${leafLabel ?? leaf}`,
      raw: path,
      known: leafLabel !== undefined,
    };
  }

  const headerLabel = HEADER_LABEL[path];
  if (headerLabel) return { label: headerLabel, raw: path, known: true };

  return { label: path, raw: path, known: false };
}

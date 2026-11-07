import { Button, Space, Typography } from 'antd';
import type { Expense } from '../api/types';

interface Props {
  expense: Expense | undefined;
  onPick: (question: string) => void;
}

/**
 * 空状态：还没问过这张单。
 *
 * 例子的内容按**当前单号**给，不是一套固定文案：驳回的单子第一颗是「为什么被驳回」，
 * 其余的问审批意见。例子只负责把话头递到输入框，发不发由人决定。
 */
export function EmptyState({ expense, onPick }: Props) {
  if (!expense) {
    return (
      <div className="empty">
        <Typography.Title level={4}>这张单号在库里不存在</Typography.Title>
        <Typography.Paragraph type="secondary">
          回列表换一张单，点「问一问」。
        </Typography.Paragraph>
      </div>
    );
  }

  return (
    <div className="empty">
      <Typography.Title level={4}>问点「{expense.title}」的事</Typography.Title>
      <Typography.Paragraph type="secondary">挑一个，或者直接打字问</Typography.Paragraph>

      <PresetChips expense={expense} onPick={onPick} />
    </div>
  );
}

interface ChipsProps {
  expense: Expense | undefined;
  onPick: (question: string) => void;
  /**
   * 对话已经开始了。
   *
   * 这时只留能接着问的那几颗，尺寸也小一圈 —— 它的作用是提示「还能问什么」，
   * 不是再当一次引导页。
   */
  inline?: boolean;
}

/** 例子标签。空状态和对话进行中都用它，只是大小和取舍不同。 */
export function PresetChips({ expense, onPick, inline = false }: ChipsProps) {
  // 单号不在库里时不给例子：这时候问什么都是 404，先回列表换张单。
  if (!expense) return null;

  return (
    <Space
      wrap={!inline}
      size={inline ? 6 : 8}
      className={inline ? 'preset-chips inline' : 'empty-chips'}
    >
      {presetsFor(expense).map((preset) => (
        <Button
          key={preset.label}
          shape="round"
          size={inline ? 'small' : 'middle'}
          onClick={() => onPick(preset.question)}
        >
          {preset.label}
        </Button>
      ))}
    </Space>
  );
}

interface Preset {
  question: string;
  label: string;
}

function presetsFor(expense: Expense): Preset[] {
  return [
    expense.status === 'REJECTED'
      ? { question: '这张单子为什么被驳回了？', label: '为什么被驳回' }
      : { question: '审批意见是什么？', label: '问审批意见' },
    { question: '这笔钱都花在哪些项目上？', label: '问费用明细' },
    { question: '一共多少钱？', label: '问金额' },
  ];
}

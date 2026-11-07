import { describe, expect, it } from 'vitest';
import { describeField } from './evidence';

/**
 * 这组用例钉的是一件事：字段路径不能原样出现在界面上。
 * 后端加字段时这里会红（known: false），提醒补一条人话 —— 那是刻意的。
 */
describe('依据字段的人话映射', () => {
  it('表头字段', () => {
    expect(describeField('amount')).toEqual({ label: '金额', raw: 'amount', known: true });
    expect(describeField('rejectReason').label).toBe('驳回原因');
    expect(describeField('approverName').label).toBe('审批人');
    expect(describeField('approvalNote').label).toBe('审批意见');
    expect(describeField('submittedAt').label).toBe('提交时间');
  });

  it('明细整块带下标转成第几项', () => {
    // 下标从 0 起，界面上必须从 1 起 —— 报销人不会把第一项叫「第 0 项」。
    expect(describeField('items[0].name')).toEqual({
      label: '明细第 1 项 · 名称',
      raw: 'items[0].name',
      known: true,
    });
    expect(describeField('items[2].amount').label).toBe('明细第 3 项 · 金额');
    expect(describeField('items[1]').label).toBe('明细第 2 项');
    expect(describeField('items').label).toBe('费用明细');
  });

  it('明细里的字段用自己的词表，不套表头的', () => {
    // 表头 category 叫「费用类型」，明细里的 category 只是「类型」。
    expect(describeField('items[0].category').label).toBe('明细第 1 项 · 类型');
    expect(describeField('category').label).toBe('费用类型');
  });

  it('没见过的字段原样返回并标 known:false —— 不猜、不吞掉', () => {
    const unknown = describeField('items[0].currency');
    expect(unknown).toEqual({ label: '明细第 1 项 · currency', raw: 'items[0].currency', known: false });
    expect(describeField('someNewField').known).toBe(false);
  });

  it('每条都带着原始路径，悬停层要拿它核对', () => {
    for (const path of ['amount', 'items', 'items[4].spentOn']) {
      expect(describeField(path).raw).toBe(path);
    }
  });
});

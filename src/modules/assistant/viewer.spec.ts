import { describe, expect, it } from 'vitest';
import { visibilityWhere, visibleToViewer } from './viewer.js';

/**
 * 可见性规则的纯函数测试。
 *
 * 这条规则有三个消费点（列表接口、prepare 拦截、工具层 where），
 * 全部引用同一份实现 —— 所以测它一个，等于把三条路一起钉住。
 *
 * ⚠️ 归属判定认 `applicantId`，不认姓名：姓名是快照，公司里两个张三
 * 就会互相看见对方的单。所以这里的行和 viewer 都带 id。
 */

const row = (applicantId: string, status: string) => ({
  applicantId,
  status: status as 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID',
});

const zhangsan = { id: 'u-zhangsan', name: '张三', role: 'applicant' } as const;
const approver = { id: 'u-wangjl', name: '王经理', role: 'approver' } as const;
const auditor = { id: 'u-zhengshi', name: '郑十', role: 'auditor' } as const;

describe('可见性规则（viewer）', () => {
  it('不带 viewer：全部可见（MCP 与脚本的兼容路径）', () => {
    expect(visibilityWhere(undefined)).toBeNull();
    expect(visibleToViewer(row('u-zhangsan', 'PAID'), undefined)).toBe(true);
  });

  describe('申请人：只看自己的单', () => {
    it('自己的单可见，任何状态都可见', () => {
      expect(visibleToViewer(row('u-zhangsan', 'DRAFT'), zhangsan)).toBe(true);
      expect(visibleToViewer(row('u-zhangsan', 'REJECTED'), zhangsan)).toBe(true);
    });

    it('别人的单不可见 —— 哪怕那张单的状态毫无敏感性', () => {
      expect(visibleToViewer(row('u-lisi', 'PAID'), zhangsan)).toBe(false);
    });

    it('同名的另一个人也看不到 —— 判定按 id，不按姓名', () => {
      const namesake = { id: 'u-zhangsan-2', name: '张三', role: 'applicant' } as const;
      expect(visibleToViewer(row('u-zhangsan', 'PAID'), namesake)).toBe(false);
    });

    it('where 条件按 applicantId 过滤', () => {
      expect(visibilityWhere(zhangsan)).toEqual({ applicantId: 'u-zhangsan' });
    });
  });

  describe('审批人：看全部非草稿', () => {
    it('各状态的非草稿单都可见，不看申请人是谁', () => {
      expect(visibleToViewer(row('u-zhangsan', 'SUBMITTED'), approver)).toBe(true);
      expect(visibleToViewer(row('u-lisi', 'REJECTED'), approver)).toBe(true);
      expect(visibleToViewer(row('u-lisi', 'PAID'), approver)).toBe(true);
    });

    it('草稿不可见 —— 还没提交的单子不该出现在审批人的世界里', () => {
      expect(visibleToViewer(row('u-zhaoliu', 'DRAFT'), approver)).toBe(false);
    });

    it('where 条件排除 DRAFT', () => {
      expect(visibilityWhere(approver)).toEqual({
        status: { not: 'DRAFT' },
      });
    });
  });

  describe('审计：只读全部，含草稿', () => {
    it('草稿也可见 —— 看不到未提交的单，就没法复核月底突击报销', () => {
      expect(visibleToViewer(row('u-zhaoliu', 'DRAFT'), auditor)).toBe(true);
      expect(visibleToViewer(row('u-zhangsan', 'PAID'), auditor)).toBe(true);
    });

    it('where 条件为空（不加限制）', () => {
      expect(visibilityWhere(auditor)).toBeNull();
    });
  });
});

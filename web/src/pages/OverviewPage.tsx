/**
 * 概览页：统计卡、类型筛选、单据表。
 *
 * 全部数据来自 `GET /assistant/expenses` 一份响应 —— 列表和统计同时到，
 * 不会出现「表格 4 行、卡片写 10 张」的两个真相。
 *
 * 筛选只是显示层的过滤。真正的可见范围在服务端：申请人拿到的响应里
 * 本来就没有别人的单，页面再怎么筛也筛不出来。
 */

import { Alert, Button, Card, Col, Row, Segmented, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MessageOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Expense, ExpenseCategory } from '../api/types';
import { AskDrawer } from '../chat/AskDrawer';
import { useExpenses } from '../data/ExpensesContext';
import { CATEGORY_TEXT, STATUS_COLOR, STATUS_TEXT } from '../lib/constants';
import { day, money } from '../lib/format';

export function OverviewPage() {
  const { expenses, summary, loading, error } = useExpenses();
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState<'ALL' | ExpenseCategory>('ALL');

  /**
   * 「问一问」= 把单号写进查询参数，抽屉自己会开。
   *
   * 不用 `open` 变量：那样刷新一次抽屉就没了，链接发给别人也打不开同一张单。
   * 开关状态留在 URL 里，抽屉和列表就永远是同一张单。
   */
  function openAsk(code: string) {
    const next = new URLSearchParams(params);
    next.set('ask', code);
    setParams(next);
  }

  // 只列「当前账号真的有」的类型：给申请人看一堆空分类没有意义。
  const categories = useMemo(
    () => [...new Set(expenses.map((expense) => expense.category))],
    [expenses],
  );

  const rows =
    category === 'ALL' ? expenses : expenses.filter((expense) => expense.category === category);

  const columns: ColumnsType<Expense> = [
    {
      title: '单号',
      dataIndex: 'code',
      width: 150,
      render: (code: string) => <Typography.Text code>{code}</Typography.Text>,
    },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    { title: '申请人', dataIndex: 'applicant', width: 96 },
    {
      title: '类型',
      dataIndex: 'category',
      width: 108,
      render: (value: ExpenseCategory) => CATEGORY_TEXT[value] ?? value,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 96,
      render: (value: Expense['status']) => (
        <Tag color={STATUS_COLOR[value]}>{STATUS_TEXT[value] ?? value}</Tag>
      ),
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 120,
      align: 'right',
      render: (value: string) => <span className="num">{money(value)}</span>,
    },
    {
      title: '提交',
      dataIndex: 'submittedAt',
      width: 112,
      render: (value: string) => day(value),
    },
    {
      title: '操作',
      key: 'ask',
      width: 100,
      render: (_, record) => (
        // 行本身也是可点的（跳整页），所以这一下要拦住冒泡，否则两个动作一起触发。
        <Button
          type="link"
          size="small"
          icon={<MessageOutlined />}
          onClick={(event) => {
            event.stopPropagation();
            openAsk(record.code);
          }}
        >
          问一问
        </Button>
      ),
    },
  ];

  return (
    <div className="page">
      <Row gutter={[12, 12]} className="stats">
        <StatCard label="可见单据" value={summary?.count ?? 0} suffix="张" />
        <StatCard label="待审批" value={summary?.byStatus.SUBMITTED ?? 0} suffix="张" />
        <StatCard label="已驳回" value={summary?.rejectedCount ?? 0} suffix="张" />
        <StatCard label="金额合计" value={money(summary?.totalAmount ?? '0.00')} />
      </Row>

      <div className="filter-bar">
        <Typography.Text type="secondary">类型</Typography.Text>
        <Segmented
          value={category}
          onChange={(value) => setCategory(value as 'ALL' | ExpenseCategory)}
          options={[
            { label: '全部', value: 'ALL' },
            ...categories.map((value) => ({
              label: CATEGORY_TEXT[value] ?? value,
              value,
            })),
          ]}
        />
      </div>

      {error ? <Alert type="error" showIcon message={error} className="page-alert" /> : null}

      <Table<Expense>
        rowKey="code"
        size="middle"
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={false}
        // 窄屏放不下八列：横向滚动比把单号挤成竖着换行体面。
        scroll={{ x: 760 }}
        // 点一行和点「问一问」是同一件事 —— 不用记两个入口的区别。
        onRow={(record) => ({
          onClick: () => openAsk(record.code),
          style: { cursor: 'pointer' },
        })}
        locale={{ emptyText: loading ? '正在按你的权限加载…' : '这个账号在库里没有可见的单据' }}
      />

      <AskDrawer />
    </div>
  );
}

function StatCard({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return (
    <Col xs={12} md={6}>
      <Card size="small">
        <Statistic title={label} value={value} suffix={suffix} />
      </Card>
    </Col>
  );
}

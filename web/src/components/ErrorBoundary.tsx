/**
 * 渲染兜底。
 *
 * React 的错误边界只能是 class —— 没有 hook 版本，这是框架的边界，不是风格问题。
 *
 * 没有它的话，任何一处 render 抛错（比如某个接口字段悄悄变了），
 * 整棵树被卸载，用户看到的是一片白，控制台之外没有任何线索。
 * 有了它，至少还剩一个「刷新 / 重试」的出口，也留下了一条可上报的错误。
 *
 * 放在路由外层：一个页面崩了不该带着整个应用一起走。
 */

import { Button, Result, Space, Typography } from 'antd';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 真正的项目这里换成上报（Sentry / 自建）。现在至少别让它只在控制台一闪而过。
    console.error('[ExpenseAssistant] 页面渲染失败', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Result
        status="error"
        title="这个页面出错了"
        subTitle={
          <Space direction="vertical" size={4}>
            <Typography.Text type="secondary">
              可能是接口返回的字段和页面预期的不一致。刷新通常能恢复。
            </Typography.Text>
            <Typography.Text code>{error.message}</Typography.Text>
          </Space>
        }
        extra={
          <Button type="primary" onClick={() => this.setState({ error: null })}>
            重试
          </Button>
        }
      />
    );
  }
}

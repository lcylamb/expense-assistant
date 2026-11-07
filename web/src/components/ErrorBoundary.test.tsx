import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../App';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(cleanup);

function Boom(): never {
  throw new Error('字段 amount 不存在');
}

describe('渲染兜底', () => {
  it('子树抛错时整页不白屏，给出原因和出口', () => {
    // React 会把这个错误再打一遍到控制台，测试里不需要看。
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 用 AppProviders 包一层：按钮文案受全局配置影响（antd 默认会往两个汉字的
    // 按钮里插空格），测试要和线上一致，否则「找得到按钮」这件事会假失败。
    render(
      <AppProviders>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </AppProviders>,
    );

    expect(screen.getByText('这个页面出错了')).toBeInTheDocument();
    expect(screen.getByText('字段 amount 不存在')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();

    silence.mockRestore();
  });
});

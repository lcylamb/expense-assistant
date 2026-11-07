/**
 * 登录页。
 *
 * 演示账号那几行只是**帮人把表单填上**，不是登录本身：点一下，用户名和密码
 * 进输入框，仍然要按「登录」过一遍服务端的 scrypt 校验。
 *
 * 不做成「点卡片直接进入」——那等于绕开密码，看的人会以为权限是页面说了算。
 *
 * 表单校验、错误态、提交中的 loading 都交给 antd Form —— 手写一遍只会得到
 * 一份少了键盘可达性和 aria 关联的实现。
 */

import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, List, Typography } from 'antd';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLE_TEXT } from '../lib/constants';

interface LoginForm {
  username: string;
  password: string;
}

export function LoginPage() {
  const { me, notice, signIn } = useAuth();
  const [form] = Form.useForm<LoginForm>();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 已登录的人不该停在登录页（比如刷新后退）。
  if (me) return <Navigate to="/overview" replace />;

  async function handleFinish(values: LoginForm) {
    setError('');
    setSubmitting(true);
    try {
      await signIn(values.username.trim(), values.password);
      // 成功后路由会把人带走，这个组件随即卸载，不需要复位 submitting。
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <Card className="login-card">
        <Typography.Title level={3}>报销单问答</Typography.Title>

        {error || notice ? (
          <Alert
            className="login-alert"
            type={error ? 'error' : 'warning'}
            showIcon
            message={error || notice}
          />
        ) : null}

        <Form<LoginForm>
          form={form}
          layout="vertical"
          requiredMark={false}
          autoComplete="on"
          onFinish={(values) => void handleFinish(values)}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              prefix={<UserOutlined />}
              autoComplete="username"
              spellCheck={false}
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
          </Form.Item>

          <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
            登录
          </Button>
        </Form>

        <div className="demo">
          <Typography.Title level={5}>演示账号</Typography.Title>
          <Typography.Paragraph type="secondary">
            统一密码 <Typography.Text code>{DEMO_PASSWORD}</Typography.Text>
            。点一行把账号填进去，再按登录 —— 换个人，能看到的单据就不一样。
          </Typography.Paragraph>

          <List
            size="small"
            bordered
            dataSource={[...DEMO_ACCOUNTS]}
            renderItem={(account) => (
              <List.Item
                className="demo-row"
                onClick={() => {
                  setError('');
                  form.setFieldsValue({ username: account.username, password: DEMO_PASSWORD });
                }}
              >
                <List.Item.Meta
                  title={account.name}
                  description={
                    <Typography.Text type="secondary" className="demo-meta">
                      {account.username} · {ROLE_TEXT[account.role]} · {account.note}
                    </Typography.Text>
                  }
                />
              </List.Item>
            )}
          />
        </div>
      </Card>
    </div>
  );
}

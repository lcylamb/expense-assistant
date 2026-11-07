/**
 * 顶栏 + 内容区。antd 的 Layout / Dropdown / Avatar。
 *
 * 没有导航菜单：整个应用只有「列表」这一页，问答是列表里的抽屉。
 * 之前那排 tab（概览 / 关于）里，「关于」已经并进 README —— 一个 tab 的菜单
 * 除了告诉人「这里只有一页」之外没有别的用处。
 *
 * 账号区只展示，不提供「切换身份」—— 换人必须退出再登录。
 * 这是「先认证，再谈权限」的顺序，页面上不该有捷径。
 */

import { LogoutOutlined } from '@ant-design/icons';
import { Avatar, Dropdown, Layout, Space, Typography } from 'antd';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_TEXT } from '../lib/constants';

export function AppLayout() {
  const { me, signOut } = useAuth();

  return (
    <Layout className="app">
      <Layout.Header className="app-header">
        <Space size={10} className="brand">
          <span className="brand-logo">报</span>
          <Typography.Text strong className="brand-text">
            报销单问答
          </Typography.Text>
        </Space>

        <Dropdown
          menu={{
            items: [{ key: 'signOut', icon: <LogoutOutlined />, label: '退出登录' }],
            onClick: ({ key }) => {
              if (key === 'signOut') void signOut();
            },
          }}
        >
          <Space size={8} className="whoami" role="button" tabIndex={0}>
            <Avatar size="small" className="whoami-avatar">
              {me?.name.slice(0, 1)}
            </Avatar>
            <span>
              <Typography.Text strong>{me?.name}</Typography.Text>
              <Typography.Text type="secondary" className="whoami-role">
                {me ? ROLE_TEXT[me.role] : ''}
              </Typography.Text>
            </span>
          </Space>
        </Dropdown>
      </Layout.Header>

      <Layout.Content className="app-content">
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}

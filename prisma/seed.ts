/**
 * 演示数据。
 *
 * ⚠️ 全部为虚构：姓名一律用「张三 / 李四」这类占位名，没有真实人员、身份证号、手机号或
 * 任何来自真实系统的数据。金额也是编的。这个仓库要能公开，所以这一条不能破。
 *
 * 数据是**刻意设计**的，不是随手凑的 —— 每一条都在为后面的评测用例服务：
 *   · 5 种状态全覆盖，其中 2 条 REJECTED 带驳回原因 → 可以问「为什么被驳回」
 *   · 4 条已通过 / 已打款带审批人和审批意见 → 可以问「审批意见是什么」，答得出具体内容
 *   · 2 条 DRAFT 没有 decidedAt → 问「审批意见是什么」，正确答案是「信息不足」
 *   · BX-2026-0006 的明细跨月（3 月发生、4 月提交）→ 问「3 月有哪些费用」时的陷阱用例
 *   · 每条单子的 amount 由明细求和算出，不手填 → 不会出现「总额对不上明细」的脏数据
 *
 * 可重复执行：每次先清空再写入。
 */
// ⚠️ Prisma CLI 和 seed 是**独立进程**，不受 @nestjs/config 影响，得自己加载 .env。
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ExpenseCategory,
  ExpenseStatus,
  PrismaClient,
  UserRole,
} from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/modules/auth/password.js';

// ⚠️ Prisma 7 起 PrismaClient 不再自己管连接，构造时必须给一个 driver adapter
// （不给会直接抛「Pass a driver adapter to the PrismaClient constructor」）。
// 连接池参数也因此归调用方决定，不再藏在内部。
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    '缺少 DATABASE_URL —— 确认项目根目录有 .env（从 .env.example 复制一份）。',
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/** 金额一律用「整数分」在内存里累加，只在写库时转成十进制字符串，避开浮点误差。 */
const toDecimalString = (cents: number) => (cents / 100).toFixed(2);

/**
 * 登录账号。
 *
 * ⚠️ 密码是**公开的** `demo1234`，写在 README 和登录页上 —— 这是一套演示账号，
 * 不是一套安全策略。它们能证明的事很具体：身份由登录产生，密码错了进不去，
 * 换个人看到的单据就变了。仅此而已。
 *
 * 七个账号覆盖三种角色，每个账号都能把一条可见性规则走到边界：
 *   申请人 → 只能看自己的（张三的单里有一条已打款、一条待审批）
 *   审批人 → 看全部非草稿（王五被驳回的单、赵六的草稿都在这条边界上）
 *   审计   → 看全部含草稿（对账视角）
 */
const USERS = [
  { username: 'zhangsan', name: '张三', role: UserRole.APPLICANT, department: '销售部' },
  { username: 'lisi', name: '李四', role: UserRole.APPLICANT, department: '研发部' },
  { username: 'wangwu', name: '王五', role: UserRole.APPLICANT, department: '市场部' },
  { username: 'zhaoliu', name: '赵六', role: UserRole.APPLICANT, department: '财务部' },
  { username: 'sunqi', name: '孙七', role: UserRole.APPLICANT, department: '人力资源部' },
  { username: 'wangjl', name: '王经理', role: UserRole.APPROVER, department: '审批中心' },
  { username: 'zhengshi', name: '郑十', role: UserRole.AUDITOR, department: '内审部' },
] as const;

const DEMO_PASSWORD = 'demo1234';

interface ItemSeed {
  name: string;
  category: ExpenseCategory;
  /** 单位：分 */
  amountCents: number;
  note?: string;
  /** 费用发生日，ISO 字符串 */
  spentOn: string;
}

interface ExpenseSeed {
  code: string;
  title: string;
  applicant: string;
  department: string;
  category: ExpenseCategory;
  status: ExpenseStatus;
  rejectReason?: string;
  /** 决策人姓名快照。已决策的单才有。 */
  approverName?: string;
  /** 审批意见。通过与打款写这里；驳回的整改要求写在 rejectReason。 */
  approvalNote?: string;
  submittedAt: string;
  decidedAt?: string;
  items: ItemSeed[];
}

const SEED: ExpenseSeed[] = [
  {
    code: 'BX-2026-0001',
    title: '北京客户现场支持差旅',
    applicant: '张三',
    department: '销售部',
    category: ExpenseCategory.TRAVEL,
    status: ExpenseStatus.PAID,
    submittedAt: '2026-03-02T09:20:00+08:00',
    decidedAt: '2026-03-06T15:00:00+08:00',
    approverName: '王经理',
    approvalNote: '行程和 3 月 1 日的客户拜访记录对得上，住宿按差旅标准报销，同意。',
    items: [
      {
        name: '深圳→北京 高铁二等座',
        category: ExpenseCategory.TRAVEL,
        amountCents: 120_000,
        note: '往返已分开报销，此为去程',
        spentOn: '2026-03-01',
      },
      {
        name: '北京住宿 3 晚',
        category: ExpenseCategory.TRAVEL,
        amountCents: 150_000,
        spentOn: '2026-03-01',
      },
      {
        name: '出差补贴（3 天）',
        category: ExpenseCategory.OTHER,
        amountCents: 45_000,
        spentOn: '2026-03-03',
      },
    ],
  },
  {
    code: 'BX-2026-0002',
    title: '研发部工位外设采购',
    applicant: '李四',
    department: '研发部',
    category: ExpenseCategory.OFFICE,
    status: ExpenseStatus.APPROVED,
    submittedAt: '2026-03-10T14:05:00+08:00',
    decidedAt: '2026-03-12T10:30:00+08:00',
    approverName: '王经理',
    approvalNote: '键盘和支架单价都在办公用品标准内，同意。',
    items: [
      {
        name: '机械键盘',
        category: ExpenseCategory.OFFICE,
        amountCents: 49_900,
        spentOn: '2026-03-09',
      },
      {
        name: '显示器支架',
        category: ExpenseCategory.OFFICE,
        amountCents: 15_900,
        spentOn: '2026-03-09',
      },
      {
        name: '腕托',
        category: ExpenseCategory.OFFICE,
        amountCents: 8_900,
        spentOn: '2026-03-09',
      },
    ],
  },
  {
    code: 'BX-2026-0003',
    title: '客户答谢晚宴',
    applicant: '王五',
    department: '市场部',
    category: ExpenseCategory.ENTERTAIN,
    status: ExpenseStatus.REJECTED,
    rejectReason: '招待费超出部门月度预算，且缺少参与人员清单',
    submittedAt: '2026-03-15T18:40:00+08:00',
    decidedAt: '2026-03-18T11:10:00+08:00',
    approverName: '王经理',
    items: [
      {
        name: '客户晚餐（6 人）',
        category: ExpenseCategory.ENTERTAIN,
        amountCents: 268_000,
        spentOn: '2026-03-14',
      },
      {
        name: '餐后交通',
        category: ExpenseCategory.TRANSPORT,
        amountCents: 8_600,
        spentOn: '2026-03-14',
      },
    ],
  },
  {
    code: 'BX-2026-0004',
    title: '3 月市内客户拜访交通',
    applicant: '张三',
    department: '销售部',
    category: ExpenseCategory.TRANSPORT,
    status: ExpenseStatus.SUBMITTED,
    submittedAt: '2026-04-01T09:00:00+08:00',
    items: [
      {
        name: '市内打车（3/11 客户拜访）',
        category: ExpenseCategory.TRANSPORT,
        amountCents: 6_800,
        spentOn: '2026-03-11',
      },
      {
        name: '市内打车（3/19 客户拜访）',
        category: ExpenseCategory.TRANSPORT,
        amountCents: 7_400,
        spentOn: '2026-03-19',
      },
      {
        name: '地铁充值',
        category: ExpenseCategory.TRANSPORT,
        amountCents: 20_000,
        note: '一次性充值，非本月全部消耗',
        spentOn: '2026-03-25',
      },
    ],
  },
  {
    code: 'BX-2026-0005',
    title: '财务部办公耗材',
    applicant: '赵六',
    department: '财务部',
    category: ExpenseCategory.OFFICE,
    status: ExpenseStatus.DRAFT,
    submittedAt: '2026-04-02T16:30:00+08:00',
    items: [
      {
        name: 'A4 打印纸（5 包）',
        category: ExpenseCategory.OFFICE,
        amountCents: 12_500,
        spentOn: '2026-04-02',
      },
      {
        name: '硒鼓',
        category: ExpenseCategory.OFFICE,
        amountCents: 42_000,
        spentOn: '2026-04-02',
      },
    ],
  },
  {
    code: 'BX-2026-0006',
    title: '上海架构评审出差',
    applicant: '李四',
    department: '研发部',
    category: ExpenseCategory.TRAVEL,
    status: ExpenseStatus.PAID,
    submittedAt: '2026-04-07T10:15:00+08:00',
    decidedAt: '2026-04-09T17:20:00+08:00',
    approverName: '王经理',
    approvalNote: '机票为经济舱、住宿两晚，与架构评审会议通知一致，同意。',
    items: [
      // ⚠️ 这一条的费用发生在 3 月，但整单 4 月才提交 —— 评测里的陷阱用例。
      {
        name: '深圳→上海 机票',
        category: ExpenseCategory.TRAVEL,
        amountCents: 185_000,
        spentOn: '2026-03-30',
      },
      {
        name: '上海住宿 2 晚',
        category: ExpenseCategory.TRAVEL,
        amountCents: 96_000,
        spentOn: '2026-03-30',
      },
      {
        name: '机场大巴',
        category: ExpenseCategory.TRANSPORT,
        amountCents: 6_000,
        spentOn: '2026-03-31',
      },
    ],
  },
  {
    code: 'BX-2026-0007',
    title: '季度团建餐费',
    applicant: '孙七',
    department: '人力资源部',
    category: ExpenseCategory.ENTERTAIN,
    status: ExpenseStatus.SUBMITTED,
    submittedAt: '2026-04-08T11:45:00+08:00',
    items: [
      {
        name: '团建聚餐（12 人）',
        category: ExpenseCategory.ENTERTAIN,
        amountCents: 186_000,
        spentOn: '2026-04-04',
      },
      {
        name: '场地费',
        category: ExpenseCategory.OTHER,
        amountCents: 60_000,
        spentOn: '2026-04-04',
      },
    ],
  },
  {
    code: 'BX-2026-0008',
    title: '行业展会物料制作',
    applicant: '王五',
    department: '市场部',
    category: ExpenseCategory.OTHER,
    status: ExpenseStatus.APPROVED,
    submittedAt: '2026-04-09T13:20:00+08:00',
    decidedAt: '2026-04-11T09:05:00+08:00',
    approverName: '王经理',
    approvalNote: '物料单价和供应商报价单一致，同意。',
    items: [
      {
        name: '易拉宝 2 个',
        category: ExpenseCategory.OTHER,
        amountCents: 36_000,
        spentOn: '2026-04-09',
      },
      {
        name: '宣传册印刷 500 份',
        category: ExpenseCategory.OTHER,
        amountCents: 89_000,
        spentOn: '2026-04-09',
      },
    ],
  },
  {
    code: 'BX-2026-0009',
    title: '杭州供应商走访差旅',
    applicant: '赵六',
    department: '财务部',
    category: ExpenseCategory.TRAVEL,
    status: ExpenseStatus.REJECTED,
    rejectReason: '发票抬头错误，请重新开具后提交',
    submittedAt: '2026-04-12T08:50:00+08:00',
    decidedAt: '2026-04-14T14:35:00+08:00',
    approverName: '王经理',
    items: [
      {
        name: '深圳→杭州 高铁二等座',
        category: ExpenseCategory.TRAVEL,
        amountCents: 92_000,
        spentOn: '2026-04-10',
      },
      {
        name: '杭州住宿 1 晚',
        category: ExpenseCategory.TRAVEL,
        amountCents: 45_000,
        spentOn: '2026-04-10',
      },
    ],
  },
  {
    code: 'BX-2026-0010',
    title: '招聘平台年度续费',
    applicant: '孙七',
    department: '人力资源部',
    category: ExpenseCategory.OTHER,
    status: ExpenseStatus.DRAFT,
    submittedAt: '2026-04-15T17:05:00+08:00',
    items: [
      {
        name: '招聘平台企业版年费',
        category: ExpenseCategory.OTHER,
        amountCents: 1_280_000,
        note: '需附合同扫描件，提交前补齐',
        spentOn: '2026-04-15',
      },
    ],
  },
];

async function main() {
  console.log('清空旧数据…');
  // 先删明细再删主表：虽然有 onDelete: Cascade，但显式写出来不依赖级联行为。
  await prisma.expenseItem.deleteMany();
  await prisma.expense.deleteMany();
  // 账号在单据之后删：Expense.applicantId 是 Restrict，先删账号会被外键挡住。
  await prisma.user.deleteMany();

  console.log(`写入 ${USERS.length} 个账号…`);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIds = new Map<string, string>();

  for (const user of USERS) {
    const created = await prisma.user.create({
      data: { ...user, passwordHash },
    });
    userIds.set(user.name, created.id);
    console.log(`  ${user.username.padEnd(9)} ${user.name.padEnd(4)} ${user.role}`);
  }

  console.log(`\n写入 ${SEED.length} 张报销单…`);

  for (const seed of SEED) {
    // 总额由明细求和得出 —— 不手填，就不会对不上。
    const totalCents = seed.items.reduce((sum, item) => sum + item.amountCents, 0);

    const items = seed.items.map((item) => ({
      name: item.name,
      category: item.category,
      amount: toDecimalString(item.amountCents),
      note: item.note ?? null,
      spentOn: new Date(`${item.spentOn}T00:00:00+08:00`),
    }));

    const applicantId = userIds.get(seed.applicant);
    if (!applicantId) {
      throw new Error(
        `单据 ${seed.code} 的申请人「${seed.applicant}」没有对应账号 —— 先加 USERS 再跑 seed`,
      );
    }

    await prisma.expense.create({
      data: {
        code: seed.code,
        title: seed.title,
        applicant: seed.applicant,
        applicantId,
        department: seed.department,
        category: seed.category,
        amount: toDecimalString(totalCents),
        status: seed.status,
        rejectReason: seed.rejectReason ?? null,
        approverName: seed.approverName ?? null,
        approvalNote: seed.approvalNote ?? null,
        submittedAt: new Date(seed.submittedAt),
        decidedAt: seed.decidedAt ? new Date(seed.decidedAt) : null,
        items: { create: items },
      },
    });

    console.log(
      `  ${seed.code}  ${seed.status.padEnd(9)}  ¥${toDecimalString(totalCents).padStart(10)}  ${seed.items.length} 条明细`,
    );
  }

  const count = await prisma.expense.count();
  console.log(`\n完成，库里现有 ${count} 张报销单。`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

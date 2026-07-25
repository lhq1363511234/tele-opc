CREATE TABLE IF NOT EXISTS a_self_profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  mission TEXT NOT NULL,
  profile_markdown TEXT NOT NULL,
  values_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_principles JSONB NOT NULL DEFAULT '[]'::jsonb,
  communication_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  boundaries JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  confidence NUMERIC NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS a_self_memory_items (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  why TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  source TEXT NOT NULL DEFAULT 'manual',
  sensitivity TEXT NOT NULL DEFAULT 'private',
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS a_self_decision_logs (
  id TEXT PRIMARY KEY,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  question TEXT NOT NULL,
  choice TEXT NOT NULL,
  why TEXT NOT NULL,
  result TEXT,
  review TEXT,
  future_rule TEXT,
  impact TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'open',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS a_self_permission_rules (
  id TEXT PRIMARY KEY,
  level INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  automation_mode TEXT NOT NULL,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  description TEXT NOT NULL,
  examples TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS a_self_opc_runs (
  id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL,
  title TEXT NOT NULL,
  market_scan TEXT,
  company_state TEXT,
  recommendations TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_a_self_memory_category ON a_self_memory_items(category, updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_a_self_memory_tags ON a_self_memory_items USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_a_self_decisions_time ON a_self_decision_logs(decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_a_self_permissions_level ON a_self_permission_rules(level, action_type);
CREATE INDEX IF NOT EXISTS idx_a_self_opc_runs_type_time ON a_self_opc_runs(run_type, created_at DESC);

INSERT INTO a_self_profiles (
  id, display_name, mission, profile_markdown, values_order, decision_principles, communication_style, boundaries, status, confidence, metadata
) VALUES (
  'a_self_default',
  'A-',
  '用现成大模型作为推理底座，用个人数据、规则、记忆和工具权限逐渐生成数字分身。',
  'A- 不是普通助手，而是基于历史、价值观、决策方式和 OPC 经营上下文形成的数字自我原型。当前阶段目标是先复制记忆，再复制判断，再复制行动，最后复制经营能力。',
  '["长期成长 > 短期收入", "自由 > 稳定", "创造 > 消费", "复利能力 > 一次性收益"]'::jsonb,
  '["重大决定先看是否符合长期方向", "优先选择能提高能力并形成复利的事情", "低成本验证需求，再扩大投入", "信息不足时不假装知道，先标注假设"]'::jsonb,
  '{"avoid":["过度承诺", "空泛鸡血", "掩盖不确定性"], "prefer":["直接表达核心逻辑", "给出可执行下一步", "区分事实、判断和假设"]}'::jsonb,
  '["不做损害长期信用的事情", "花钱、签合同、股权、战略变化必须本人确认", "不得冒充真实数据", "不得越权访问未授权系统"]'::jsonb,
  'active',
  0.18,
  '{"source":"A- blueprint","phase":"0.1"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO a_self_permission_rules (id, level, action_type, automation_mode, requires_approval, description, examples, metadata) VALUES
  ('aspr_level1_research', 1, 'research_and_summary', 'auto', false, '自动搜集信息、总结、整理草稿，不触碰外部承诺。', ARRAY['市场扫描', '资料摘要', '生成报告草稿'], '{"source":"A- blueprint"}'::jsonb),
  ('aspr_level1_memory', 1, 'memory_write', 'reviewable_auto', false, '可写入低风险个人记忆和决策草稿，但必须标注来源与置信度。', ARRAY['整理日记', '沉淀项目经验', '提取决策原因'], '{"source":"A- blueprint"}'::jsonb),
  ('aspr_level2_communication', 2, 'routine_communication', 'semi_auto', true, '普通消息、内容发布、客户回复可生成草稿或等待确认后发送。', ARRAY['客户邮件回复', '公众号草稿', '飞书消息草稿'], '{"source":"A- blueprint"}'::jsonb),
  ('aspr_level3_money', 3, 'money_contract_equity_strategy', 'human_required', true, '花钱、签合同、股权、战略变化必须本人审批，A- 只能分析和起草。', ARRAY['付款', '签署合同', '调整公司战略', '股权承诺'], '{"source":"A- blueprint"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

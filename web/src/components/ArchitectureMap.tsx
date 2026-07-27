import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Database, FileCode2, Search, ServerCog, TerminalSquare } from 'lucide-react';
import { apiGet } from '../api';
import { EmptyState, ErrorPanel, LoadingPanel, PanelHeader } from './ui';

type ArchitectureModule = {
  id: string;
  name: string;
  label: string;
  frontend?: string[];
  backend?: string[];
  routes?: string[];
  tables?: string[];
  services?: string[];
  logs?: string[];
  tests?: string[];
  responsibility?: string;
  symptoms?: string[];
};

type ArchitectureResponse = {
  ok: boolean;
  version: number;
  updatedAt: string;
  modules: ArchitectureModule[];
};

export function ArchitectureMap() {
  const [query, setQuery] = useState('');
  const result = useQuery({
    queryKey: ['architecture-modules'],
    queryFn: () => apiGet<ArchitectureResponse>('/api/web/architecture'),
    staleTime: 60_000
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const modules = result.data?.modules ?? [];
    if (!needle) return modules;
    return modules.filter((module) => JSON.stringify(module).toLowerCase().includes(needle));
  }, [query, result.data]);

  if (result.isLoading) return <LoadingPanel />;
  if (result.isError) return <ErrorPanel error={result.error} />;

  return (
    <div className="architecture-page">
      <section className="panel architecture-hero">
        <PanelHeader title="系统模块地图" hint={`单一事实源 · 更新 ${result.data?.updatedAt ?? '未知'}`} />
        <p>出现 Bug 时先确认模块编号，再查看该模块的 API、数据表、服务和日志。不要默认扫描全站。</p>
        <label className="architecture-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 M15、飞书、finance、worker、表名或文件路径"
          />
        </label>
      </section>

      <section className="architecture-summary" aria-label="模块统计">
        <span><Boxes size={16} /> {result.data?.modules.length ?? 0} 个模块</span>
        <span><ServerCog size={16} /> API / Worker / Channel 分层</span>
        <span><Database size={16} /> 数据表可定位</span>
      </section>

      <div className="architecture-list">
        {filtered.map((module) => <ModuleRow key={module.id} module={module} />)}
        {!filtered.length ? <EmptyState text="没有匹配的模块，请换模块编号、业务名或文件路径。" /> : null}
      </div>
    </div>
  );
}

function ModuleRow({ module }: { module: ArchitectureModule }) {
  return (
    <article className="panel architecture-module">
      <div className="architecture-module-heading">
        <strong>{module.id}</strong>
        <div>
          <h3>{module.label}</h3>
          <code>{module.name}</code>
        </div>
      </div>
      {module.responsibility ? <p className="architecture-responsibility">{module.responsibility}</p> : null}
      <ModuleField icon={<Search size={15} />} label="故障归属" values={module.symptoms} tone="warning" />
      <ModuleField icon={<FileCode2 size={15} />} label="前端" values={module.frontend} />
      <ModuleField icon={<ServerCog size={15} />} label="后端" values={module.backend} />
      <ModuleField icon={<TerminalSquare size={15} />} label="接口" values={module.routes} />
      <ModuleField icon={<Database size={15} />} label="数据表" values={module.tables} />
      <ModuleField icon={<ServerCog size={15} />} label="服务" values={module.services} />
      <ModuleField icon={<TerminalSquare size={15} />} label="日志" values={module.logs} />
      <ModuleField icon={<FileCode2 size={15} />} label="测试" values={module.tests} />
    </article>
  );
}

function ModuleField({ icon, label, values, tone }: { icon: React.ReactNode; label: string; values?: string[]; tone?: 'warning' }) {
  if (!values?.length) return null;
  return (
    <div className={`architecture-field${tone ? ` architecture-field-${tone}` : ''}`}>
      <span>{icon}{label}</span>
      <div>{values.map((value) => <code key={value}>{value}</code>)}</div>
    </div>
  );
}

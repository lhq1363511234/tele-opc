import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APPOS_FEISHU_TABLES, type ApposFeishuTableName } from "../../src/appos/feishu/base-tables.js";

type Field = Record<string, unknown>;

type TableSchema = {
  name: string;
  fields: Field[];
};

const statusOptions = (...names: string[]) => names.map((name) => ({ name }));

const baseSelect = (name: string, options: string[], multiple = false): Field => ({
  name,
  type: "select",
  multiple,
  options: statusOptions(...options),
});

const text = (name: string): Field => ({ name, type: "text" });
const checkbox = (name: string): Field => ({ name, type: "checkbox" });
const datetime = (name: string): Field => ({
  name,
  type: "datetime",
  style: { format: "yyyy-MM-dd HH:mm" },
});
const number = (name: string): Field => ({ name, type: "number" });
const displayNameFor = (name: string) => APPOS_FEISHU_TABLES[name as ApposFeishuTableName]?.displayName ?? name;

export const apposBaseTables: TableSchema[] = [
  {
    name: "BusinessContracts",
    fields: [
      text("id"),
      baseSelect("source_channel", ["feishu", "telegram", "web", "mora_sim", "system"]),
      text("source_message_id"),
      text("goal"),
      baseSelect("domain", [
        "content",
        "social_distribution",
        "crm",
        "finance",
        "calendar",
        "mail",
        "browser",
        "ops",
        "project",
        "memory",
        "unknown",
      ]),
      text("inputs_json"),
      text("success_criteria"),
      baseSelect("risk_level", ["low", "medium", "high"]),
      checkbox("approval_required"),
      baseSelect("status", ["planned", "running", "waiting_approval", "done", "failed", "cancelled"]),
      datetime("created_at"),
    ],
  },
  {
    name: "WorkflowDefinitions",
    fields: [
      text("id"),
      baseSelect("provider", ["dify", "n8n", "builtin", "http_tool"]),
      text("name"),
      baseSelect("domain", ["content", "social_distribution", "crm", "finance", "calendar", "mail", "browser", "ops", "project", "memory", "unknown"]),
      text("capability_tags"),
      text("input_schema_json"),
      text("output_schema_json"),
      baseSelect("risk_level", ["low", "medium", "high"]),
      baseSelect("approval_policy", ["never", "before_run", "before_external_write", "always"]),
      checkbox("enabled"),
    ],
  },
  {
    name: "WorkflowRuns",
    fields: [
      text("id"),
      text("workflow_definition_id"),
      text("business_contract_id"),
      baseSelect("provider", ["dify", "n8n", "builtin", "http_tool"]),
      baseSelect("status", ["planned", "queued", "running", "waiting_callback", "reviewing", "done", "failed", "cancelled"]),
      text("input_json"),
      text("output_json"),
      text("error_json"),
      text("trace_id"),
      text("external_execution_id"),
      datetime("created_at"),
      datetime("updated_at"),
    ],
  },
  {
    name: "ContentCampaigns",
    fields: [
      text("id"),
      text("contract_id"),
      text("name"),
      text("objective"),
      text("platforms"),
      text("target_audience"),
      baseSelect("status", ["planned", "generating", "reviewing", "approved", "running", "done", "failed", "cancelled"]),
      text("owner_notes"),
    ],
  },
  {
    name: "ContentPosts",
    fields: [
      text("id"),
      text("campaign_id"),
      baseSelect("platform", ["douyin", "xiaohongshu", "kuaishou", "shipinhao", "wechat_mp", "bilibili", "other"]),
      text("account"),
      text("title"),
      text("script"),
      text("caption"),
      text("tags"),
      baseSelect("status", ["planned", "drafted", "reviewing", "approved", "video_ready", "published", "failed", "cancelled"]),
      text("approval_id"),
      text("artifact_id"),
      text("publish_url"),
      text("metrics_json"),
    ],
  },
  {
    name: "Artifacts",
    fields: [
      text("id"),
      baseSelect("type", ["script", "caption", "image", "audio", "capcut_draft", "preview_video", "final_video", "document", "webpage", "code", "metadata"]),
      text("title"),
      text("source_run_id"),
      text("customer_or_project_ref"),
      text("storage_ref"),
      text("preview_url"),
      text("draft_url"),
      number("version"),
      baseSelect("status", ["created", "reviewing", "approved", "archived", "failed"]),
    ],
  },
  {
    name: "Approvals",
    fields: [
      text("id"),
      baseSelect("object_type", ["business_contract", "workflow_run", "content_post", "artifact", "repair_plan", "external_publish"]),
      text("object_id"),
      text("action"),
      baseSelect("risk_level", ["low", "medium", "high"]),
      baseSelect("status", ["requested", "approved", "rejected", "expired", "cancelled"]),
      text("reason"),
      datetime("requested_at"),
      datetime("decided_at"),
      baseSelect("decided_by_channel", ["feishu", "telegram", "web", "system"]),
    ],
  },
  {
    name: "ApplicationEvents",
    fields: [
      text("id"),
      text("event_type"),
      text("local_object_type"),
      text("local_object_id"),
      text("summary"),
      text("evidence_refs_json"),
      text("external_refs_json"),
      datetime("timestamp"),
    ],
  },
  {
    name: "ExternalResources",
    fields: [
      text("id"),
      text("source_url"),
      baseSelect("source_type", ["direct_url", "cloud_drive", "video_platform", "rss", "manual_upload", "unknown"]),
      text("provider"),
      text("license"),
      baseSelect("probe_status", ["pending", "probing", "ready", "blocked", "failed"]),
      number("duration_seconds"),
      number("size_bytes"),
      text("checksum"),
      text("storage_ref"),
      baseSelect("risk_level", ["low", "medium", "high"]),
    ],
  },
  {
    name: "MediaJobs",
    fields: [
      text("id"),
      text("resource_id"),
      baseSelect("operation", ["transcribe", "clip", "render_preview", "render_hls", "publish_ready_asset"]),
      baseSelect("status", ["planned", "queued", "running", "waiting_callback", "done", "failed", "cancelled"]),
      text("input_json"),
      text("output_json"),
      text("evidence_refs_json"),
      datetime("created_at"),
      datetime("updated_at"),
    ],
  },
  {
    name: "FailureEvents",
    fields: [
      text("id"),
      baseSelect("source", ["mora", "tele-opc", "dify", "n8n", "feishu", "telegram", "web", "provider"]),
      baseSelect("object_type", ["workflow_run", "api_call", "code_test", "frontend_error", "user_report", "provider_error", "integration_health"]),
      text("object_id"),
      text("symptom"),
      baseSelect("severity", ["low", "medium", "high", "critical"]),
      text("evidence_refs_json"),
      datetime("first_seen_at"),
      baseSelect("status", ["open", "diagnosed", "repair_planned", "verified", "resolved", "ignored"]),
    ],
  },
];

const run = (cmd: string, cmdArgs: string[]) => {
  const printable = [cmd, ...cmdArgs].map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ");
  console.log(`\n$ ${printable}`);
  const executable = process.platform === "win32" && cmd === "lark-cli" ? "node" : cmd;
  const args =
    process.platform === "win32" && cmd === "lark-cli"
      ? [`${process.env.APPDATA}\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js`, ...cmdArgs]
      : cmdArgs;
  const result = spawnSync(executable, args, {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${printable}`);
  }
};

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const writeFieldFiles = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  for (const table of apposBaseTables) {
    writeFileSync(path.join(dir, `${table.name}.fields.json`), JSON.stringify(table.fields, null, 2), "utf8");
  }
};

const main = () => {
  const args = new Set(process.argv.slice(2));
  const writeFieldsDir = argValue("--write-fields-dir");
  if (writeFieldsDir) {
    writeFieldFiles(writeFieldsDir);
    console.log(`Wrote field JSON files to ${writeFieldsDir}`);
    return;
  }

  const printFieldsFor = argValue("--print-fields");
  if (printFieldsFor) {
    const table = apposBaseTables.find((item) => item.name === printFieldsFor);
    if (!table) {
      throw new Error(`Unknown table: ${printFieldsFor}`);
    }
    console.log(JSON.stringify(table.fields));
    return;
  }

  const execute = args.has("--execute");
  const fieldsDir = argValue("--fields-dir");
  if (fieldsDir) {
    writeFieldFiles(fieldsDir);
  }
  const skipTables = new Set(process.argv.flatMap((value, index, all) => (value === "--skip-table" ? [all[index + 1]] : [])));
  const baseToken = argValue("--base-token") ?? process.env.APPOS_FEISHU_BASE_APP_TOKEN;
  const dryRun = execute ? [] : ["--dry-run"];

  if (!baseToken) {
    console.log("No --base-token or APPOS_FEISHU_BASE_APP_TOKEN provided.");
    console.log("Dry-run table creation commands will be printed with BASE_TOKEN_PLACEHOLDER.");
  }

  for (const table of apposBaseTables) {
    if (skipTables.has(table.name)) {
      console.log(`Skipping table: ${table.name}`);
      continue;
    }
    run("lark-cli", [
      "base",
      "+table-create",
      "--base-token",
      baseToken ?? "BASE_TOKEN_PLACEHOLDER",
      "--name",
      displayNameFor(table.name),
      "--fields",
      fieldsDir ? `@${path.join(fieldsDir, `${table.name}.fields.json`)}` : JSON.stringify(table.fields),
      ...dryRun,
    ]);
  }

  console.log(execute ? "\nFeishu Base schema creation requested." : "\nDry run complete. Re-run with --execute --base-token <token> to create tables.");
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

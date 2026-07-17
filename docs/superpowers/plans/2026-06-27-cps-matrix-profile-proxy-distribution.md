# CPS Matrix Profile Proxy Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the CPS matrix workflow one checkpoint at a time: Feishu Profile/account tables, CloakBrowser Profile-name resolution, cleanip gating, source video collection, media analysis, edit planning, CapCut drafts, and automated distribution.

**Architecture:** Keep user-maintained business data in Feishu Base, while AppOS resolves runtime details internally. Users only provide Profile names and account rows; AppOS resolves CloakBrowser IDs, verifies session/proxy state, and gates automation before collection or publishing.

**Tech Stack:** TypeScript AppOS modules, existing lark-cli Feishu Base scripts, CloakBrowser Manager HTTP/CDP API, n8n webhooks, Dify/DeepSeek planner, capcut-mate, Vitest.

---

## Execution Rule

Implement exactly one task, verify it, then stop for user review.

Do not batch multiple tasks in one run.

---

## Task 1: Add CPS Matrix Feishu Table Definitions

**Goal:** Add stable logical table definitions for `CloakProfiles`, `PlatformAccounts`, `MediaAnalyses`, `EditingVersions`, and improved `PublishRecords` fields without mutating the live Base yet.

**Files:**

- Modify: `src/appos/feishu/base-tables.ts`
- Modify: `scripts/appos/create_cps_matrix_base_schema.ts`
- Modify: `scripts/appos/ensure_cps_matrix_base_fields.ts`
- Test: `tests/appos/feishu-base-tables.test.ts`

**Acceptance:**

- Code can resolve new logical table names.
- Schema script can emit field JSON for new tables.
- Existing CPS table names still resolve.
- No live Feishu mutation unless `--execute` is passed.

### Steps

- [x] Add new logical table names in `src/appos/feishu/base-tables.ts`.

Expected logical names:

```ts
CloakProfiles
PlatformAccounts
MediaAnalyses
EditingVersions
PublishRecords
```

- [x] Add Chinese display aliases:

```text
CloakProfiles -> Profile璧勪骇
PlatformAccounts -> 骞冲彴璐﹀彿
MediaAnalyses -> 濯掍綋鍒嗘瀽
EditingVersions -> 鍓緫鐗堟湰
PublishRecords -> 鍙戝竷璁板綍
```

- [x] Update `create_cps_matrix_base_schema.ts` with fields from `docs/appos/CPS_MATRIX_PROFILE_PROXY_DISTRIBUTION_WORKFLOW.zh-CN.md`.

- [x] Update `ensure_cps_matrix_base_fields.ts` so existing Base tables can be patched later.

- [x] Add/extend tests for table resolution.

Run:

```powershell
npm test -- tests/appos/feishu-base-tables.test.ts
```

Expected:

```text
Test Files  1 passed
```

---

## Task 2: Resolve CloakBrowser Profile By Name

**Goal:** Users fill `Profile 鍚嶇О`; AppOS resolves the runtime Profile ID internally.

**Files:**

- Modify: `src/appos/domains/cps/cloakbrowser-prerequisites.ts`
- Test: `tests/appos/cloakbrowser-prerequisites.test.ts`

**Acceptance:**

- [x] Exact unique name resolves to ID.
- [x] Missing name fails clearly.
- [x] Duplicate name fails clearly.
- [x] Existing ID-based flow still works.

---

## Task 3: Add cleanip Proxy Score Check

**Goal:** Before distribution, open a selected Profile and verify `https://cleanip.io/` score is `>= 90`.

**Files:**

- Create: `src/appos/domains/cps/cleanip-check.ts`
- Test: `tests/appos/cleanip-check.test.ts`

**Acceptance:**

- [x] Parses numeric score from page text.
- [x] Returns pass/fail with threshold.
- [x] Does not continue when score is below 90.

---

## Task 4: Add Distribution Readiness Gate

**Goal:** Validate Feishu Profile/account rows before upload automation.

**Files:**

- Create: `src/appos/domains/cps/distribution-readiness.ts`
- Test: `tests/appos/distribution-readiness.test.ts`

**Acceptance:**

- [x] Requires enabled platform account.
- [x] Requires linked Profile name.
- [x] Requires login status `宸茬櫥褰昤.
- [x] Requires report status `宸叉姤鐧絗 or `涓嶉渶瑕乣.
- [x] Requires current drama name, short drama link, and App link.
- [x] Requires cleanip score `>= 90`.

---

## Task 5: Harden MoboBoost/CDReader Source Collection

**Goal:** Make selected-drama collection stop cleanly when original videos are not downloadable and report the real reason.

**Files:**

- Modify: `scripts/appos/moboboost_cps_scrape.py`
- Modify: `src/appos/domains/cps/moboboost-module.ts`
- Test: `tests/appos/moboboost-cps-module.test.ts`

**Acceptance:**

- [x] Downloads original videos when available.
- [x] Detects `未生成资源`, `账号报备`, `无权限`, `无文件下载`.
- [x] Does not continue to media preprocessing without original videos.

---

## Task 6: Write Media Analysis Rows After Preprocess

**Goal:** Write one structured media analysis row per episode after ffprobe/ASR/screenshots.

**Files:**

- Modify: `src/appos/domains/cps/moboboost.ts`
- Modify: `src/appos/domains/cps/inbeidou.ts`
- Test: `tests/appos/moboboost-cps.test.ts`
- Test: `tests/appos/inbeidou-cps.test.ts`

**Acceptance:**

- Subtitle path is exposed as a resource.
- Report path, screenshots, duration, aspect ratio, black ratio, dialogue density are separate fields.
- Avoids dumping large transcript JSON into one unreadable cell.

---

## Task 7: Add Feishu Distribution Selection Action

**Goal:** Let user choose target platform accounts from Feishu after videos are ready.

**Files:**

- Modify: `src/appos/domains/cps/moboboost-module.ts`
- Modify: `src/appos/domains/cps/inbeidou-module.ts`
- Test: module route tests.

**Acceptance:**

- Card shows eligible platform accounts.
- Ineligible accounts show reason.
- User selection creates distribution run input.

---

## Task 8: Automated Platform Distribution Skeleton

**Goal:** Add a controlled skeleton for Facebook/TikTok upload automation using Profile rows and readiness gate.

**Files:**

- Create: `src/appos/domains/cps/distribution-runner.ts`
- Create: `scripts/appos/run_cps_distribution.ts`
- Test: `tests/appos/distribution-runner.test.ts`

**Acceptance:**

- Resolves Profile by name.
- Runs cleanip check.
- Opens upload page.
- Fills title/copy/link fields through platform-specific adapters.
- Clicks publish automatically only after all gates pass.

---

## Task 9: End-To-End Dry Run

**Goal:** Run one selected drama through collection, media preprocess, planning, CapCut drafts, readiness gate, and distribution dry-run.

**Acceptance:**

- Runtime output includes source collection result.
- Original video paths exist.
- Media analysis reports exist.
- Edit plan exists.
- CapCut draft results exist.
- Distribution readiness result shows pass/fail per selected account.

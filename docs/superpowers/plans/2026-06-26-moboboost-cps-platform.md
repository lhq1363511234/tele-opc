# MoboBoost CPS Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MoboBoost/CDReader as an independent CPS short-drama source that uses the existing CloakBrowser profile cookie state and can be started from Feishu robot menus.

**Architecture:** Keep the browser automation script platform-specific and independent from the Inbeidou script. Reuse AppOS service checks, Feishu card sending, Feishu Base writing, and Dify payload conventions through a MoboBoost module with compatible API routes.

**Tech Stack:** TypeScript, Fastify, Vitest, Python, CloakBrowser Manager CDP, Feishu lark-cli.

---

### Task 1: MoboBoost Data Normalization

**Files:**
- Create: `src/appos/domains/cps/moboboost.ts`
- Test: `tests/appos/moboboost-cps.test.ts`

- [x] Add tests for normalizing MoboBoost raw drama rows into stable AppOS CPS records.
- [x] Implement `normalizeMoboboostResults`, `buildMoboboostFeishuBatchPayloads`, and `buildMoboboostDifyPayload`.
- [x] Verify the test fails before implementation and passes after implementation.

### Task 2: MoboBoost AppOS Module

**Files:**
- Create: `src/appos/domains/cps/moboboost-module.ts`
- Modify: `src/app.ts`
- Test: `tests/appos/moboboost-cps-module.test.ts`

- [x] Add failing tests for command building, Feishu platform card rendering, drama selection, ingest, and route ACK behavior.
- [x] Implement module methods for `discoverForFeishu`, `buildFeishuTaskSelection`, `ingest`, and route registration.
- [x] Register module routes in the Fastify app.

### Task 3: Independent Browser Script

**Files:**
- Create: `scripts/appos/moboboost_cps_scrape.py`
- Modify: `package.json`

- [x] Implement a new CDReader/MoboBoost browser scraper using CloakBrowser page-level CDP.
- [x] Support `--list-only`, `--platform`, `--tasks`, `--all`, `--no-download`, and JSON outputs.
- [x] Default to `https://ckoc.cdreader.com/cn/material/content/v2/center` and reuse `CLOAKBROWSER_PROFILE`.

### Task 4: Feishu Robot Menu Wiring

**Files:**
- Modify: `scripts/appos/feishu_inbeidou_command_listener.mjs`
- Modify: `docs/appos/FEISHU_INBEIDOU_ENTRY.zh-CN.md`

- [x] Allow Feishu text commands such as `MoboBoost选剧` and `CDReader选剧` to start the MoboBoost flow.
- [x] Document robot menu item `MoboBoost选剧` with event key `moboboost_start_selection`.

### Task 5: Verification

**Files:**
- Existing tests and scripts.

- [x] Run targeted Vitest suites for MoboBoost and existing Inbeidou module.
- [x] Run TypeScript typecheck.
- [x] Run the MoboBoost discover command against the current CloakBrowser profile and confirm JSON output files are created.

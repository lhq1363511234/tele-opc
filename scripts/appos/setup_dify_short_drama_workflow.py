from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session


ROOT = Path("B:/Cir/CodexProjects")
ENV_PATH = ROOT / "opc-local.env"
CREDENTIALS_PATH = ROOT / "opc-local.credentials.txt"
DSL_PATH = Path("B:/Cir/CodexProjects/tele-opc/docs/appos/dify-workflows/short_drama_cps_edit_planner.yml")
DIFY_API_ROOT = ROOT / "dify" / "api"
DIFY_ENV_PATH = DIFY_API_ROOT / ".env"
DEFAULT_LOG_FORMAT = "%(asctime)s,%(msecs)d %(levelname)-2s [%(filename)s:%(lineno)d] %(req_id)s %(message)s"


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def read_admin_email() -> str:
    text = CREDENTIALS_PATH.read_text(encoding="utf-8") if CREDENTIALS_PATH.exists() else ""
    email = re.search(r"DIFY_ADMIN_EMAIL=(.+)", text)
    value = (email.group(1).strip() if email else os.getenv("DIFY_ADMIN_EMAIL", "")).strip()
    if not value:
        raise RuntimeError("Missing DIFY_ADMIN_EMAIL in local private credentials file")
    return value


def upsert_env_line(path: Path, key: str, value: str) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    prefix = f"{key}="
    replaced = False
    next_lines: list[str] = []
    for line in lines:
        if line.startswith(prefix):
            next_lines.append(f"{key}={value}")
            replaced = True
        else:
            next_lines.append(line)
    if not replaced:
        next_lines.append(f"{key}={value}")
    path.write_text("\n".join(next_lines).rstrip() + "\n", encoding="utf-8")


def apply_env_defaults(*env_files: Path) -> None:
    for path in env_files:
        for key, value in read_env_file(path).items():
            os.environ.setdefault(key, value)
    os.environ["LOG_OUTPUT_FORMAT"] = os.environ.get("LOG_OUTPUT_FORMAT") or "text"
    if os.environ.get("LOG_OUTPUT_FORMAT") == "json":
        os.environ["LOG_OUTPUT_FORMAT"] = "text"
    if os.environ.get("LOG_FORMAT") in {"", "json", None}:
        os.environ["LOG_FORMAT"] = DEFAULT_LOG_FORMAT


def main() -> None:
    apply_env_defaults(ENV_PATH, DIFY_ENV_PATH)
    if str(DIFY_API_ROOT) not in sys.path:
        sys.path.insert(0, str(DIFY_API_ROOT))

    env = read_env_file(ENV_PATH)
    api_base_url = env.get("DIFY_API_URL") or os.getenv("DIFY_API_URL") or "http://127.0.0.1:5001"
    email = read_admin_email().lower()
    yaml_content = DSL_PATH.read_text(encoding="utf-8")

    from app_factory import create_app
    from extensions.ext_database import db
    from libs.datetime_utils import naive_utc_now
    from models.account import Account
    from models.enums import ApiTokenType
    from models.model import ApiToken, App
    from services.account_service import TenantService
    from services.app_dsl_service import AppDslService
    from services.entities.dsl_entities import ImportMode, ImportStatus
    from services.workflow_service import WorkflowService

    _socketio_app, flask_app = create_app()
    with flask_app.app_context():
      with Session(db.engine, expire_on_commit=False) as session:
        account = session.scalar(select(Account).where(Account.email == email))
        if account is None:
            raise RuntimeError(f"Dify account not found for configured admin email: {email}")
        joins = TenantService.get_join_tenants(account, session=session)
        if not joins:
            raise RuntimeError(f"Dify account has no workspace tenant: {email}")
        account.current_tenant = joins[0]
        account.set_tenant_id(joins[0].id)

        import_service = AppDslService(session)
        result = import_service.import_app(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=yaml_content,
            name="OPC 短剧CPS剪辑策划",
            description="短剧 CPS 第 6 步 Dify 剪辑策划 workflow",
            icon_type="emoji",
            icon="🎬",
            icon_background="#FFEAD5",
        )
        if result.status not in {ImportStatus.COMPLETED, ImportStatus.COMPLETED_WITH_WARNINGS}:
            raise RuntimeError(f"Dify import failed: {result.model_dump(mode='json')}")
        if not result.app_id:
            raise RuntimeError(f"Dify import returned no app_id: {result.model_dump(mode='json')}")

        app_model = session.get(App, result.app_id)
        if app_model is None:
            raise RuntimeError(f"Dify app not found after import: {result.app_id}")

        workflow = WorkflowService().publish_workflow(
            session=session,
            app_model=app_model,
            account=account,
            marked_name="v1",
            marked_comment="Tele-OPC short drama CPS edit planner",
        )
        app_model.workflow_id = workflow.id
        app_model.updated_by = account.id
        app_model.updated_at = naive_utc_now()

        api_token = ApiToken()
        api_token.app_id = app_model.id
        api_token.tenant_id = app_model.tenant_id
        api_token.token = ApiToken.generate_api_key("app-", 24)
        api_token.type = ApiTokenType.APP
        session.add(api_token)
        session.commit()

        upsert_env_line(ENV_PATH, "APPOS_DIFY_SHORT_DRAMA_CPS_WORKFLOW_URL", f"{api_base_url.rstrip('/')}/v1/workflows/run")
        upsert_env_line(ENV_PATH, "APPOS_DIFY_SHORT_DRAMA_CPS_APP_ID", str(app_model.id))
        upsert_env_line(ENV_PATH, "APPOS_DIFY_SHORT_DRAMA_CPS_API_KEY", api_token.token)

        print(json.dumps({
            "ok": True,
            "appId": str(app_model.id),
            "workflowId": str(workflow.id),
            "workflowUrl": f"{api_base_url.rstrip('/')}/v1/workflows/run",
            "apiKeyStoredIn": str(ENV_PATH),
        }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

import json
import tempfile
import unittest
from pathlib import Path

from scripts import codex_log_db


class CodexLogDbTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "codex_test_log.db"
        codex_log_db.init_db(self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_session_log_and_artifact_summary(self) -> None:
        codex_log_db.upsert_session(
            self.db_path,
            task_id="task-1",
            session_id="session-1",
            user_requirement="继续工作",
            summary="正在补日志基础设施",
            status="running",
        )
        codex_log_db.append_log(
            self.db_path,
            task_id="task-1",
            session_id="session-1",
            user_requirement="继续工作",
            thinking_path="先补日志库，再推进下载功能",
            key_steps="创建 SQLite 脚本与入口文件",
            code_snippet="print('hello')",
            error_message="",
            fix_record="",
            status="running",
        )
        codex_log_db.add_artifact(
            self.db_path,
            task_id="task-1",
            session_id="session-1",
            artifact_type="doc",
            artifact_path="docs/demo.md",
            description="阶段文档",
        )

        summary = codex_log_db.summarize_history(self.db_path, "task-1")
        self.assertEqual(summary.last_step, "创建 SQLite 脚本与入口文件")
        self.assertIn("doc: docs/demo.md | 阶段文档", summary.reusable_items)

    def test_error_log_is_reported(self) -> None:
        codex_log_db.append_log(
            self.db_path,
            task_id="task-2",
            session_id="session-2",
            user_requirement="继续工作",
            thinking_path="",
            key_steps="运行初始化",
            code_snippet="",
            error_message="初始化失败",
            fix_record="等待重试",
            status="error",
        )

        summary = codex_log_db.summarize_history(self.db_path, "task-2")
        self.assertTrue(summary.unresolved_issues)
        self.assertIn("初始化失败", json.dumps(summary.unresolved_issues, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()

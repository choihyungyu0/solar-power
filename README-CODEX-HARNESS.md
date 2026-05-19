# Solar Power Codex Harness Pack

이 폴더의 파일들을 `solar-power-starter` 프로젝트 루트에 복사하세요.

복사 후 구조 예시:

```txt
solar-power-starter/
├── AGENTS.md
├── agent.md
├── .codex/prompts/
├── docs/CODEX_HARNESS.md
├── scripts/harness-check.ps1
├── scripts/harness-check.sh
└── supabase/migrations/202605190001_initial_schema.sql
```

Windows PowerShell에서 검증:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/harness-check.ps1
```

Codex 첫 프롬프트는 `.codex/prompts/00-first-run-project-audit.md`를 사용하세요.

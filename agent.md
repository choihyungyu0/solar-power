# agent.md

이 레포의 실제 에이전트 지침 파일은 `AGENTS.md`입니다.
Codex 작업 전에는 반드시 루트의 `AGENTS.md`를 먼저 읽고 따르세요.

요약:

- 현재 MVP는 React + TypeScript + Vite + Supabase 중심입니다.
- FastAPI는 당장 수정하지 않습니다.
- Windows PowerShell에서는 `npm` 대신 `npm.cmd`를 우선 사용합니다.
- 작업 후 `powershell -ExecutionPolicy Bypass -File scripts/harness-check.ps1`로 검증합니다.
- 프론트엔드에 Supabase `service_role` 키를 넣지 않습니다.

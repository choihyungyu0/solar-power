export type AiChatMessagePayload = {
  role: 'assistant' | 'user';
  content: string;
};

export type AiChatRequestPayload = {
  question: string;
  messages: AiChatMessagePayload[];
  context: Record<string, unknown>;
};

export type AiChatResponse =
  | {
      ok: true;
      answer: string;
      source: string;
      llmEnabled: true;
      model?: string;
    }
  | {
      ok: false;
      message: string;
      errorType?: string;
      reason?: string;
    };

function getClimateBackendBaseUrl() {
  return (import.meta.env.VITE_CLIMATE_BACKEND_BASE_URL ?? '').trim().replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function requestAiChatAnswer(payload: AiChatRequestPayload): Promise<AiChatResponse> {
  const baseUrl = getClimateBackendBaseUrl();

  if (!baseUrl) {
    return {
      ok: false,
      message: 'AI 상담 서버가 설정되지 않았습니다.',
      errorType: 'BackendNotConfigured',
    };
  }

  try {
    const response = await fetch(`${baseUrl}/api/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => null)) as unknown;

    if (response.ok && isRecord(data) && data.ok === true && typeof data.answer === 'string') {
      return {
        ok: true,
        answer: data.answer,
        source: typeof data.source === 'string' ? data.source : 'openai-chat-completions',
        llmEnabled: true,
        model: typeof data.model === 'string' ? data.model : undefined,
      };
    }

    return {
      ok: false,
      message: isRecord(data) && typeof data.message === 'string' ? data.message : 'AI 상담 답변을 생성하지 못했습니다.',
      errorType: isRecord(data) && typeof data.errorType === 'string' ? data.errorType : `HTTP_${response.status}`,
      reason: isRecord(data) && typeof data.reason === 'string' ? data.reason : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      message: 'AI 상담 답변을 생성하지 못했습니다.',
      errorType: error instanceof Error ? error.name : 'FetchError',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface ToolResult {
  toolCallId: string;
  output: string;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  error?: string;
}

export interface ModelProvider {
  readonly name: string;
  chat(messages: Message[], tools?: ToolDef[]): AsyncIterable<StreamChunk>;
}

export interface AgentConfig {
  maxIterations: number;
  kbId: string;
  provider: ModelProvider;
}

export interface AgentEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'error' | 'done';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
}

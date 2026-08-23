import type {
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "@intx/types/runtime";

export interface BaseEnv {
  [key: string]: unknown;
}

export interface ToolDeclaration {
  readonly name: string;
  readonly approval?: "ask";
}

export type ToolHandler = (
  call: ToolCall,
  signal: AbortSignal,
) => Promise<ToolResult>;

export interface ToolBundle {
  readonly definitions: readonly ToolDefinition[];
  run(call: ToolCall, signal: AbortSignal): Promise<ToolResult>;
  dispose?(): Promise<void>;
}

export type ToolFactory<EnvReq extends BaseEnv = BaseEnv> = (
  env: EnvReq,
) => ToolBundle;

export type AnnotatedToolFactory<EnvReq extends BaseEnv = BaseEnv> =
  ToolFactory<EnvReq> & {
    readonly id: string;
    readonly requires: readonly string[];
    readonly definitions: readonly ToolDeclaration[];
  };

export function defineTool<EnvReq extends BaseEnv = BaseEnv>(opts: {
  id: string;
  requires?: readonly string[];
  definitions: readonly ToolDeclaration[];
  factory: ToolFactory<EnvReq>;
}): AnnotatedToolFactory<EnvReq>;

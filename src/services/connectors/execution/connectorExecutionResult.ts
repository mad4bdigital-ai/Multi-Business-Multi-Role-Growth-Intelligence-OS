export interface ConnectorResourceRef {
  resourceType: string;
  resourceId: string;
  displayName?: string;
}

export interface ConnectorExecutionResult {
  success: boolean;
  connectorKey: string;
  actionKey: string;
  resourceRefs?: ConnectorResourceRef[];
  summary: string;
  rawStatus?: string;
  warnings?: string[];
}

import { URL } from 'node:url';
import { INode, NodeOperationError } from 'n8n-workflow';

export function getWorkflowUrl(
	node: INode,
	baseUrl: string,
	workflowId: string | undefined,
): string | undefined {
	if (!baseUrl || workflowId === undefined) {
		throw new NodeOperationError(
			node,
			'Instance base URL is not available or workflowId is undefined',
		);
	}

	return new URL(`workflow/${workflowId}`, baseUrl).href;
}

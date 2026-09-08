import { URL } from 'node:url';
import { INode, NodeOperationError } from 'n8n-workflow';

export function getWorkflowUrl(node: INode, workflowId: string | undefined): string | undefined {
	const baseUrl = process.env.WEBHOOK_URL;
	if (baseUrl === undefined || workflowId === undefined) {
		throw new NodeOperationError(node, 'WEBHOOK_URL is not set or workflowId is undefined');
	}

	return new URL(`workflow/${workflowId}`, baseUrl).href;
}

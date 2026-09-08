import { NodeApiError, NodeOperationError, JsonObject, INode } from 'n8n-workflow';

/**
 * Wrapper for the error data used in Lime workflows
 */
export type WorkflowErrorContext = {
	message: string;
} & JsonObject;

/**
 * Structure for unsuccessful response used in communication layer.
 */
export type ErrorResponse = {
	success: false;
	data: { error: WorkflowErrorContext };
};

/**
 * Function which handles how are the errors handled in n8n workflows. It
 * either throws an error or returns the error data, depending on the
 * `continue on Error` flag.
 * @param node - the context of a Node
 * subclass of {@link INode}
 * @param errorContext - the data of the error we want to return to the user
 * @param isApiError - flag checking if the error is connected to the external
 * API or internal N8N's logic - based on it we either throw {@link NodeApiError}
 * or {@link NodeOperationError}
 */
export function handleWorkflowError(
	node: INode,
	errorContext: WorkflowErrorContext,
	isApiError: boolean = false,
): ErrorResponse {
	if (node.onError === 'continueErrorOutput' || node.onError === 'continueRegularOutput') {
		return {
			success: false,
			data: { error: errorContext },
		};
	} else if (isApiError) {
		throw new NodeApiError(node, errorContext);
	}
	throw new NodeOperationError(node, errorContext.message);
}

/**
 * Return the given error as an n8n node error so it renders with full context
 * in the n8n UI: {@link NodeApiError} and {@link NodeOperationError} pass
 * through unchanged, anything else is wrapped in a {@link NodeOperationError}.
 * @param node - the node the error belongs to
 * @param error - the caught error
 */
export function toNodeError(node: INode, error: unknown): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		return error;
	}
	return new NodeOperationError(node, error instanceof Error ? error : String(error));
}

import { IAllExecuteFunctions } from 'n8n-workflow';
import { version as packageVersion } from '../package.json';

const SOURCE_APPLICATION = 'lime-crm-workflows';
const USER_AGENT = `${SOURCE_APPLICATION}/${packageVersion} (n8n-node)`;
const MAX_INPUT_LENGTH = 200;

type LimeHeaderName =
	| 'X-Source-Application'
	| 'User-Agent'
	| 'X-N8N-Instance-Id'
	| 'X-N8N-Workflow-Id'
	| 'X-N8N-Workflow-Name'
	| 'X-N8N-Execution-Id'
	| 'X-N8N-Execution-Mode'
	| 'X-N8N-Node-Name'
	| 'X-N8N-Node-Type';

function sanitize(value: string): string | undefined {
	const truncated = [...value].slice(0, MAX_INPUT_LENGTH).join('');
	return encodeURIComponent(truncated) || undefined;
}

/**
 * Build the set of metadata headers attached to every outbound request the
 * Lime nodes make. Headers identify the source package, the n8n instance,
 * and the originating workflow/execution/node so the backend can apply
 * per-tenant rate limiting and correlate access logs.
 *
 * Free-form values that may come from user input (workflow name, node name)
 * are URL-encoded and length-capped. Empty values are dropped.
 *
 * @param context - Any n8n execution-style context that exposes the
 *   {@link FunctionsBase} methods.
 * @returns A record of header name to header value, containing only headers
 *   whose value is non-empty.
 *
 * @public
 * @group Utils
 */
export function buildLimeHeaders(context: IAllExecuteFunctions): Record<string, string> {
	const workflow = context.getWorkflow();
	const node = context.getNode();

	const candidates: Record<LimeHeaderName, string | undefined> = {
		'X-Source-Application': SOURCE_APPLICATION,
		'User-Agent': USER_AGENT,
		'X-N8N-Instance-Id': context.getInstanceId(),
		'X-N8N-Workflow-Id': workflow.id,
		'X-N8N-Workflow-Name': workflow.name ? sanitize(workflow.name) : undefined,
		'X-N8N-Execution-Id': context.getExecutionId(),
		'X-N8N-Execution-Mode': context.getMode?.(),
		'X-N8N-Node-Name': sanitize(node.name),
		'X-N8N-Node-Type': node.type,
	};

	return Object.fromEntries(Object.entries(candidates).filter(([, value]) => value)) as Record<
		string,
		string
	>;
}

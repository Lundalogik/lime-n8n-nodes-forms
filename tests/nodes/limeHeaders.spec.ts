import { IAllExecuteFunctions } from 'n8n-workflow';
import { buildLimeHeaders } from '../../nodes';
import { version as packageVersion } from '../../package.json';

function makeContext(
	overrides: Partial<{
		instanceId: string;
		workflowId?: string;
		workflowName?: string;
		executionId: string;
		mode: string;
		nodeName: string;
		nodeType: string;
	}> = {},
): IAllExecuteFunctions {
	const {
		instanceId = 'instance-abc',
		workflowId = 'wf-1',
		workflowName = 'My Workflow',
		executionId = 'exec-42',
		mode = 'manual',
		nodeName = 'Lime CRM',
		nodeType = 'limeCrm',
	} = overrides;

	return {
		getInstanceId: jest.fn().mockReturnValue(instanceId),
		getWorkflow: jest.fn().mockReturnValue({ id: workflowId, name: workflowName }),
		getExecutionId: jest.fn().mockReturnValue(executionId),
		getNode: jest.fn().mockReturnValue({ name: nodeName, type: nodeType }),
		getMode: jest.fn().mockReturnValue(mode),
	} as unknown as IAllExecuteFunctions;
}

describe('buildLimeHeaders', () => {
	it('returns the full set of headers for a populated context', () => {
		const headers = buildLimeHeaders(makeContext());

		expect(headers).toEqual({
			'X-Source-Application': 'lime-crm-workflows',
			'User-Agent': `lime-crm-workflows/${packageVersion} (n8n-node)`,
			'X-N8N-Instance-Id': 'instance-abc',
			'X-N8N-Workflow-Id': 'wf-1',
			'X-N8N-Workflow-Name': encodeURIComponent('My Workflow'),
			'X-N8N-Execution-Id': 'exec-42',
			'X-N8N-Execution-Mode': 'manual',
			'X-N8N-Node-Name': encodeURIComponent('Lime CRM'),
			'X-N8N-Node-Type': 'limeCrm',
		});
	});

	it('URL-encodes workflow and node names containing special characters', () => {
		const headers = buildLimeHeaders(
			makeContext({
				workflowName: 'Sync ACME Corp / jens@customer.com',
				nodeName: 'Step #1 — fetch',
			}),
		);

		expect(headers['X-N8N-Workflow-Name']).toBe('Sync%20ACME%20Corp%20%2F%20jens%40customer.com');
		expect(headers['X-N8N-Node-Name']).toBe('Step%20%231%20%E2%80%94%20fetch');
	});

	it('truncates free-form values to 200 codepoints and stays decodable', () => {
		const emojiName = '🍋'.repeat(250);

		const headers = buildLimeHeaders(makeContext({ workflowName: emojiName, nodeName: emojiName }));

		for (const header of ['X-N8N-Workflow-Name', 'X-N8N-Node-Name']) {
			expect(() => decodeURIComponent(headers[header])).not.toThrow();
			expect([...decodeURIComponent(headers[header])]).toHaveLength(200);
		}
	});

	it('drops headers whose source value is empty', () => {
		const headers = buildLimeHeaders(makeContext({ workflowId: '', workflowName: '' }));

		expect(headers).not.toHaveProperty('X-N8N-Workflow-Id');
		expect(headers).not.toHaveProperty('X-N8N-Workflow-Name');
		expect(headers['X-Source-Application']).toBe('lime-crm-workflows');
	});

	it('drops the execution mode header when getMode is not defined', () => {
		const ctx = makeContext();
		delete (ctx as { getMode?: unknown }).getMode;

		const headers = buildLimeHeaders(ctx);

		expect(headers).not.toHaveProperty('X-N8N-Execution-Mode');
		expect(headers['X-Source-Application']).toBe('lime-crm-workflows');
	});
});

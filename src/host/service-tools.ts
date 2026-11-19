import { defineTool } from '@deepseek-ai/dsh-tools'
import { workerName } from '../shared/types.ts'
import { assertDshAgentName } from '../shared/agent-names.ts'
import { integrationReport, isolationGuidance, readResolutions } from './isolated-merge-decisions.ts'
import {
  CLI_NAME_GUIDANCE,
  requireCliName,
  resolveCliName,
  isGenericQoderName,
  isGenericWorkBuddyName,
} from './routing.ts'
import { waitForInput } from './service-errors.ts'
import type { ServiceContext } from './service-context.ts'

export function registerTools(this: ServiceContext): void {
  const output = {
    schema: { type: 'string' as const },
    render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
  }
  this.ctx.effect(
    () =>
      this.ctx.tools.register(
        defineTool({
          name: 'cliworker_resolve',
          description: `只读解析明确调用中的 CLI 名称、别名或轻微拼写误差，不启动任务、不读取账号、不保存选型。${CLI_NAME_GUIDANCE}。未知、歧义或多个目标返回简短候选错误，不启动、不额外发问题卡。`,
          parameters: {
            name: {
              type: 'string',
              required: true,
              description: '用户要求调用的 CLI 名称；不是任务内容或模型名称。',
            },
          },
          output,
          isConcurrencySafe: () => true,
          execute: async (args, exec) =>
            JSON.stringify(
              isGenericQoderName(args.name) || isGenericWorkBuddyName(args.name)
                ? await this.resolveDispatchName(
                    args.name,
                    AbortSignal.any([exec.signal, this.disposed.signal]),
                  )
                : resolveCliName(args.name),
            ),
        }),
      ),
    'cliworker:resolve',
  )
  this.ctx.effect(
    () =>
      this.ctx.tools.register(
        defineTool({
          name: 'cliworker_start',
          description: `用户明确要求“调用 agy cli”或“用 glm cli 完成任务”时，调用本工具打开 CLI Worker 的选型流程。只需提供 CLI、任务标题和任务内容；模型、思考强度与角色由插件收集，完成选型前不会启动任务，不要把它们当作调用本工具的前置输入。${CLI_NAME_GUIDANCE}。泛称 qoder / WorkBuddy 在双版本均安装时先通过原生询问选择版本。Host 在首次选择模型、思考强度与角色，或同项目新对话确认是否沿用时提问；同对话后续不重复。不要提前自行提问或增加确认，不代答。返回后台 job、worker ID、agentName 与 permission（本轮实际权限档位；未选过档位的 Worker 跟随主对话权限预设），向用户说明权限时以 permission 为准，不要自行推断。主对话的直接子 Agent（包括 CLI Worker）可同级派遣，新 Worker 归属主对话并与发起者同级；发起者不提供模型、强度、角色或会话 ID，每个主对话最多 6 个未结束的子 Agent 派遣。主对话的已有智能体续聊用 cliworker_followup；除泛称 qoder / WorkBuddy 的双版本选择外，其他歧义返回简短候选错误，不启动、不额外发问题卡。`,
          parameters: {
            cli: {
              type: 'string',
              required: true,
              description: `本次用户明确指定的 CLI 规范 ID 或别名：${CLI_NAME_GUIDANCE}。每次调用必填，Antigravity 也不可省略；不得照搬历史调用中省略 cli 的写法。较长名称仅接受唯一轻微误差；短名须精确，不猜模型。`,
            },
            title: { type: 'string', required: true },
            prompt: { type: 'string', required: true },
            agent_name: {
              type: 'string',
              description:
                'Optional user-requested unique worker name within this parent conversation. Use 1–32 lowercase ASCII letters, digits or hyphens, starting with a letter; lead is reserved. Otherwise assigned from the CLI short name and an ordinal. Use followup by worker_name to reuse an existing named worker.',
            },
            read_only: {
              type: 'boolean',
              description:
                'Use native read-only/plan mode; unsupported by Kimi print mode. Omit or false for coding.',
            },
          },
          output,
          timeoutMs: 1800000,
          isConcurrencySafe: () => true,
          execute: async (args, exec) => {
            if (!exec.agent) throw new Error('A parent Agent is required')
            const parent = await this.dispatchSubject(exec.agent)
            this.assertExecution(parent, true)
            const { questionAgent, initiator } = await this.siblingDispatch(exec.agent, parent, exec.signal)
            let cli = requireCliName(args.cli)
            if (isGenericWorkBuddyName(args.cli))
              cli = await this.chooseWorkBuddyVariant(parent, exec.signal, args.cli, questionAgent)
            if (isGenericQoderName(args.cli))
              cli = await this.chooseQoderVariant(parent, exec.signal, args.cli, questionAgent)
            const agentName = args.agent_name === undefined ? undefined : assertDshAgentName(args.agent_name)
            if (cli === 'kimi' && args.read_only) throw new Error('Kimi 非交互模式不支持只读派遣')
            const setup = await this.chooseDispatch(
              parent,
              AbortSignal.any([exec.signal, this.disposed.signal]),
              cli,
              questionAgent,
            )
            exec.signal.throwIfAborted()
            return this.launch(
              parent,
              args.title,
              args.prompt,
              setup.preference,
              args.read_only ? 'plan' : 'accept-edits',
              undefined,
              { agentName, role: setup.role ?? undefined, ...(initiator ? { initiator } : {}) },
              AbortSignal.any([exec.signal, this.disposed.signal]),
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              'agent',
              initiator ? questionAgent.id : undefined,
            )
          },
        }),
      ),
    'cliworker:start',
  )
  this.ctx.effect(
    () =>
      this.ctx.tools.register(
        defineTool({
          name: 'cliworker_status',
          description:
            'Read the parent conversation’s CLI workers or one worker’s latest result. Background completion is announced automatically.',
          parameters: { worker_id: { type: 'string' }, worker_name: { type: 'string' } },
          output,
          isConcurrencySafe: () => true,
          execute: async (args, exec) => {
            if (!exec.agent) throw new Error('A parent Agent is required')
            const parent = await this.dispatchSubject(exec.agent)
            if (args.worker_id || args.worker_name) {
              const dsh = await this.dshFallback(parent.id, args, exec.signal, () =>
                this.runtime.resolveWorker(parent.id, args.worker_id, args.worker_name),
              )
              if ('kind' in dsh) return JSON.stringify(dsh)
              return JSON.stringify({ ...dsh, agentName: workerName(dsh), guidance: isolationGuidance(dsh) })
            }
            const dshRows =
              this.runtime.snapshot(parent.id).showDshSubagents === false
                ? []
                : (await this.dshSubagents.list(parent.id, exec.signal)).map((row) => ({
                    kind: 'dsh-subagent',
                    workerId: row.id,
                    agentName: row.agentName,
                    title: row.name,
                    status: row.stopped ? 'stopped' : row.status,
                    model: row.model,
                    mode: row.mode,
                  }))
            return JSON.stringify([
              ...this.runtime.snapshot(parent.id).workers.map((worker) => ({
                ...worker,
                agentName: workerName(worker),
                guidance: isolationGuidance(worker),
              })),
              ...dshRows,
            ])
          },
        }),
      ),
    'cliworker:status',
  )
  this.ctx.effect(
    () =>
      this.ctx.tools.register(
        defineTool({
          name: 'cliworker_followup',
          description:
            'Continue a specific idle CLI worker by worker_id or its exact agentName in worker_name. Retains its role, current model/effort and CLI conversation; never starts another worker. Do not use it to resume a worker that was stopped manually (its result has stoppedBy: "user") unless the user has since explicitly asked to continue. A DSH native subagent listed in the CLI Worker window is continued the same way by its DSH catalog name listed by cliworker_status or a former name; its reply returns as a DSH subagent message. The CLI Worker receipt includes permission: this turn\'s actual tier (a Worker without its own level follows the parent preset); report it as is.',
          parameters: {
            worker_id: { type: 'string' },
            worker_name: { type: 'string' },
            prompt: { type: 'string', required: true },
          },
          output,
          isConcurrencySafe: () => true,
          execute: async (args, exec) => {
            if (!exec.agent) throw new Error('A parent Agent is required')
            const agent = exec.agent
            const target = await this.dshFallback(
              agent.id,
              args,
              exec.signal,
              () => this.runtime.resolveWorker(agent.id, args.worker_id, args.worker_name),
              args.prompt,
            )
            if ('kind' in target) return JSON.stringify(target)
            return this.continueWorker(agent.id, target.id, args.prompt, exec.signal, 'agent')
          },
        }),
      ),
    'cliworker:followup',
  )
  this.ctx.effect(
    () =>
      this.ctx.tools.register(
        defineTool({
          name: 'cliworker_stop',
          description: 'Stop a CLI worker and await cleanup of its managed processes.',
          parameters: { worker_id: { type: 'string' }, worker_name: { type: 'string' } },
          output,
          isConcurrencySafe: () => true,
          execute: async (args, exec) => {
            if (!exec.agent) throw new Error('A parent Agent is required')
            const worker = this.runtime.resolveWorker(exec.agent.id, args.worker_id, args.worker_name)
            return JSON.stringify(await this.runtime.stop(exec.agent.id, worker.id))
          },
        }),
      ),
    'cliworker:stop',
  )
  this.ctx.effect(
    () =>
      this.ctx.tools.register(
        defineTool({
          name: 'cliworker_merge',
          description:
            '把空闲 CLI 智能体隔离副本中的改动三方合并回当前项目，作为未提交改动写回，不会提交。隔离运行的智能体完成后，由你核查结果再调用本工具。只有一边改过的文件直接写回；两边都改过的文件不是错误，返回 needs_integration 及基线、项目、副本三个版本的文件路径，由你按各任务目标整合，再带 resolutions 调用本工具（use=content 附完整最终内容，或 use=copy / use=project）。只有两边目标相互矛盾时才用 ask_user_question 请用户选择。决定齐全前项目不变、副本保留。不要让 CLI 改到原目录重做。',
          parameters: {
            worker_id: { type: 'string' },
            worker_name: { type: 'string' },
            resolutions: {
              type: 'array',
              description:
                'Decisions for files a previous call returned in needs_integration. Each item: path, use (content | copy | project), and content (the complete final file text) when use is content.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  path: { type: 'string', required: true },
                  use: { type: 'string', enum: ['content', 'copy', 'project'], required: true },
                  content: { type: 'string' },
                },
              },
            },
          },
          output,
          isConcurrencySafe: () => false,
          execute: async (args, exec) => {
            if (!exec.agent) throw new Error('A parent Agent is required')
            const worker = this.runtime.resolveWorker(exec.agent.id, args.worker_id, args.worker_name)
            const resolutions = readResolutions(args.resolutions)
            const result = await this.mergeIsolatedWorker(exec.agent, worker.id, exec.signal, resolutions)
            return JSON.stringify(
              result.status === 'merged'
                ? result
                : integrationReport(
                    workerName(worker),
                    result,
                    resolutions && result.conflicts.map((item) => item.path),
                  ),
            )
          },
        }),
      ),
    'cliworker:merge',
  )
  this.ctx.effect(
    () =>
      this.ctx.tools.register(
        defineTool({
          name: 'cliworker_discard',
          description:
            '丢弃空闲 CLI 智能体的隔离副本。执行前会向用户确认；确认后副本中的改动永久删除，主目录不变。用户未确认时副本保留。',
          parameters: { worker_id: { type: 'string' }, worker_name: { type: 'string' } },
          output,
          isConcurrencySafe: () => false,
          execute: async (args, exec) => {
            if (!exec.agent) throw new Error('A parent Agent is required')
            const agent = exec.agent
            const worker = this.runtime.resolveWorker(agent.id, args.worker_id, args.worker_name)
            const signal = AbortSignal.any([exec.signal, this.disposed.signal])
            const response = await waitForInput(
              agent.ctx.get('userQuestions')!.ask({
                agent,
                signal,
                questions: [
                  {
                    id: 'cliworker_discard',
                    header: '丢弃副本',
                    question: `丢弃 ${workerName(worker)} 的隔离副本？副本中的改动将永久删除，项目主目录不变。`,
                    options: [{ label: '丢弃' }, { label: '保留' }],
                  },
                ],
              }),
              signal,
            )
            const answer = response.answers.find((item) => item.id === 'cliworker_discard')
            if (
              answer?.custom !== undefined ||
              answer?.selected.length !== 1 ||
              answer.selected[0] !== '丢弃'
            )
              return JSON.stringify({ status: 'kept', message: '用户未确认，隔离副本已保留' })
            await this.runtime.discardIsolation(agent.id, worker.id)
            return JSON.stringify({ status: 'discarded' })
          },
        }),
      ),
    'cliworker:discard',
  )
}

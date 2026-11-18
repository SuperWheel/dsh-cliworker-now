import { isWorkBuddyCli } from './workbuddy-variant.ts'
import { WorkBuddyUnavailableError } from './workbuddy-installation.ts'
import { readDshChildren } from './dsh-subagents.ts'
import { SettingsCatalogCache } from './settings-catalog-cache.ts'
import { resolveModel } from '../shared/models.ts'
import { visibleModelChoices } from '../shared/model-presentation.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import { CLI_LABELS, cliOf, workerName, effortLabel, type CliId } from '../shared/types.ts'
import { readRoleAnswer, roleQuestion } from './roles.ts'
import { ProcessCleanupUnconfirmedError } from './process.ts'
import { validatePreference, configuredCliExecutable, resolveCliExecutable } from './adapters.ts'
import { WindowsCliNotFoundError } from './windows-cli-installation.ts'
import { type DispatchSetup } from './storage.ts'
import { isGenericWorkBuddyName, resolveAvailableWorkBuddyName, resolveAvailableCliName } from './routing.ts'
import { waitForInput } from './service-errors.ts'
import type { ServiceContext } from './service-context.ts'
import { preferenceSchema } from './service-models.ts'

export async function dispatchSubject(this: ServiceContext, caller: Agent): Promise<Agent> {
  if (caller.session.header.origin !== 'subagent') return caller
  const parentId = caller.session.header.parentSession
  // A background Worker can outlive its parent's resident Agent; load it the
  // same way native Remote Agent parameters do before deciding it is gone.
  if (parentId)
    try {
      await this.ctx.typert.lookups.get('agent')?.resolve(parentId)
    } catch {
      /* reported below */
    }
  const parent = parentId && this.ctx.agents.get(parentId)
  if (!parent) throw new Error('无法解析子 Agent 所属主对话；任务尚未创建')
  if (
    parent.id === caller.id ||
    parent.session.header.origin === 'subagent' ||
    parent.session.header.parentSession
  )
    throw new Error('只允许主对话的直接子 Agent 同级派遣；第三层调用被拒绝')
  return parent
}

export async function siblingDispatch(
  this: ServiceContext,
  caller: Agent,
  parent: Agent,
  signal: AbortSignal,
) {
  if (caller === parent) return { questionAgent: parent }
  this.runtime.assertSiblingCapacity(parent.id)
  const worker = [...this.runtime.storage.workers.values()].find(
    (row) => row.parentSessionId === parent.id && row.harnessConversation?.sessionId === caller.id,
  )
  const surface =
    worker &&
    (this.runQuestionSessions?.get(worker.runId) ??
      (this.runOrigins?.get(worker.runId) === 'agent' ? parent.id : caller.id))
  const questionAgent = surface ? this.ctx.agents.get(surface as Agent['id']) : parent
  if (!questionAgent) throw new Error('发起者当前轮的询问会话不可用；任务尚未创建')
  const label = worker
    ? workerName(worker)
    : (await readDshChildren(this.ctx.get('sessionQuery'), parent.id, signal)).find(
        (row) => row.id === caller.id,
      )?.label
  return {
    questionAgent,
    initiator: {
      kind: worker ? ('worker' as const) : ('subagent' as const),
      id: worker?.id ?? caller.id,
      name: label || caller.id,
    },
  }
}

/** Read installation paths without saving discovery or opening a native account/model process. */
export async function resolveDispatchName(this: ServiceContext, name: string, signal: AbortSignal) {
  const installed = async (cli: 'qoder' | 'qodercn' | 'workbuddycn' | 'workbuddy') => {
    signal.throwIfAborted()
    const saved = this.options.cliExecutablePaths?.read(cli)
    const config = {
      ...this.options,
      cliExecutablePaths: undefined,
      ...(saved?.mode === 'manual' ? { [`${cli}Executable`]: saved.path } : {}),
    }
    try {
      await resolveCliExecutable(cli, this.backend, config, signal)
      signal.throwIfAborted()
      return true
    } catch (error) {
      if (error instanceof ProcessCleanupUnconfirmedError) {
        this.runtime.blockCatalogOnCleanup(cli, error)
        throw error
      }
      signal.throwIfAborted()
      // A missing manually configured entry is a broken selection, not absence.
      if (!saved || saved.mode !== 'manual') {
        if (
          !configuredCliExecutable(cli, config) &&
          ((error instanceof WorkBuddyUnavailableError && error.reason === 'not-installed') ||
            error instanceof WindowsCliNotFoundError ||
            error instanceof SubprocessExecutableNotFoundError ||
            ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? ''))
        )
          return false
      }
      throw error
    }
  }
  return isGenericWorkBuddyName(name)
    ? resolveAvailableWorkBuddyName(name, installed)
    : resolveAvailableCliName(name, installed)
}

export async function chooseQoderVariant(
  this: ServiceContext,
  agent: Agent,
  callerSignal: AbortSignal,
  name: string,
  questionAgent = agent,
) {
  const signal = AbortSignal.any([callerSignal, this.disposed.signal])
  signal.throwIfAborted()
  const project = this.project(agent)
  const key = JSON.stringify([agent.id, project, 'qoder-variant'])
  const waits = (this.dispatchWaits ??= new Map())
  const previous = waits.get(key) ?? Promise.resolve()
  let release!: () => void
  const owned = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => owned)
  waits.set(key, tail)
  void tail.then(() => {
    if (waits.get(key) === tail) waits.delete(key)
  })
  this.pending.set(agent.id, (this.pending.get(agent.id) ?? 0) + 1)
  this.runtime.changed()
  try {
    await waitForInput(previous, signal)
    this.assertExecution(agent, true)
    const resolution = await this.resolveDispatchName(name, signal)
    signal.throwIfAborted()
    let cli: 'qoder' | 'qodercn'
    if (resolution.status === 'resolved' && (resolution.cli === 'qoder' || resolution.cli === 'qodercn'))
      cli = resolution.cli
    else if (resolution.status === 'ambiguous') {
      const response = await waitForInput(
        questionAgent.ctx.get('userQuestions')!.ask({
          agent: questionAgent,
          signal,
          questions: [
            {
              id: 'cliworker_qoder_variant',
              header: 'Qoder 版本',
              question: '检测到 Qoder 和 Qoder CN，请选择本次使用的版本',
              options: [{ label: 'Qoder' }, { label: 'Qoder CN' }],
            },
          ],
        }),
        signal,
      )
      signal.throwIfAborted()
      const answer = response.answers.find((item) => item.id === 'cliworker_qoder_variant')
      if (
        answer?.custom !== undefined ||
        answer?.selected.length !== 1 ||
        !['Qoder', 'Qoder CN'].includes(answer.selected[0]!)
      )
        throw new Error('请选择 Qoder 或 Qoder CN；任务尚未启动')
      cli = answer.selected[0] === 'Qoder' ? 'qoder' : 'qodercn'
    } else throw new Error('未找到 Qoder 或 Qoder CN 安装，请先安装或配置 CLI 路径；任务尚未启动')
    signal.throwIfAborted()
    this.assertExecution(agent, true)
    if (this.project(agent) !== project) throw new Error('项目已变更，请重新选择')
    this.runtime.assertCliEnabled(cli)
    return cli
  } finally {
    release()
    const pending = (this.pending.get(agent.id) ?? 1) - 1
    if (pending) this.pending.set(agent.id, pending)
    else this.pending.delete(agent.id)
    this.runtime.changed()
  }
}

export async function chooseWorkBuddyVariant(
  this: ServiceContext,
  agent: Agent,
  callerSignal: AbortSignal,
  name: string,
  questionAgent = agent,
) {
  const signal = AbortSignal.any([callerSignal, this.disposed.signal])
  signal.throwIfAborted()
  const project = this.project(agent)
  const key = JSON.stringify([agent.id, project, 'workbuddy-variant'])
  const waits = (this.dispatchWaits ??= new Map())
  const previous = waits.get(key) ?? Promise.resolve()
  let release!: () => void
  const owned = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => owned)
  waits.set(key, tail)
  void tail.then(() => {
    if (waits.get(key) === tail) waits.delete(key)
  })
  this.pending.set(agent.id, (this.pending.get(agent.id) ?? 0) + 1)
  this.runtime.changed()
  try {
    await waitForInput(previous, signal)
    this.assertExecution(agent, true)
    const resolution = await this.resolveDispatchName(name, signal)
    signal.throwIfAborted()
    let cli: 'workbuddycn' | 'workbuddy'
    if (resolution.status === 'resolved' && isWorkBuddyCli(resolution.cli)) cli = resolution.cli
    else if (resolution.status === 'ambiguous') {
      const response = await waitForInput(
        questionAgent.ctx.get('userQuestions')!.ask({
          agent: questionAgent,
          signal,
          questions: [
            {
              id: 'cliworker_workbuddy_variant',
              header: 'WorkBuddy 版本',
              question: '检测到 WorkBuddy CN 和 WorkBuddy（国际版），请选择本次使用的版本',
              options: [{ label: 'WorkBuddy CN' }, { label: 'WorkBuddy（国际版）' }],
            },
          ],
        }),
        signal,
      )
      signal.throwIfAborted()
      const answer = response.answers.find((item) => item.id === 'cliworker_workbuddy_variant')
      if (
        answer?.custom !== undefined ||
        answer?.selected.length !== 1 ||
        !['WorkBuddy CN', 'WorkBuddy（国际版）'].includes(answer.selected[0]!)
      )
        throw new Error('请选择 WorkBuddy CN 或 WorkBuddy（国际版）；任务尚未启动')
      cli = answer.selected[0] === 'WorkBuddy CN' ? 'workbuddycn' : 'workbuddy'
    } else
      throw new Error('未找到 WorkBuddy CN 或 WorkBuddy（国际版）安装，请先安装或配置 CLI 路径；任务尚未启动')
    signal.throwIfAborted()
    this.assertExecution(agent, true)
    if (this.project(agent) !== project) throw new Error('项目已变更，请重新选择')
    this.runtime.assertCliEnabled(cli)
    return cli
  } finally {
    release()
    const pending = (this.pending.get(agent.id) ?? 1) - 1
    if (pending) this.pending.set(agent.id, pending)
    else this.pending.delete(agent.id)
    this.runtime.changed()
  }
}

/**
 * Serialize only this conversation's questions; a cancelled waiter never owns
 * the question. A settled setup asks nothing, so its catalog check leaves the
 * queue and parallel dispatches of one conversation start together.
 */
export async function chooseDispatch(
  this: ServiceContext,
  agent: Agent,
  callerSignal: AbortSignal,
  cli: CliId,
  questionAgent = agent,
): Promise<DispatchSetup> {
  const signal = AbortSignal.any([callerSignal, this.disposed.signal])
  signal.throwIfAborted()
  this.runtime.assertCliEnabled(cli)
  const project = this.project(agent)
  const key = JSON.stringify([agent.id, project, cli])
  const waits = (this.dispatchWaits ??= new Map())
  const turn = () => {
    const previous = waits.get(key) ?? Promise.resolve()
    let release!: () => void
    const owned = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => owned)
    waits.set(key, tail)
    void tail.then(() => {
      if (waits.get(key) === tail) waits.delete(key)
    })
    return { previous, release }
  }
  this.pending.set(agent.id, (this.pending.get(agent.id) ?? 0) + 1)
  this.runtime.changed()
  try {
    for (let queued = false; ; queued = true) {
      const { previous, release } = turn()
      let held = true
      try {
        await waitForInput(previous, signal)
        signal.throwIfAborted()
        this.assertExecution(agent, true)
        this.runtime.assertCliEnabled(cli)
        if (!queued && this.runtime.storage.conversationSetup(agent.id, project, cli)) {
          release()
          held = false
        }
        this.settingsCatalogs ??= new SettingsCatalogCache(this.runtime.storage.directory)
        const catalogRevision = this.settingsCatalogs.revision(cli)
        const queried = await this.queryCatalog(cli, this.backend, this.options, project, signal)
        const { catalog } = queried
        let { binding } = queried
        signal.throwIfAborted()
        this.runtime.assertCliEnabled(cli)
        this.settingsCatalogs.remember(project, { catalog, binding }, catalogRevision)
        const models = catalog.models
        const valid = (setup: DispatchSetup | undefined): setup is DispatchSetup => {
          // A saved choice outlives an account change: the current account must still offer it,
          // and launch authorizes it again under that account.
          if (!setup || cliOf(setup.preference) !== cli) return false
          try {
            validatePreference(setup.preference, catalog)
            return resolveModel(setup.preference, models).model === setup.preference.model
          } catch {
            return false
          }
        }
        let asked = false
        const ask = async (questions: AskUserQuestionItem[]) => {
          signal.throwIfAborted()
          asked = true
          const response = await waitForInput(
            questionAgent.ctx.get('userQuestions')!.ask({ agent: questionAgent, signal, questions }),
            signal,
          )
          signal.throwIfAborted()
          this.runtime.assertCliEnabled(cli)
          return response
        }
        const current = this.runtime.storage.conversationSetup(agent.id, project, cli)
        let setup: DispatchSetup | undefined = valid(current) ? current : undefined
        // The settled setup no longer fits this catalog: ask again in turn.
        if (!setup && !held) continue
        let selected = false
        // The only unasked start: the user turned asking off and the saved complete setup still checks out.
        if (!setup && this.runtime.storage.generalSettings().askBeforeDispatch === false) {
          const saved = this.runtime.storage.dispatchSetup(project, cli)
          if (valid(saved)) setup = saved
        } else if (!current) {
          const saved = this.runtime.storage.dispatchSetup(project, cli)
          if (valid(saved)) {
            const modelLabel =
              models.find(
                (model) =>
                  model.id === saved.preference.model ||
                  Object.values(model.variants ?? {}).includes(saved.preference.model),
              )?.label ?? saved.preference.model
            const response = await ask([
              {
                id: 'cliworker_reuse',
                header: '沿用设定',
                question: `是否沿用 ${modelLabel} · ${effortLabel(saved.preference.effort)} · ${saved.role?.name ?? '不使用角色预设'}？`,
                options: [{ label: '沿用' }, { label: '重新选择' }],
              },
            ])
            const answer = response.answers.find((item) => item.id === 'cliworker_reuse')
            if (
              answer?.custom !== undefined ||
              answer?.selected.length !== 1 ||
              !['沿用', '重新选择'].includes(answer.selected[0]!)
            )
              throw new Error('请选择沿用或重新选择；任务尚未启动')
            if (answer.selected[0] === '沿用') setup = saved
          }
        }
        if (!setup) {
          const choices = visibleModelChoices(models)
          const response = await ask([
            {
              id: 'cliworker_model',
              header: `${CLI_LABELS[cli]} 模型`,
              question: '选择模型',
              options: choices.map((model) => ({ label: model.label })),
            },
          ])
          const answer = response.answers.find((item) => item.id === 'cliworker_model')
          const chosen =
            answer?.custom === undefined && answer?.selected.length === 1
              ? choices.find((model) => model.label === answer.selected[0])
              : undefined
          if (!chosen?.efforts?.length) throw new Error('请选择列表中的模型')
          const offered = structuredClone(this.runtime.storage.rolePresets())
          const questions: AskUserQuestionItem[] = []
          if (chosen.efforts.length > 1)
            questions.push({
              id: 'cliworker_effort',
              header: '思考强度',
              question: `选择 ${chosen.label} 的思考强度`,
              options: chosen.efforts.map((effort) => ({ label: effortLabel(effort) })),
            })
          questions.push(roleQuestion(offered))
          const selection = await ask(questions)
          const effortAnswer = selection.answers.find((item) => item.id === 'cliworker_effort')
          const effort =
            chosen.efforts.length === 1
              ? chosen.efforts[0]
              : effortAnswer?.custom === undefined && effortAnswer?.selected.length === 1
                ? chosen.efforts.find((effort) => effortLabel(effort) === effortAnswer.selected[0])
                : undefined
          const preference = resolveModel(preferenceSchema.parse({ cli, model: chosen.id, effort }), models)
          setup = { preference, role: readRoleAnswer(offered, selection) ?? null, binding }
          selected = true
        }
        // A remembered answer is never execution authority. Detect changes during any
        // question; an unasked setup was just checked, and launch checks it again.
        if (asked) {
          const checked = await this.authorizeChoice(
            setup.preference,
            this.backend,
            this.options,
            project,
            signal,
            binding,
          )
          if (checked.preference.model !== setup.preference.model)
            throw new Error('模型与思考强度已变更，请重新选择')
          binding = checked.binding
          setup = { ...setup, binding }
        }
        signal.throwIfAborted()
        this.assertExecution(agent, true)
        this.runtime.assertCliEnabled(cli)
        if (this.project(agent) !== project) throw new Error('项目已变更，请重新选择')
        if (selected) this.runtime.storage.setDispatchSetup(project, setup)
        if (current !== setup) this.runtime.storage.setConversationSetup(agent.id, project, setup)
        ;(this.selectionBindings ??= new WeakMap()).set(setup.preference, binding)
        ;(this.selectionProjects ??= new WeakMap()).set(setup.preference, project)
        return setup
      } finally {
        if (held) release()
      }
    }
  } finally {
    const pending = (this.pending.get(agent.id) ?? 1) - 1
    if (pending) this.pending.set(agent.id, pending)
    else this.pending.delete(agent.id)
    this.runtime.changed()
  }
}

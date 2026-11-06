import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { AccountsWindow } from '../src/client/account-login/accounts-window.tsx'
vi.mock('../src/client/account-terminal.tsx',()=>({AccountTerminal:(props: any)=>createElement('synthetic-terminal',{login:props.login})}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives',()=>({Button:({children,...props}:any)=>createElement('button',props,children),IconPlusOutlineRegular:()=>null}))
it('shows native credential numbers so the old OMP key can be selected without guessing list position (synthetic UI)', async()=> {
  let renderer: ReturnType<typeof create>
  await act(async()=>{renderer=create(createElement(AccountsWindow,{
    api:{} as any,sessionId:'synthetic',cli:'omp',closeControl:{current:undefined},onRefresh:()=>{},onClose:()=>{},
    status:{cli:'omp',installed:true,state:'configured',summary:'Synthetic',actions:[],logins:[2,1].map(id=>({id:`omp:zhipu-coding-plan:plugin.${id}`,source:'plugin' as const,providerLabel:'智谱 BigModel Coding（中国）',authMethod:'api' as const}))},
  }))})
  const cards=renderer!.root.findAllByType('li')
  const text=(node:any):string=> typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):''
  expect(text(cards[0])).toContain('凭据 #2')
  expect(text(cards[1])).toContain('凭据 #1')
  await act(async()=>{cards[1]!.findAllByType('button')[0]!.props.onClick()})
  const confirm=renderer!.root.findAllByType('button').find(b=>text(b)==='确认退出')!
  await act(async()=>{confirm.props.onClick()})
  expect(renderer!.root.findByType('synthetic-terminal').props.login).toBe('omp:zhipu-coding-plan:plugin.1')
  await act(async()=>renderer!.unmount())
})
